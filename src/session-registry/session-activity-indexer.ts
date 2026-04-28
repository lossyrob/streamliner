import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

import type { SessionRegistryListItem } from "../session-registry-contract";
import type { SessionRegistryActivityStatus } from "../session-registry-schema";
import type { SessionRegistryDerivedStatePatch } from "./file-store";

export const SESSION_ACTIVITY_INDEX_MAX_BYTES = 128 * 1024;

interface SessionActivityIndexOptions {
  maxBytes?: number;
  now?: () => Date;
  processExists?: (pid: number) => boolean;
}

interface ActivityObservation {
  status: SessionRegistryActivityStatus;
  observedAt: string | null;
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

function readTail(path: string, maxBytes: number): string {
  const stat = statSync(path);
  if (stat.size === 0) {
    return "";
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
  if (start > 0) {
    const firstNewline = text.indexOf("\n");
    text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
  }
  return text;
}

function eventTypeToActivityStatus(type: string): SessionRegistryActivityStatus | null {
  if (type === "assistant.turn_end") {
    return "waiting_for_input";
  }
  if (type === "session.ended") {
    return "exited";
  }
  if (
    type === "user.message" ||
    type === "assistant.turn_start" ||
    type === "assistant.message" ||
    type === "tool.execution_start" ||
    type === "tool.execution_complete"
  ) {
    return "working";
  }
  return null;
}

function parseActivityFromEvents(
  eventsPath: string,
  maxBytes: number,
): ActivityObservation | null {
  if (!existsSync(eventsPath)) {
    return null;
  }
  let latest: ActivityObservation | null = null;
  for (const line of readTail(eventsPath, maxBytes).split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const event = JSON.parse(line) as { type?: unknown; timestamp?: unknown };
      if (typeof event.type !== "string") {
        continue;
      }
      const status = eventTypeToActivityStatus(event.type);
      if (!status) {
        continue;
      }
      latest = {
        status,
        observedAt: typeof event.timestamp === "string" ? event.timestamp : null,
      };
    } catch {
      continue;
    }
  }
  return latest;
}

function patchChanged(
  session: SessionRegistryListItem,
  patch: SessionRegistryDerivedStatePatch,
): boolean {
  return (
    (patch.activityStatus !== undefined && patch.activityStatus !== session.activityStatus) ||
    (patch.activityStatusUpdatedAt !== undefined &&
      patch.activityStatusUpdatedAt !== session.activityStatusUpdatedAt) ||
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
    patch = {
      activityStatus: "exited",
      activityStatusUpdatedAt: session.trustedEndedAt ?? session.lastSeenAt ?? nowIso,
    };
  } else if (
    session.trustedStartedAt &&
    session.trustedEndedAt === null &&
    (session.copilotProcessState !== "live" ||
      (session.copilotProcessId !== null && !processExistsFn(session.copilotProcessId)))
  ) {
    patch = {
      copilotProcessState: "none",
      copilotProcessId: null,
      activityStatus: "interrupted",
      activityStatusUpdatedAt: nowIso,
    };
  } else {
    const observation = parseActivityFromEvents(
      eventsPath,
      options.maxBytes ?? SESSION_ACTIVITY_INDEX_MAX_BYTES,
    );
    if (observation) {
      patch = {
        activityStatus: observation.status,
        activityStatusUpdatedAt: observation.observedAt ?? nowIso,
      };
    }
  }

  if (!patch || !patchChanged(session, patch)) {
    return null;
  }
  return patch;
}
