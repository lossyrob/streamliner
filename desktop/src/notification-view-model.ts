import type { EventKind, NotificationRecord, Severity } from "./types/notification";

export interface BadgeInputs {
  colorHex: string;
  monogram: string;
  eventKind: EventKind;
}

export interface NotificationCardViewModel {
  notification: NotificationRecord;
  eventLabel: string;
  severityLabel: string;
  relativeTime: string;
  badge: BadgeInputs;
  accentColor: string;
  clickable: boolean;
}

const DEFAULT_BADGE_COLOR = "6D5DFB";
const EVENT_LABELS: Record<EventKind, string> = {
  online: "Online",
  "pr-created": "PR created",
  "pr-approved": "PR approved",
  "issue-closed": "Issue closed",
  reconciled: "Reconciled",
  done: "Done",
  generic: "Update",
};

const SEVERITY_LABELS: Record<Severity, string> = {
  info: "Info",
  warn: "Warning",
  error: "Error",
};

export function mergeNotifications(
  current: NotificationRecord[],
  incoming: NotificationRecord[],
): NotificationRecord[] {
  const byId = new Map<number, NotificationRecord>();
  for (const notification of current) byId.set(notification.id, notification);
  for (const notification of incoming) byId.set(notification.id, notification);
  return sortNotifications([...byId.values()]);
}

export function sortNotifications(
  notifications: NotificationRecord[],
): NotificationRecord[] {
  return [...notifications].sort((a, b) => {
    const created = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return created !== 0 ? created : b.id - a.id;
  });
}

export function buildNotificationFeedViewModel(
  notifications: NotificationRecord[],
  now = new Date(),
): NotificationCardViewModel[] {
  return sortNotifications(notifications).map((notification) =>
    buildNotificationCardViewModel(notification, now),
  );
}

export function buildNotificationCardViewModel(
  notification: NotificationRecord,
  now = new Date(),
): NotificationCardViewModel {
  const colorHex = normalizeColor(notification.workstreamColor);
  return {
    notification,
    eventLabel: EVENT_LABELS[notification.eventKind] ?? EVENT_LABELS.generic,
    severityLabel: SEVERITY_LABELS[notification.severity] ?? SEVERITY_LABELS.info,
    relativeTime: formatRelativeTime(notification.createdAt, now),
    badge: {
      colorHex,
      monogram: deriveDisplayMonogram(notification.workstreamShortName),
      eventKind: notification.eventKind,
    },
    accentColor: `#${colorHex}`,
    clickable: Boolean(notification.link),
  };
}

export function formatRelativeTime(createdAt: string, now = new Date()): string {
  const then = Date.parse(createdAt);
  if (Number.isNaN(then)) return "Unknown time";
  const diffMs = Math.max(0, now.getTime() - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function deriveDisplayMonogram(shortName: string | null): string {
  const cleaned = (shortName ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 3)
    .toUpperCase();
  return cleaned || "SL";
}

function normalizeColor(color: string | null): string {
  const cleaned = (color ?? "").replace(/^#/, "").trim();
  return /^[0-9a-f]{6}$/i.test(cleaned) ? cleaned.toUpperCase() : DEFAULT_BADGE_COLOR;
}
