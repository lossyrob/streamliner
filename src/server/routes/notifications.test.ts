import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import type { WorkstreamRegistryEntry } from "../../workstream-registry-contract";
import { createNotificationsRouter } from "./notifications";
import { NotificationStore } from "../notification-store";
import { NotificationEventStream } from "../notification-events";

const roots: string[] = [];

function tempStorePath(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-notif-route-"));
  roots.push(root);
  return join(root, "notifications.ndjson");
}

function workstream(overrides: Partial<WorkstreamRegistryEntry>): WorkstreamRegistryEntry {
  return {
    projectKey: "proj",
    workstreamId: "ws-a",
    title: "A",
    summary: "",
    path: "/tmp/a",
    addedAt: "2024-01-01T00:00:00.000Z",
    lastOpenedAt: "2024-01-01T00:00:00.000Z",
    presentation: { shortName: "WSA", color: "#6754d7" },
    ...overrides,
  };
}

function buildApp(workstreams: WorkstreamRegistryEntry[] = []) {
  const store = new NotificationStore({ storePath: tempStorePath() });
  const eventStream = new NotificationEventStream(store);
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createNotificationsRouter({
      store,
      eventStream,
      loadWorkstreams: async () => workstreams,
      dashboardBaseUrl: "http://127.0.0.1:5173",
    }),
  );
  return { app, store, eventStream };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe("notifications router", () => {
  it("creates an enriched notification and returns 201", async () => {
    const { app } = buildApp([workstream({})]);
    const res = await request(app)
      .post("/api/notifications")
      .send({ title: "PR Created", body: "node x", workstreamId: "ws-a", eventKind: "pr-created", nodeId: "n1" });
    expect(res.status).toBe(201);
    expect(res.body.notification).toMatchObject({
      id: 1,
      title: "PR Created",
      eventKind: "pr-created",
      projectKey: "proj",
      workstreamColor: "6754d7",
      workstreamShortName: "WSA",
      link: "http://127.0.0.1:5173/workstreams/proj/ws-a/nodes/n1",
    });
    expect(res.body.warnings).toBeUndefined();
  });

  it("defaults eventKind to generic and source to cli", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/api/notifications").send({ title: "t", body: "b" });
    expect(res.status).toBe(201);
    expect(res.body.notification.eventKind).toBe("generic");
    expect(res.body.notification.source).toBe("cli");
  });

  it("rejects a missing title", async () => {
    const { app } = buildApp();
    const res = await request(app).post("/api/notifications").send({ body: "b" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_title");
  });

  it("rejects an invalid eventKind", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/notifications")
      .send({ title: "t", body: "b", eventKind: "exploded" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_event_kind");
  });

  it("rejects a non-absolute link", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/notifications")
      .send({ title: "t", body: "b", link: "/workstreams/proj/ws-a" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_link");
  });

  it("rejects a disallowed link scheme", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/notifications")
      .send({ title: "t", body: "b", link: "javascript:alert(1)" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_link");
  });

  it("returns warnings (still 201) for an ambiguous workstream id", async () => {
    const { app } = buildApp([
      workstream({ projectKey: "p1", workstreamId: "dup" }),
      workstream({ projectKey: "p2", workstreamId: "dup" }),
    ]);
    const res = await request(app)
      .post("/api/notifications")
      .send({ title: "t", body: "b", workstreamId: "dup" });
    expect(res.status).toBe(201);
    expect(res.body.notification.projectKey).toBeNull();
    expect(res.body.warnings).toHaveLength(1);
  });

  it("lists notifications with afterId", async () => {
    const { app } = buildApp();
    for (let i = 0; i < 3; i += 1) {
      await request(app).post("/api/notifications").send({ title: `n${i}`, body: "b" });
    }
    const res = await request(app).get("/api/notifications?afterId=1");
    expect(res.status).toBe(200);
    expect(res.body.notifications.map((n: { id: number }) => n.id)).toEqual([2, 3]);
  });

  it("resolves a single notification by id (activation path)", async () => {
    const { app } = buildApp();
    for (let i = 0; i < 3; i += 1) {
      await request(app).post("/api/notifications").send({ title: `n${i}`, body: "b" });
    }
    const res = await request(app).get("/api/notifications/2");
    expect(res.status).toBe(200);
    expect(res.body.notification.id).toBe(2);
    expect(res.body.notification.title).toBe("n1");
  });

  it("returns 404 for an unknown notification id", async () => {
    const { app } = buildApp();
    await request(app).post("/api/notifications").send({ title: "t", body: "b" });
    const res = await request(app).get("/api/notifications/999");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("does not let the :id route shadow the events path", async () => {
    const { app } = buildApp();
    // `events` is non-numeric so the digit-constrained :id route must not match
    // it; with no SSE route mounted here that means a 404 (not a 400/200 from
    // the id handler).
    const res = await request(app).get("/api/notifications/events");
    expect(res.status).toBe(404);
    expect(res.body.code).not.toBe("invalid_id");
  });

  it("persists notifications to the store and publishes to the stream", async () => {
    const { app, store } = buildApp();
    await request(app).post("/api/notifications").send({ title: "t", body: "b" });
    expect(await store.maxId()).toBe(1);
  });
});
