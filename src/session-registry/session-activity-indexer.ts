import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

import type { SessionRegistryListItem } from "../session-registry-contract";
import {
  DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
  type SessionRegistryActivityDiagnosticCode,
  type SessionRegistryActivityEvidence,
  type SessionRegistryActivityStatus,
} from "../session-registry-schema";
import type { SessionRegistryDerivedStatePatch } from "./file-store";

export const SESSION_ACTIVITY_INDEX_MAX_BYTES = 128 * 1024;

interface SessionActivityIndexOptions {
  maxBytes?: number;
  now?: () => Date;
  processExists?: (pid: number) => boolean;
}

interface ActivityObservation {
  status: SessionRegistryActivityStatus | null;
  observedAt: string | null;
  evidence: SessionRegistryActivityEvidence;
}

interface ActivityEventObservation {
  status: SessionRegistryActivityStatus;
  reason: SessionRegistryActivityEvidence["statusReason"];
  observedAt: string | null;
}

interface TailRead {
  text: string;
  offset: number;
  size: number;
  mtimeMs: number | null;
  truncated: boolean;
}

interface RawActivityEvent {
  type?: unknown;
  timestamp?: unknown;
  data?: unknown;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

function readTail(path: string, maxBytes: number): TailRead {
  const stat = statSync(path);
  if (stat.size === 0) {
    return {
      text: "",
      offset: 0,
      size: 0,
      mtimeMs: stat.mtimeMs,
      truncated: false,
    };
  }
  const bytesToRead = Math.min(Math.max(1, maxBytes), stat.size);
  const start = stat.size - bytesToRead;
  const buffer = Buffer.alloc(bytesToRead);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, bytesToRead, start);
  } finally {
    closeSync(fd);
  }
  let text = buffer.toString("utf8");
  let offset = start;
  if (start > 0) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline >= 0) {
      text = text.slice(firstNewline + 1);
      offset = start + firstNewline + 1;
    } else {
      text = "";
      offset = stat.size;
    }
  }
  return {
    text,
    offset,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    truncated: start > 0,
  };
}

function isUserRequestedToolExecution(event: RawActivityEvent): boolean {
  return isJsonObject(event.data) && event.data.isUserRequested === true;
}

function getStringField(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function getToolCallId(value: unknown): string | null {
  if (!isJsonObject(value)) {
    return null;
  }
  return getStringField(value, ["toolCallId", "id", "callId"]);
}

function getToolName(value: unknown): string | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const direct = getStringField(value, ["toolName", "name"]);
  if (direct) {
    return direct;
  }
  const functionValue = value.function;
  return isJsonObject(functionValue) ? getStringField(functionValue, ["name"]) : null;
}

function isAskUserToolName(name: string | null): boolean {
  if (!name) {
    return false;
  }
  const normalized = name.toLowerCase();
  return (
    normalized === "ask_user" ||
    normalized.endsWith(".ask_user") ||
    normalized.endsWith("/ask_user")
  );
}

function isAskUserTool(value: unknown): boolean {
  return isAskUserToolName(getToolName(value));
}

function extractToolRequests(event: RawActivityEvent): unknown[] {
  if (!isJsonObject(event.data)) {
    return [];
  }
  const candidates = [event.data.toolRequests];
  if (isJsonObject(event.data.message)) {
    candidates.push(event.data.message.toolRequests);
  }
  return candidates.flatMap((candidate) =>
    Array.isArray(candidate) ? candidate : [],
  );
}

function eventToActivityObservation(
  event: RawActivityEvent,
  hasAskUserRequest: boolean,
): ActivityEventObservation | null {
  const type = event.type;
  if (typeof type !== "string") {
    return null;
  }
  const observedAt = typeof event.timestamp === "string" ? event.timestamp : null;
  if (hasAskUserRequest) {
    return {
      status: "waiting_for_input",
      reason: "pending_input",
      observedAt,
    };
  }
  if (type === "tool.execution_start" && isAskUserTool(event.data)) {
    return {
      status: "waiting_for_input",
      reason: "pending_input",
      observedAt,
    };
  }
  if (type === "assistant.turn_end") {
    return {
      status: "waiting_for_input",
      reason: "assistant_turn_end",
      observedAt,
    };
  }
  if (type === "session.ended") {
    return {
      status: "exited",
      reason: "session_ended",
      observedAt,
    };
  }
  if (type === "tool.execution_complete" && isUserRequestedToolExecution(event)) {
    return {
      status: "waiting_for_input",
      reason: "user_requested_tool_complete",
      observedAt,
    };
  }

  switch (type) {
    case "user.message":
      return { status: "working", reason: "user_message", observedAt };
    case "tool.user_requested":
      return { status: "working", reason: "tool_user_requested", observedAt };
    case "assistant.turn_start":
      return { status: "working", reason: "assistant_turn_start", observedAt };
    case "assistant.message":
      return { status: "working", reason: "assistant_message", observedAt };
    case "tool.execution_start":
      return { status: "working", reason: "tool_execution_start", observedAt };
    case "tool.execution_complete":
      return { status: "working", reason: "tool_execution_complete", observedAt };
    default:
      return null;
  }
}

function uniqueDiagnostics(
  diagnostics: SessionRegistryActivityDiagnosticCode[],
): SessionRegistryActivityDiagnosticCode[] {
  return [...new Set(diagnostics)];
}

function buildActivityEvidence(args: {
  statusReason: SessionRegistryActivityEvidence["statusReason"];
  confidence: SessionRegistryActivityEvidence["confidence"];
  diagnostics?: SessionRegistryActivityDiagnosticCode[];
  pendingInputRequest?: boolean;
  pendingInputRequestCount?: number;
  lastUserMessageAt?: string | null;
  lastAssistantTurnStartedAt?: string | null;
  lastAssistantTurnEndedAt?: string | null;
  lastActivityEventAt?: string | null;
  userMessageCount?: number;
  assistantTurnCount?: number;
  eventsScannedAt?: string | null;
  eventsOffset?: number;
  eventsSize?: number;
  eventsMtimeMs?: number | null;
}): SessionRegistryActivityEvidence {
  return {
    ...DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    ...args,
    diagnostics: uniqueDiagnostics(args.diagnostics ?? []),
  };
}

function parseActivityFromEvents(
  eventsPath: string,
  maxBytes: number,
  nowIso: string,
): ActivityObservation | null {
  if (!existsSync(eventsPath)) {
    return {
      status: null,
      observedAt: null,
      evidence: buildActivityEvidence({
        statusReason: "events_missing",
        confidence: "low",
        diagnostics: ["events_missing"],
        eventsScannedAt: nowIso,
      }),
    };
  }
  const tail = readTail(eventsPath, maxBytes);
  const diagnostics: SessionRegistryActivityDiagnosticCode[] = tail.truncated
    ? ["events_tail_truncated"]
    : [];
  if (tail.text.trim().length === 0) {
    return {
      status: null,
      observedAt: null,
      evidence: buildActivityEvidence({
        statusReason: "events_empty",
        confidence: "low",
        diagnostics: [...diagnostics, "events_empty"],
        eventsScannedAt: nowIso,
        eventsOffset: tail.offset,
        eventsSize: tail.size,
        eventsMtimeMs: tail.mtimeMs,
      }),
    };
  }

  let latest: ActivityEventObservation | null = null;
  let userMessageCount = 0;
  let assistantTurnCount = 0;
  let lastUserMessageAt: string | null = null;
  let lastAssistantTurnStartedAt: string | null = null;
  let lastAssistantTurnEndedAt: string | null = null;
  let latestAskUserAt: string | null = null;
  const openAskUserToolCalls = new Set<string>();
  let anonymousAskUserRequests = 0;

  for (const line of tail.text.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const event = JSON.parse(line) as RawActivityEvent;
      const timestamp = typeof event.timestamp === "string" ? event.timestamp : null;
      if (event.type === "user.message") {
        userMessageCount += 1;
        lastUserMessageAt = timestamp;
      }
      if (event.type === "assistant.turn_start") {
        assistantTurnCount += 1;
        lastAssistantTurnStartedAt = timestamp;
      }
      if (event.type === "assistant.turn_end") {
        lastAssistantTurnEndedAt = timestamp;
      }

      const askUserRequests = extractToolRequests(event).filter(isAskUserTool);
      for (const request of askUserRequests) {
        const toolCallId = getToolCallId(request);
        if (toolCallId) {
          openAskUserToolCalls.add(toolCallId);
        } else {
          anonymousAskUserRequests += 1;
        }
        latestAskUserAt = timestamp;
      }

      if (event.type === "tool.execution_start" && isAskUserTool(event.data)) {
        const toolCallId = getToolCallId(event.data);
        if (toolCallId) {
          openAskUserToolCalls.add(toolCallId);
        } else {
          anonymousAskUserRequests += 1;
        }
        latestAskUserAt = timestamp;
      }

      if (event.type === "tool.execution_complete") {
        const toolCallId = getToolCallId(event.data);
        if (toolCallId) {
          openAskUserToolCalls.delete(toolCallId);
        } else if (anonymousAskUserRequests > 0) {
          const completedToolName = getToolName(event.data);
          if (isAskUserToolName(completedToolName)) {
            anonymousAskUserRequests -= 1;
          }
        }
      }

      const observation = eventToActivityObservation(event, askUserRequests.length > 0);
      if (!observation) {
        continue;
      }
      latest = observation;
    } catch {
      diagnostics.push("events_parse_error");
    }
  }

  const pendingInputRequestCount =
    openAskUserToolCalls.size + anonymousAskUserRequests;
  if (pendingInputRequestCount > 0) {
    const confidence = diagnostics.length > 0 ? "medium" : "high";
    return {
      status: "waiting_for_input",
      observedAt: latestAskUserAt ?? latest?.observedAt ?? null,
      evidence: buildActivityEvidence({
        statusReason: "pending_input",
        confidence,
        diagnostics,
        pendingInputRequest: true,
        pendingInputRequestCount,
        lastUserMessageAt,
        lastAssistantTurnStartedAt,
        lastAssistantTurnEndedAt,
        lastActivityEventAt: latestAskUserAt ?? latest?.observedAt ?? null,
        userMessageCount,
        assistantTurnCount,
        eventsScannedAt: nowIso,
        eventsOffset: tail.offset,
        eventsSize: tail.size,
        eventsMtimeMs: tail.mtimeMs,
      }),
    };
  }

  if (!latest) {
    return {
      status: null,
      observedAt: null,
      evidence: buildActivityEvidence({
        statusReason: "events_unrecognized",
        confidence: "low",
        diagnostics: [...diagnostics, "events_unrecognized"],
        lastUserMessageAt,
        lastAssistantTurnStartedAt,
        lastAssistantTurnEndedAt,
        userMessageCount,
        assistantTurnCount,
        eventsScannedAt: nowIso,
        eventsOffset: tail.offset,
        eventsSize: tail.size,
        eventsMtimeMs: tail.mtimeMs,
      }),
    };
  }

  return {
    status: latest.status,
    observedAt: latest.observedAt,
    evidence: buildActivityEvidence({
      statusReason: latest.reason,
      confidence: diagnostics.length > 0 ? "medium" : "high",
      diagnostics,
      lastUserMessageAt,
      lastAssistantTurnStartedAt,
      lastAssistantTurnEndedAt,
      lastActivityEventAt: latest.observedAt,
      userMessageCount,
      assistantTurnCount,
      eventsScannedAt: nowIso,
      eventsOffset: tail.offset,
      eventsSize: tail.size,
      eventsMtimeMs: tail.mtimeMs,
    }),
  };
}

function patchChanged(
  session: SessionRegistryListItem,
  patch: SessionRegistryDerivedStatePatch,
): boolean {
  const comparableActivityEvidence = (
    evidence: SessionRegistryActivityEvidence,
  ): Omit<
    SessionRegistryActivityEvidence,
    "eventsScannedAt" | "eventsOffset" | "eventsSize" | "eventsMtimeMs"
  > => {
    return {
      statusReason: evidence.statusReason,
      confidence: evidence.confidence,
      diagnostics: evidence.diagnostics,
      pendingInputRequest: evidence.pendingInputRequest,
      pendingInputRequestCount: evidence.pendingInputRequestCount,
      lastUserMessageAt: evidence.lastUserMessageAt,
      lastAssistantTurnStartedAt: evidence.lastAssistantTurnStartedAt,
      lastAssistantTurnEndedAt: evidence.lastAssistantTurnEndedAt,
      lastActivityEventAt: evidence.lastActivityEventAt,
      userMessageCount: evidence.userMessageCount,
      assistantTurnCount: evidence.assistantTurnCount,
    };
  };

  return (
    (patch.activityStatus !== undefined && patch.activityStatus !== session.activityStatus) ||
    (patch.activityStatusUpdatedAt !== undefined &&
      patch.activityStatusUpdatedAt !== session.activityStatusUpdatedAt) ||
    (patch.activityEvidence !== undefined &&
      JSON.stringify(comparableActivityEvidence(patch.activityEvidence)) !==
        JSON.stringify(comparableActivityEvidence(session.activityEvidence))) ||
    (patch.copilotProcessState !== undefined &&
      patch.copilotProcessState !== session.copilotProcessState) ||
    (patch.copilotProcessId !== undefined && patch.copilotProcessId !== session.copilotProcessId)
  );
}

export function indexSessionActivity(
  session: SessionRegistryListItem,
  eventsPath: string,
  options: SessionActivityIndexOptions = {},
): SessionRegistryDerivedStatePatch | null {
  const now = options.now ?? (() => new Date());
  const nowIso = now().toISOString();
  const processExistsFn = options.processExists ?? processExists;

  let patch: SessionRegistryDerivedStatePatch | null = null;
  if (session.trustedEndedAt || session.lifecycleStatus === "ended") {
    const observedAt = session.trustedEndedAt ?? session.lastSeenAt ?? nowIso;
    patch = {
      activityStatus: "exited",
      activityStatusUpdatedAt: observedAt,
      activityEvidence: buildActivityEvidence({
        statusReason: session.trustedEndedAt ? "trusted_end" : "session_ended",
        confidence: "high",
        lastActivityEventAt: observedAt,
      }),
    };
  } else if (
    session.trustedStartedAt &&
    session.trustedEndedAt === null &&
    (session.copilotProcessState !== "live" ||
      (session.copilotProcessId !== null && !processExistsFn(session.copilotProcessId)))
  ) {
    const interruptedAt =
      session.activityStatus === "interrupted" &&
      session.activityEvidence.statusReason === "process_interrupted" &&
      session.activityStatusUpdatedAt
        ? session.activityStatusUpdatedAt
        : nowIso;
    patch = {
      copilotProcessState: "none",
      copilotProcessId: null,
      activityStatus: "interrupted",
      activityStatusUpdatedAt: interruptedAt,
      activityEvidence: buildActivityEvidence({
        statusReason: "process_interrupted",
        confidence: "high",
        lastActivityEventAt: interruptedAt,
      }),
    };
  } else {
    const observation = parseActivityFromEvents(
      eventsPath,
      options.maxBytes ?? SESSION_ACTIVITY_INDEX_MAX_BYTES,
      nowIso,
    );
    if (observation) {
      patch = {
        activityEvidence: observation.evidence,
      };
      if (observation.status) {
        patch.activityStatus = observation.status;
        patch.activityStatusUpdatedAt = observation.observedAt ?? nowIso;
      }
    }
  }

  if (!patch || !patchChanged(session, patch)) {
    return null;
  }
  return patch;
}
