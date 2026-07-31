import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
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
  startOffset?: number;
  endOffset?: number;
  baseTurnIndex?: number;
}

export interface UserTurnScanResult {
  totalTurns: number;
  recentTurns: RecentUserTurn[];
  startOffset: number;
  endOffset: number;
}

interface RawEventLine {
  type?: string;
  data?: { content?: unknown };
  timestamp?: string;
}

const DEFAULT_MAX_TURNS = 4;
const DEFAULT_MAX_CHARS_PER_TURN = 1500;
const SCAN_YIELD_INTERVAL_LINES = 250;
const LINE_BOUNDARY_SCAN_CHUNK_BYTES = 64 * 1024;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function isLineBoundary(eventsPath: string, offset: number): boolean {
  if (offset === 0) {
    return true;
  }
  const fd = openSync(eventsPath, "r");
  try {
    const byte = Buffer.allocUnsafe(1);
    return readSync(fd, byte, 0, 1, offset - 1) === 1 && byte[0] === 0x0a;
  } finally {
    closeSync(fd);
  }
}

function lastCompleteLineEndOffset(eventsPath: string, requestedEndOffset: number): number {
  if (requestedEndOffset <= 0) {
    return 0;
  }
  const fd = openSync(eventsPath, "r");
  try {
    const completeTrailingRecordEnd = (lineStart: number): number => {
      if (lineStart === requestedEndOffset) {
        return requestedEndOffset;
      }
      const trailing = Buffer.allocUnsafe(requestedEndOffset - lineStart);
      const bytesRead = readSync(fd, trailing, 0, trailing.length, lineStart);
      try {
        JSON.parse(trailing.subarray(0, bytesRead).toString("utf8").trim());
        return requestedEndOffset;
      } catch {
        return lineStart;
      }
    };
    let cursor = requestedEndOffset;
    while (cursor > 0) {
      const chunkStart = Math.max(0, cursor - LINE_BOUNDARY_SCAN_CHUNK_BYTES);
      const buffer = Buffer.allocUnsafe(cursor - chunkStart);
      const bytesRead = readSync(fd, buffer, 0, buffer.length, chunkStart);
      for (let index = bytesRead - 1; index >= 0; index -= 1) {
        if (buffer[index] === 0x0a) {
          return completeTrailingRecordEnd(chunkStart + index + 1);
        }
      }
      cursor = chunkStart;
    }
    return completeTrailingRecordEnd(0);
  } finally {
    closeSync(fd);
  }
}

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
  const scan = await scanUserMessageTurns(eventsPath, options);
  return scan.recentTurns;
}

export async function scanUserMessageTurns(
  eventsPath: string,
  options: ExtractUserTurnsOptions = {},
): Promise<UserTurnScanResult> {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxCharsPerTurn = options.maxCharsPerTurn ?? DEFAULT_MAX_CHARS_PER_TURN;
  if (!existsSync(eventsPath)) {
    return { totalTurns: 0, recentTurns: [], startOffset: 0, endOffset: 0 };
  }

  const stat = statSync(eventsPath);
  const requestedStartOffset = Number.isFinite(options.startOffset)
    ? Math.max(0, Math.floor(options.startOffset ?? 0))
    : 0;
  const requestedEndOffset = Number.isFinite(options.endOffset)
    ? Math.min(stat.size, Math.max(0, Math.floor(options.endOffset ?? 0)))
    : stat.size;
  const endOffset = lastCompleteLineEndOffset(eventsPath, requestedEndOffset);
  const startOffset =
    requestedStartOffset <= endOffset && isLineBoundary(eventsPath, requestedStartOffset)
      ? requestedStartOffset
      : 0;
  if (endOffset <= startOffset) {
    return { totalTurns: 0, recentTurns: [], startOffset, endOffset };
  }
  const baseTurnIndex = Number.isFinite(options.baseTurnIndex)
    ? startOffset === requestedStartOffset
      ? Math.max(0, Math.floor(options.baseTurnIndex ?? 0))
      : 0
    : 0;
  const stream = createReadStream(eventsPath, {
    encoding: "utf8",
    ...(startOffset > 0 ? { start: startOffset } : {}),
    end: endOffset - 1,
  });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  const recentTurns: RecentUserTurn[] = [];
  let totalTurns = 0;
  let linesScanned = 0;
  for await (const line of lines) {
    linesScanned += 1;
    if (linesScanned % SCAN_YIELD_INTERVAL_LINES === 0) {
      await yieldToEventLoop();
    }
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
    totalTurns += 1;
    if (maxTurns > 0) {
      recentTurns.push({
        index: totalTurns,
        absoluteIndex: baseTurnIndex + totalTurns,
        content: truncate(content, maxCharsPerTurn),
        timestamp: parsed.timestamp,
      });
      if (recentTurns.length > maxTurns) {
        recentTurns.shift();
      }
    }
  }

  return {
    totalTurns,
    recentTurns: recentTurns.map((turn, index) => ({ ...turn, index: index + 1 })),
    startOffset,
    endOffset,
  };
}

export async function countUserMessageTurns(eventsPath: string): Promise<number> {
  return (await scanUserMessageTurns(eventsPath, { maxTurns: 0 })).totalTurns;
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
  "You write concise descriptions for Copilot coding sessions.",
  "Return exactly two short sentences, no more than 55 words total.",
  "Sentence one describes the session's goal or start context using the existing title, repo, and branch only when helpful.",
  "Sentence two describes the latest user requests or current direction from the recent messages.",
  "Do not write a title. No labels like 'Summary:' or 'Latest:', no markdown, no bullets, no quotes.",
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
    "Based on the session context and recent user messages below, produce the two-sentence session description now.",
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
  const normalized = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line.length > 0)
    .join(" ");
  if (!normalized) return "";
  return normalized
    .replace(/^summary[:\s-]+/i, "")
    .replace(/^description[:\s-]+/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type CopilotSdkModule = typeof import("@github/copilot-sdk");

interface SharedCopilotClient {
  start: () => Promise<void>;
  createSession: (config: unknown) => Promise<unknown>;
  deleteSession: (sessionId: string) => Promise<void>;
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
      logLevel: "error",
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
    deleteSession?: (sessionId: string) => Promise<void>;
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
      if (helperSessionId && typeof client.deleteSession === "function") {
        try {
          await client.deleteSession(helperSessionId);
        } catch {
          // The isolated session filesystem is still removed below.
        }
      }
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
