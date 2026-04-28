import { createServer, get as httpGet, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { SessionRegistryFileStore } from "../session-registry/file-store";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";

const createdRoots: string[] = [];
const activeApps: StreamlinerApiApp[] = [];
const activeServers: Server[] = [];

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
});
