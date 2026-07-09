import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

import type { SessionRegistryListItem } from "../session-registry-contract";
import {
  buildSessionRegistryActivityEvidence,
  type SessionRegistryActivityDiagnosticCode,
  type SessionRegistryActivityEvidence,
  type SessionRegistryActivityStatusReason,
  type SessionRegistryActivityStatus,
} from "../session-registry-schema";
import type { SessionRegistryDerivedStatePatch } from "./file-store";
import { processExists } from "./lock-liveness";

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

interface AnonymousAskUserRequest {
  openedAtMs: number | null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  let bytesRead = 0;
  try {
    bytesRead = readSync(fd, buffer, 0, bytesToRead, start);
  } finally {
    closeSync(fd);
  }
  let text = buffer.subarray(0, bytesRead).toString("utf8");
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

/**
 * Copilot CLI currently serializes ask_user requests as plain `ask_user`,
 * or as provider-qualified names ending in `.ask_user` or `/ask_user`.
 */
function isAskUserTool(value: unknown): boolean {
  return isAskUserToolName(getToolName(value));
}

function extractToolRequestArrays(event: RawActivityEvent): unknown[][] {
  if (!isJsonObject(event.data)) {
    return [];
  }
  const candidates = [event.data.toolRequests];
  if (isJsonObject(event.data.message)) {
    candidates.push(event.data.message.toolRequests);
  }
  return candidates.filter((candidate): candidate is unknown[] =>
    Array.isArray(candidate),
  );
}

/**
 * Supports the Copilot CLI event shapes observed so far:
 * `event.data.toolRequests` and nested `event.data.message.toolRequests`.
 */
function extractToolRequests(event: RawActivityEvent): unknown[] {
  return extractToolRequestArrays(event).flatMap((candidate) => candidate);
}

function toolRequestsHaveUnrecognizedShape(event: RawActivityEvent): boolean {
  const requests = extractToolRequests(event);
  return requests.length > 0 && requests.every((request) => getToolName(request) === null);
}

function uniqueAskUserRequests(requests: unknown[]): unknown[] {
  const seenObjectRequests = new WeakSet<object>();
  const seenAnonymousToolNames = new Set<string>();
  const unique: unknown[] = [];
  for (const request of requests) {
    if (typeof request === "object" && request !== null) {
      if (seenObjectRequests.has(request)) {
        continue;
      }
      seenObjectRequests.add(request);
    }
    const toolCallId = getToolCallId(request);
    const toolName = getToolName(request);
    if (!toolCallId && isAskUserToolName(toolName)) {
      const normalized = toolName?.toLowerCase() ?? "ask_user";
      if (seenAnonymousToolNames.has(normalized)) {
        continue;
      }
      seenAnonymousToolNames.add(normalized);
    }
    unique.push(request);
  }
  return unique;
}

function parseOptionalTimestampMs(timestamp: string | null): number | null {
  if (!timestamp) {
    return null;
  }
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : null;
}

function statusReasonFromDiagnostic(
  code: SessionRegistryActivityDiagnosticCode,
): SessionRegistryActivityStatusReason | null {
  switch (code) {
    case "events_missing":
      return "events_missing";
    case "events_empty":
      return "events_empty";
    case "events_unrecognized":
      return "events_unrecognized";
    default:
      return null;
  }
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
  return buildSessionRegistryActivityEvidence(args);
}

function parseActivityFromEvents(
  eventsPath: string,
  maxBytes: number,
  nowIso: string,
): ActivityObservation | null {
  if (!existsSync(eventsPath)) {
    const diagnostic = "events_missing";
    return {
      status: null,
      observedAt: null,
      evidence: buildActivityEvidence({
        statusReason: statusReasonFromDiagnostic(diagnostic) ?? "events_unrecognized",
        confidence: "low",
        diagnostics: [diagnostic],
        eventsScannedAt: nowIso,
      }),
    };
  }
  const tail = readTail(eventsPath, maxBytes);
  const diagnostics: SessionRegistryActivityDiagnosticCode[] = tail.truncated
    ? ["events_tail_truncated"]
    : [];
  if (tail.text.trim().length === 0) {
    const diagnostic =
      tail.truncated && tail.size > 0 && tail.offset === tail.size
        ? "events_unrecognized"
        : "events_empty";
    return {
      status: null,
      observedAt: null,
      evidence: buildActivityEvidence({
        statusReason: statusReasonFromDiagnostic(diagnostic) ?? "events_unrecognized",
        confidence: "low",
        diagnostics: [...diagnostics, diagnostic],
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
  let anonymousAskUserRequests: AnonymousAskUserRequest[] = [];

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
        const turnEndMs = parseOptionalTimestampMs(timestamp);
        if (turnEndMs !== null) {
          anonymousAskUserRequests = anonymousAskUserRequests.filter(
            (request) =>
              request.openedAtMs === null || request.openedAtMs >= turnEndMs,
          );
        }
      }

      if (toolRequestsHaveUnrecognizedShape(event)) {
        diagnostics.push("events_unrecognized_tool_shape");
      }

      const askUserRequests = uniqueAskUserRequests(
        extractToolRequests(event).filter(isAskUserTool),
      );
      for (const request of askUserRequests) {
        const toolCallId = getToolCallId(request);
        if (toolCallId) {
          openAskUserToolCalls.add(toolCallId);
        } else {
          anonymousAskUserRequests.push({
            openedAtMs: parseOptionalTimestampMs(timestamp),
          });
        }
        latestAskUserAt = timestamp;
      }

      if (event.type === "tool.execution_start" && isAskUserTool(event.data)) {
        const toolCallId = getToolCallId(event.data);
        if (toolCallId) {
          openAskUserToolCalls.add(toolCallId);
        } else {
          anonymousAskUserRequests.push({
            openedAtMs: parseOptionalTimestampMs(timestamp),
          });
        }
        latestAskUserAt = timestamp;
      }

      if (event.type === "tool.execution_complete") {
        const toolCallId = getToolCallId(event.data);
        if (toolCallId) {
          openAskUserToolCalls.delete(toolCallId);
        } else if (anonymousAskUserRequests.length > 0) {
          const completedToolName = getToolName(event.data);
          if (isAskUserToolName(completedToolName)) {
            anonymousAskUserRequests = anonymousAskUserRequests.slice(1);
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
    openAskUserToolCalls.size + anonymousAskUserRequests.length;
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
        lastActivityEventAt: latest?.observedAt ?? latestAskUserAt ?? null,
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
    const diagnostic = "events_unrecognized";
    return {
      status: null,
      observedAt: null,
      evidence: buildActivityEvidence({
        statusReason: statusReasonFromDiagnostic(diagnostic) ?? "events_unrecognized",
        confidence: "low",
        diagnostics: [...diagnostics, diagnostic],
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
  const comparableActivityEvidenceKey = (
    evidence: SessionRegistryActivityEvidence,
  ): string => {
    const comparable: Partial<SessionRegistryActivityEvidence> = { ...evidence };
    delete comparable.eventsScannedAt;
    delete comparable.eventsOffset;
    delete comparable.eventsSize;
    delete comparable.eventsMtimeMs;
    if (comparable.diagnostics) {
      comparable.diagnostics = [...comparable.diagnostics].sort();
    }
    return JSON.stringify(comparable);
  };

  return (
    (patch.activityStatus !== undefined && patch.activityStatus !== session.activityStatus) ||
    (patch.activityStatusUpdatedAt !== undefined &&
      patch.activityStatusUpdatedAt !== session.activityStatusUpdatedAt) ||
    (patch.activityEvidence !== undefined &&
      comparableActivityEvidenceKey(patch.activityEvidence) !==
        comparableActivityEvidenceKey(session.activityEvidence)) ||
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
