import type { Request, Response } from "express";

import type {
  SessionRegistryListOptions,
  SessionRegistryChangeEvent,
  SessionRegistryStore,
} from "../session-registry-contract";

const HEARTBEAT_INTERVAL_MS = 15_000;
const REPLAY_BUFFER_SIZE = 100;

type StreamEventName =
  | "snapshot"
  | "session.upserted"
  | "session.deleted"
  | "session.rebuilt"
  | "heartbeat";

interface BufferedStreamEvent {
  id: number;
  name: StreamEventName;
  payload: unknown;
}

interface StreamClient {
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
}

function toStreamEvent(event: SessionRegistryChangeEvent): Omit<BufferedStreamEvent, "id"> {
  switch (event.kind) {
    case "upsert":
      return {
        name: "session.upserted",
        payload: {
          registryId: event.registryId,
          session: event.snapshot,
        },
      };
    case "delete":
      return {
        name: "session.deleted",
        payload: {
          registryId: event.registryId,
        },
      };
    case "rebuild":
      return {
        name: "session.rebuilt",
        payload: {
          registryIds: event.registryIds,
        },
      };
  }
}

function writeSse(res: Response, event: BufferedStreamEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.name}\n`);
  res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
}

function writeHeartbeat(res: Response): void {
  res.write("event: heartbeat\n");
  res.write(`data: ${JSON.stringify({ sentAt: new Date().toISOString() })}\n\n`);
}

function parseLastEventId(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNullableSearchParam(
  searchParams: URLSearchParams,
  key: string,
): string | null | undefined {
  if (!searchParams.has(key)) {
    return undefined;
  }
  const value = searchParams.get(key);
  return value === "null" ? null : value;
}

function parseSnapshotOptions(req: Request): SessionRegistryListOptions {
  const url = new URL(req.originalUrl ?? req.url, "http://streamliner.local");
  const repoFilter = parseNullableSearchParam(url.searchParams, "repo");
  return {
    includeArchived: url.searchParams.get("includeArchived") === "true",
    text: url.searchParams.get("text") ?? undefined,
    ...(repoFilter !== undefined ? { repo: repoFilter } : {}),
    workstreamId: url.searchParams.get("workstreamId") ?? undefined,
    nodeId: url.searchParams.get("nodeId") ?? undefined,
  };
}

export class SessionRegistryEventStream {
  private nextEventId = 1;
  private readonly clients = new Map<Response, StreamClient>();
  private readonly buffer: BufferedStreamEvent[] = [];
  private readonly unsubscribe: () => void;
  private readonly store: SessionRegistryStore;

  constructor(store: SessionRegistryStore) {
    this.store = store;
    this.unsubscribe = store.subscribe((event) => {
      this.publish(toStreamEvent(event));
    });
  }

  close(): void {
    this.unsubscribe();
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
    const replayed = lastEventId !== null
      ? this.replayAfter(lastEventId, res)
      : false;
    if (!replayed) {
      this.writeSnapshot(res, parseSnapshotOptions(req));
    }

    req.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  };

  private replayAfter(lastEventId: number, res: Response): boolean {
    const firstBufferedId = this.buffer[0]?.id;
    if (firstBufferedId !== undefined && lastEventId < firstBufferedId - 1) {
      return false;
    }
    if (lastEventId >= this.nextEventId) {
      return false;
    }
    const replay = this.buffer.filter((event) => event.id > lastEventId);
    if (replay.length === 0) {
      return false;
    }
    for (const event of replay) {
      writeSse(res, event);
    }
    return true;
  }

  private writeSnapshot(res: Response, options: SessionRegistryListOptions): void {
    writeSse(
      res,
      this.buildEvent("snapshot", {
        sessions: this.store.listSessions(options),
      }),
    );
  }

  private publish(event: Omit<BufferedStreamEvent, "id">): void {
    const bufferedEvent = this.buildEvent(event.name, event.payload);
    this.buffer.push(bufferedEvent);
    if (this.buffer.length > REPLAY_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - REPLAY_BUFFER_SIZE);
    }
    for (const client of this.clients.values()) {
      writeSse(client.res, bufferedEvent);
    }
  }

  private buildEvent(name: StreamEventName, payload: unknown): BufferedStreamEvent {
    const event = {
      id: this.nextEventId,
      name,
      payload,
    };
    this.nextEventId += 1;
    return event;
  }
}
