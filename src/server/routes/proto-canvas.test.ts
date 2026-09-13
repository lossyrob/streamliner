import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProtoCanvasRouter } from "./proto-canvas";

const roots: string[] = [];

function createRoot() {
  const root = mkdtempSync(join(tmpdir(), "streamliner-proto-canvas-"));
  roots.push(root);
  return root;
}

function writeFixture(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function createApp(projectRoot?: string) {
  const app = express();
  app.use(express.json());
  app.use("/api/_proto/canvas", createProtoCanvasRouter(projectRoot));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => {
  vi.stubEnv("STREAMLINER_PROTO_CANVAS_PROJECT_ROOT", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("portfolio prototype project configuration", () => {
  it.each([undefined, "", "   "])("requires a configured root (%j)", async (projectRoot) => {
    const app = createApp(projectRoot);
    const endpoints = [
      ["get", "/portfolio"],
      ["get", "/positions"],
      ["put", "/positions"],
      ["patch", "/positions"],
      ["post", "/positions?method=patch"],
      ["get", "/colors"],
      ["put", "/colors"],
      ["get", "/terminal-active"],
      ["put", "/terminal-active"],
      ["get", "/workstream-doc?id=example"],
    ] as const;

    for (const [method, path] of endpoints) {
      const response = await request(app)[method](`/api/_proto/canvas${path}`).expect(503);
      expect(response.body.error).toContain("STREAMLINER_PROTO_CANVAS_PROJECT_ROOT");
    }
    await request(app).get("/health").expect(200, { ok: true });
  });

  it("reads the environment at router creation and isolates separate project roots", async () => {
    const firstRoot = createRoot();
    const secondRoot = createRoot();
    writeFixture(join(firstRoot, "portfolio", "portfolio.json"), '{"id":"first"}');
    writeFixture(join(secondRoot, "portfolio", "portfolio.json"), '{"id":"second"}');

    vi.stubEnv("STREAMLINER_PROTO_CANVAS_PROJECT_ROOT", firstRoot);
    const firstApp = createApp();
    vi.stubEnv("STREAMLINER_PROTO_CANVAS_PROJECT_ROOT", secondRoot);
    const secondApp = createApp();

    await request(firstApp).get("/api/_proto/canvas/portfolio").expect(200, { id: "first" });
    await request(secondApp).get("/api/_proto/canvas/portfolio").expect(200, { id: "second" });
  });

  it.each(["default", "relative", "absolute"])("preserves storage behavior with %s paths", async (mode) => {
    const root = createRoot();
    const storageRoot = mode === "absolute" ? createRoot() : root;
    const portfolioRelative = mode === "default"
      ? join("portfolio", "portfolio.json")
      : join("data", "portfolio.json");
    const stateRelative = mode === "default" ? join("portfolio", "state") : "layout";
    const portfolioPath = join(storageRoot, portfolioRelative);
    const stateDir = join(storageRoot, stateRelative);
    if (mode !== "default") {
      writeFixture(join(root, "streamliner.json"), JSON.stringify({
        portfolio: {
          path: mode === "absolute" ? portfolioPath : portfolioRelative,
          stateDir: mode === "absolute" ? stateDir : stateRelative,
        },
      }));
    }
    const portfolio = { workstreams: [], edges: [], externalDependencies: [] };
    writeFixture(portfolioPath, JSON.stringify(portfolio));
    const app = createApp(root);
    const api = request(app);

    await api.get("/api/_proto/canvas/portfolio").expect(200, portfolio);
    await api.get("/api/_proto/canvas/positions").expect(200, {
      path: join(stateDir, "positions.json"), positions: {},
    });

    const first = { x: 1, y: 2, ts: 3, manuallyMoved: true };
    const second = { x: 4, y: 5, ts: 6, manuallyMoved: true };
    await api.put("/api/_proto/canvas/positions").send({ positions: { first } }).expect(200);
    await api.put("/api/_proto/canvas/positions").send({ positions: { second } }).expect(200);
    const merged = await api.get("/api/_proto/canvas/positions").expect(200);
    expect(merged.body.positions).toEqual({ first, second });
    await api.patch("/api/_proto/canvas/positions")
      .send({ remove: ["first"], upsert: { third: first } }).expect(200);
    await api.post("/api/_proto/canvas/positions?method=patch")
      .send({ remove: ["second"] }).expect(200);
    expect(JSON.parse(readFileSync(join(stateDir, "positions.json"), "utf8"))).toEqual({ third: first });

    await api.put("/api/_proto/canvas/colors").send({ colors: { example: "#123abc" } }).expect(200);
    await api.get("/api/_proto/canvas/colors").expect(200, {
      path: join(stateDir, "colors.json"), colors: { example: "#123abc" },
    });
    await api.put("/api/_proto/canvas/terminal-active").send({ activeIds: ["example"] }).expect(200);
    await api.get("/api/_proto/canvas/terminal-active").expect(200, {
      path: join(stateDir, "terminal-active.json"), activeIds: ["example"],
    });
  });

  it("resolves formed and candidate documents, including synonyms, within the configured root", async () => {
    const root = createRoot();
    const briefPath = join(root, "workstreams", "example-database-access", "brief.md");
    const candidatePath = join(root, "shaping", "candidates", "example-database-access-plan.md");
    writeFixture(briefPath, "# Example brief");
    writeFixture(candidatePath, "# Example candidate");
    const api = request(createApp(root));

    const formed = await api.get("/api/_proto/canvas/workstream-doc?id=example-db-access&type=formed").expect(200);
    expect(formed.body).toMatchObject({ kind: "brief", path: briefPath, content: "# Example brief" });
    const candidate = await api.get("/api/_proto/canvas/workstream-doc?id=example-db-access&type=candidate").expect(200);
    expect(candidate.body).toMatchObject({ kind: "candidate", path: candidatePath, content: "# Example candidate" });
    await api.get("/api/_proto/canvas/workstream-doc?id=missing").expect(404);
    await api.get("/api/_proto/canvas/workstream-doc?id=..%2Foutside").expect(400);
  });

  it("reports a missing portfolio at the configured path", async () => {
    const root = createRoot();
    const response = await request(createApp(root)).get("/api/_proto/canvas/portfolio").expect(500);
    expect(response.body.error).toBe(`Configured portfolio path missing: ${join(root, "portfolio", "portfolio.json")}`);
  });

  it("preserves project configuration validation", () => {
    const root = createRoot();
    writeFixture(join(root, "streamliner.json"), '{"portfolio":{"path":42}}');
    expect(() => createApp(root)).toThrow('field "portfolio.path" must be a non-empty string');
  });
});
