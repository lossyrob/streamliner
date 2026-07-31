import { describe, expect, it } from "vitest";
import {
  buildNotificationCardViewModel,
  buildNotificationFeedViewModel,
  mergeNotifications,
} from "./notification-view-model";
import type { NotificationRecord } from "./types/notification";

function notification(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 1,
    createdAt: "2026-05-31T04:00:00.000Z",
    title: "Notification title",
    body: "Notification body",
    severity: "info",
    eventKind: "generic",
    workstreamId: "ws-1",
    projectKey: "streamliner",
    workstreamColor: "6D5DFB",
    workstreamShortName: "STR",
    nodeId: null,
    sessionId: null,
    link: "http://127.0.0.1:5173/workstreams/ws-1",
    source: "test",
    ...overrides,
  };
}

describe("mergeNotifications", () => {
  it("deduplicates backlog and live events by id with live updates winning", () => {
    const merged = mergeNotifications(
      [notification({ id: 1, title: "old" }), notification({ id: 2 })],
      [notification({ id: 1, title: "new" }), notification({ id: 3 })],
    );

    expect(merged.map((entry) => entry.id)).toEqual([3, 2, 1]);
    expect(merged.find((entry) => entry.id === 1)?.title).toBe("new");
  });
});

describe("buildNotificationFeedViewModel", () => {
  it("orders cards newest first with id as a stable tie-breaker", () => {
    const cards = buildNotificationFeedViewModel([
      notification({ id: 1, createdAt: "2026-05-31T03:00:00.000Z" }),
      notification({ id: 3, createdAt: "2026-05-31T04:00:00.000Z" }),
      notification({ id: 2, createdAt: "2026-05-31T04:00:00.000Z" }),
    ]);

    expect(cards.map((card) => card.notification.id)).toEqual([3, 2, 1]);
  });
});

describe("buildNotificationCardViewModel", () => {
  it("formats relative time, labels, and badge inputs", () => {
    const card = buildNotificationCardViewModel(
      notification({
        eventKind: "pr-approved",
        severity: "warn",
        workstreamColor: "#abc123",
        workstreamShortName: "MVP!",
        createdAt: "2026-05-31T03:05:00.000Z",
      }),
      new Date("2026-05-31T04:10:00.000Z"),
    );

    expect(card.eventLabel).toBe("PR approved");
    expect(card.severityLabel).toBe("Warning");
    expect(card.relativeTime).toBe("1h ago");
    expect(card.badge).toEqual({
      colorHex: "ABC123",
      monogram: "MVP",
      eventKind: "pr-approved",
    });
    expect(card.accentColor).toBe("#ABC123");
    expect(card.clickable).toBe(true);
  });

  it("falls back to Streamliner badge defaults for missing presentation data", () => {
    const card = buildNotificationCardViewModel(
      notification({ workstreamColor: null, workstreamShortName: null, link: null }),
    );

    expect(card.badge.colorHex).toBe("6D5DFB");
    expect(card.badge.monogram).toBe("SL");
    expect(card.clickable).toBe(false);
  });
});
