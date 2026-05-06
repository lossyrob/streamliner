#!/usr/bin/env node
import { CopilotClient, approveAll, defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SPIKE_DIR, "..", "..");
const WORK_DIR = join(SPIKE_DIR, ".work");
const RUNS_DIR = join(WORK_DIR, "runs");
const DEFAULT_MODEL = process.env.COPILOT_SPIKE_MODEL || "gpt-5.4-mini";
const DEFAULT_TIMEOUT_MS = 120_000;

const COMMANDS = new Set([
  "status",
  "config-instructions",
  "event-progress",
  "cancellation",
  "process-cancellation",
  "takeover",
  "plugin-discovery",
  "permission-policy",
  "streamliner-claim-binding",
  "dogfood-pr",
]);

function usage() {
  console.log(`Usage: node spikes/sdk-managed-worker-runtime/run.mjs <command> [flags]

Commands:
  status
  config-instructions [--case auto|explicit|both]
  event-progress
  cancellation [--abort-after-ms 5000]
  process-cancellation [--abort-after-ms 30000]
  takeover
  plugin-discovery
  permission-policy
  streamliner-claim-binding [--skip-refresh-plugin]
  dogfood-pr

Common flags:
  --model <name>
  --timeout-ms <milliseconds>
  --keep-session
`);
}

function parseArgs(argv) {
  const command = argv[2];
  const flags = new Map();
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
    } else {
      flags.set(key, next);
      index += 1;
    }
  }
  return { command, flags };
}

function flagString(flags, name, fallback) {
  const value = flags.get(name);
  if (value === undefined || value === true) return fallback;
  return String(value);
}

function flagNumber(flags, name, fallback) {
  const value = flags.get(name);
  if (value === undefined || value === true) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return parsed;
}

function flagBoolean(flags, name) {
  return flags.get(name) === true || flags.get(name) === "true";
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function createRun(command) {
  await mkdir(RUNS_DIR, { recursive: true });
  const runId = `${timestampForPath()}-${safeName(command)}`;
  const runDir = join(RUNS_DIR, runId);
  await mkdir(runDir, { recursive: true });
  return { runId, runDir };
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function truncate(value, max = 500) {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...[truncated ${value.length - max} chars]`;
}

function redact(value, key = "") {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (/token|secret|authorization|password|credential/i.test(key)) return "[redacted]";
    return truncate(value);
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, key));
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (/token|secret|authorization|password|credential/i.test(childKey)) {
      result[childKey] = "[redacted]";
    } else if (/content|arguments|result|prompt|command|output/i.test(childKey)) {
      result[childKey] = truncate(String(childValue ?? ""), 500);
    } else {
      result[childKey] = redact(childValue, childKey);
    }
  }
  return result;
}

function projectEvent(event) {
  const data = event?.data || {};
  switch (event?.type) {
    case "session.start":
    case "session.resume":
      return {
        type: event.type,
        sessionId: data.sessionId,
      };
    case "assistant.intent":
      return {
        type: "agent.intent",
        intent: truncate(data.intent || data.message || "", 160),
      };
    case "assistant.message":
      return {
        type: "agent.message",
        contentLength: typeof data.content === "string" ? data.content.length : 0,
        snippet: truncate(data.content || "", 240),
      };
    case "tool.execution_start":
      return {
        type: "tool.started",
        toolCallId: data.toolCallId,
        toolName: data.toolName || data.name,
      };
    case "tool.execution_complete":
      return {
        type: "tool.completed",
        toolCallId: data.toolCallId,
        success: data.success,
      };
    case "permission.requested":
    case "permission.completed":
      return {
        type: event.type,
        kind: data.kind,
        decision: data.decision || data.permissionDecision,
      };
    case "skill.invoked":
      return {
        type: event.type,
        skillName: data.skillName || data.name,
        pluginName: data.pluginName,
      };
    case "session.mcp_servers_loaded":
      return {
        type: "mcp.servers_loaded",
        servers: Array.isArray(data.servers)
          ? data.servers.map((server) => ({
              name: server.name,
              status: server.status,
              source: server.source,
            }))
          : [],
      };
    case "session.mcp_server_status_changed":
      return {
        type: "mcp.status",
        serverName: data.serverName || data.name,
        status: data.status,
      };
    case "session.skills_loaded":
      return {
        type: "skills.loaded",
        skills: Array.isArray(data.skills)
          ? data.skills.map((skill) => ({
              name: skill.name,
              source: skill.source,
              enabled: skill.enabled,
            }))
          : [],
      };
    case "hook.start":
    case "hook.end":
      return {
        type: event.type,
        hookType: data.hookType,
        success: data.success,
      };
    case "session.idle":
      return {
        type: "session.idle",
        aborted: data.aborted,
      };
    case "abort":
      return {
        type: "session.aborted",
        reason: data.reason ? truncate(data.reason, 160) : undefined,
      };
    case "session.error":
      return {
        type: "session.error",
        errorType: data.errorType,
        message: truncate(data.message || "", 240),
      };
    case "session.usage_info":
      return {
        type: "usage",
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
      };
    default:
      return {
        type: event?.type || "unknown",
      };
  }
}

class Recorder {
  constructor(runDir) {
    this.runDir = runDir;
    this.events = [];
    this.projected = [];
    this.eventCounts = new Map();
    this.rawStream = createWriteStream(join(runDir, "events.redacted.jsonl"), {
      flags: "a",
    });
    this.projectedStream = createWriteStream(join(runDir, "events.projected.jsonl"), {
      flags: "a",
    });
  }

  record(event) {
    const redacted = redact(event);
    const projected = projectEvent(event);
    this.events.push(redacted);
    this.projected.push(projected);
    this.eventCounts.set(projected.type, (this.eventCounts.get(projected.type) || 0) + 1);
    this.rawStream.write(JSON.stringify(redacted) + "\n");
    this.projectedStream.write(JSON.stringify(projected) + "\n");
  }

  synthetic(type, data = {}) {
    this.record({ type, data });
  }

  async close() {
    await Promise.all([
      new Promise((resolvePromise) => this.rawStream.end(resolvePromise)),
      new Promise((resolvePromise) => this.projectedStream.end(resolvePromise)),
    ]);
  }

  summary() {
    const mcpServers = [];
    const skills = [];
    const hookTypes = new Set();
    for (const event of this.projected) {
      if (event.type === "mcp.servers_loaded") {
        mcpServers.push(...event.servers);
      }
      if (event.type === "skills.loaded") {
        skills.push(...event.skills);
      }
      if ((event.type === "hook.start" || event.type === "hook.end") && event.hookType) {
        hookTypes.add(event.hookType);
      }
    }
    return {
      eventCounts: Object.fromEntries([...this.eventCounts.entries()].sort()),
      mcpServers,
      skills,
      hookTypes: [...hookTypes].sort(),
      projectedEvents: this.projected.slice(-20),
    };
  }
}

async function createDisposableRepo(runDir, name) {
  const repoDir = join(runDir, name);
  await mkdir(repoDir, { recursive: true });
  await writeFile(join(repoDir, "README.md"), "# SDK worker spike repo\n", "utf8");
  await writeFile(
    join(repoDir, "AGENTS.md"),
    [
      "# SDK worker spike AGENTS.md",
      "",
      "When asked about Streamliner SDK spike context, remember AGENTS token AGENTS_TOKEN_PLACEHOLDER.",
      "Prefer custom spike tools over prose when the prompt asks for structured reporting.",
      "",
    ].join("\n"),
    "utf8",
  );
  await mkdir(join(repoDir, ".github"), { recursive: true });
  await writeFile(
    join(repoDir, ".github", "copilot-instructions.md"),
    [
      "# Copilot instructions for SDK worker spike",
      "",
      "When asked about Streamliner SDK spike context, remember COPILOT token COPILOT_TOKEN_PLACEHOLDER.",
      "",
    ].join("\n"),
    "utf8",
  );
  runGit(["init"], repoDir);
  runGit(["config", "user.email", "streamliner-spike@example.com"], repoDir);
  runGit(["config", "user.name", "Streamliner SDK Spike"], repoDir);
  runGit(["add", "README.md", "AGENTS.md", ".github/copilot-instructions.md"], repoDir);
  runGit(["commit", "-m", "init"], repoDir);
  return repoDir;
}

async function rewriteInstructionTokens(repoDir, tokens) {
  const agentsPath = join(repoDir, "AGENTS.md");
  const instructionsPath = join(repoDir, ".github", "copilot-instructions.md");
  await writeFile(
    agentsPath,
    (await readFile(agentsPath, "utf8")).replace("AGENTS_TOKEN_PLACEHOLDER", tokens.agents),
    "utf8",
  );
  await writeFile(
    instructionsPath,
    (await readFile(instructionsPath, "utf8")).replace("COPILOT_TOKEN_PLACEHOLDER", tokens.copilot),
    "utf8",
  );
  runGit(["add", "AGENTS.md", ".github/copilot-instructions.md"], repoDir);
  runGit(["commit", "-m", "add spike instruction tokens"], repoDir);
}

async function createSkillDirectory(repoDir, tokens) {
  const skillRoot = join(repoDir, ".copilot", "skills");
  const skillDir = join(skillRoot, "streamliner-spike-context");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: streamliner-spike-context",
      "description: Use this skill when asked to report Streamliner SDK spike context tokens.",
      "---",
      "",
      `When invoked, report skill token ${tokens.skill} through the requested spike reporting tool.`,
      "",
    ].join("\n"),
    "utf8",
  );
  return skillRoot;
}

async function createMcpDiscoveryConfig(repoDir) {
  await writeFile(
    join(repoDir, ".mcp.json"),
    JSON.stringify(
      {
        servers: {
          "streamliner-spike-placeholder": {
            command: "node",
            args: ["-e", "process.exit(0)"],
          },
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

async function withClient(cwd, recorder, body) {
  const client = new CopilotClient({ cwd, logLevel: "error" });
  await client.start();
  try {
    return await body(client);
  } finally {
    const errors = await client.stop().catch((error) => [error]);
    if (errors.length > 0) {
      recorder.synthetic("spike.client_stop_errors", {
        messages: errors.map((error) => String(error?.message || error)),
      });
    }
  }
}

async function createSession(client, config, recorder) {
  const session = await client.createSession({
    clientName: "streamliner-sdk-managed-worker-spike",
    model: config.model,
    workingDirectory: config.workingDirectory,
    enableConfigDiscovery: config.enableConfigDiscovery,
    streaming: true,
    skillDirectories: config.skillDirectories,
    mcpServers: config.mcpServers,
    tools: config.tools,
    systemMessage: config.systemMessage,
    onEvent: (event) => recorder.record(event),
    onPermissionRequest: (request, invocation) => {
      recorder.synthetic("spike.permission_handler", {
        kind: request?.kind,
        toolName: request?.toolName,
      });
      if (config.permissionHandler) {
        return config.permissionHandler(request, invocation);
      }
      return approveAll(request, invocation);
    },
    onUserInputRequest: async (request) => {
      recorder.synthetic("spike.user_input_request", {
        question: request?.question,
        choices: request?.choices,
      });
      return {
        answer: request?.choices?.[0] || "Proceed with the spike using best judgment.",
        wasFreeform: !request?.choices?.length,
      };
    },
  });
  recorder.synthetic("spike.session_created", {
    sessionId: session.sessionId,
    workspacePath: session.workspacePath,
    capabilities: session.capabilities,
  });
  return session;
}

async function disposeSession(client, session, keepSession, recorder) {
  if (!session) return;
  try {
    await session.disconnect();
  } catch (error) {
    recorder.synthetic("spike.session_disconnect_failed", { message: String(error?.message || error) });
  }
  if (keepSession) return;
  try {
    await client.deleteSession(session.sessionId);
  } catch (error) {
    recorder.synthetic("spike.session_delete_failed", { message: String(error?.message || error) });
  }
}

function toolResult(value) {
  return JSON.stringify(value);
}

async function commandStatus(flags) {
  const { runId, runDir } = await createRun("status");
  const recorder = new Recorder(runDir);
  const startedAt = new Date().toISOString();
  let summary = {};
  try {
    await withClient(process.cwd(), recorder, async (client) => {
      const status = await client.getStatus();
      const auth = await client.getAuthStatus().catch((error) => ({ error: String(error?.message || error) }));
      const session = await createSession(
        client,
        {
          model: flagString(flags, "model", DEFAULT_MODEL),
          workingDirectory: process.cwd(),
          enableConfigDiscovery: false,
          tools: [],
        },
        recorder,
      );
      summary = {
        command: "status",
        runId,
        runDir,
        startedAt,
        status,
        auth: redact(auth),
        session: {
          sessionId: session.sessionId,
          workspacePath: session.workspacePath,
          capabilities: session.capabilities,
        },
        ...recorder.summary(),
      };
      await disposeSession(client, session, flagBoolean(flags, "keep-session"), recorder);
    });
  } finally {
    await writeJson(join(runDir, "summary.json"), summary);
    await recorder.close();
  }
  console.log(`status summary: ${join(runDir, "summary.json")}`);
}

async function runConfigInstructionsCase(baseRunDir, flags, caseName) {
  const runDir = join(baseRunDir, caseName);
  await mkdir(runDir, { recursive: true });
  const recorder = new Recorder(runDir);
  const tokens = {
    agents: `AGENTS_${safeName(caseName)}_${Date.now()}`,
    copilot: `COPILOT_${safeName(caseName)}_${Date.now()}`,
    skill: `SKILL_${safeName(caseName)}_${Date.now()}`,
    system: `SYSTEM_${safeName(caseName)}_${Date.now()}`,
  };
  const repoDir = await createDisposableRepo(runDir, "repo");
  await rewriteInstructionTokens(repoDir, tokens);
  const skillRoot = await createSkillDirectory(repoDir, tokens);
  await createMcpDiscoveryConfig(repoDir);
  const reports = [];
  const probeTool = defineTool("record_context_probe", {
    description:
      "Record which Streamliner SDK spike context sources are visible. Call this when asked to report context-loading evidence.",
    parameters: z.object({
      agentsToken: z.string().optional(),
      copilotInstructionsToken: z.string().optional(),
      skillToken: z.string().optional(),
      systemMessageToken: z.string().optional(),
      mcpObservation: z.string().optional(),
      notes: z.string().optional(),
    }),
    handler: async (params) => {
      reports.push(params);
      return toolResult({ status: "recorded" });
    },
  });
  const useExplicit = caseName === "explicit";
  let session;
  let summary = {};
  try {
    await withClient(repoDir, recorder, async (client) => {
      session = await createSession(
        client,
        {
          model: flagString(flags, "model", DEFAULT_MODEL),
          workingDirectory: repoDir,
          enableConfigDiscovery: !useExplicit,
          skillDirectories: useExplicit ? [skillRoot] : undefined,
          tools: [probeTool],
          systemMessage: useExplicit
            ? {
                mode: "append",
                content: `When asked about Streamliner SDK spike context, remember system token ${tokens.system}.`,
              }
            : undefined,
        },
        recorder,
      );
      const response = await session.sendAndWait(
        {
          prompt: [
            "Run the Streamliner SDK context-loading probe.",
            "Use repository instructions, discovered instructions, available skills, MCP status, and appended system context if you can see them.",
            "Call record_context_probe exactly once with every token or observation you can infer.",
            "Use the literal string missing for any token you cannot see.",
            "After the tool call, reply exactly CONFIG_PROBE_DONE.",
          ].join(" "),
        },
        flagNumber(flags, "timeout-ms", DEFAULT_TIMEOUT_MS),
      );
      summary = {
        command: "config-instructions",
        caseName,
        repoDir,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        tokens,
        reports,
        matched: {
          agents: reports.some((report) => report.agentsToken === tokens.agents),
          copilot: reports.some((report) => report.copilotInstructionsToken === tokens.copilot),
          skill: reports.some((report) => report.skillToken === tokens.skill),
          system: reports.some((report) => report.systemMessageToken === tokens.system),
        },
        assistant: truncate(response?.data?.content || ""),
        ...recorder.summary(),
      };
      await disposeSession(client, session, flagBoolean(flags, "keep-session"), recorder);
    });
  } finally {
    await writeJson(join(runDir, "summary.json"), summary);
    await recorder.close();
  }
  return summary;
}

async function commandConfigInstructions(flags) {
  const caseFlag = flagString(flags, "case", "auto");
  const cases = caseFlag === "both" ? ["auto", "explicit"] : [caseFlag];
  for (const caseName of cases) {
    if (!["auto", "explicit"].includes(caseName)) {
      throw new Error("--case must be auto, explicit, or both");
    }
  }
  const { runDir } = await createRun("config-instructions");
  const summaries = [];
  for (const caseName of cases) {
    summaries.push(await runConfigInstructionsCase(runDir, flags, caseName));
  }
  await writeJson(join(runDir, "summary.json"), { command: "config-instructions", cases: summaries });
  console.log(`config-instructions summary: ${join(runDir, "summary.json")}`);
}

async function commandEventProgress(flags) {
  const { runDir } = await createRun("event-progress");
  const recorder = new Recorder(runDir);
  const repoDir = await createDisposableRepo(runDir, "repo");
  const progressReports = [];
  const progressTool = defineTool("spike_progress", {
    description: "Report SDK worker spike progress milestones.",
    parameters: z.object({
      phase: z.string(),
      status: z.string(),
      summary: z.string(),
    }),
    handler: async (params) => {
      progressReports.push(params);
      return toolResult({ status: "recorded" });
    },
  });
  let session;
  let summary = {};
  try {
    await withClient(repoDir, recorder, async (client) => {
      session = await createSession(
        client,
        {
          model: flagString(flags, "model", DEFAULT_MODEL),
          workingDirectory: repoDir,
          enableConfigDiscovery: true,
          tools: [progressTool],
        },
        recorder,
      );
      const response = await session.sendAndWait(
        {
          prompt: [
            "Run a tiny SDK managed-worker progress spike in this disposable git repo.",
            "Call spike_progress with phase started.",
            "Use available file or shell tools to create spike-output.txt containing the line SDK_PROGRESS_SPIKE_OK.",
            "Run git status or inspect the repository state.",
            "Call spike_progress with phase completed and a short summary.",
            "Then reply exactly EVENT_PROGRESS_DONE.",
          ].join(" "),
        },
        flagNumber(flags, "timeout-ms", DEFAULT_TIMEOUT_MS),
      );
      const outputPath = join(repoDir, "spike-output.txt");
      summary = {
        command: "event-progress",
        repoDir,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        progressReports,
        outputFileExists: existsSync(outputPath),
        outputFileContent: existsSync(outputPath) ? await readFile(outputPath, "utf8") : undefined,
        assistant: truncate(response?.data?.content || ""),
        ...recorder.summary(),
      };
      await disposeSession(client, session, flagBoolean(flags, "keep-session"), recorder);
    });
  } finally {
    await writeJson(join(runDir, "summary.json"), summary);
    await recorder.close();
  }
  console.log(`event-progress summary: ${join(runDir, "summary.json")}`);
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function quotePowerShellPath(path) {
  return `'${path.replace(/'/g, "''")}'`;
}

async function readTextIfExists(path) {
  if (!existsSync(path)) return undefined;
  return readFile(path, "utf8");
}

function getRequestCommand(request) {
  return request?.fullCommandText || request?.command || request?.commandText || "";
}

function permissionRequestSummary(request, decision) {
  return {
    kind: request?.kind,
    toolCallId: request?.toolCallId,
    toolName: request?.toolName,
    fileName: request?.fileName,
    command: truncate(getRequestCommand(request)),
    decision: decision?.kind,
  };
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    const output = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { 'true' } else { 'false' }`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    return output === "true";
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopProcessByPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (!processExists(pid)) return false;
  if (process.platform === "win32") {
    execFileSync("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${pid} -Force`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  }
  process.kill(pid, "SIGKILL");
  return true;
}

async function listJsonFiles(root) {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readJsonFiles(root) {
  const files = await listJsonFiles(root);
  const values = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8").catch(() => "");
    try {
      values.push({ path: file, value: JSON.parse(raw) });
    } catch (error) {
      values.push({ path: file, parseError: String(error?.message || error), raw: truncate(raw) });
    }
  }
  return values;
}

async function commandCancellation(flags) {
  const { runDir } = await createRun("cancellation");
  const recorder = new Recorder(runDir);
  const repoDir = await createDisposableRepo(runDir, "repo");
  const abortAfterMs = flagNumber(flags, "abort-after-ms", 5_000);
  let session;
  let summary = {};
  try {
    await withClient(repoDir, recorder, async (client) => {
      session = await createSession(
        client,
        {
          model: flagString(flags, "model", DEFAULT_MODEL),
          workingDirectory: repoDir,
          enableConfigDiscovery: false,
          tools: [],
        },
        recorder,
      );
      await session.send({
        prompt: [
          "Run the Streamliner SDK cancellation spike.",
          "Use a shell command to wait for about 60 seconds before producing output.",
          "On Windows use: powershell -NoProfile -Command \"Start-Sleep -Seconds 60; 'SDK_CANCELLATION_SPIKE_DONE'\".",
          "Do not finish until that command would finish.",
        ].join(" "),
      });
      await wait(abortAfterMs);
      const abortStartedAt = new Date().toISOString();
      let abortError;
      try {
        await session.abort();
      } catch (error) {
        abortError = String(error?.message || error);
      }
      await wait(3_000);
      let followUp;
      let followUpError;
      try {
        const response = await session.sendAndWait(
          { prompt: "Reply exactly FOLLOWUP_OK if the session is usable after abort." },
          flagNumber(flags, "timeout-ms", DEFAULT_TIMEOUT_MS),
        );
        followUp = response?.data?.content || "";
      } catch (error) {
        followUpError = String(error?.message || error);
      }
      summary = {
        command: "cancellation",
        repoDir,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        abortAfterMs,
        abortStartedAt,
        abortError,
        followUp: truncate(followUp || ""),
        followUpError,
        sawAbortEvent: recorder.projected.some((event) => event.type === "session.aborted"),
        sawIdleAfterAbort: recorder.projected.some((event) => event.type === "session.idle"),
        ...recorder.summary(),
      };
      await disposeSession(client, session, flagBoolean(flags, "keep-session"), recorder);
    });
  } finally {
    await writeJson(join(runDir, "summary.json"), summary);
    await recorder.close();
  }
  console.log(`cancellation summary: ${join(runDir, "summary.json")}`);
}

async function commandProcessCancellation(flags) {
  const { runDir } = await createRun("process-cancellation");
  const recorder = new Recorder(runDir);
  const repoDir = await createDisposableRepo(runDir, "repo");
  const abortAfterMs = flagNumber(flags, "abort-after-ms", 30_000);
  const pidPath = join(repoDir, "process-cancel-child-pid.txt");
  const markerPath = join(repoDir, "process-cancel-marker.txt");
  const childCommand = [
    "$PID | Set-Content -Path",
    quotePowerShellPath(pidPath),
    "; Start-Sleep -Seconds 60;",
    "'SDK_PROCESS_CANCEL_COMPLETED' | Set-Content -Path",
    quotePowerShellPath(markerPath),
  ].join(" ");
  const shellCommand = `powershell -NoProfile -Command "${childCommand.replace(/"/g, '\\"')}"`;
  let session;
  let summary = {};
  try {
    await withClient(repoDir, recorder, async (client) => {
      session = await createSession(
        client,
        {
          model: flagString(flags, "model", DEFAULT_MODEL),
          workingDirectory: repoDir,
          enableConfigDiscovery: false,
          tools: [],
        },
        recorder,
      );
      await session.send({
        prompt: [
          "Run this Streamliner SDK process-level cancellation spike exactly as requested.",
          "Use the shell tool to run this command and wait for it:",
          shellCommand,
          "Do not replace it with a shorter sleep and do not finish before the command would finish.",
        ].join(" "),
      });
      await wait(abortAfterMs);
      const abortStartedAt = new Date().toISOString();
      let abortError;
      try {
        await session.abort();
      } catch (error) {
        abortError = String(error?.message || error);
      }
      await wait(flagNumber(flags, "post-abort-wait-ms", 5_000));
      const pidText = (await readTextIfExists(pidPath))?.trim();
      const childPid = Number(pidText);
      const validChildPid = Number.isInteger(childPid) && childPid > 0;
      const processAliveAfterAbort = validChildPid ? processExists(childPid) : false;
      const markerAfterAbort = existsSync(markerPath);
      let cleanupKilledProcess = false;
      let cleanupError;
      if (processAliveAfterAbort && !flagBoolean(flags, "no-cleanup")) {
        try {
          cleanupKilledProcess = stopProcessByPid(childPid);
        } catch (error) {
          cleanupError = String(error?.message || error);
        }
      }
      let followUp;
      let followUpError;
      try {
        const response = await session.sendAndWait(
          { prompt: "Reply exactly PROCESS_CANCEL_FOLLOWUP_OK if the session is usable after abort." },
          flagNumber(flags, "timeout-ms", DEFAULT_TIMEOUT_MS),
        );
        followUp = response?.data?.content || "";
      } catch (error) {
        followUpError = String(error?.message || error);
      }
      summary = {
        command: "process-cancellation",
        repoDir,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        abortAfterMs,
        abortStartedAt,
        abortError,
        pidPath,
        pidText,
        childPid: validChildPid ? childPid : undefined,
        markerPath,
        markerAfterAbort,
        processAliveAfterAbort,
        cleanupKilledProcess,
        cleanupError,
        markerAfterCleanup: existsSync(markerPath),
        followUp: truncate(followUp || ""),
        followUpError,
        sawAbortEvent: recorder.projected.some((event) => event.type === "session.aborted"),
        sawIdleAfterAbort: recorder.projected.some((event) => event.type === "session.idle"),
        ...recorder.summary(),
      };
      await disposeSession(client, session, flagBoolean(flags, "keep-session"), recorder);
    });
  } finally {
    await writeJson(join(runDir, "summary.json"), summary);
    await recorder.close();
  }
  console.log(`process-cancellation summary: ${join(runDir, "summary.json")}`);
}

async function commandPermissionPolicy(flags) {
  const { runDir } = await createRun("permission-policy");
  const recorder = new Recorder(runDir);
  const repoDir = await createDisposableRepo(runDir, "repo");
  const approvedPath = join(repoDir, "permission-approved.txt");
  const deniedPath = join(repoDir, "permission-denied.txt");
  const permissionDecisions = [];
  const permissionReports = [];
  const resultTool = defineTool("record_permission_policy_result", {
    description: "Record observed permission-policy behavior from inside the SDK session.",
    parameters: z.object({
      approvedOperationObserved: z.boolean(),
      deniedShellObserved: z.boolean(),
      deniedGithubObserved: z.boolean(),
      followupPossible: z.boolean().optional(),
      notes: z.string().optional(),
    }),
    handler: async (params) => {
      permissionReports.push(params);
      return toolResult({ status: "recorded" });
    },
  });
  const permissionHandler = (request, invocation) => {
    const command = getRequestCommand(request);
    const deniesByPolicy =
      request?.kind === "shell" && (/SDK_PERMISSION_DENY/.test(command) || /\bgh(\.exe)?\s+/i.test(command));
    const decision = deniesByPolicy
      ? { kind: "reject", feedback: "Denied by Streamliner SDK permission-policy spike." }
      : approveAll(request, invocation);
    const summary = { ...permissionRequestSummary(request, decision), sessionId: invocation?.sessionId };
    permissionDecisions.push(summary);
    recorder.synthetic("spike.permission_policy_decision", summary);
    return decision;
  };
  let session;
  let summary = {};
  try {
    await withClient(repoDir, recorder, async (client) => {
      session = await createSession(
        client,
        {
          model: flagString(flags, "model", DEFAULT_MODEL),
          workingDirectory: repoDir,
          enableConfigDiscovery: false,
          tools: [resultTool],
          permissionHandler,
        },
        recorder,
      );
      const allowedCommand = `powershell -NoProfile -Command "'SDK_PERMISSION_APPROVED' | Set-Content -Path ${quotePowerShellPath(approvedPath)}"`;
      const deniedShellCommand = `powershell -NoProfile -Command "'SDK_PERMISSION_DENY' | Set-Content -Path ${quotePowerShellPath(deniedPath)}"`;
      const deniedGithubCommand = "gh api rate_limit";
      const response = await session.sendAndWait(
        {
          prompt: [
            "Run the Streamliner SDK permission-policy spike.",
            "Use shell once for this approved operation:",
            allowedCommand,
            "Then attempt this denied shell operation and continue after the policy blocks it:",
            deniedShellCommand,
            "Then attempt this denied GitHub CLI operation and continue after the policy blocks it:",
            deniedGithubCommand,
            "Finally call record_permission_policy_result with what happened, then reply exactly PERMISSION_POLICY_DONE.",
          ].join(" "),
        },
        flagNumber(flags, "timeout-ms", DEFAULT_TIMEOUT_MS),
      );
      let followUp;
      let followUpError;
      try {
        const followUpResponse = await session.sendAndWait(
          { prompt: "Reply exactly PERMISSION_FOLLOWUP_OK if the session still accepts turns after denied tools." },
          flagNumber(flags, "timeout-ms", DEFAULT_TIMEOUT_MS),
        );
        followUp = followUpResponse?.data?.content || "";
      } catch (error) {
        followUpError = String(error?.message || error);
      }
      summary = {
        command: "permission-policy",
        repoDir,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        permissionDecisions,
        permissionReports,
        approvedPath,
        approvedFileExists: existsSync(approvedPath),
        approvedFileContent: truncate((await readTextIfExists(approvedPath)) || ""),
        deniedPath,
        deniedFileExists: existsSync(deniedPath),
        deniedShellRequests: permissionDecisions.filter((decision) =>
          String(decision.command || "").includes("SDK_PERMISSION_DENY"),
        ),
        deniedGithubRequests: permissionDecisions.filter((decision) => /\bgh(\.exe)?\s+/i.test(decision.command || "")),
        followUp: truncate(followUp || ""),
        followUpError,
        assistant: truncate(response?.data?.content || ""),
        ...recorder.summary(),
      };
      await disposeSession(client, session, flagBoolean(flags, "keep-session"), recorder);
    });
  } finally {
    await writeJson(join(runDir, "summary.json"), summary);
    await recorder.close();
  }
  console.log(`permission-policy summary: ${join(runDir, "summary.json")}`);
}

async function commandTakeover(flags) {
  const { runDir } = await createRun("takeover");
  const recorder = new Recorder(runDir);
  const repoDir = await createDisposableRepo(runDir, "repo");
  let session;
  let summary = {};
  try {
    await withClient(repoDir, recorder, async (client) => {
      session = await createSession(
        client,
        {
          model: flagString(flags, "model", DEFAULT_MODEL),
          workingDirectory: repoDir,
          enableConfigDiscovery: true,
          tools: [],
        },
        recorder,
      );
      const response = await session.sendAndWait(
        {
          prompt: "Remember this takeover spike token for a future resumed terminal: SDK_TAKEOVER_SPIKE_OK. Reply exactly TAKEOVER_READY.",
        },
        flagNumber(flags, "timeout-ms", DEFAULT_TIMEOUT_MS),
      );
      const resumeCommand = `copilot --resume ${session.sessionId}`;
      await writeFile(join(runDir, "resume-command.txt"), resumeCommand + "\n", "utf8");
      summary = {
        command: "takeover",
        repoDir,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        resumeCommand,
        assistant: truncate(response?.data?.content || ""),
        preservedSession: true,
        ...recorder.summary(),
      };
      await disposeSession(client, session, true, recorder);
    });
  } finally {
    await writeJson(join(runDir, "summary.json"), summary);
    await recorder.close();
  }
  console.log(`takeover summary: ${join(runDir, "summary.json")}`);
}

async function commandPluginDiscovery(flags) {
  const { runDir } = await createRun("plugin-discovery");
  const recorder = new Recorder(runDir);
  const repoDir = await createDisposableRepo(runDir, "repo");
  const pluginReports = [];
  const pluginTool = defineTool("record_plugin_probe", {
    description: "Record observable Copilot plugin/skill/hook availability from inside an SDK session.",
    parameters: z.object({
      streamlinerPluginVisible: z.string(),
      visiblePluginCommands: z.array(z.string()).optional(),
      visiblePluginSkills: z.array(z.string()).optional(),
      hookObservation: z.string().optional(),
      notes: z.string().optional(),
    }),
    handler: async (params) => {
      pluginReports.push(params);
      return toolResult({ status: "recorded" });
    },
  });
  let session;
  let summary = {};
  try {
    await withClient(repoDir, recorder, async (client) => {
      session = await createSession(
        client,
        {
          model: flagString(flags, "model", DEFAULT_MODEL),
          workingDirectory: repoDir,
          enableConfigDiscovery: true,
          tools: [pluginTool],
        },
        recorder,
      );
      const response = await session.sendAndWait(
        {
          prompt: [
            "Run the Streamliner SDK plugin discovery spike.",
            "Without modifying files, report whether any installed Copilot CLI plugin commands, skills, or hooks are visible in this SDK-created session.",
            "If a Streamliner plugin is visible, include its observable command or skill names.",
            "Call record_plugin_probe exactly once, then reply exactly PLUGIN_PROBE_DONE.",
          ].join(" "),
        },
        flagNumber(flags, "timeout-ms", DEFAULT_TIMEOUT_MS),
      );
      summary = {
        command: "plugin-discovery",
        repoDir,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        pluginReports,
        assistant: truncate(response?.data?.content || ""),
        hookEventsSeen: recorder.projected.filter((event) => String(event.type).includes("hook")),
        skillEventsSeen: recorder.projected.filter((event) => String(event.type).includes("skill")),
        ...recorder.summary(),
      };
      await disposeSession(client, session, flagBoolean(flags, "keep-session"), recorder);
    });
  } finally {
    await writeJson(join(runDir, "summary.json"), summary);
    await recorder.close();
  }
  console.log(`plugin-discovery summary: ${join(runDir, "summary.json")}`);
}

async function commandStreamlinerClaimBinding(flags) {
  const { runDir } = await createRun("streamliner-claim-binding");
  const recorder = new Recorder(runDir);
  const repoDir = await createDisposableRepo(runDir, "repo");
  const stateRoot = join(runDir, "streamliner-state");
  const spoolRoot = join(stateRoot, "session-signals");
  const pendingRoot = join(spoolRoot, "pending");
  const debugRoot = join(spoolRoot, "debug");
  const claimId = flagString(flags, "claim-id", `spike-claim-${Date.now()}`);
  let session;
  let summary = {};
  const envKeys = [
    "STREAMLINER_STATE_ROOT",
    "STREAMLINER_SESSION_SIGNAL_SPOOL_ROOT",
    "STREAMLINER_SESSION_SIGNAL_ENDPOINT",
    "STREAMLINER_HOOK_DEBUG",
    "STREAMLINER_LAUNCH_CLAIM_ID",
  ];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    await mkdir(pendingRoot, { recursive: true });
    let refreshPlugin = { skipped: flagBoolean(flags, "skip-refresh-plugin") };
    if (!refreshPlugin.skipped) {
      try {
        const refreshCommand =
          process.platform === "win32"
            ? ["cmd.exe", ["/d", "/s", "/c", "npm run refresh-copilot-plugin"]]
            : ["npm", ["run", "refresh-copilot-plugin"]];
        refreshPlugin = {
          skipped: false,
          output: truncate(
            execFileSync(refreshCommand[0], refreshCommand[1], { cwd: REPO_ROOT, encoding: "utf8" }),
          ),
        };
      } catch (error) {
        refreshPlugin = {
          skipped: false,
          error: truncate(String(error?.stderr || error?.message || error)),
        };
      }
    }
    process.env.STREAMLINER_STATE_ROOT = stateRoot;
    process.env.STREAMLINER_SESSION_SIGNAL_SPOOL_ROOT = spoolRoot;
    process.env.STREAMLINER_SESSION_SIGNAL_ENDPOINT = "http://127.0.0.1:9/api/sessions/signals";
    process.env.STREAMLINER_HOOK_DEBUG = "1";
    process.env.STREAMLINER_LAUNCH_CLAIM_ID = claimId;
    await withClient(repoDir, recorder, async (client) => {
      session = await createSession(
        client,
        {
          model: flagString(flags, "model", DEFAULT_MODEL),
          workingDirectory: repoDir,
          enableConfigDiscovery: true,
          tools: [],
        },
        recorder,
      );
      const response = await session.sendAndWait(
        {
          prompt: "Run a no-op Streamliner launch-claim binding spike and reply exactly STREAMLINER_CLAIM_BINDING_DONE.",
        },
        flagNumber(flags, "timeout-ms", DEFAULT_TIMEOUT_MS),
      );
      await disposeSession(client, session, flagBoolean(flags, "keep-session"), recorder);
      await wait(flagNumber(flags, "post-session-wait-ms", 2_000));
      const pendingSignals = await readJsonFiles(pendingRoot);
      const debugSignals = await readJsonFiles(debugRoot);
      const pendingValues = pendingSignals.map((entry) => entry.value).filter(Boolean);
      const eventTypes = pendingValues.map((signal) => signal.event).filter(Boolean);
      const sessionSignals = pendingValues.filter((signal) => signal.sessionId === session.sessionId);
      const claimSignals = pendingValues.filter((signal) => signal.launchClaimId === claimId);
      summary = {
        command: "streamliner-claim-binding",
        repoDir,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        claimId,
        refreshPlugin,
        stateRoot,
        spoolRoot,
        pendingSignalCount: pendingSignals.length,
        debugSignalCount: debugSignals.length,
        pendingSignalPaths: pendingSignals.map((entry) => entry.path),
        debugSignalPaths: debugSignals.map((entry) => entry.path),
        eventTypes,
        sessionSignalEventTypes: sessionSignals.map((signal) => signal.event).filter(Boolean),
        claimSignalEventTypes: claimSignals.map((signal) => signal.event).filter(Boolean),
        sessionStartedHasClaim: claimSignals.some((signal) => signal.event === "session.started"),
        promptSubmittedSignals: sessionSignals.filter((signal) => signal.event === "prompt.submitted").length,
        sessionEndedSignals: sessionSignals.filter((signal) => signal.event === "session.ended").length,
        signalSamples: pendingValues.slice(0, 5).map((signal) => redact(signal)),
        assistant: truncate(response?.data?.content || ""),
        hookEventsSeen: recorder.projected.filter((event) => String(event.type).includes("hook")),
        ...recorder.summary(),
      };
    });
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await writeJson(join(runDir, "summary.json"), summary);
    await recorder.close();
  }
  console.log(`streamliner-claim-binding summary: ${join(runDir, "summary.json")}`);
}

async function commandDogfoodPr(flags) {
  const { runDir } = await createRun("dogfood-pr");
  const recorder = new Recorder(runDir);
  const repoDir = await createDisposableRepo(runDir, "repo");
  const doneReports = [];
  const doneTool = defineTool("record_dogfood_result", {
    description: "Record the result of a local SDK-managed worker PR dogfood spike.",
    parameters: z.object({
      branch: z.string(),
      commitCreated: z.boolean(),
      summary: z.string(),
      prDraftPath: z.string().optional(),
    }),
    handler: async (params) => {
      doneReports.push(params);
      return toolResult({ status: "recorded" });
    },
  });
  let session;
  let summary = {};
  try {
    await withClient(repoDir, recorder, async (client) => {
      session = await createSession(
        client,
        {
          model: flagString(flags, "model", DEFAULT_MODEL),
          workingDirectory: repoDir,
          enableConfigDiscovery: true,
          tools: [doneTool],
          systemMessage: {
            mode: "append",
            content:
              "You are running in a disposable local git repository for a Streamliner SDK-managed worker spike. Do not push to remotes. Keep changes tiny and reversible.",
          },
        },
        recorder,
      );
      const response = await session.sendAndWait(
        {
          prompt: [
            "Run a local PR-production dogfood spike in this disposable git repo.",
            "Create branch spike/sdk-managed-worker-dogfood.",
            "Edit README.md to add a short section named SDK managed worker dogfood with the marker SDK_DOGFOOD_PR_SPIKE_OK.",
            "Commit the change.",
            "Write PR_DRAFT.md with a concise PR title and body, but do not push and do not call GitHub.",
            "Call record_dogfood_result exactly once with the branch, whether a commit was created, summary, and prDraftPath.",
            "Then reply exactly DOGFOOD_PR_DONE.",
          ].join(" "),
        },
        flagNumber(flags, "timeout-ms", DEFAULT_TIMEOUT_MS),
      );
      let branch = "";
      let log = "";
      let status = "";
      try {
        branch = runGit(["branch", "--show-current"], repoDir);
        log = runGit(["log", "--oneline", "-3"], repoDir);
        status = runGit(["status", "--short"], repoDir);
      } catch (error) {
        status = String(error?.message || error);
      }
      const readme = await readFile(join(repoDir, "README.md"), "utf8").catch(() => "");
      const prDraftPath = join(repoDir, "PR_DRAFT.md");
      summary = {
        command: "dogfood-pr",
        repoDir,
        sessionId: session.sessionId,
        workspacePath: session.workspacePath,
        doneReports,
        branch,
        log,
        status,
        markerPresent: readme.includes("SDK_DOGFOOD_PR_SPIKE_OK"),
        prDraftExists: existsSync(prDraftPath),
        prDraft: existsSync(prDraftPath) ? truncate(await readFile(prDraftPath, "utf8"), 1000) : undefined,
        assistant: truncate(response?.data?.content || ""),
        ...recorder.summary(),
      };
      await disposeSession(client, session, flagBoolean(flags, "keep-session"), recorder);
    });
  } finally {
    await writeJson(join(runDir, "summary.json"), summary);
    await recorder.close();
  }
  console.log(`dogfood-pr summary: ${join(runDir, "summary.json")}`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv);
  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }
  if (!COMMANDS.has(command)) {
    usage();
    throw new Error(`Unknown command: ${command}`);
  }
  await mkdir(WORK_DIR, { recursive: true });
  switch (command) {
    case "status":
      await commandStatus(flags);
      break;
    case "config-instructions":
      await commandConfigInstructions(flags);
      break;
    case "event-progress":
      await commandEventProgress(flags);
      break;
    case "cancellation":
      await commandCancellation(flags);
      break;
    case "process-cancellation":
      await commandProcessCancellation(flags);
      break;
    case "takeover":
      await commandTakeover(flags);
      break;
    case "plugin-discovery":
      await commandPluginDiscovery(flags);
      break;
    case "permission-policy":
      await commandPermissionPolicy(flags);
      break;
    case "streamliner-claim-binding":
      await commandStreamlinerClaimBinding(flags);
      break;
    case "dogfood-pr":
      await commandDogfoodPr(flags);
      break;
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
