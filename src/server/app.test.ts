import { createServer, get as httpGet, type Server } from "node:http";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Request, Response } from "express";

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SessionRegistryChangeEvent,
  SessionRegistryChangeListener,
  SessionRegistryListOptions,
  SessionRegistryStore,
} from "../session-registry-contract";
import { SessionRegistryFileStore } from "../session-registry/file-store";
import { LaunchClaimFileStore } from "../session-registry/launch-claim-store";
import { createLaunchClaim } from "../session-registry/launch-claims";
import {
  DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
  type SessionRegistryRecord,
} from "../session-registry-schema";
import {
  createStreamlinerApiApp,
  type StreamlinerApiApp,
  type StreamlinerApiAppOptions,
} from "./app";
import { SessionRegistryEventStream } from "./session-events";

const createdRoots: string[] = [];
const activeApps: StreamlinerApiApp[] = [];
const activeServers: Server[] = [];

class FakeSseRequest extends EventEmitter {
  private readonly lastEventId?: string;
  readonly originalUrl: string;
  readonly url: string;

  constructor(lastEventId?: string, url = "/api/sessions/events") {
    super();
    this.lastEventId = lastEventId;
    this.originalUrl = url;
    this.url = url;
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

function createIsolatedApi(
  rootDir: string,
  options: StreamlinerApiAppOptions = {},
): StreamlinerApiApp {
  return createStreamlinerApiApp({
    store: new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") }),
    recentsPath: join(rootDir, "recent-graphs.json"),
    workstreamRegistryPath: join(rootDir, "workstreams.json"),
    workstreamSourceRegistryPath: join(rootDir, "sources.json"),
    nodeLaunchRecordsPath: join(rootDir, "node-launch-records.json"),
    ...options,
  });
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
  url?: string,
): { req: FakeSseRequest; res: FakeSseResponse } {
  const req = new FakeSseRequest(lastEventId, url);
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
    pawLaunch: null,
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
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    pawWorkflow: null,
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

function buildGraph(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "api-test",
    projectKey: "streamliner",
    title: "API Test",
    summary: "Test workstream graph.",
    status: "active",
    attention: "focus",
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    repos: [
      {
        id: "streamliner",
        owner: "lossyrob",
        name: "streamliner",
        role: "primary",
      },
    ],
    designRefs: [],
    nodes: [],
    checkpoints: [],
    ...overrides,
  };
}

function createEventStreamStore(options: {
  listSessions?: SessionRegistryStore["listSessions"];
} = {}): {
  store: SessionRegistryStore;
  publishUpsert: (id: string, title: string) => void;
} {
  const listeners = new Set<SessionRegistryChangeListener>();
  const unsupportedStoreCall = () => {
    throw new Error("Unexpected SessionRegistryStore call in event stream test.");
  };
  const streamStore: SessionRegistryStore = {
    listSessions: options.listSessions ?? (() => []),
    getSession: unsupportedStoreCall,
    upsertSession: unsupportedStoreCall,
    attachObservedSession: unsupportedStoreCall,
    recordTrustedSessionSignal: unsupportedStoreCall,
    patchSession: unsupportedStoreCall,
    archiveSession: unsupportedStoreCall,
    deleteSession: unsupportedStoreCall,
    subscribe: (listener: SessionRegistryChangeListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    store: streamStore,
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
    const api = createIsolatedApi(rootDir, {
      store,
      graphPath,
    });
    activeApps.push(api);

    await request(api.app).get("/api/health").expect(200, { ok: true });
    await request(api.app).get("/api/graph.json").expect(200);
    await request(api.app).get("/api/recents").expect(200);
    await request(api.app).get("/api/workstreams").expect(200);

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
        activityEvidence: expect.objectContaining({
          statusReason: expect.any(String),
          confidence: expect.any(String),
          diagnostics: expect.any(Array),
        }),
      }),
    );
  });

  it("blocks mutating API requests in readonly preview mode", async () => {
    const rootDir = createRootDir();
    const api = createStreamlinerApiApp({
      readonlyMode: true,
      recentsPath: join(rootDir, "recent-graphs.json"),
      workstreamRegistryPath: join(rootDir, "workstreams.json"),
      workstreamSourceRegistryPath: join(rootDir, "sources.json"),
    });
    activeApps.push(api);

    await request(api.app).get("/api/health").expect(200, { ok: true });
    await request(api.app)
      .post("/api/workstreams")
      .send({ path: "C:\\graphs\\graph.json" })
      .expect(403)
      .expect((res) => {
        expect(res.body).toEqual(expect.objectContaining({
          code: "preview_readonly",
        }));
      });
  });

  it("stores reusable PAW launch prompt profiles", async () => {
    const rootDir = createRootDir();
    const api = createIsolatedApi(rootDir, {
      promptProfilesPath: join(rootDir, "profiles.json"),
    });
    activeApps.push(api);

    await request(api.app)
      .get("/api/paw-launch-prompt-profiles")
      .expect("Cache-Control", "no-store")
      .expect(200, { profiles: [] });

    const createResponse = await request(api.app)
      .post("/api/paw-launch-prompt-profiles")
      .send({
        name: "Final PR only",
        instructions: "Use PAW final-pr-only with no intermediate pauses.",
      })
      .expect(201);
    expect(createResponse.body.profile).toEqual(expect.objectContaining({
      id: "final-pr-only",
      name: "Final PR only",
      instructions: "Use PAW final-pr-only with no intermediate pauses.",
    }));

    await request(api.app)
      .post("/api/paw-launch-prompt-profiles")
      .send({
        name: " final   pr ONLY ",
        instructions: "Duplicate names should not create another profile.",
      })
      .expect(409)
      .expect((res) => {
        expect(res.body).toEqual(expect.objectContaining({
          code: "prompt_profile_name_conflict",
        }));
      });

    const updateResponse = await request(api.app)
      .put("/api/paw-launch-prompt-profiles/final-pr-only")
      .send({
        name: "Final PR only",
        instructions: "Use PAW final-pr-review only.",
      })
      .expect(200);
    expect(updateResponse.body.profile.instructions).toBe("Use PAW final-pr-review only.");

    const listResponse = await request(api.app)
      .get("/api/paw-launch-prompt-profiles")
      .expect(200);
    expect(listResponse.body.profiles).toEqual([
      expect.objectContaining({
        id: "final-pr-only",
        instructions: "Use PAW final-pr-review only.",
      }),
    ]);
  });

  it("dedupes existing PAW launch prompt profiles by name", async () => {
    const rootDir = createRootDir();
    const profilesPath = join(rootDir, "profiles.json");
    writeFileSync(profilesPath, JSON.stringify({
      version: 1,
      profiles: [
        {
          id: "paw-lite-old",
          name: "Paw-lite",
          instructions: "Old instructions",
          createdAt: "2026-05-03T18:00:00.000Z",
          updatedAt: "2026-05-03T18:00:00.000Z",
        },
        {
          id: "paw-lite-new",
          name: "PAW lite",
          instructions: "New instructions",
          createdAt: "2026-05-03T18:01:00.000Z",
          updatedAt: "2026-05-03T18:02:00.000Z",
        },
      ],
    }), "utf8");
    const api = createIsolatedApi(rootDir, { promptProfilesPath: profilesPath });
    activeApps.push(api);

    const listResponse = await request(api.app)
      .get("/api/paw-launch-prompt-profiles")
      .expect(200);
    expect(listResponse.body.profiles).toEqual([
      expect.objectContaining({
        id: "paw-lite-new",
        instructions: "New instructions",
      }),
    ]);
  });

  it("reads and updates PAW WorkflowContext files under .paw/work", async () => {
    const rootDir = createRootDir();
    const pawWorkRoot = join(rootDir, ".paw", "work");
    const workflowContextPath = join(pawWorkRoot, "launch-prompt-profiles", "WorkflowContext.md");
    mkdirSync(dirname(workflowContextPath), { recursive: true });
    writeFileSync(
      workflowContextPath,
      "# WorkflowContext\nAdditional Inputs: streamliner-context=streamliner/context.md\n",
      "utf8",
    );
    const api = createIsolatedApi(rootDir, { pawWorkRoot });
    activeApps.push(api);

    const readResponse = await request(api.app)
      .get("/api/paw-workflow-context")
      .query({ path: workflowContextPath })
      .expect(200);
    expect(readResponse.body.content).toContain("Additional Inputs");

    const updatedContent = "# WorkflowContext\nAdditional Inputs: streamliner-context=streamliner/context.md\n\n## Notes\nEdited in browser.\n";
    await request(api.app)
      .put("/api/paw-workflow-context")
      .send({ path: workflowContextPath, content: updatedContent })
      .expect(200);
    expect(readFileSync(workflowContextPath, "utf8")).toBe(updatedContent);

    const siblingRootDir = createRootDir();
    const siblingWorkflowContextPath = join(
      siblingRootDir,
      ".paw",
      "work",
      "terminal-launch-integration",
      "WorkflowContext.md",
    );
    mkdirSync(dirname(siblingWorkflowContextPath), { recursive: true });
    writeFileSync(siblingWorkflowContextPath, updatedContent, "utf8");
    const siblingReadResponse = await request(api.app)
      .get("/api/paw-workflow-context")
      .query({ path: siblingWorkflowContextPath })
      .expect(200);
    expect(siblingReadResponse.body.content).toContain("Edited in browser.");

    await request(api.app)
      .put("/api/paw-workflow-context")
      .send({ path: join(rootDir, "WorkflowContext.md"), content: updatedContent })
      .expect(400);
  });

  it("registers, loads, relinks, and deletes tracked workstreams", async () => {
    const rootDir = createRootDir();
    const graphPath = join(rootDir, "graph.json");
    const movedGraphPath = join(rootDir, "moved-graph.json");
    writeFileSync(graphPath, JSON.stringify(buildGraph()), "utf8");
    writeFileSync(movedGraphPath, JSON.stringify(buildGraph({ title: "API Test Moved" })), "utf8");
    const api = createIsolatedApi(rootDir);
    activeApps.push(api);

    const registerResponse = await request(api.app)
      .post("/api/workstreams")
      .send({ path: graphPath })
      .expect(201);
    expect(registerResponse.body.workstream).toEqual(
      expect.objectContaining({
        projectKey: "streamliner",
        workstreamId: "api-test",
        title: "API Test",
        fileStatus: "available",
      }),
    );

    const graphResponse = await request(api.app)
      .get("/api/workstreams/streamliner/api-test/graph")
      .expect(200);
    expect(graphResponse.body.title).toBe("API Test");

    const relinkResponse = await request(api.app)
      .patch("/api/workstreams/streamliner/api-test")
      .send({ path: movedGraphPath })
      .expect(200);
    expect(relinkResponse.body.workstream.path).toBe(movedGraphPath);

    await request(api.app)
      .delete("/api/workstreams/streamliner/api-test")
      .expect(204);

    const listResponse = await request(api.app).get("/api/workstreams").expect(200);
    expect(listResponse.body.workstreams).toEqual([]);
  });

  it("migrates legacy recent graphs once and records migration warnings", async () => {
    const rootDir = createRootDir();
    const graphPath = join(rootDir, "graph.json");
    const duplicateGraphPath = join(rootDir, "duplicate-graph.json");
    const missingGraphPath = join(rootDir, "missing-graph.json");
    writeFileSync(graphPath, JSON.stringify(buildGraph()), "utf8");
    writeFileSync(duplicateGraphPath, JSON.stringify(buildGraph({ title: "Duplicate" })), "utf8");
    const recentsPath = join(rootDir, "recent-graphs.json");
    writeFileSync(
      recentsPath,
      JSON.stringify([
        { path: graphPath, title: "API Test", id: "api-test", lastOpened: "2026-05-01T12:00:00.000Z" },
        { path: duplicateGraphPath, title: "Duplicate", id: "api-test", lastOpened: "2026-05-01T12:01:00.000Z" },
        { path: missingGraphPath, title: "Missing", id: "missing", lastOpened: "2026-05-01T12:02:00.000Z" },
      ]),
      "utf8",
    );
    const api = createIsolatedApi(rootDir, {
      recentsPath,
    });
    activeApps.push(api);

    const firstList = await request(api.app).get("/api/workstreams").expect(200);
    expect(firstList.body.workstreams).toHaveLength(1);
    expect(firstList.body.workstreams[0]).toEqual(expect.objectContaining({ workstreamId: "api-test" }));
    expect(firstList.body.migrationWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "legacy-recents-identity-conflict" }),
        expect.objectContaining({ code: "legacy-recents-graph-missing" }),
      ]),
    );

    const secondList = await request(api.app).get("/api/workstreams").expect(200);
    expect(secondList.body.workstreams).toHaveLength(1);
    expect(secondList.body.migrationWarnings).toHaveLength(firstList.body.migrationWarnings.length);
  });

  it("migrates legacy recent graphs that predate top-level summaries", async () => {
    const rootDir = createRootDir();
    const graphPath = join(rootDir, "graph.json");
    const legacyGraph = buildGraph({ title: "Legacy Graph" });
    delete legacyGraph.summary;
    writeFileSync(graphPath, JSON.stringify(legacyGraph), "utf8");
    const recentsPath = join(rootDir, "recent-graphs.json");
    writeFileSync(
      recentsPath,
      JSON.stringify([
        { path: graphPath, title: "Legacy Recent", id: "api-test", lastOpened: "2026-05-01T12:00:00.000Z" },
      ]),
      "utf8",
    );
    const api = createIsolatedApi(rootDir, {
      recentsPath,
    });
    activeApps.push(api);

    const listResponse = await request(api.app).get("/api/workstreams").expect(200);
    expect(listResponse.body.workstreams).toHaveLength(1);
    expect(listResponse.body.workstreams[0]).toEqual(
      expect.objectContaining({
        projectKey: "streamliner",
        workstreamId: "api-test",
        title: "Legacy Graph",
        summary: "Legacy Graph",
      }),
    );
    expect(listResponse.body.migrationWarnings).toEqual([]);
  });

  it("repairs previously persisted unreadable warnings for legacy summary-less graphs", async () => {
    const rootDir = createRootDir();
    const graphPath = join(rootDir, "graph.json");
    const registryPath = join(rootDir, "workstreams.json");
    const legacyGraph = buildGraph({ title: "Legacy Graph" });
    delete legacyGraph.summary;
    writeFileSync(graphPath, JSON.stringify(legacyGraph), "utf8");
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        migratedFromRecentsAt: "2026-05-01T12:00:00.000Z",
        migrationWarnings: [
          {
            code: "legacy-recents-graph-unreadable",
            message: "Expected workstream.summary to be a non-empty string.",
            path: graphPath,
          },
        ],
        workstreams: [],
      }),
      "utf8",
    );
    const api = createIsolatedApi(rootDir, {
      workstreamRegistryPath: registryPath,
      workstreamSourceRegistryPath: join(rootDir, "sources.json"),
    });
    activeApps.push(api);

    const listResponse = await request(api.app).get("/api/workstreams").expect(200);
    expect(listResponse.body.workstreams).toHaveLength(1);
    expect(listResponse.body.migrationWarnings).toEqual([]);
    const persisted = JSON.parse(readFileSync(registryPath, "utf8")) as {
      migrationWarnings: unknown[];
      workstreams: unknown[];
    };
    expect(persisted.migrationWarnings).toEqual([]);
    expect(persisted.workstreams).toHaveLength(1);
  });

  it("drops stale unreadable legacy warnings when their graph path no longer exists", async () => {
    const rootDir = createRootDir();
    const registryPath = join(rootDir, "workstreams.json");
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        migratedFromRecentsAt: "2026-05-01T12:00:00.000Z",
        migrationWarnings: [
          {
            code: "legacy-recents-graph-unreadable",
            message: "Expected workstream.summary to be a non-empty string.",
            path: join(rootDir, "deleted-temp-graph.json"),
          },
        ],
        workstreams: [],
      }),
      "utf8",
    );
    const api = createIsolatedApi(rootDir, {
      workstreamRegistryPath: registryPath,
      workstreamSourceRegistryPath: join(rootDir, "sources.json"),
    });
    activeApps.push(api);

    const listResponse = await request(api.app).get("/api/workstreams").expect(200);
    expect(listResponse.body.migrationWarnings).toEqual([]);
    expect(listResponse.body.workstreams).toEqual([]);
    const persisted = JSON.parse(readFileSync(registryPath, "utf8")) as {
      migrationWarnings: unknown[];
      workstreams: unknown[];
    };
    expect(persisted.migrationWarnings).toEqual([]);
    expect(persisted.workstreams).toEqual([]);
  });

  it("keeps missing registered graph files addressable for relink or untrack", async () => {
    const rootDir = createRootDir();
    const graphPath = join(rootDir, "graph.json");
    writeFileSync(graphPath, JSON.stringify(buildGraph()), "utf8");
    const api = createIsolatedApi(rootDir);
    activeApps.push(api);

    await request(api.app).post("/api/workstreams").send({ path: graphPath }).expect(201);
    rmSync(graphPath, { force: true });

    const listResponse = await request(api.app).get("/api/workstreams").expect(200);
    expect(listResponse.body.workstreams[0].fileStatus).toBe("missing");

    const graphResponse = await request(api.app)
      .get("/api/workstreams/streamliner/api-test/graph")
      .expect(404);
    expect(graphResponse.body.code).toBe("workstream_file_missing");
  });

  it("does not rewrite the workstream registry for not-modified graph polls", async () => {
    const rootDir = createRootDir();
    const graphPath = join(rootDir, "graph.json");
    const registryPath = join(rootDir, "workstreams.json");
    writeFileSync(graphPath, JSON.stringify(buildGraph()), "utf8");
    const api = createIsolatedApi(rootDir, {
      workstreamRegistryPath: registryPath,
      workstreamSourceRegistryPath: join(rootDir, "sources.json"),
    });
    activeApps.push(api);

    await request(api.app).post("/api/workstreams").send({ path: graphPath }).expect(201);
    const firstGraph = await request(api.app)
      .get("/api/workstreams/streamliner/api-test/graph")
      .expect(200);
    const registryAfterOpen = readFileSync(registryPath, "utf8");

    await request(api.app)
      .get("/api/workstreams/streamliner/api-test/graph")
      .set("If-Modified-Since", firstGraph.header["last-modified"])
      .expect(304);

    expect(readFileSync(registryPath, "utf8")).toBe(registryAfterOpen);
  });

  it("rejects relinking to a graph with a different composite identity", async () => {
    const rootDir = createRootDir();
    const graphPath = join(rootDir, "graph.json");
    const otherGraphPath = join(rootDir, "other-graph.json");
    writeFileSync(graphPath, JSON.stringify(buildGraph()), "utf8");
    writeFileSync(
      otherGraphPath,
      JSON.stringify(buildGraph({ id: "other-workstream", title: "Other" })),
      "utf8",
    );
    const api = createIsolatedApi(rootDir);
    activeApps.push(api);

    await request(api.app).post("/api/workstreams").send({ path: graphPath }).expect(201);
    const response = await request(api.app)
      .patch("/api/workstreams/streamliner/api-test")
      .send({ path: otherGraphPath })
      .expect(409);
    expect(response.body.code).toBe("workstream_identity_mismatch");
  });

  it("discovers workstreams from persisted project-root sources and reads graph updates from disk", async () => {
    const rootDir = createRootDir();
    const projectRoot = join(rootDir, "project");
    const workstreamDir = join(projectRoot, ".streamliner", "workstreams", "api-test");
    const graphPath = join(workstreamDir, "graph.json");
    mkdirSync(workstreamDir, { recursive: true });
    writeFileSync(graphPath, JSON.stringify(buildGraph()), "utf8");
    const sourceRegistryPath = join(rootDir, "sources.json");
    const api = createIsolatedApi(rootDir, {
      workstreamSourceRegistryPath: sourceRegistryPath,
    });
    activeApps.push(api);

    const addResponse = await request(api.app)
      .post("/api/workstream-sources")
      .send({ type: "project-root", path: projectRoot })
      .expect(201);
    expect(addResponse.body.source).toEqual(expect.objectContaining({
      type: "project-root",
      path: projectRoot,
      health: "available",
      discoveredCount: 1,
    }));
    expect(addResponse.body.workstreams[0]).toEqual(expect.objectContaining({
      source: "source",
      projectKey: "streamliner",
      workstreamId: "api-test",
      title: "API Test",
    }));

    const restartedApi = createIsolatedApi(rootDir, {
      store: new SessionRegistryFileStore({ rootDir: join(rootDir, "registry-restarted") }),
      recentsPath: join(rootDir, "recent-graphs-restarted.json"),
      workstreamRegistryPath: join(rootDir, "workstreams-restarted.json"),
      workstreamSourceRegistryPath: sourceRegistryPath,
    });
    activeApps.push(restartedApi);
    const restartedList = await request(restartedApi.app).get("/api/workstreams").expect(200);
    expect(restartedList.body.workstreams[0]).toEqual(expect.objectContaining({
      source: "source",
      title: "API Test",
    }));
    const sourceRegistryAfterInitialScan = readFileSync(sourceRegistryPath, "utf8");

    writeFileSync(graphPath, JSON.stringify(buildGraph({ title: "API Test Updated" })), "utf8");
    const graphResponse = await request(restartedApi.app)
      .get("/api/workstreams/streamliner/api-test/graph")
      .expect(200);
    expect(graphResponse.body.title).toBe("API Test Updated");
    await request(restartedApi.app)
      .get("/api/workstreams/streamliner/api-test/graph")
      .set("If-Modified-Since", graphResponse.header["last-modified"])
      .expect(304);
    await request(restartedApi.app).get("/api/workstreams").expect(200);
    expect(readFileSync(sourceRegistryPath, "utf8")).toBe(sourceRegistryAfterInitialScan);
  });

  it("surfaces path/source conflicts while preserving path-backed route precedence", async () => {
    const rootDir = createRootDir();
    const graphPath = join(rootDir, "registered-graph.json");
    const sourceRoot = join(rootDir, "workstreams");
    const sourceWorkstreamDir = join(sourceRoot, "api-test");
    const sourceGraphPath = join(sourceWorkstreamDir, "graph.json");
    mkdirSync(sourceWorkstreamDir, { recursive: true });
    writeFileSync(graphPath, JSON.stringify(buildGraph({ title: "Path Graph" })), "utf8");
    writeFileSync(sourceGraphPath, JSON.stringify(buildGraph({ title: "Source Graph" })), "utf8");
    const api = createIsolatedApi(rootDir);
    activeApps.push(api);

    await request(api.app).post("/api/workstreams").send({ path: graphPath }).expect(201);
    await request(api.app)
      .post("/api/workstream-sources")
      .send({ type: "workstreams-root", path: sourceRoot })
      .expect(201);

    const listResponse = await request(api.app).get("/api/workstreams").expect(200);
    expect(listResponse.body.workstreams).toHaveLength(1);
    expect(listResponse.body.workstreams[0]).toEqual(expect.objectContaining({
      source: "path",
      title: "Path Graph",
    }));
    expect(listResponse.body.conflicts[0]).toEqual(expect.objectContaining({
      projectKey: "streamliner",
      workstreamId: "api-test",
      archived: false,
    }));
    expect(listResponse.body.conflicts[0].candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "path", selected: true, path: graphPath }),
        expect.objectContaining({ source: "source", selected: false, path: sourceGraphPath }),
      ]),
    );

    const graphResponse = await request(api.app)
      .get("/api/workstreams/streamliner/api-test/graph")
      .expect(200);
    expect(graphResponse.body.title).toBe("Path Graph");

    const archiveResponse = await request(api.app)
      .post("/api/workstreams/streamliner/api-test/archive")
      .expect(200);
    expect(archiveResponse.body.workstreams).toEqual([]);
    expect(archiveResponse.body.archivedWorkstreams[0].title).toBe("Path Graph");
    expect(archiveResponse.body.conflicts[0].archived).toBe(true);

    const restoreResponse = await request(api.app)
      .delete("/api/workstreams/streamliner/api-test/archive")
      .expect(200);
    expect(restoreResponse.body.workstreams[0].title).toBe("Path Graph");

    const sourceId = listResponse.body.sources[0].id as string;
    await request(api.app).delete(`/api/workstream-sources/${sourceId}`).expect(204);
    const afterDelete = await request(api.app).get("/api/workstreams").expect(200);
    expect(afterDelete.body.conflicts).toEqual([]);
    expect(afterDelete.body.workstreams[0].title).toBe("Path Graph");
  });

  it("does not report a path/source conflict when both candidates point at the same graph file", async () => {
    const rootDir = createRootDir();
    const sourceRoot = join(rootDir, "workstreams");
    const sourceWorkstreamDir = join(sourceRoot, "api-test");
    const graphPath = join(sourceWorkstreamDir, "graph.json");
    mkdirSync(sourceWorkstreamDir, { recursive: true });
    writeFileSync(graphPath, JSON.stringify(buildGraph({ title: "Shared Graph" })), "utf8");
    const api = createIsolatedApi(rootDir);
    activeApps.push(api);

    await request(api.app).post("/api/workstreams").send({ path: graphPath }).expect(201);
    await request(api.app)
      .post("/api/workstream-sources")
      .send({ type: "workstreams-root", path: sourceRoot })
      .expect(201);

    const listResponse = await request(api.app).get("/api/workstreams").expect(200);
    expect(listResponse.body.workstreams).toHaveLength(1);
    expect(listResponse.body.workstreams[0]).toEqual(expect.objectContaining({
      source: "path",
      path: graphPath,
      title: "Shared Graph",
    }));
    expect(listResponse.body.conflicts).toEqual([]);
  });

  it("rejects invalid source paths and marks previously valid sources unhealthy when missing", async () => {
    const rootDir = createRootDir();
    const filePath = join(rootDir, "not-a-directory.json");
    const sourceRoot = join(rootDir, "workstreams");
    const workstreamDir = join(sourceRoot, "api-test");
    mkdirSync(workstreamDir, { recursive: true });
    writeFileSync(filePath, "{}", "utf8");
    writeFileSync(join(workstreamDir, "graph.json"), JSON.stringify(buildGraph()), "utf8");
    const api = createIsolatedApi(rootDir);
    activeApps.push(api);

    const invalidResponse = await request(api.app)
      .post("/api/workstream-sources")
      .send({ type: "workstreams-root", path: filePath })
      .expect(400);
    expect(invalidResponse.body.code).toBe("source_path_not_directory");

    await request(api.app)
      .post("/api/workstream-sources")
      .send({ type: "workstreams-root", path: sourceRoot })
      .expect(201);
    rmSync(sourceRoot, { recursive: true, force: true });

    const refreshResponse = await request(api.app)
      .post("/api/workstream-sources/refresh")
      .expect(200);
    expect(refreshResponse.body.sources[0]).toEqual(expect.objectContaining({
      path: sourceRoot,
      health: "missing",
    }));
    expect(refreshResponse.body.sources[0].messages[0]).toEqual(expect.objectContaining({
      code: "source-missing",
      severity: "error",
    }));
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
    expect(received).toContain("activityEvidence");
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

  it("filters session event snapshots with the stream query", () => {
    let receivedOptions: SessionRegistryListOptions | undefined;
    const { store } = createEventStreamStore({
      listSessions: (options) => {
        receivedOptions = options;
        return [];
      },
    });
    const eventStream = new SessionRegistryEventStream(store);
    try {
      const stream = openEventStream(
        eventStream,
        undefined,
        "/api/sessions/events?includeArchived=true&repo=null&workstreamId=session-launching-and-tracking&nodeId=graph-node-session-status-ui&text=waiting",
      );
      expect(stream.res.body()).toContain("event: snapshot");
      expect(receivedOptions).toEqual({
        includeArchived: true,
        repo: null,
        workstreamId: "session-launching-and-tracking",
        nodeId: "graph-node-session-status-ui",
        text: "waiting",
      });
      stream.req.emit("close");
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

  it("relaunch endpoint returns result for valid session", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const session = store.upsertSession({
      title: "Relaunch target",
      cwd: rootDir,
      origin: { kind: "manual" },
    });
    const api = createStreamlinerApiApp({
      store,
      relaunchDeps: {
        launchTerminal: () => ({ method: "windows-terminal", pid: 99999 }),
        existsSync: () => true,
      },
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post(`/api/sessions/${session.id}/relaunch`).set("Content-Type", "application/json").expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        sessionId: session.id,
        cwd: rootDir,
        method: "windows-terminal",
        pid: 99999,
      }),
    );
  });

  it("relaunch endpoint returns 404 for nonexistent session", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const api = createStreamlinerApiApp({
      store,
      relaunchDeps: {
        launchTerminal: () => ({ method: "powershell", pid: 1 }),
        existsSync: () => true,
      },
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/sessions/nonexistent/relaunch").set("Content-Type", "application/json").expect(404);
    expect(response.body.code).toBe("session_not_found");
  });

  it("relaunch endpoint returns 400 for archived session", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const session = store.upsertSession({
      title: "Archived session",
      cwd: rootDir,
      origin: { kind: "manual" },
    });
    store.archiveSession(session.id);
    const api = createStreamlinerApiApp({
      store,
      relaunchDeps: {
        launchTerminal: () => ({ method: "powershell", pid: 1 }),
        existsSync: () => true,
      },
    });
    activeApps.push(api);

    const response = await request(api.app)
      .post(`/api/sessions/${session.id}/relaunch`).set("Content-Type", "application/json").expect(400);
    expect(response.body.code).toBe("session_archived");
  });

  it("relaunch endpoint blocks non-loopback requests", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const session = store.upsertSession({
      title: "Blocked relaunch",
      cwd: rootDir,
      origin: { kind: "manual" },
    });
    const api = createStreamlinerApiApp({
      store,
      relaunchDeps: {
        launchTerminal: () => ({ method: "powershell", pid: 1 }),
        existsSync: () => true,
      },
    });
    activeApps.push(api);

    await request(api.app)
      .post(`/api/sessions/${session.id}/relaunch`)
      .set("X-Forwarded-For", "203.0.113.7")
      .expect(403, { error: "Session relaunch must originate from loopback." });
  });

  it("relaunch endpoint rejects requests without application/json content-type", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const session = store.upsertSession({
      title: "CSRF test",
      cwd: rootDir,
      origin: { kind: "manual" },
    });
    const api = createStreamlinerApiApp({
      store,
      relaunchDeps: {
        launchTerminal: () => ({ method: "powershell", pid: 1 }),
        existsSync: () => true,
      },
    });
    activeApps.push(api);

    await request(api.app)
      .post(`/api/sessions/${session.id}/relaunch`)
      .set("Content-Type", "text/plain")
      .expect(415, { error: "Content-Type must be application/json." });
  });

  it("stop endpoint synthesizes session.ended for an interrupted session", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const session = store.upsertSession({
      title: "Stuck",
      cwd: rootDir,
      origin: { kind: "observed" },
      copilotSessionId: "stuck-session",
    });
    // Simulate the stuck-active state from the user's report: started but
    // no end signal, process gone.
    store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "stuck-session",
      timestamp: "2026-04-29T20:02:39.000Z",
      cwd: rootDir,
      hookSource: "resume",
    });
    const api = createStreamlinerApiApp({ store });
    activeApps.push(api);

    const response = await request(api.app)
      .post(`/api/sessions/${session.id}/stop`)
      .set("Content-Type", "application/json")
      .send({})
      .expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        sessionId: session.id,
        lifecycleStatus: "ended",
      }),
    );
    expect(typeof response.body.trustedEndedAt).toBe("string");

    const updated = store.getSession(session.id);
    expect(updated?.lifecycleStatus).toBe("ended");
    expect(updated?.trustedEndReason).toBe("user_exit");
    expect(updated?.activityStatus).toBe("exited");
    expect(updated?.activityEvidence).toEqual(
      expect.objectContaining({
        statusReason: "trusted_end",
        confidence: "high",
      }),
    );
  });

  it("stop endpoint returns 404 for nonexistent session", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const api = createStreamlinerApiApp({ store });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/sessions/nonexistent/stop")
      .set("Content-Type", "application/json")
      .send({})
      .expect(404);
    expect(response.body.code).toBe("session_not_found");
  });

  it("stop endpoint returns 400 for already-ended session", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const session = store.upsertSession({
      title: "Already done",
      cwd: rootDir,
      origin: { kind: "observed" },
      copilotSessionId: "done-session",
    });
    store.recordTrustedSessionSignal({
      event: "session.ended",
      source: "copilot-cli-hook",
      sessionId: "done-session",
      timestamp: "2026-04-29T19:00:00.000Z",
      cwd: rootDir,
      endReason: "complete",
    });
    const api = createStreamlinerApiApp({ store });
    activeApps.push(api);

    const response = await request(api.app)
      .post(`/api/sessions/${session.id}/stop`)
      .set("Content-Type", "application/json")
      .send({})
      .expect(400);
    expect(response.body.code).toBe("session_already_ended");
  });

  it("stop endpoint blocks non-loopback requests", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const session = store.upsertSession({
      title: "Loopback test",
      cwd: rootDir,
      origin: { kind: "observed" },
      copilotSessionId: "lb-session",
    });
    const api = createStreamlinerApiApp({ store });
    activeApps.push(api);

    await request(api.app)
      .post(`/api/sessions/${session.id}/stop`)
      .set("Content-Type", "application/json")
      .set("X-Forwarded-For", "203.0.113.7")
      .send({})
      .expect(403, { error: "Session stop must originate from loopback." });
  });

  it("releases a stuck node launch claim and detaches its reserved session row", async () => {
    const rootDir = createRootDir();
    const store = new SessionRegistryFileStore({ rootDir: join(rootDir, "registry") });
    const claimStore = new LaunchClaimFileStore({ rootDir: join(rootDir, "claims") });
    const created = createLaunchClaim(
      store,
      claimStore,
      {
        workstreamId: "session-launching-and-tracking",
        nodeId: "session-event-observation",
        expectedCwd: rootDir,
        expectedBranch: "feature/session-event-observation",
        expectedRepo: "lossyrob/streamliner",
        contextId: "ctx-release",
        reservedRowTitle: "Session event observation",
      },
      {
        now: () => new Date("2026-05-04T20:40:06.000Z"),
        mintLaunchClaimId: () => "claim-release",
        mintRegistryRowId: () => "registry-release",
        mintNonce: () => "nonce-release",
      },
    );
    expect(created.ok).toBe(true);
    claimStore.updateClaim("claim-release", (claim) => ({
      ...claim,
      status: "bound",
      boundRegistryId: "registry-release",
      boundCopilotSessionId: "copilot-release",
    }));
    const api = createStreamlinerApiApp({ store, launchClaimStore: claimStore });
    activeApps.push(api);

    const response = await request(api.app)
      .post("/api/node-launch-records/launch-claims/claim-release/release")
      .set("Content-Type", "application/json")
      .send({})
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        launchClaim: expect.objectContaining({
          launchClaimId: "claim-release",
          status: "failed",
          failureCode: "user-cancelled",
          blocksLaunch: false,
          retryable: true,
        }),
        detachedRegistryIds: ["registry-release"],
      }),
    );
    expect(claimStore.getClaim("claim-release")?.status).toBe("failed");
    expect(store.getSession("registry-release")?.graphBinding).toBeNull();
  });
});
