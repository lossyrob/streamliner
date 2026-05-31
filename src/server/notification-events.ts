import type { Request, Response } from "express";

import {
  NOTIFICATION_SSE_EVENTS,
  type NotificationRecord,
} from "../notification-contract";
import type { NotificationStore } from "./notification-store";

const HEARTBEAT_INTERVAL_MS = 15_000;
const REPLAY_BUFFER_SIZE = 100;

interface StreamClient {
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
}

function writeCreated(res: Response, record: NotificationRecord): void {
  res.write(`id: ${record.id}\n`);
  res.write(`event: ${NOTIFICATION_SSE_EVENTS.created}\n`);
  res.write(`data: ${JSON.stringify(record)}\n\n`);
}

function writeSnapshot(res: Response, records: NotificationRecord[]): void {
  // Snapshot carries no id so it never advances the client's Last-Event-ID and
  // is trivially distinguishable from a live `notification.created` event (the
  // desktop suppresses toasts for snapshot/backlog).
  res.write(`event: ${NOTIFICATION_SSE_EVENTS.snapshot}\n`);
  res.write(`data: ${JSON.stringify({ notifications: records })}\n\n`);
}

function writeHeartbeat(res: Response): void {
  res.write(`event: ${NOTIFICATION_SSE_EVENTS.heartbeat}\n`);
  res.write(`data: ${JSON.stringify({ sentAt: new Date().toISOString() })}\n\n`);
}

function parseLastEventId(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * SSE stream for notifications. Unlike the session/workstream streams this is
 * single-event-type and id-coupled: the SSE `event.id` equals the persisted
 * record `id`, so `Last-Event-ID` is a stable cross-restart cursor.
 *
 * Replay is sourced from the durable store via `listSince(lastEventId)` using a
 * strict `>` boundary, which is gap-free (the store has no rotation in the MVP)
 * and never double-delivers — the in-memory buffer is only a live fan-out aid.
 * A cold-launch client that omits `Last-Event-ID` receives a `snapshot` (not a
 * burst of `notification.created` events), which the desktop never toasts.
 */
export class NotificationEventStream {
  private readonly store: NotificationStore;
  private readonly clients = new Map<Response, StreamClient>();
  private readonly buffer: NotificationRecord[] = [];

  constructor(store: NotificationStore) {
    this.store = store;
  }

  close(): void {
    for (const client of this.clients.values()) {
      clearInterval(client.heartbeat);
      client.res.end();
    }
    this.clients.clear();
  }

  handle = (req: Request, res: Response): void => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
      writeHeartbeat(res);
    }, HEARTBEAT_INTERVAL_MS);
    this.clients.set(res, { res, heartbeat });

    const lastEventId = parseLastEventId(req.header("last-event-id"));
    void this.onConnect(res, lastEventId);

    req.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  };

  /** Emit a freshly-persisted record to all clients and buffer it. */
  publish(record: NotificationRecord): void {
    this.buffer.push(record);
    if (this.buffer.length > REPLAY_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - REPLAY_BUFFER_SIZE);
    }
    for (const client of this.clients.values()) {
      writeCreated(client.res, record);
    }
  }

  private async onConnect(res: Response, lastEventId: number | null): Promise<void> {
    try {
      if (lastEventId !== null) {
        // Resume from cursor: replay anything strictly newer from the store.
        // No snapshot is sent so reconnects never produce a backlog burst.
        const missed = await this.store.listSince(lastEventId);
        for (const record of missed) {
          if (this.clients.has(res)) {
            writeCreated(res, record);
          }
        }
        return;
      }
      const snapshot = await this.store.listRecent();
      if (this.clients.has(res)) {
        writeSnapshot(res, snapshot);
      }
    } catch {
      // On a store read failure, fall back to an empty snapshot rather than
      // killing the connection; live events still flow via publish().
      if (lastEventId === null && this.clients.has(res)) {
        writeSnapshot(res, []);
      }
    }
  }
}
