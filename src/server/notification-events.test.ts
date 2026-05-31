import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Request, Response } from "express";
import { afterEach, describe, expect, it } from "vitest";

import { NotificationEventStream } from "./notification-events";
import { NotificationStore, type NotificationDraft } from "./notification-store";

const roots: string[] = [];

function tempStore(): NotificationStore {
  const root = mkdtempSync(join(tmpdir(), "streamliner-notif-events-"));
  roots.push(root);
  return new NotificationStore({ storePath: join(root, "notifications.ndjson") });
}

function draft(title: string): NotificationDraft {
  return {
    title,
    body: "b",
    severity: "info",
    eventKind: "generic",
    workstreamId: null,
    projectKey: null,
    workstreamColor: null,
    workstreamShortName: null,
    nodeId: null,
    sessionId: null,
    link: null,
    source: "cli",
  };
}

interface ParsedFrame {
  id?: number;
  event: string;
  data: unknown;
}

class FakeResponse {
  readonly chunks: string[] = [];
  setHeader(): void {}
  status(): this {
    return this;
  }
  flushHeaders(): void {}
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  end(): void {}

  frames(): ParsedFrame[] {
    return this.chunks
      .join("")
      .split("\n\n")
      .filter((block) => block.trim().length > 0)
      .map((block) => {
        const lines = block.split("\n");
        const frame: ParsedFrame = { event: "message", data: undefined };
        for (const line of lines) {
          if (line.startsWith("id: ")) {
            frame.id = Number(line.slice(4));
          } else if (line.startsWith("event: ")) {
            frame.event = line.slice(7);
          } else if (line.startsWith("data: ")) {
            frame.data = JSON.parse(line.slice(6));
          }
        }
        return frame;
      });
  }
}

class FakeRequest extends EventEmitter {
  private readonly lastEventId?: string;
  constructor(lastEventId?: string) {
    super();
    this.lastEventId = lastEventId;
  }
  header(name: string): string | undefined {
    return name.toLowerCase() === "last-event-id" ? this.lastEventId : undefined;
  }
}

function connect(stream: NotificationEventStream, lastEventId?: string): {
  req: FakeRequest;
  res: FakeResponse;
} {
  const req = new FakeRequest(lastEventId);
  const res = new FakeResponse();
  stream.handle(req as unknown as Request, res as unknown as Response);
  return { req, res };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function waitForFrames(res: FakeResponse, count: number): Promise<ParsedFrame[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const frames = res.frames();
    if (frames.length >= count) {
      return frames;
    }
    await tick();
  }
  return res.frames();
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe("NotificationEventStream", () => {
  it("sends a distinct id-less snapshot to a cold client", async () => {
    const store = tempStore();
    await store.append(draft("a"));
    const stream = new NotificationEventStream(store);
    const { res } = connect(stream);
    const frames = await waitForFrames(res, 1);
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("snapshot");
    expect(frames[0].id).toBeUndefined();
    expect((frames[0].data as { notifications: unknown[] }).notifications).toHaveLength(1);
  });

  it("publishes notification.created with id equal to the record id", async () => {
    const store = tempStore();
    const stream = new NotificationEventStream(store);
    const { res } = connect(stream);
    await tick();
    const record = await store.append(draft("live"));
    stream.publish(record);
    const created = res.frames().filter((f) => f.event === "notification.created");
    expect(created).toHaveLength(1);
    expect(created[0].id).toBe(record.id);
    expect((created[0].data as { title: string }).title).toBe("live");
  });

  it("preserves order and monotonic ids across many publishes", async () => {
    const store = tempStore();
    const stream = new NotificationEventStream(store);
    const { res } = connect(stream);
    await tick();
    for (let i = 0; i < 10; i += 1) {
      stream.publish(await store.append(draft(`n${i}`)));
    }
    const ids = res.frames()
      .filter((f) => f.event === "notification.created")
      .map((f) => f.id as number);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("replays from the store on reconnect using a strict boundary, no snapshot", async () => {
    const store = tempStore();
    const stream = new NotificationEventStream(store);
    for (let i = 0; i < 4; i += 1) {
      await store.append(draft(`n${i}`));
    }
    const { res } = connect(stream, "2");
    const frames = await waitForFrames(res, 2);
    expect(frames.every((f) => f.event === "notification.created")).toBe(true);
    expect(frames.map((f) => f.id)).toEqual([3, 4]);
  });

  it("replays nothing when the client cursor is already current", async () => {
    const store = tempStore();
    const stream = new NotificationEventStream(store);
    await store.append(draft("a"));
    await store.append(draft("b"));
    const { res } = connect(stream, "2");
    await tick();
    await tick();
    expect(res.frames()).toHaveLength(0);
  });
});
