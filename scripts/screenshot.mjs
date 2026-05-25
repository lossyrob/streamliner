#!/usr/bin/env node
/**
 * Boot the Vite dev server against a graph file and capture a screenshot of
 * the Streamliner dashboard. Intended for iterative UI development — see
 * .github/skills/iterative-ui/SKILL.md for the full workflow.
 *
 * Usage:
 *   node scripts/screenshot.mjs \
 *       --graph <abs-path-to-graph.json> \
 *       --out   <abs-path-to-output.png> \
 *       [--path <url-path-or-query>] \
 *       [--selector <css-selector-to-wait-for>] \
 *       [--viewport 1600x1000] \
 *       [--full-page] \
 *       [--select-node <node-id>] \
 *       [--click <playwright-selector>] \
 *       [--delay-ms 600]
 *       [--state-root <dir-with-seeded-streamliner-state>]
 *       [--ready-timeout-ms 45000]
 *
 * Exit codes:
 *   0 — screenshot written
 *   2 — CLI arg error
 *   3 — dev server failed to become ready
 *   4 — page never reached the expected UI state
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, resolve, isAbsolute } from "node:path";
import { chromium } from "@playwright/test";

function killTree(proc) {
  if (!proc?.pid) return;
  if (process.platform === "win32") {
    // npx.cmd spawns a nested node process; kill the whole tree so Vite exits.
    spawnSync("taskkill", ["/pid", String(proc.pid), "/f", "/t"], { stdio: "ignore" });
  } else {
    if (proc.killed || proc.exitCode !== null) return;
    try { proc.kill("SIGTERM"); } catch { /* ignore */ }
  }
}

function parseArgs(argv) {
  const args = {
    viewport: { width: 1600, height: 1000 },
    path: "/",
    pathProvided: false,
    selector: ".react-flow__node",
    fullPage: false,
    delayMs: 600,
    readyTimeoutMs: 45_000,
    clickSelectors: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--graph":      args.graph = next(); break;
      case "--out":        args.out = next(); break;
      case "--path":       args.path = next(); args.pathProvided = true; break;
      case "--selector":   args.selector = next(); break;
      case "--select-node":args.selectNode = next(); break;
      case "--click":      args.clickSelectors.push(next()); break;
      case "--viewport": {
        const [w, h] = next().split("x").map(Number);
        args.viewport = { width: w, height: h };
        break;
      }
      case "--full-page":  args.fullPage = true; break;
      case "--delay-ms":   args.delayMs = Number(next()); break;
      case "--state-root": args.stateRoot = next(); break;
      case "--ready-timeout-ms": args.readyTimeoutMs = Number(next()); break;
      case "-h": case "--help":
        console.log("See header of scripts/screenshot.mjs for usage.");
        process.exit(0);
      default:
        console.error(`Unknown arg: ${a}`);
        process.exit(2);
    }
  }
  if (!args.graph || !args.out) {
    console.error("Required: --graph <abs-path> --out <abs-path>");
    process.exit(2);
  }
  if (!isAbsolute(args.graph)) args.graph = resolve(args.graph);
  if (!isAbsolute(args.out))   args.out   = resolve(args.out);
  if (args.stateRoot && !isAbsolute(args.stateRoot)) args.stateRoot = resolve(args.stateRoot);
  return args;
}

async function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Could not allocate a free TCP port"));
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

async function waitForViteReady(proc, timeoutMs) {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("timeout waiting for vite ready")), timeoutMs);
    let buffer = "";
    const tryMatch = () => {
      // Strip ANSI escape codes to make the regex robust across platforms.
      const clean = buffer.replace(/\x1b\[[0-9;]*m/g, "");
      const m = clean.match(/(https?:\/\/(?:127\.0\.0\.1|localhost)[^\s\/]*)/);
      if (m) {
        clearTimeout(timer);
        proc.stdout.off("data", onData);
        ok(m[1].replace(/\/$/, ""));
      }
    };
    const onData = (buf) => {
      const s = buf.toString();
      process.stdout.write(`[vite] ${s}`);
      buffer += s;
      tryMatch();
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", (b) => process.stderr.write(`[vite:err] ${b}`));
    proc.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`vite exited early with code ${code}`));
    });
  });
}

async function waitForApiReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the API process binds.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("timeout waiting for API ready");
}

async function main() {
  const args = parseArgs(process.argv);
  await mkdir(dirname(args.out), { recursive: true });

  const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
  const apiPort = String(await getFreePort());
  const apiRuntimeRoot = await mkdtemp(resolve(tmpdir(), "streamliner-screenshot-registry-"));
  const stateRoot = args.stateRoot ?? resolve(apiRuntimeRoot, "state");
  const logDir = resolve(stateRoot, "logs");
  const workstreamRegistryPath = resolve(apiRuntimeRoot, "workstream-registry", "workstreams.json");
  const workstreamSourceRegistryPath = resolve(apiRuntimeRoot, "workstream-registry", "sources.json");
  const recentsPath = resolve(apiRuntimeRoot, "recent-graphs.json");
  const childEnv = {
    ...process.env,
    STREAMLINER_GRAPH: args.graph,
    STREAMLINER_API_PORT: apiPort,
    STREAMLINER_API_HOST: "127.0.0.1",
    STREAMLINER_STATE_ROOT: stateRoot,
    STREAMLINER_LOG_DIR: logDir,
    STREAMLINER_SESSION_REGISTRY_ROOT: apiRuntimeRoot,
    STREAMLINER_WORKSTREAM_REGISTRY: workstreamRegistryPath,
    STREAMLINER_WORKSTREAM_SOURCE_REGISTRY: workstreamSourceRegistryPath,
    STREAMLINER_RECENTS_PATH: recentsPath,
    STREAMLINER_INTERNAL_DISABLE_SESSION_WORKER: "1",
    BROWSER: "none",
  };
  await mkdir(stateRoot, { recursive: true });
  const api = spawn(npxBin, ["tsx", "src/server/index.ts"], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  api.stdout.on("data", (b) => process.stdout.write(`[api] ${b}`));
  api.stderr.on("data", (b) => process.stderr.write(`[api:err] ${b}`));
  const vite = spawn(npxBin, ["vite", "--host", "127.0.0.1", "--port", "0", "--strictPort=false"], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  let baseUrl;
  try {
    await waitForApiReady(`http://127.0.0.1:${apiPort}`, args.readyTimeoutMs);
    const registerResponse = await fetch(`http://127.0.0.1:${apiPort}/api/workstreams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: args.graph }),
    });
    if (registerResponse.ok && !args.pathProvided) {
      const { workstream } = await registerResponse.json();
      args.path = `/workstreams/${encodeURIComponent(workstream.projectKey)}/${encodeURIComponent(workstream.workstreamId)}`;
    }
    baseUrl = await waitForViteReady(vite, args.readyTimeoutMs);
  } catch (e) {
    console.error(e.message);
    killTree(api);
    killTree(vite);
    process.exit(3);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: args.viewport });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("[page] ERROR", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("[page.console]", msg.text());
  });

  try {
    await page.goto(new URL(args.path, `${baseUrl}/`).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForSelector(args.selector, { timeout: 20_000 });
    if (args.selectNode) {
      await page.click(`.react-flow__node[data-id="${args.selectNode}"]`, { timeout: 5_000 });
    }
    for (const selector of args.clickSelectors) {
      await page.click(selector, { timeout: 5_000 });
    }
    // Small settle delay for xyflow animations / fit-view.
    await page.waitForTimeout(args.delayMs);
    await page.screenshot({ path: args.out, fullPage: args.fullPage });
    console.log(`Wrote ${args.out}`);
  } catch (e) {
    console.error("Failed to capture screenshot:", e.message);
    await page.screenshot({ path: args.out + ".error.png", fullPage: true }).catch(() => {});
    process.exitCode = 4;
  } finally {
    await browser.close().catch(() => {});
    killTree(api);
    killTree(vite);
    // Give taskkill a moment, then force-exit since npx.cmd may still hold stdio.
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
