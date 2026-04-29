import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiLogger, getApiLogger, resetApiLoggerForTests } from "./logger";

const createdRoots: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "streamliner-logger-"));
  createdRoots.push(dir);
  return dir;
}

function makeFakeConsole() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function readLogLines(file: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const dir of createdRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  resetApiLoggerForTests(null);
});

describe("ApiLogger", () => {
  it("writes JSON-lines entries to the daily log file", () => {
    const dir = makeDir();
    const fakeConsole = makeFakeConsole();
    const fixed = new Date("2026-04-29T12:00:00.000Z");
    const logger = new ApiLogger({
      logDir: dir,
      level: "debug",
      now: () => fixed,
      console: fakeConsole,
      purgeOnStart: false,
    });

    logger.info("server up", { port: 4319 });

    const file = join(dir, "api-2026-04-29.log");
    const entries = readLogLines(file);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      ts: "2026-04-29T12:00:00.000Z",
      level: "info",
      scope: "api",
      msg: "server up",
      port: 4319,
    });
  });

  it("filters entries below the configured level", () => {
    const dir = makeDir();
    const logger = new ApiLogger({
      logDir: dir,
      level: "warn",
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      console: makeFakeConsole(),
      purgeOnStart: false,
    });

    logger.debug("ignored debug");
    logger.info("ignored info");
    logger.warn("kept warn");
    logger.error("kept error");

    const entries = readLogLines(join(dir, "api-2026-04-29.log"));
    expect(entries.map((e) => e.level)).toEqual(["warn", "error"]);
  });

  it("mirrors entries to the console at the matching level", () => {
    const dir = makeDir();
    const fakeConsole = makeFakeConsole();
    const logger = new ApiLogger({
      logDir: dir,
      level: "debug",
      mirrorConsole: true,
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      console: fakeConsole,
      purgeOnStart: false,
    });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(fakeConsole.debug).toHaveBeenCalledTimes(1);
    expect(fakeConsole.info).toHaveBeenCalledTimes(1);
    expect(fakeConsole.warn).toHaveBeenCalledTimes(1);
    expect(fakeConsole.error).toHaveBeenCalledTimes(1);
  });

  it("does not mirror to console when mirrorConsole is false", () => {
    const dir = makeDir();
    const fakeConsole = makeFakeConsole();
    const logger = new ApiLogger({
      logDir: dir,
      level: "debug",
      mirrorConsole: false,
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      console: fakeConsole,
      purgeOnStart: false,
    });

    logger.info("file only");

    expect(fakeConsole.info).not.toHaveBeenCalled();
    const entries = readLogLines(join(dir, "api-2026-04-29.log"));
    expect(entries).toHaveLength(1);
  });

  it("normalizes Error fields to {name, message, stack}", () => {
    const dir = makeDir();
    const logger = new ApiLogger({
      logDir: dir,
      level: "debug",
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      console: makeFakeConsole(),
      purgeOnStart: false,
    });

    const err = new Error("boom");
    logger.error("failed", { err });

    const entries = readLogLines(join(dir, "api-2026-04-29.log"));
    expect(entries[0].err).toEqual(
      expect.objectContaining({ name: "Error", message: "boom" }),
    );
    expect(typeof (entries[0].err as { stack: string }).stack).toBe("string");
  });

  it("withScope chains scope segments with a dot", () => {
    const dir = makeDir();
    const logger = new ApiLogger({
      logDir: dir,
      level: "debug",
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      console: makeFakeConsole(),
      purgeOnStart: false,
    });

    const child = logger.withScope("relaunch");
    const grandchild = child.withScope("validate");
    child.info("c");
    grandchild.warn("g");

    const entries = readLogLines(join(dir, "api-2026-04-29.log"));
    expect(entries.map((e) => e.scope)).toEqual(["relaunch", "relaunch.validate"]);
  });

  it("getApiLogger returns a singleton until reset", () => {
    const a = getApiLogger();
    const b = getApiLogger();
    expect(a).toBe(b);
    resetApiLoggerForTests(null);
    const c = getApiLogger();
    expect(c).not.toBe(a);
  });

  it("respects STREAMLINER_LOG_LEVEL env when no level option provided", () => {
    const dir = makeDir();
    const original = process.env.STREAMLINER_LOG_LEVEL;
    process.env.STREAMLINER_LOG_LEVEL = "warn";
    try {
      const logger = new ApiLogger({
        logDir: dir,
        now: () => new Date("2026-04-29T00:00:00.000Z"),
        console: makeFakeConsole(),
        purgeOnStart: false,
      });
      logger.info("dropped");
      logger.warn("kept");
      const entries = readLogLines(join(dir, "api-2026-04-29.log"));
      expect(entries.map((e) => e.level)).toEqual(["warn"]);
    } finally {
      if (original === undefined) {
        delete process.env.STREAMLINER_LOG_LEVEL;
      } else {
        process.env.STREAMLINER_LOG_LEVEL = original;
      }
    }
  });
});

describe("ApiLogger retention purge", () => {
  it("removes log files older than retentionDays on startup", () => {
    const dir = makeDir();
    // Seed three files with backdated mtimes
    const old = join(dir, "api-2026-04-01.log");
    const mid = join(dir, "api-2026-04-15.log");
    const recent = join(dir, "api-2026-04-28.log");
    writeFileSync(old, "{}\n");
    writeFileSync(mid, "{}\n");
    writeFileSync(recent, "{}\n");

    const fixed = new Date("2026-04-29T00:00:00.000Z");
    const oldMtime = new Date("2026-04-01T00:00:00.000Z");
    const midMtime = new Date("2026-04-15T00:00:00.000Z");
    const recentMtime = new Date("2026-04-28T00:00:00.000Z");

    utimesSync(old, oldMtime, oldMtime);
    utimesSync(mid, midMtime, midMtime);
    utimesSync(recent, recentMtime, recentMtime);

    new ApiLogger({
      logDir: dir,
      now: () => fixed,
      console: makeFakeConsole(),
      retentionDays: 14,
      purgeOnStart: true,
    });

    const remaining = readdirSync(dir).filter((n) => n.endsWith(".log")).sort();
    expect(remaining).toEqual(["api-2026-04-15.log", "api-2026-04-28.log"]);
  });

  it("does not throw when log dir does not exist yet", () => {
    const dir = join(makeDir(), "subdir-that-doesnt-exist-yet");
    expect(() => new ApiLogger({
      logDir: dir,
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      console: makeFakeConsole(),
      purgeOnStart: true,
    })).not.toThrow();
  });

  it("ignores non-log files in the log dir", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "notes.txt"), "ignored");
    writeFileSync(join(dir, "api-bad-name.log"), "ignored");

    new ApiLogger({
      logDir: dir,
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      console: makeFakeConsole(),
      retentionDays: 14,
      purgeOnStart: true,
    });

    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
    expect(existsSync(join(dir, "api-bad-name.log"))).toBe(true);
  });
});
