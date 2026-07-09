import type { Request, Response } from "express";

import type {
  SessionRegistryListOptions,
  SessionRegistryChangeEvent,
  SessionRegistryStore,
} from "../session-registry-contract";
import type { SessionRegistryRecord } from "../session-registry-schema";
import { sessionRegistryRecordMatchesOptions } from "../session-registry-filter";

const HEARTBEAT_INTERVAL_MS = 15_000;
const REPLAY_BUFFER_SIZE = 100;

type StreamEventName =
  | "snapshot"
  | "session.upserted"
  | "session.runtime.updated"
  | "session.deleted"
  | "session.rebuilt"
  | "heartbeat";

interface BufferedStreamEvent {
  id: number;
  name: StreamEventName;
  payload: unknown;
  registryId?: string;
  filterRecord?: SessionRegistryRecord;
}

interface StreamClient {
  res: Response;
  heartbeat: ReturnType<typeof setInterval>;
  options: SessionRegistryListOptions;
}

function toStreamEvent(event: SessionRegistryChangeEvent): Omit<BufferedStreamEvent, "id"> {
  switch (event.kind) {
    case "upsert": {
      if (event.changeScope === "runtime" && event.snapshot.runtime?.runtimeKind === "managed-sdk") {
        return {
          name: "session.runtime.updated",
          registryId: event.registryId,
          filterRecord: event.snapshot,
          payload: {
            registryId: event.registryId,
            runtime: event.snapshot.runtime,
            updatedAt: event.snapshot.updatedAt,
            version: event.snapshot.version,
          },
        };
      }
      return {
        name: "session.upserted",
        registryId: event.registryId,
        filterRecord: event.snapshot,
        payload: {
          registryId: event.registryId,
          session: event.snapshot,
        },
      };
    }
    case "delete":
      return {
        name: "session.deleted",
        registryId: event.registryId,
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
    const options = parseSnapshotOptions(req);
    this.clients.set(res, { res, heartbeat, options });

    const lastEventId = parseLastEventId(req.header("last-event-id"));
    const replayed = lastEventId !== null
      ? this.replayAfter(lastEventId, res, options)
      : false;
    if (!replayed) {
      this.writeSnapshot(res, options);
    }

    req.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  };

  private replayAfter(
    lastEventId: number,
    res: Response,
    options: SessionRegistryListOptions,
  ): boolean {
    const firstBufferedId = this.buffer[0]?.id;
    if (firstBufferedId !== undefined && lastEventId < firstBufferedId - 1) {
      return false;
    }
    if (lastEventId >= this.nextEventId) {
      return false;
    }
    const replay = this.buffer
      .filter((event) => event.id > lastEventId)
      .map((event) => eventForClient(event, options))
      .filter((event): event is BufferedStreamEvent => event !== null);
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
    const bufferedEvent = this.buildEvent(event.name, event.payload, {
      registryId: event.registryId,
      filterRecord: event.filterRecord,
    });
    this.buffer.push(bufferedEvent);
    if (this.buffer.length > REPLAY_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - REPLAY_BUFFER_SIZE);
    }
    for (const client of this.clients.values()) {
      const clientEvent = eventForClient(bufferedEvent, client.options);
      if (clientEvent) {
        writeSse(client.res, clientEvent);
      }
    }
  }

  private buildEvent(
    name: StreamEventName,
    payload: unknown,
    metadata: Pick<BufferedStreamEvent, "registryId" | "filterRecord"> = {},
  ): BufferedStreamEvent {
    const event = {
      id: this.nextEventId,
      name,
      payload,
      ...metadata,
    };
    this.nextEventId += 1;
    return event;
  }
}

function eventForClient(
  event: BufferedStreamEvent,
  options: SessionRegistryListOptions,
): BufferedStreamEvent | null {
  if (!event.filterRecord) {
    return event;
  }
  if (sessionRegistryRecordMatchesOptions(event.filterRecord, options)) {
    return event;
  }
  if (
    (event.name === "session.upserted" || event.name === "session.runtime.updated") &&
    event.registryId
  ) {
    return {
      id: event.id,
      name: "session.deleted",
      registryId: event.registryId,
      payload: { registryId: event.registryId },
    };
  }
  return null;
}
