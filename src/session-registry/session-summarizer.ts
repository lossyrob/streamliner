import { createReadStream, existsSync, statSync } from "node:fs";
import { createInterface } from "node:readline";

import {
  cleanupResidualDefaultCopilotSessionState,
  createCopilotSdkSessionFsHandle,
  getCopilotSdkSessionFsConfig,
  type CopilotSdkSessionFsHandle,
} from "./copilot-sdk-session-fs";
import { rememberIgnoredObservedCopilotSessionId } from "./copilot-session-discovery";

export interface RecentUserTurn {
  index: number;
  absoluteIndex: number;
  content: string;
  timestamp?: string;
}

export interface ExtractUserTurnsOptions {
  maxTurns?: number;
  maxCharsPerTurn?: number;
}

interface RawEventLine {
  type?: string;
  data?: { content?: unknown };
  timestamp?: string;
}

const DEFAULT_MAX_TURNS = 4;
const DEFAULT_MAX_CHARS_PER_TURN = 1500;

function toStringContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value == null) return null;
  if (Array.isArray(value)) {
    const pieces = value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : null;
        }
        return null;
      })
      .filter((piece): piece is string => piece !== null);
    return pieces.length > 0 ? pieces.join("\n") : null;
  }
  if (typeof value === "object" && value !== null && "text" in value) {
    const text = (value as { text?: unknown }).text;
    return typeof text === "string" ? text : null;
  }
  return null;
}

function truncate(text: string, maxChars: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1)}…`;
}

/**
 * Stream events.jsonl and return the most recent user.message turns, trimmed
 * to a reasonable size. Designed to work cheaply even against the 48MB files
 * that long-running Copilot sessions accumulate.
 */
export async function extractRecentUserTurns(
  eventsPath: string,
  options: ExtractUserTurnsOptions = {},
): Promise<RecentUserTurn[]> {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxCharsPerTurn = options.maxCharsPerTurn ?? DEFAULT_MAX_CHARS_PER_TURN;
  if (!existsSync(eventsPath)) return [];

  const stream = createReadStream(eventsPath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  const collected: RecentUserTurn[] = [];
  let index = 0;
  for await (const line of lines) {
    if (!line || line[0] !== "{") continue;
    let parsed: RawEventLine;
    try {
      parsed = JSON.parse(line) as RawEventLine;
    } catch {
      continue;
    }
    if (parsed.type !== "user.message") continue;
    const content = toStringContent(parsed.data?.content);
    if (!content) continue;
    const absoluteIndex = index + 1;
    collected.push({
      index: absoluteIndex,
      absoluteIndex,
      content: truncate(content, maxCharsPerTurn),
      timestamp: parsed.timestamp,
    });
    index += 1;
  }

  return collected.slice(-maxTurns).map((turn, idx) => ({ ...turn, index: idx + 1 }));
}

export interface SessionSummaryContext {
  title?: string | null;
  repo?: string | null;
  branch?: string | null;
  cwd?: string | null;
}

export interface SummarizeSessionOptions {
  turns: RecentUserTurn[];
  context?: SessionSummaryContext;
  model: string;
  /** Timeout in milliseconds for the SDK call. Defaults to 60s. */
  timeoutMs?: number;
  /** Optional shared CopilotClient instance. If omitted, one is started for this call. */
  client?: unknown;
}

export interface SummarizeSessionResult {
  summary: string;
  model: string;
  durationMs: number;
  rawContent: string;
}

export const DEFAULT_SUMMARY_MODEL = "gpt-5.4-mini";

const SUMMARY_SYSTEM_PROMPT = [
  "You summarize Copilot coding agent sessions in a single short phrase (6-10 words).",
  "The phrase describes what the user is actively working on based on their recent messages.",
  "Use present-tense verbs (e.g. 'Debugging auth token refresh', 'Redesigning session list UI').",
  "No quotes, no prefixes like 'Summary:', no trailing punctuation, no markdown. Plain text only.",
].join(" ");

function buildUserPrompt(
  turns: RecentUserTurn[],
  context: SessionSummaryContext | undefined,
): string {
  const header: string[] = [];
  if (context?.repo) header.push(`Repo: ${context.repo}`);
  if (context?.branch) header.push(`Branch: ${context.branch}`);
  if (context?.cwd) header.push(`Cwd: ${context.cwd}`);
  if (context?.title) header.push(`Existing title: ${context.title}`);
  const body = turns
    .map((turn) => `--- User turn ${turn.index} ---\n${turn.content}`)
    .join("\n\n");
  return [
    header.length > 0 ? header.join("\n") : null,
    "Based on the user's recent messages below, produce the summary phrase now.",
    body,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function sanitizeSummary(raw: string): string {
  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const firstLine = cleaned.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
  if (!firstLine) return "";
  return firstLine
    .replace(/^summary[:\s-]+/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/g, "")
    .trim();
}

type CopilotSdkModule = typeof import("@github/copilot-sdk");

interface SharedCopilotClient {
  start: () => Promise<void>;
  createSession: (config: unknown) => Promise<unknown>;
  stop: () => Promise<unknown>;
}

interface SummarizerSession {
  sessionId?: string;
  sendAndWait: (
    opts: { prompt: string },
    timeout: number,
  ) => Promise<{ content?: string } | undefined>;
  disconnect?: () => Promise<void>;
  destroy?: () => Promise<void>;
}

async function cleanupSessionFsHandle(
  handle: CopilotSdkSessionFsHandle | null,
): Promise<void> {
  if (!handle) {
    return;
  }
  try {
    await handle.cleanup();
  } catch {
    // best-effort cleanup for isolated SDK session storage
  }
}

let sharedSdk: CopilotSdkModule | null = null;
let sharedClient: SharedCopilotClient | null = null;

async function loadSdk(): Promise<CopilotSdkModule> {
  if (!sharedSdk) {
    sharedSdk = await import("@github/copilot-sdk");
  }
  return sharedSdk;
}

/**
 * Obtain a shared Copilot client. The client spawns a ~133MB process, so we
 * keep one per Node process and reuse it across summarize calls.
 */
export async function getSharedCopilotClient(): Promise<unknown> {
  if (!sharedClient) {
    const sdk = await loadSdk();
    const client = new sdk.CopilotClient({
      sessionFs: getCopilotSdkSessionFsConfig(),
    });
    await client.start();
    sharedClient = client as unknown as SharedCopilotClient;
  }
  return sharedClient;
}

export async function shutdownSharedCopilotClient(): Promise<void> {
  if (!sharedClient) return;
  const client = sharedClient;
  sharedClient = null;
  try {
    await client.stop();
  } catch {
    // best-effort
  }
}

export async function summarizeSession(
  options: SummarizeSessionOptions,
): Promise<SummarizeSessionResult> {
  if (options.turns.length === 0) {
    throw new Error("summarizeSession requires at least one user turn.");
  }
  const sdk = await loadSdk();
  const client = (options.client ?? (await getSharedCopilotClient())) as {
    createSession: (config: unknown) => Promise<unknown>;
  };

  const timeoutMs = options.timeoutMs ?? 60_000;
  const systemMessage = { mode: "replace" as const, content: SUMMARY_SYSTEM_PROMPT };
  let sessionFsHandle: CopilotSdkSessionFsHandle | null = null;
  let helperSessionId: string | null = null;
  const session = (await client.createSession({
    model: options.model,
    systemMessage,
    onPermissionRequest: sdk.approveAll,
    onUserInputRequest: async (request: { choices?: string[] }) => ({
      answer: request.choices?.[0] ?? "Proceed.",
      wasFreeform: !request.choices?.length,
    }),
    createSessionFsHandler: (createdSession: { sessionId: string }) => {
      helperSessionId = createdSession.sessionId;
      sessionFsHandle = createCopilotSdkSessionFsHandle(createdSession.sessionId);
      return sessionFsHandle.provider;
    },
  })) as SummarizerSession;
  if (typeof session.sessionId === "string") {
    helperSessionId = session.sessionId;
    rememberIgnoredObservedCopilotSessionId(session.sessionId);
  }

  const prompt = buildUserPrompt(options.turns, options.context);
  const startedAt = Date.now();
  try {
    const response = await session.sendAndWait({ prompt }, timeoutMs);
    const responseAsAny = response as
      | { content?: string; data?: { content?: string } }
      | undefined;
    const rawContent =
      responseAsAny?.data?.content ?? responseAsAny?.content ?? "";
    const durationMs = Date.now() - startedAt;
    return {
      summary: sanitizeSummary(rawContent),
      model: options.model,
      durationMs,
      rawContent,
    };
  } finally {
    try {
      if (typeof session.disconnect === "function") {
        await session.disconnect();
      } else if (typeof session.destroy === "function") {
        await session.destroy();
      }
    } catch {
      // best-effort cleanup; a failed destroy shouldn't mask the primary result
    } finally {
      await cleanupSessionFsHandle(sessionFsHandle);
      if (helperSessionId) {
        await cleanupResidualDefaultCopilotSessionState(helperSessionId);
      }
    }
  }
}

/**
 * Cache key used by the registry to avoid re-summarizing unchanged sessions.
 * Combines the events file mtime with its byte length so that appending new
 * events invalidates the cache even within the same mtime millisecond.
 */
export function computeEventsFingerprint(eventsPath: string): string | null {
  if (!existsSync(eventsPath)) return null;
  const stat = statSync(eventsPath);
  return `${stat.mtimeMs}:${stat.size}`;
}
