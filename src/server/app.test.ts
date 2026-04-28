import { createServer, get as httpGet, type Server } from "node:http";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SessionRegistryChangeEvent,
  SessionRegistryChangeListener,
  SessionRegistryStore,
} from "../session-registry-contract";
import { SessionRegistryFileStore } from "../session-registry/file-store";
import type { SessionRegistryRecord } from "../session-registry-schema";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";
import { SessionRegistryEventStream } from "./session-events";

const createdRoots: string[] = [];
const activeApps: StreamlinerApiApp[] = [];
const activeServers: Server[] = [];

class FakeSseRequest extends EventEmitter {
  constructor(private readonly lastEventId?: string) {
    super();
  }

  header(name: string): string | undefined {
    return name.toLowerCase() === "last-event-id" ? this.lastEventId : undefined;
  }
}

class FakeSseResponse {
  readonly chunks: string[] = [];
  readonly headers = new Map<string, string>();
  statusCode = 200;
  ended = false;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers.set(name, value);
    return this;
  }

  flushHeaders(): void {}

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): this {
    this.ended = true;
    return this;
  }

  body(): string {
    return this.chunks.join("");
  }
}

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-api-app-"));
  createdRoots.push(root);
  return root;
}

async function listen(server: Server): Promise<number> {
  activeServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address.");
  }
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  vi.useRealTimers();
  for (const server of activeServers.splice(0)) {
    await closeServer(server);
  }
  for (const app of activeApps.splice(0)) {
    app.close();
  }
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function openEventStream(
  eventStream: SessionRegistryEventStream,
  lastEventId?: string,
): { req: FakeSseRequest; res: FakeSseResponse } {
  const req = new FakeSseRequest(lastEventId);
  const res = new FakeSseResponse();
  eventStream.handle(
    req as unknown as Request,
    res as unknown as Response,
  );
  return { req, res };
}

function eventIds(body: string): number[] {
  return [...body.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
}

function buildTrustedSignal(sessionId: string) {
  return {
    event: "session.started",
    source: "copilot-cli-hook",
    sessionId,
    timestamp: "2026-04-28T14:30:00.000Z",
    cwd: "C:\\repo",
    repo: "lossyrob/streamliner",
    branch: "main",
    hookSource: "resume",
    executionKind: "copilot_cli",
  };
}

function buildStreamRecord(id: string, title: string): SessionRegistryRecord {
  return {
    schemaVersion: 1,
    id,
    version: 0,
    title,
    titleSource: "user",
    description: "",
    color: null,
    cwd: "C:\\repo",
    repo: null,
    branch: null,
    copilotSessionId: null,
    lifecycleStatus: "active",
    lastSeenAt: null,
    createdAt: "2026-04-28T14:30:00.000Z",
    updatedAt: "2026-04-28T14:30:00.000Z",
    tags: [],
    origin: { kind: "manual" },
    graphBinding: null,
    aiSummary: null,
    aiSummaryModel: null,
    aiSummaryUpdatedAt: null,
    aiSummaryEventsFingerprint: null,
    aiSummaryStatus: "missing",
    aiSummaryError: null,
    observedSessionKind: null,
    copilotProcessState: null,
    copilotProcessId: null,
    activityStatus: "unknown",
    activityStatusUpdatedAt: null,
    trustedSignalSource: null,
    trustedStartedAt: null,
    trustedEndedAt: null,
    trustedLastSignalAt: null,
    trustedStartSource: null,
    trustedEndReason: null,
    trustedExecutionKind: null,
    trustedInitialPromptLength: null,
    trustedLastPromptLength: null,
    derivedWorktreePath: null,
    derivedBranch: null,
    derivedGithubRefs: [],
    derivedContextUpdatedAt: null,
    derivedContextEventsOffset: 0,
    derivedContextEventsSize: 0,
    derivedContextEventsMtimeMs: null,
  };
}

function createEventStreamStore(): {
  store: SessionRegistryStore;
  publishUpsert: (id: string, title: string) => void;
} {
  const listeners = new Set<SessionRegistryChangeListener>();
  const streamStore = {
    listSessions: () => [],
    subscribe: (listener: SessionRegistryChangeListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } satisfies Pick<SessionRegistryStore, "listSessions" | "subscribe">;

  return {
    store: streamStore as SessionRegistryStore,
    publishUpsert: (id: string, title: string) => {
      const event: SessionRegistryChangeEvent = {
        kind: "upsert",
        registryId: id,
        snapshot: buildStreamRecord(id, title),
      };
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

describe("createStreamlinerApiApp", () => {
  it("serves health, graph, recents, and session routes without listening itself", async () => {
    const rootDir = createRootDir();
    const graphPath = join(rootDir, "graph.json");
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, id: "api-test", title: "API Test", nodes: [] }),
      "utf8",
    );
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const api = createStreamlinerApiApp({
      store,
      graphPath,
      recentsPath: join(rootDir, "recent-graphs.json"),
    });
    activeApps.push(api);

    await request(api.app).get("/api/health").expect(200, { ok: true });
    await request(api.app).get("/api/graph.json").expect(200);
    await request(api.app).get("/api/recents").expect(200);

    const createResponse = await request(api.app)
      .post("/api/sessions")
      .send({
        title: "API session",
        cwd: "C:\\repo",
        origin: { kind: "manual" },
      })
      .expect(200);
    expect(createResponse.body).toEqual(
      expect.objectContaining({
        title: "API session",
        version: 0,
      }),
    );
  });

  it("streams session registry events over SSE", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const api = createStreamlinerApiApp({ store });
    activeApps.push(api);
    const server = createServer(api.app);
    const port = await listen(server);

    const received = await new Promise<string>((resolve, reject) => {
      let body = "";
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for SSE")), 5_000);
      const req = httpGet(`http://127.0.0.1:${port}/api/sessions/events`, (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
          if (
            body.includes("event: snapshot") &&
            body.includes("event: session.upserted") &&
            body.includes("Streamed session")
          ) {
            clearTimeout(timeout);
            req.destroy();
            resolve(body);
          }
        });
      });
      req.on("error", (error) => {
        if (!body.includes("event: session.upserted")) {
          clearTimeout(timeout);
          reject(error);
        }
      });

      setTimeout(() => {
        store.upsertSession({
          title: "Streamed session",
          cwd: "C:\\repo",
          origin: { kind: "manual" },
        });
      }, 100);
    });

    expect(received).toContain("event: snapshot");
    expect(received).toContain("event: session.upserted");
    expect(received).toContain("Streamed session");
  });

  it("returns client errors for malformed and oversized JSON bodies", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const api = createStreamlinerApiApp({ store });
    activeApps.push(api);

    await request(api.app)
      .post("/api/sessions")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400, { error: "Malformed JSON request body." });

    const oversizedJson = JSON.stringify({ payload: "x".repeat(1024 * 1024) });
    const oversizedResponse = await request(api.app)
      .post("/api/sessions")
      .set("Content-Type", "application/json")
      .send(oversizedJson)
      .expect(413);

    expect(oversizedResponse.body).toEqual({
      error: expect.stringContaining("request entity too large"),
    });
  });

  it("gates trusted session signals to loopback forwarded addresses", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const api = createStreamlinerApiApp({ store });
    activeApps.push(api);

    await request(api.app)
      .post("/api/sessions/signals")
      .set("X-Forwarded-For", "203.0.113.7")
      .send(buildTrustedSignal("blocked-signal"))
      .expect(403, { error: "Trusted session signals must originate from loopback." });

    for (const forwardedFor of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      const response = await request(api.app)
        .post("/api/sessions/signals")
        .set("X-Forwarded-For", forwardedFor)
        .send(buildTrustedSignal(`accepted-${forwardedFor.replace(/[^a-z0-9]/gi, "-")}`))
        .expect(200);
      expect(response.body).toEqual(expect.objectContaining({ trustedSignalSource: "copilot-cli-hook" }));
    }
  });

  it("replays buffered session events and falls back to snapshots outside the buffer", () => {
    const { store, publishUpsert } = createEventStreamStore();
    const eventStream = new SessionRegistryEventStream(store);
    try {
      const first = openEventStream(eventStream);
      publishUpsert("replay-me", "Replay me");
      const firstBody = first.res.body();
      const replayFromId = eventIds(firstBody).at(-2);
      expect(firstBody).toContain("event: snapshot");
      expect(firstBody).toContain("event: session.upserted");
      expect(firstBody).toContain("Replay me");
      first.req.emit("close");

      const replay = openEventStream(eventStream, String(replayFromId));
      expect(replay.res.body()).toContain("event: session.upserted");
      expect(replay.res.body()).toContain("Replay me");
      replay.req.emit("close");

      for (let index = 0; index < 101; index += 1) {
        publishUpsert(`overflow-${index}`, `Overflow ${index}`);
      }

      const fallback = openEventStream(eventStream, String(replayFromId));
      expect(fallback.res.body()).toContain("event: snapshot");
      fallback.req.emit("close");
    } finally {
      eventStream.close();
    }
  });

  it("writes id-less SSE heartbeats", () => {
    vi.useFakeTimers();
    const { store } = createEventStreamStore();
    const eventStream = new SessionRegistryEventStream(store);
    try {
      const stream = openEventStream(eventStream);
      vi.advanceTimersByTime(15_000);

      const body = stream.res.body();
      const heartbeatIndex = body.indexOf("event: heartbeat");
      expect(heartbeatIndex).toBeGreaterThanOrEqual(0);
      expect(body.slice(heartbeatIndex)).not.toMatch(/^id: /m);
      stream.req.emit("close");
    } finally {
      eventStream.close();
    }
  });
});
