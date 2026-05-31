/**
 * Shared notification contract used by the local API server, the `streamliner`
 * CLI, and (mirrored in Rust) the desktop consumer.
 *
 * Notifications flow: CLI -> `POST /api/notifications` -> server validates +
 * enriches + persists + emits SSE -> desktop raises a toast + feed card.
 */

export const NOTIFICATIONS_API_BASE_PATH = "/api/notifications";
export const NOTIFICATIONS_EVENTS_PATH = `${NOTIFICATIONS_API_BASE_PATH}/events`;

export const NOTIFICATION_SEVERITIES = ["info", "warn", "error"] as const;
export type Severity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_EVENT_KINDS = [
  "online",
  "pr-created",
  "pr-approved",
  "issue-closed",
  "reconciled",
  "done",
  "generic",
] as const;
export type EventKind = (typeof NOTIFICATION_EVENT_KINDS)[number];

export const DEFAULT_SEVERITY: Severity = "info";
export const DEFAULT_EVENT_KIND: EventKind = "generic";

/** Schemes the desktop is willing to open from a notification link. */
export const ALLOWED_LINK_SCHEMES = ["http:", "https:", "file:"] as const;

/** A persisted + emitted notification. `id` doubles as the SSE event id. */
export interface NotificationRecord {
  id: number;
  createdAt: string;
  title: string;
  body: string;
  severity: Severity;
  eventKind: EventKind;
  workstreamId: string | null;
  projectKey: string | null;
  /** Resolved hex color (no leading `#`) for the badge field, if known. */
  workstreamColor: string | null;
  /** Resolved short name (from registry presentation) for the badge monogram. */
  workstreamShortName: string | null;
  nodeId: string | null;
  sessionId: string | null;
  /** Absolute deep-link URL after enrichment, or null. */
  link: string | null;
  source: string;
}

/** Request body for `POST /api/notifications`. */
export interface NotificationRequest {
  title: string;
  body: string;
  severity?: Severity;
  eventKind?: EventKind;
  workstreamId?: string;
  projectKey?: string;
  nodeId?: string;
  sessionId?: string;
  link?: string;
  source?: string;
}

export interface NotificationCreateResponse {
  notification: NotificationRecord;
  /** Non-fatal enrichment warnings (e.g. ambiguous workstream id). */
  warnings?: string[];
}

export interface NotificationListResponse {
  notifications: NotificationRecord[];
}

export interface NotificationSnapshotPayload {
  notifications: NotificationRecord[];
}

export const NOTIFICATION_SSE_EVENTS = {
  snapshot: "snapshot",
  created: "notification.created",
  heartbeat: "heartbeat",
} as const;

export function isSeverity(value: unknown): value is Severity {
  return (
    typeof value === "string" &&
    (NOTIFICATION_SEVERITIES as readonly string[]).includes(value)
  );
}

export function isEventKind(value: unknown): value is EventKind {
  return (
    typeof value === "string" &&
    (NOTIFICATION_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Coerce an arbitrary value to a known {@link EventKind}, defaulting unknown
 * values to `generic`. Lets a newer server value not break an older consumer.
 */
export function coerceEventKind(value: unknown): EventKind {
  return isEventKind(value) ? value : DEFAULT_EVENT_KIND;
}

export type LinkValidation =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/**
 * Validate an explicit notification link. Links must be absolute
 * `http`/`https`/`file` URLs so the desktop can open them verbatim and the
 * server never stores a non-openable value. Relative paths and bare filesystem
 * paths are rejected — callers compose absolute URLs or omit the link and let
 * the server derive one.
 */
export function validateToastLink(value: string): LinkValidation {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "link must not be empty" };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: "link must be an absolute http(s) or file URL",
    };
  }
  if (!(ALLOWED_LINK_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    return {
      ok: false,
      reason: `link scheme '${parsed.protocol}' is not allowed (use http, https, or file)`,
    };
  }
  return { ok: true, url: parsed.toString() };
}
