import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { SessionRegistryFileStore } from "../session-registry/file-store";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";

const roots: string[] = [];
const apps: StreamlinerApiApp[] = [];

function rootDir(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-notif-app-"));
  roots.push(root);
  return root;
}

function buildApi(root: string, readonlyMode = false): StreamlinerApiApp {
  const api = createStreamlinerApiApp({
    store: new SessionRegistryFileStore({ rootDir: join(root, "registry") }),
    recentsPath: join(root, "recent-graphs.json"),
    workstreamRegistryPath: join(root, "workstreams.json"),
    workstreamSourceRegistryPath: join(root, "sources.json"),
    nodeLaunchRecordsPath: join(root, "node-launch-records.json"),
    notificationStorePath: join(root, "notifications.ndjson"),
    dashboardBaseUrl: "http://127.0.0.1:5173",
    readonlyMode,
  });
  apps.push(api);
  return api;
}

afterEach(() => {
  while (apps.length > 0) {
    apps.pop()?.close();
  }
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe("notifications API wiring", () => {
  it("exposes the dashboard base URL via /api/client-config", async () => {
    const api = buildApi(rootDir());
    const res = await request(api.app).get("/api/client-config").expect(200);
    expect(res.body.dashboardBaseUrl).toBe("http://127.0.0.1:5173");
  });

  it("allows POST /api/notifications even in readonly preview mode", async () => {
    const api = buildApi(rootDir(), true);

    // A registry mutation is still blocked...
    await request(api.app)
      .post("/api/workstreams")
      .send({ path: "C:\\graphs\\graph.json" })
      .expect(403);

    // ...but notifications (a localhost-only write surface) are allowed.
    const created = await request(api.app)
      .post("/api/notifications")
      .send({ title: "ONLINE", body: "ready", eventKind: "online" })
      .expect(201);
    expect(created.body.notification.id).toBe(1);

    await request(api.app).get("/api/notifications").expect(200);
  });

  it("round-trips a notification through POST then GET list", async () => {
    const api = buildApi(rootDir());
    await request(api.app)
      .post("/api/notifications")
      .send({ title: "Reconciled", body: "done", eventKind: "reconciled" })
      .expect(201);
    const list = await request(api.app).get("/api/notifications").expect(200);
    expect(list.body.notifications).toHaveLength(1);
    expect(list.body.notifications[0].eventKind).toBe("reconciled");
  });

  it("rejects POST /api/notifications forwarded from a non-loopback client", async () => {
    const api = buildApi(rootDir());
    const res = await request(api.app)
      .post("/api/notifications")
      .set("x-forwarded-for", "203.0.113.7")
      .send({ title: "Reconciled", body: "done", eventKind: "reconciled" })
      .expect(403);
    expect(res.body.code).toBe("loopback_only");
    // The rejected write must not have been persisted.
    const list = await request(api.app).get("/api/notifications").expect(200);
    expect(list.body.notifications).toHaveLength(0);
  });
});
