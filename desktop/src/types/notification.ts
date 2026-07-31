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

export interface NotificationRecord {
  id: number;
  createdAt: string;
  title: string;
  body: string;
  severity: Severity;
  eventKind: EventKind;
  workstreamId: string | null;
  projectKey: string | null;
  workstreamColor: string | null;
  workstreamShortName: string | null;
  nodeId: string | null;
  sessionId: string | null;
  link: string | null;
  source: string;
}

export interface NotificationSnapshotPayload {
  notifications: NotificationRecord[];
}

export const NOTIFICATION_SSE_EVENTS = {
  snapshot: "snapshot",
  created: "notification.created",
  heartbeat: "heartbeat",
} as const;
