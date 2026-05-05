import type { SessionRegistryListItem } from "../session-registry-contract";
import {
  isTrustedActiveSession,
  isTrustedInterruptedSession,
} from "./session-policies";

const DEFAULT_RECENTLY_CLOSED_HOURS = 6;

function looksLikeSummarizerPrompt(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("Repo:") && trimmed.includes("Existing title:");
}

export function isHelperLikeObservedSession(
  session: SessionRegistryListItem,
): boolean {
  return (
    session.originKind === "observed" &&
    (session.observedSessionKind === "helper" ||
      looksLikeSummarizerPrompt(session.title) ||
      session.description.startsWith("AI summary helper ·"))
  );
}

export function hasTrustedSignal(session: SessionRegistryListItem): boolean {
  return session.trustedSignalSource !== null;
}

export function getActivityTimestamp(
  session: SessionRegistryListItem,
): number | null {
  if (!session.lastSeenAt) {
    return null;
  }
  const parsed = Date.parse(session.lastSeenAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecentlyClosedObservedSession(
  session: SessionRegistryListItem,
): boolean {
  if (session.originKind !== "observed" || session.copilotProcessState === "live") {
    return false;
  }
  const activityTimestamp = getActivityTimestamp(session);
  if (activityTimestamp === null) {
    return false;
  }
  return (
    Date.now() - activityTimestamp <=
    DEFAULT_RECENTLY_CLOSED_HOURS * 60 * 60 * 1000
  );
}

export function isRecentlyEndedTrustedSession(
  session: SessionRegistryListItem,
): boolean {
  if (!hasTrustedSignal(session) || !session.trustedEndedAt) {
    return false;
  }
  const endedAt = Date.parse(session.trustedEndedAt);
  if (!Number.isFinite(endedAt)) {
    return false;
  }
  return Date.now() - endedAt <= DEFAULT_RECENTLY_CLOSED_HOURS * 60 * 60 * 1000;
}

export function getObservedStatusLabel(
  session: SessionRegistryListItem,
): string | null {
  if (session.originKind !== "observed") {
    return null;
  }
  if (isHelperLikeObservedSession(session)) {
    return "helper";
  }
  if (session.copilotProcessState === "live") {
    return "open";
  }
  if (session.copilotProcessState === "stale_lock") {
    return "stale lock";
  }
  if (isRecentlyClosedObservedSession(session)) {
    return "closed";
  }
  return "historical";
}

export function getTrustedStatusLabel(
  session: SessionRegistryListItem,
): string | null {
  if (!hasTrustedSignal(session)) {
    return null;
  }
  const runner = session.trustedExecutionKind === "agency" ? "agency" : "cli";
  if (isTrustedActiveSession(session)) {
    return `${runner} open`;
  }
  if (isTrustedInterruptedSession(session)) {
    return `${runner} resumable`;
  }
  if (session.trustedEndedAt) {
    return `${runner} ended`;
  }
  return `${runner} trusted`;
}

export function getActivityStatusLabel(session: SessionRegistryListItem): string {
  switch (session.activityStatus) {
    case "working":
      return "working";
    case "waiting_for_input":
      return "waiting for you";
    case "interrupted":
      return "interrupted";
    case "exited":
      return "exited";
    case "unknown":
      return getTrustedStatusLabel(session) ?? getObservedStatusLabel(session) ?? "unknown";
    default:
      return "unknown";
  }
}

export function activityStatusClass(
  status: SessionRegistryListItem["activityStatus"],
): string {
  switch (status) {
    case "working":
      return "accent";
    case "waiting_for_input":
      return "green";
    case "interrupted":
      return "amber";
    case "exited":
      return "muted";
    case "unknown":
      return "muted";
    default:
      return "muted";
  }
}

export function activitySignalClass(
  status: SessionRegistryListItem["activityStatus"],
): string {
  switch (status) {
    case "working":
      return "working";
    case "waiting_for_input":
      return "waiting";
    case "interrupted":
    case "exited":
    case "unknown":
      return "inactive";
    default:
      return "inactive";
  }
}

export function activityStatusHint(
  status: SessionRegistryListItem["activityStatus"],
): string {
  switch (status) {
    case "working":
      return "agent active";
    case "waiting_for_input":
      return "assistant done";
    case "interrupted":
      return "resumable";
    case "exited":
      return "ended";
    case "unknown":
      return "activity unknown";
    default:
      return "activity unknown";
  }
}

export function getActivityStatusDescription(
  session: SessionRegistryListItem,
): string {
  switch (session.activityStatus) {
    case "working":
      return "The latest Copilot event indicates the assistant turn is still in progress.";
    case "waiting_for_input":
      return "The latest Copilot event indicates the assistant turn ended and the session is waiting for input.";
    case "interrupted":
      return "The session started without a matching end signal, and Streamliner no longer sees a live Copilot process.";
    case "exited":
      return "The session has an end signal or ended lifecycle state.";
    case "unknown":
      return "Streamliner has not indexed enough activity yet to classify this session.";
    default:
      return "Streamliner has not indexed enough activity yet to classify this session.";
  }
}
