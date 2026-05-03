#!/usr/bin/env node
/**
 * Start or stop an isolated Streamliner preview for the current worktree.
 *
 * The preview uses separate API/Vite ports and writes runtime state under
 * .streamliner-preview\<name>\ so it does not disturb the main checkout's
 * Streamliner process or registries.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_GRAPH = ".streamliner\\workstreams\\session-launching-and-tracking\\graph.json";

function usage() {
  console.log(`Usage:
  npm run preview:worktree -- [--graph <graph.json>] [--name <id>] [--mode readonly|sandbox] [--api-port <port>] [--web-port <port>] [--attached]
  npm run preview:stop -- [--name <id>]
  npm run preview:status -- [--name <id>]

Defaults:
  --mode readonly
  --name <current-directory-name>
  --root .streamliner-preview\\<name>\\
  Ports are reused from .streamliner-preview\\<name>\\ports.json when available.
  Use --attached when a Copilot-managed background shell should own the preview lifetime.
`);
}

function parseArgs(argv) {
  const args = {
    command: "start",
    host: DEFAULT_HOST,
    mode: "readonly",
  };
  const positional = [];
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${arg} requires a value.`);
      }
      return argv[index];
    };
    switch (arg) {
      case "--":
        break;
      case "--help":
      case "-h":
        args.command = "help";
        break;
      case "--stop":
        args.command = "stop";
        break;
      case "--status":
        args.command = "status";
        break;
      case "--name":
        args.name = next();
        break;
      case "--root":
        args.root = next();
        break;
      case "--graph":
        args.graph = next();
        break;
      case "--mode":
        args.mode = next();
        break;
      case "--api-port":
        args.apiPort = Number(next());
        break;
      case "--web-port":
        args.webPort = Number(next());
        break;
      case "--force":
        args.force = true;
        break;
      case "--attached":
      case "--foreground":
        args.attached = true;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        positional.push(arg);
    }
  }
  applyPositionalArgs(args, positional);
  if (args.mode !== "readonly" && args.mode !== "sandbox") {
    throw new Error("--mode must be readonly or sandbox.");
  }
  for (const [name, value] of [["--api-port", args.apiPort], ["--web-port", args.webPort]]) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0 || value > 65_535)) {
      throw new Error(`${name} must be a TCP port.`);
    }
  }
  return args;
}

function looksLikeGraphPath(value) {
  return (
    value.toLowerCase().endsWith(".json") ||
    value.includes("\\") ||
    value.includes("/")
  );
}

function applyPositionalArgs(args, positional) {
  for (const value of positional) {
    if (args.command === "stop" || args.command === "status") {
      if (!args.name) {
        args.name = value;
        continue;
      }
      throw new Error(`Unexpected positional argument: ${value}`);
    }
    if ((value === "readonly" || value === "sandbox") && args.mode === "readonly") {
      args.mode = value;
      continue;
    }
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric > 0 && numeric <= 65_535) {
      if (args.apiPort === undefined) {
        args.apiPort = numeric;
        continue;
      }
      if (args.webPort === undefined) {
        args.webPort = numeric;
        continue;
      }
    }
    if (!args.graph && looksLikeGraphPath(value)) {
      args.graph = value;
      continue;
    }
    if (!args.name) {
      args.name = value;
      continue;
    }
    if (!args.graph) {
      args.graph = value;
      continue;
    }
    throw new Error(`Unexpected positional argument: ${value}`);
  }
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "worktree-preview";
}

function previewPaths(args) {
  const name = slugify(args.name ?? basename(process.cwd()));
  const root = resolve(args.root ?? join(process.cwd(), ".streamliner-preview", name));
  return {
    name,
    root,
    manifestPath: join(root, "preview.json"),
    portsPath: join(root, "ports.json"),
    logsDir: join(root, "logs"),
    stateRoot: join(root, "state", "session-registry"),
    workstreamRegistryPath: join(root, "state", "workstream-registry", "workstreams.json"),
    workstreamSourceRegistryPath: join(root, "state", "workstream-registry", "sources.json"),
    recentsPath: join(root, "state", "recent-graphs.json"),
  };
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function getFreePort(host) {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Could not allocate a free TCP port."));
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}

async function isPortAvailable(host, port) {
  return new Promise((resolveAvailability) => {
    const server = createServer();
    server.once("error", () => {
      resolveAvailability(false);
    });
    server.listen(port, host, () => {
      server.close(() => {
        resolveAvailability(true);
      });
    });
  });
}

function readSavedPorts(paths, host) {
  if (!existsSync(paths.portsPath)) {
    return {};
  }
  try {
    const saved = JSON.parse(readFileSync(paths.portsPath, "utf8"));
    if (saved.host && saved.host !== host) {
      return {};
    }
    return {
      apiPort: Number.isInteger(saved.apiPort) ? saved.apiPort : undefined,
      webPort: Number.isInteger(saved.webPort) ? saved.webPort : undefined,
    };
  } catch {
    return {};
  }
}

function writePortCache(paths, host, apiPort, webPort) {
  writeFileSync(
    paths.portsPath,
    JSON.stringify({
      host,
      apiPort,
      webPort,
      updatedAt: new Date().toISOString(),
    }, null, 2),
    "utf8",
  );
}

function portFromUrl(url) {
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 && port <= 65_535
      ? port
      : undefined;
  } catch {
    return undefined;
  }
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

async function resolvePort(host, explicitPort, savedPort, label) {
  if (explicitPort !== undefined) {
    return explicitPort;
  }
  if (savedPort !== undefined && await isPortAvailable(host, savedPort)) {
    return savedPort;
  }
  const port = await getFreePort(host);
  if (savedPort !== undefined) {
    console.warn(`Saved ${label} port ${savedPort} is unavailable; using ${port}.`);
  }
  return port;
}

async function resolvePreviewPorts(args, paths) {
  const saved = readSavedPorts(paths, args.host);
  const apiPort = await resolvePort(args.host, args.apiPort, saved.apiPort, "API");
  let webPort = await resolvePort(args.host, args.webPort, saved.webPort, "web");
  if (apiPort === webPort) {
    if (args.webPort !== undefined) {
      throw new Error("API and web ports must be different.");
    }
    do {
      webPort = await getFreePort(args.host);
    } while (webPort === apiPort);
  }
  return { apiPort, webPort };
}

async function waitForUrl(url, label) {
  const deadline = Date.now() + 45_000;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label} at ${url}. Last error: ${lastError}`);
}

function deriveProjectKey(graph) {
  if (typeof graph.projectKey === "string" && graph.projectKey.length > 0) {
    return graph.projectKey;
  }
  const repos = Array.isArray(graph.repos) ? graph.repos : [];
  const primaryRepos = repos.filter((repo) => repo?.role === "primary" && typeof repo.id === "string");
  if (primaryRepos.length === 1) {
    return primaryRepos[0].id;
  }
  const repoIds = repos.map((repo) => repo?.id).filter((id) => typeof id === "string");
  if (repoIds.length === 1) {
    return repoIds[0];
  }
  return graph.id;
}

function assertKebabId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`Expected ${label} to be a kebab-case id.`);
  }
}

async function seedWorkstreamRegistry(graphPath, registryPath) {
  const absGraphPath = resolve(graphPath);
  const graph = JSON.parse(await readFile(absGraphPath, "utf8"));
  const workstreamId = graph.id;
  const projectKey = deriveProjectKey(graph);
  assertKebabId(projectKey, "projectKey");
  assertKebabId(workstreamId, "workstreamId");

  const timestamp = new Date().toISOString();
  const current = existsSync(registryPath)
    ? JSON.parse(readFileSync(registryPath, "utf8"))
    : { version: 1, migrationWarnings: [], workstreams: [] };
  const workstreams = Array.isArray(current.workstreams) ? current.workstreams : [];
  const key = `${projectKey}/${workstreamId}`;
  const nextEntry = {
    projectKey,
    workstreamId,
    title: typeof graph.title === "string" ? graph.title : workstreamId,
    summary: typeof graph.summary === "string" ? graph.summary : "",
    path: absGraphPath,
    addedAt: workstreams.find((entry) => `${entry.projectKey}/${entry.workstreamId}` === key)?.addedAt ?? timestamp,
    lastOpenedAt: timestamp,
  };
  const nextRegistry = {
    version: 1,
    migratedFromRecentsAt: current.migratedFromRecentsAt ?? timestamp,
    migrationWarnings: Array.isArray(current.migrationWarnings) ? current.migrationWarnings : [],
    workstreams: [
      nextEntry,
      ...workstreams.filter((entry) => {
        const sameKey = `${entry.projectKey}/${entry.workstreamId}` === key;
        const samePath = typeof entry.path === "string" &&
          resolve(entry.path).toLowerCase() === absGraphPath.toLowerCase();
        return !sameKey && !samePath;
      }),
    ],
  };
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(nextRegistry, null, 2), "utf8");
  return {
    graphPath: absGraphPath,
    projectKey,
    workstreamId,
    path: `/workstreams/${encodeURIComponent(projectKey)}/${encodeURIComponent(workstreamId)}`,
  };
}

async function writeEmptySourceRegistry(sourceRegistryPath) {
  if (existsSync(sourceRegistryPath)) {
    return;
  }
  await mkdir(dirname(sourceRegistryPath), { recursive: true });
  await writeFile(
    sourceRegistryPath,
    JSON.stringify({
      version: 1,
      sources: [],
      archivedWorkstreams: [],
      discoveredWorkstreams: [],
    }, null, 2),
    "utf8",
  );
}

function spawnWindowsHiddenNodeProcess(args, options) {
  const script = [
    "@echo off",
    `cd /d ${cmdQuote(process.cwd())}`,
    [
      cmdQuote(process.execPath),
      ...args.map(cmdQuote),
      `1>>${cmdQuote(options.stdoutPath)}`,
      `2>>${cmdQuote(options.stderrPath)}`,
    ].join(" "),
  ].join("\r\n");
  writeFileSync(options.scriptPath, script, "utf8");
  const child = spawn(process.env.ComSpec ?? "cmd.exe", [
    "/d",
    "/c",
    options.scriptPath,
  ], {
    cwd: process.cwd(),
    env: options.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child;
}

function spawnNodeProcess(args, options) {
  const stdout = openSync(options.stdoutPath, "a");
  const stderr = openSync(options.stderrPath, "a");
  if (process.platform === "win32" && !options.attached) {
    closeSync(stdout);
    closeSync(stderr);
    return spawnWindowsHiddenNodeProcess(args, options);
  }
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: options.env,
    detached: !options.attached,
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
  closeSync(stdout);
  closeSync(stderr);
  if (!options.attached) {
    child.unref();
  }
  return child;
}

async function waitForPreviewManifestRemoval(paths, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(paths.manifestPath)) {
      return true;
    }
    await delay(100);
  }
  return !existsSync(paths.manifestPath);
}

async function waitForAttachedPreview(paths, children) {
  let stopping = false;
  const cleanup = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    for (const child of children) {
      if (child.pid) {
        await stopPid(child.pid);
      }
    }
    rmSync(paths.manifestPath, { force: true });
  };
  const handleSignal = (signal) => {
    cleanup()
      .then(() => {
        process.exit(signal === "SIGINT" ? 130 : 143);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      });
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  await new Promise((resolveWait, rejectWait) => {
    for (const child of children) {
      child.once("exit", (code, signal) => {
        if (stopping) {
          resolveWait();
          return;
        }
        waitForPreviewManifestRemoval(paths)
          .then((stopped) => {
            if (stopped) {
              resolveWait();
              return;
            }
            const name = child === children[0] ? "API" : "Vite";
            rejectWait(new Error(`${name} preview process exited unexpectedly (code ${code ?? "null"}, signal ${signal ?? "null"}).`));
          })
          .catch((error) => {
            rejectWait(error instanceof Error ? error : new Error(String(error)));
          });
      });
      child.once("error", rejectWait);
    }
  }).finally(async () => {
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
    await cleanup();
  });
}

async function startPreview(args) {
  const paths = previewPaths(args);
  if (existsSync(paths.manifestPath)) {
    const existing = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
    if (!args.force && (isAlive(existing.apiPid) || isAlive(existing.webPid))) {
      console.log(`Preview '${paths.name}' is already running at ${existing.workstreamUrl ?? existing.webUrl}`);
      console.log(`Stop it with: npm run preview:stop -- --name ${paths.name}`);
      return;
    }
  }

  mkdirSync(paths.logsDir, { recursive: true });
  await writeEmptySourceRegistry(paths.workstreamSourceRegistryPath);
  const defaultGraph = resolve(DEFAULT_GRAPH);
  const graphPath = args.graph
    ? (isAbsolute(args.graph) ? args.graph : resolve(args.graph))
    : existsSync(defaultGraph)
      ? defaultGraph
      : undefined;
  const seeded = graphPath
    ? await seedWorkstreamRegistry(graphPath, paths.workstreamRegistryPath)
    : undefined;

  const { apiPort, webPort } = await resolvePreviewPorts(args, paths);
  const apiUrl = `http://${args.host}:${apiPort}`;
  const webUrl = `http://${args.host}:${webPort}`;
  const workstreamUrl = seeded ? `${webUrl}${seeded.path}` : webUrl;
  const env = {
    ...process.env,
    STREAMLINER_API_HOST: args.host,
    STREAMLINER_API_PORT: String(apiPort),
    STREAMLINER_SESSION_REGISTRY_ROOT: paths.stateRoot,
    STREAMLINER_WORKSTREAM_REGISTRY: paths.workstreamRegistryPath,
    STREAMLINER_WORKSTREAM_SOURCE_REGISTRY: paths.workstreamSourceRegistryPath,
    STREAMLINER_RECENTS_PATH: paths.recentsPath,
    STREAMLINER_PREVIEW_READONLY: args.mode === "readonly" ? "1" : "0",
    STREAMLINER_INTERNAL_DISABLE_SESSION_WORKER: "1",
    BROWSER: "none",
  };
  if (seeded) {
    env.STREAMLINER_GRAPH = seeded.graphPath;
  }

  const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const viteBin = join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(tsxCli) || !existsSync(viteBin)) {
    throw new Error("Preview dependencies are missing. Run npm install before starting a preview.");
  }

  const api = spawnNodeProcess([tsxCli, "src/server/index.ts"], {
    env,
    stdoutPath: join(paths.logsDir, "api.out.log"),
    stderrPath: join(paths.logsDir, "api.err.log"),
    scriptPath: join(paths.logsDir, "api-launch.cmd"),
    attached: args.attached,
  });
  await waitForUrl(`${apiUrl}/api/health`, "Streamliner API");

  const web = spawnNodeProcess([viteBin, "--host", args.host, "--port", String(webPort), "--strictPort"], {
    env,
    stdoutPath: join(paths.logsDir, "vite.out.log"),
    stderrPath: join(paths.logsDir, "vite.err.log"),
    scriptPath: join(paths.logsDir, "vite-launch.cmd"),
    attached: args.attached,
  });
  await waitForUrl(webUrl, "Vite preview");

  const manifest = {
    name: paths.name,
    mode: args.mode,
    cwd: process.cwd(),
    root: paths.root,
    apiPid: api.pid,
    webPid: web.pid,
    apiUrl,
    webUrl,
    workstreamUrl,
    graphPath: seeded?.graphPath ?? null,
    startedAt: new Date().toISOString(),
    paths: {
      stateRoot: paths.stateRoot,
      workstreamRegistryPath: paths.workstreamRegistryPath,
      workstreamSourceRegistryPath: paths.workstreamSourceRegistryPath,
      recentsPath: paths.recentsPath,
      logsDir: paths.logsDir,
    },
  };
  writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  writePortCache(paths, args.host, apiPort, webPort);

  console.log(`Started Streamliner worktree preview '${paths.name}' (${args.mode}).`);
  console.log(`URL: ${workstreamUrl}`);
  console.log(`API: ${apiUrl}`);
  console.log(`Logs: ${paths.logsDir}`);
  console.log(`Stop: npm run preview:stop -- --name ${paths.name}`);
  if (args.attached) {
    console.log("Attached: this preview will stop when the owning shell exits.");
    await waitForAttachedPreview(paths, [api, web]);
  }
}

async function stopPid(pid) {
  if (!isAlive(pid)) {
    return;
  }
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.status === 0 || !isAlive(pid)) {
      return;
    }
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(100);
    if (!isAlive(pid)) {
      return;
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

async function stopPreview(args) {
  const paths = previewPaths(args);
  if (!existsSync(paths.manifestPath)) {
    console.log(`No preview manifest found for '${paths.name}'.`);
    return;
  }
  const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
  const apiPort = portFromUrl(manifest.apiUrl);
  const webPort = portFromUrl(manifest.webUrl);
  if (apiPort !== undefined && webPort !== undefined) {
    writePortCache(paths, args.host, apiPort, webPort);
  }
  await stopPid(manifest.webPid);
  await stopPid(manifest.apiPid);
  rmSync(paths.manifestPath, { force: true });
  console.log(`Stopped Streamliner worktree preview '${paths.name}'.`);
}

function statusPreview(args) {
  const paths = previewPaths(args);
  if (!existsSync(paths.manifestPath)) {
    console.log(`Preview '${paths.name}' is not running.`);
    return;
  }
  const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
  console.log(JSON.stringify({
    name: paths.name,
    mode: manifest.mode,
    webUrl: manifest.webUrl,
    workstreamUrl: manifest.workstreamUrl,
    apiAlive: isAlive(manifest.apiPid),
    webAlive: isAlive(manifest.webPid),
    apiPid: manifest.apiPid,
    webPid: manifest.webPid,
    apiUrl: manifest.apiUrl,
    logsDir: manifest.paths?.logsDir,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === "help") {
    usage();
    return;
  }
  if (args.command === "stop") {
    await stopPreview(args);
    return;
  }
  if (args.command === "status") {
    statusPreview(args);
    return;
  }
  await startPreview(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
