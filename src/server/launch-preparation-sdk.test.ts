import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readPreparationProfile } from "./launch-preparation-profile";
import { createPreparationClient, definePreparationTool } from "./launch-preparation-sdk";

// A local protocol-3 peer, not a Copilot runtime. No authentication, model calls,
// real session state, or tools outside the supplied test handlers are possible.
const mockCli = String.raw`
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--help")) {
  console.log("--context <tier> [possible values: default, long_context]");
  process.exit(0);
}
function record(value) {
  appendFileSync(process.env.STREAMLINER_TEST_SDK_WIRE_LOG, JSON.stringify(value) + "\n");
}
record({ method: "process.start", params: { args: process.argv.slice(2), cwd: process.cwd() } });
function send(value) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...value });
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body);
}
let eventId = 0;
function event(sessionId, type, data) {
  send({ method: "session.event", params: { sessionId, event: {
    id: String(++eventId), timestamp: new Date().toISOString(), parentId: null, type, data,
  } } });
}
let turn = 0;
const pending = new Map();
function dispatch(message) {
  record(message);
  const { id, method, params = {} } = message;
  if (id === undefined) return;
  let result;
  switch (method) {
    case "connect":
    case "ping":
      result = { protocolVersion: 3 }; break;
    case "models.list":
      result = { models: [{
        id: "gpt-6-astra", name: "GPT-6 Astra",
        capabilities: { supports: { reasoningEffort: true, vision: true },
          limits: { max_context_window_tokens: 1050000 } },
        supportedReasoningEfforts: ["high"],
        billing: { multiplier: 1, tokenPrices: { longContext: { contextMax: 1050000 } } },
      }] }; break;
    case "session.create":
    case "session.resume":
      result = { sessionId: params.sessionId, workspacePath: process.cwd() }; break;
    case "session.send": {
      const toolName = ++turn === 1 ? "save_streamliner_context" : "complete_paw_init";
      const requestId = "tool-" + turn;
      pending.set(requestId, params.sessionId);
      send({ id, result: { messageId: "message-" + turn } });
      event(params.sessionId, "external_tool.requested", {
        requestId, toolCallId: requestId, toolName, arguments: { content: toolName },
      });
      return;
    }
    case "session.tools.handlePendingToolCall": {
      send({ id, result: { success: true } });
      const sessionId = pending.get(params.requestId);
      pending.delete(params.requestId);
      event(sessionId, "external_tool.completed", { requestId: params.requestId });
      event(sessionId, "assistant.message", { messageId: "reply-" + turn, content: '{"status":"ready"}' });
      event(sessionId, "session.idle", {});
      return;
    }
    case "session.detach":
    case "session.destroy":
    case "runtime.shutdown":
      result = { success: true }; break;
    default:
      send({ id, error: { code: -32601, message: "Unexpected mock method: " + method } });
      return;
  }
  send({ id, result });
}
let buffer = Buffer.alloc(0);
process.stdin.on("data", chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const match = /Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString());
    if (!match) throw Error("Invalid RPC framing");
    const length = Number(match[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    dispatch(message);
  }
});
`;

interface WireMessage {
  method: string;
  params: Record<string, unknown>;
}

let root: string;
let cliPath: string;
let wirePath: string;
const clients = new Set<Awaited<ReturnType<typeof createPreparationClient>>>();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "streamliner-preparation-wire-"));
  cliPath = join(root, "mock-cli.js");
  wirePath = join(root, "wire.jsonl");
  writeFileSync(cliPath, mockCli);
  vi.stubEnv("STREAMLINER_TEST_SDK_WIRE_LOG", wirePath);
});

afterEach(async () => {
  for (const client of clients) await client.stop();
  clients.clear();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 });
});

function messages(): WireMessage[] {
  return readFileSync(wirePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

async function clientFor(context: "long_context" | "default" | undefined) {
  const profile = readPreparationProfile({
    STREAMLINER_PAW_INIT_CLI_PATH: cliPath,
    STREAMLINER_PAW_INIT_MODEL: "gpt-6-astra",
    STREAMLINER_PAW_INIT_REASONING_EFFORT: "high",
    ...(context !== undefined ? { STREAMLINER_PAW_INIT_CONTEXT: context } : {}),
  });
  const client = await createPreparationClient(profile, root);
  clients.add(client);
  await client.start();
  return client;
}

describe("preparation SDK transport", () => {
  it.each(["long_context", "default"] as const)("serializes %s on actual create and resume RPCs", async (context) => {
    // Even an ambient in-process preference must not override the explicit stdio path.
    vi.stubEnv("COPILOT_SDK_DEFAULT_CONNECTION", "inprocess");
    const client = await clientFor(context);
    const config = { clientName: "preparation-wire-test", workingDirectory: root, configDir: join(root, "config"), tools: [] };
    const created = await client.createSession(config);
    await created.disconnect();
    const resumed = await client.resumeSession(created.sessionId, config);
    expect(resumed.sessionId).toBe(created.sessionId);
    await resumed.disconnect();
    expect(await client.stop()).toEqual([]);
    clients.delete(client);

    const wire = messages();
    const sessions = wire.filter((entry) => ["session.create", "session.resume"].includes(entry.method));
    expect(sessions.map((entry) => entry.method)).toEqual(["session.create", "session.resume"]);
    for (const { params } of sessions) {
      expect(params).toMatchObject({
        model: "gpt-6-astra", reasoningEffort: "high", contextTier: context,
        workingDirectory: root, configDir: join(root, "config"), requestPermission: true,
      });
      expect(params).not.toHaveProperty("modelCapabilities");
      expect(params).not.toHaveProperty("configDirectory");
    }
    expect(wire[0].params).toMatchObject({ cwd: root });
    expect(wire[0].params.args).toContain("--stdio");
    expect(wire[0].params.args).not.toContain("--context");
    expect(wire.filter((entry) => entry.method === "session.detach")).toHaveLength(2);
    expect(wire.filter((entry) => entry.method === "runtime.shutdown")).toHaveLength(1);
    expect(wire.findIndex((entry) => entry.method === "models.list"))
      .toBeLessThan(wire.findIndex((entry) => entry.method === "session.create"));
  });

  it("omits context on create and resume when only model/reasoning/CLI are configured", async () => {
    const client = await clientFor(undefined);
    const created = await client.createSession({ tools: [] });
    await created.disconnect();
    const resumed = await client.resumeSession(created.sessionId, { tools: [] });
    await resumed.disconnect();
    for (const entry of messages().filter((entry) => ["session.create", "session.resume"].includes(entry.method))) {
      expect(entry.params).not.toHaveProperty("contextTier");
      expect(entry.params).toMatchObject({ model: "gpt-6-astra", reasoningEffort: "high" });
    }
  });

  it("dispatches version-correct tools exactly once and releases event listeners and the session", async () => {
    const client = await clientFor("long_context");
    const save = vi.fn(async (args: { content: string }) => ({ saved: args.content }));
    const complete = vi.fn(async () => ({ status: "ready" }));
    const toolConfig = { description: "Mock lifecycle tool", skipPermission: true, parameters: { type: "object" } };
    const session = await client.createSession({
      tools: [
        definePreparationTool("save_streamliner_context", { ...toolConfig, handler: save }),
        definePreparationTool("complete_paw_init", { ...toolConfig, handler: complete }),
      ],
    });
    const events = vi.fn();
    const off = session.on(events);
    expect((await session.sendAndWait({ prompt: "Save mock context" }, 5_000))?.data.content).toBe('{"status":"ready"}');
    expect(events.mock.calls.filter(([event]) => event.type === "session.idle")).toHaveLength(1);
    const eventsBeforeUnsubscribe = events.mock.calls.length;
    off();
    expect((await session.sendAndWait({ prompt: "Complete mock init" }, 5_000))?.data.content).toBe('{"status":"ready"}');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({ content: "save_streamliner_context" });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(complete.mock.invocationCallOrder[0]);
    expect(events).toHaveBeenCalledTimes(eventsBeforeUnsubscribe);
    await session.disconnect();
    expect(await client.stop()).toEqual([]);
    clients.delete(client);
    const results = messages().filter((entry) => entry.method === "session.tools.handlePendingToolCall");
    expect(results).toHaveLength(2);
    expect(results.map((entry) => entry.params.result)).toEqual([
      '{"saved":"save_streamliner_context"}', '{"status":"ready"}',
    ]);
    expect(results.every((entry) => !("error" in entry.params))).toBe(true);
  });

  it.each([false, true])("preserves legacy default transport and wire fields (model-only profile: %s)", async (configured) => {
    vi.stubEnv("COPILOT_CLI_PATH", cliPath);
    const client = await createPreparationClient(readPreparationProfile(configured
      ? { STREAMLINER_PAW_INIT_MODEL: "gpt-6-astra" }
      : {}), root);
    clients.add(client);
    await client.start();
    const config = { configDir: join(root, "legacy-config"), tools: [] };
    const created = await client.createSession(config);
    await created.disconnect();
    const resumed = await client.resumeSession(created.sessionId, config);
    await resumed.disconnect();
    expect(await client.stop()).toEqual([]);
    clients.delete(client);
    const wire = messages();
    const sessions = wire.filter((entry) => ["session.create", "session.resume"].includes(entry.method));
    expect(sessions).toHaveLength(2);
    for (const { params } of sessions) {
      expect(params).toMatchObject({ model: configured ? "gpt-6-astra" : "gpt-5.5", configDir: join(root, "legacy-config") });
      expect(params).not.toHaveProperty("contextTier");
      expect(params).not.toHaveProperty("reasoningEffort");
    }
    if (!configured) expect(wire.some((entry) => entry.method === "models.list")).toBe(false);
    expect(wire[0].params.args).not.toContain("--context");
  });

  it("fails catalog validation before either create or resume reaches the wire", async () => {
    const profile = readPreparationProfile({
      STREAMLINER_PAW_INIT_CLI_PATH: cliPath,
      STREAMLINER_PAW_INIT_MODEL: "unavailable-model",
    });
    const client = await createPreparationClient(profile, root);
    clients.add(client);
    await client.start();
    await expect(client.createSession({ tools: [] })).rejects.toThrow("unavailable or not enabled");
    await expect(client.resumeSession("must-not-resume", { tools: [] })).rejects.toThrow("unavailable or not enabled");
    expect(messages().some((entry) => ["session.create", "session.resume"].includes(entry.method))).toBe(false);
  });

  it("rejects an old CLI before making a preparation transport available", async () => {
    writeFileSync(cliPath, 'console.log("--model <model>");');
    await expect(clientFor("long_context")).rejects.toThrow("does not advertise --context long_context");
    expect(clients.size).toBe(0);
    expect(existsSync(wirePath)).toBe(false);
  });

  it("retains the SDK 0.3 package and unrelated consumers", () => {
    const readRepoFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const pkg = JSON.parse(readRepoFile("../../package.json"));
    const lock = JSON.parse(readRepoFile("../../package-lock.json"));
    expect(pkg.dependencies["@github/copilot-sdk"]).toBe("^0.3.0");
    expect(lock.packages["node_modules/@github/copilot-sdk"].version).toBe("0.3.0");
    expect(pkg.dependencies["@github/copilot-sdk-preparation"]).toBe("npm:@github/copilot-sdk@1.0.18");
    expect(lock.packages["node_modules/@github/copilot-sdk-preparation"].version).toBe("1.0.18");
    for (const path of ["./launch-context.ts", "./managed-sdk-runner.ts",
      "../session-registry/session-summarizer.ts", "../session-registry/copilot-sdk-session-fs.ts"]) {
      expect(readRepoFile(path)).toContain('"@github/copilot-sdk"');
      expect(readRepoFile(path)).not.toContain("@github/copilot-sdk-preparation");
    }
  });
});
