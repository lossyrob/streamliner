import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  normalizeDefaultCliArgs,
  readSessionLaunchSettings,
  writeSessionLaunchSettings,
} from "./session-launch-settings";
import { createSessionLaunchSettingsRouter } from "./routes/session-launch-settings";

function createRoot(): string {
  return mkdtempSync(join(tmpdir(), "streamliner-session-launch-settings-"));
}

function createTestApp(path: string) {
  const app = express();
  app.use(express.json());
  app.use("/api", createSessionLaunchSettingsRouter({ settingsPath: path }));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
    res.status(statusCode).json({
      code: typeof error.code === "string" ? error.code : "internal_error",
      error: error instanceof Error ? error.message : String(error),
    });
  };
  app.use(errorHandler);
  return app;
}

describe("session launch settings", () => {
  it("returns --yolo defaults when no settings file exists", async () => {
    const root = createRoot();
    try {
      await expect(readSessionLaunchSettings(join(root, "settings.json"))).resolves.toEqual({
        defaultCliArgs: ["--yolo"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes and reads default launch args", async () => {
    const root = createRoot();
    const path = join(root, "settings.json");
    try {
      await writeSessionLaunchSettings({
        defaultCliArgs: ["--model=gpt-5.5", "--prefer-version", "1.0.52-config-hardening-patch", "--yolo"],
      }, path);
      await expect(readSessionLaunchSettings(path)).resolves.toEqual({
        defaultCliArgs: ["--model=gpt-5.5", "--prefer-version", "1.0.52-config-hardening-patch", "--yolo"],
      });
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
        version: 1,
        defaultCliArgs: ["--model=gpt-5.5", "--prefer-version", "1.0.52-config-hardening-patch", "--yolo"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes legacy prefer-version equals form", async () => {
    const root = createRoot();
    const path = join(root, "settings.json");
    try {
      await writeSessionLaunchSettings({
        defaultCliArgs: ["--prefer-version=1.0.52-config-hardening-patch", "--yolo"],
      }, path);
      await expect(readSessionLaunchSettings(path)).resolves.toEqual({
        defaultCliArgs: ["--prefer-version", "1.0.52-config-hardening-patch", "--yolo"],
      });
      expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
        defaultCliArgs: ["--prefer-version", "1.0.52-config-hardening-patch", "--yolo"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves an explicit empty defaults list", async () => {
    const root = createRoot();
    const path = join(root, "settings.json");
    try {
      await writeSessionLaunchSettings({ defaultCliArgs: [] }, path);
      await expect(readSessionLaunchSettings(path)).resolves.toEqual({ defaultCliArgs: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects resume-specific and positional tokens", () => {
    expect(() => normalizeDefaultCliArgs(["--resume=abc"])).toThrow(/--resume/);
    expect(() => normalizeDefaultCliArgs(["--resume"])).toThrow(/--resume/);
    expect(() => normalizeDefaultCliArgs(["kickoff prompt"])).toThrow(/whitespace|option tokens/);
    expect(() => normalizeDefaultCliArgs(["model-name"])).toThrow(/option tokens/);
    expect(() => normalizeDefaultCliArgs(["--prefer-version"])).toThrow(/requires a value/);
    expect(() => normalizeDefaultCliArgs(["--prefer-version", "--yolo"])).toThrow(/requires a value/);
  });

  it("surfaces malformed settings files", async () => {
    const root = createRoot();
    const path = join(root, "settings.json");
    try {
      writeFileSync(path, "{ nope", "utf8");
      await expect(readSessionLaunchSettings(path)).rejects.toMatchObject({
        code: "session_launch_settings_malformed",
        statusCode: 500,
        message: expect.stringContaining(path),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serves and updates settings through the API", async () => {
    const root = createRoot();
    const path = join(root, "settings.json");
    const app = createTestApp(path);
    try {
      await request(app)
        .get("/api/session-launch-settings")
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual({ defaultCliArgs: ["--yolo"] });
        });

      await request(app)
        .put("/api/session-launch-settings")
        .send({ defaultCliArgs: [] })
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual({ defaultCliArgs: [] });
        });

      await request(app)
        .get("/api/session-launch-settings")
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual({ defaultCliArgs: [] });
        });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid API updates", async () => {
    const root = createRoot();
    const app = createTestApp(join(root, "settings.json"));
    try {
      await request(app)
        .put("/api/session-launch-settings")
        .send({ defaultCliArgs: ["--resume=abc"] })
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe("invalid_session_launch_settings");
        });

      await request(app)
        .put("/api/session-launch-settings")
        .send({ defaultCLIArgs: ["--yolo"] })
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe("invalid_session_launch_settings");
          expect(body.error).toContain("defaultCLIArgs");
        });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
