import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  computeEventsFingerprint,
  countUserMessageTurns,
  extractRecentUserTurns,
  scanUserMessageTurns,
  summarizeSession,
} from "./session-summarizer";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeEventsFile(lines: Array<Record<string, unknown>>): string {
  const dir = mkdtempSync(join(tmpdir(), "streamliner-summarizer-test-"));
  createdDirs.push(dir);
  const eventsPath = join(dir, "events.jsonl");
  writeFileSync(
    eventsPath,
    lines.map((line) => JSON.stringify(line)).join("\n"),
    "utf8",
  );
  return eventsPath;
}

describe("extractRecentUserTurns", () => {
  it("returns the last N user.message turns in chronological order", async () => {
    const eventsPath = writeEventsFile([
      { type: "session.start" },
      { type: "user.message", data: { content: "first" }, timestamp: "t1" },
      { type: "assistant.turn_start" },
      { type: "user.message", data: { content: "second" }, timestamp: "t2" },
      { type: "assistant.turn_end" },
      { type: "user.message", data: { content: "third" }, timestamp: "t3" },
      { type: "user.message", data: { content: "fourth" }, timestamp: "t4" },
      { type: "user.message", data: { content: "fifth" }, timestamp: "t5" },
    ]);

    const turns = await extractRecentUserTurns(eventsPath, { maxTurns: 3 });
    expect(turns.map((turn) => turn.content)).toEqual(["third", "fourth", "fifth"]);
    expect(turns.map((turn) => turn.index)).toEqual([1, 2, 3]);
    expect(turns.map((turn) => turn.absoluteIndex)).toEqual([3, 4, 5]);
  });

  it("collapses whitespace and truncates long content", async () => {
    const longContent = `  hello\n\n  world  ${"x".repeat(2000)}`;
    const eventsPath = writeEventsFile([
      { type: "user.message", data: { content: longContent } },
    ]);
    const turns = await extractRecentUserTurns(eventsPath, {
      maxTurns: 1,
      maxCharsPerTurn: 40,
    });
    expect(turns).toHaveLength(1);
    expect(turns[0].content.length).toBe(40);
    expect(turns[0].content.endsWith("…")).toBe(true);
    expect(turns[0].content).toMatch(/^hello world /);
  });

  it("handles array-shaped content with text parts", async () => {
    const eventsPath = writeEventsFile([
      {
        type: "user.message",
        data: {
          content: [
            { type: "text", text: "piece one" },
            { type: "text", text: "piece two" },
          ],
        },
      },
    ]);
    const turns = await extractRecentUserTurns(eventsPath);
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe("piece one piece two");
  });

  it("ignores unparseable lines and non-user events", async () => {
    const eventsPath = writeEventsFile([
      { type: "assistant.message", data: { content: "noise" } },
      { type: "tool.request" },
    ]);
    writeFileSync(eventsPath, "{not json}\n", { flag: "a" });
    const turns = await extractRecentUserTurns(eventsPath);
    expect(turns).toEqual([]);
  });

  it("returns an empty list when the events file is missing", async () => {
    const turns = await extractRecentUserTurns("/definitely/does/not/exist.jsonl");
    expect(turns).toEqual([]);
  });
});

describe("countUserMessageTurns", () => {
  it("counts contentful user.message turns without retaining prompt text", async () => {
    const eventsPath = writeEventsFile([
      { type: "user.message", data: { content: "first" } },
      { type: "assistant.message", data: { content: "noise" } },
      { type: "user.message", data: { content: [{ type: "text", text: "second" }] } },
      { type: "user.message", data: { content: null } },
    ]);
    writeFileSync(eventsPath, "\n{not json}\n", { flag: "a" });

    await expect(countUserMessageTurns(eventsPath)).resolves.toBe(2);
  });

  it("returns zero when the events file is missing", async () => {
    await expect(countUserMessageTurns("/definitely/does/not/exist.jsonl")).resolves.toBe(0);
  });
});

describe("scanUserMessageTurns", () => {
  it("counts all turns while retaining only the requested recent window", async () => {
    const eventsPath = writeEventsFile(
      Array.from({ length: 8 }, (_, index) => ({
        type: "user.message",
        data: { content: `turn-${index + 1}` },
      })),
    );

    await expect(scanUserMessageTurns(eventsPath, { maxTurns: 3 })).resolves.toEqual({
      totalTurns: 8,
      recentTurns: [
        expect.objectContaining({ index: 1, absoluteIndex: 6, content: "turn-6" }),
        expect.objectContaining({ index: 2, absoluteIndex: 7, content: "turn-7" }),
        expect.objectContaining({ index: 3, absoluteIndex: 8, content: "turn-8" }),
      ],
      startOffset: 0,
      endOffset: statSync(eventsPath).size,
    });
  });

  it("scans only events appended after a known byte offset", async () => {
    const eventsPath = writeEventsFile([
      { type: "user.message", data: { content: "old-1" } },
      { type: "user.message", data: { content: "old-2" } },
    ]);
    writeFileSync(eventsPath, "\n", { flag: "a" });
    const startOffset = computeEventsFingerprint(eventsPath);
    const offset = Number.parseInt(startOffset?.split(":").at(-1) ?? "", 10);
    writeFileSync(
      eventsPath,
      `${[
        { type: "user.message", data: { content: "new-1" } },
        { type: "assistant.message", data: { content: "noise" } },
        { type: "user.message", data: { content: "new-2" } },
      ].map((event) => JSON.stringify(event)).join("\n")}\n`,
      { flag: "a" },
    );
    const endOffsetFingerprint = computeEventsFingerprint(eventsPath);
    const endOffset = Number.parseInt(endOffsetFingerprint?.split(":").at(-1) ?? "", 10);
    writeFileSync(
      eventsPath,
      JSON.stringify({ type: "user.message", data: { content: "too-late" } }),
      { flag: "a" },
    );

    await expect(
      scanUserMessageTurns(eventsPath, {
        maxTurns: 4,
        startOffset: offset,
        endOffset,
        baseTurnIndex: 2,
      }),
    ).resolves.toEqual({
      totalTurns: 2,
      recentTurns: [
        expect.objectContaining({ absoluteIndex: 3, content: "new-1" }),
        expect.objectContaining({ absoluteIndex: 4, content: "new-2" }),
      ],
      startOffset: offset,
      endOffset,
    });
  });

  it("falls back to a full scan when the requested start is mid-line", async () => {
    const eventsPath = writeEventsFile([
      { type: "user.message", data: { content: "first" } },
      { type: "user.message", data: { content: "second" } },
    ]);
    writeFileSync(eventsPath, "\n", { flag: "a" });
    const size = statSync(eventsPath).size;

    const result = await scanUserMessageTurns(eventsPath, {
      maxTurns: 2,
      startOffset: 10,
      endOffset: size,
      baseTurnIndex: 20,
    });

    expect(result).toEqual({
      totalTurns: 2,
      recentTurns: [
        expect.objectContaining({ absoluteIndex: 1, content: "first" }),
        expect.objectContaining({ absoluteIndex: 2, content: "second" }),
      ],
      startOffset: 0,
      endOffset: size,
    });
  });
});

describe("summarizeSession", () => {
  it("disconnects and deletes its ephemeral SDK helper session", async () => {
    const helperSessionId = `summary-helper-${Date.now()}`;
    const disconnect = vi.fn(async () => {});
    const deleteSession = vi.fn(async () => {});
    const createSession = vi.fn(async (config: {
      createSessionFsHandler: (session: { sessionId: string }) => unknown;
    }) => {
      config.createSessionFsHandler({ sessionId: helperSessionId });
      return {
        sessionId: helperSessionId,
        sendAndWait: vi.fn(async () => ({ data: { content: "First sentence. Second sentence." } })),
        disconnect,
      };
    });

    const result = await summarizeSession({
      turns: [{ index: 1, absoluteIndex: 1, content: "Investigate memory growth." }],
      model: "test-model",
      client: { createSession, deleteSession },
    });

    expect(result.summary).toBe("First sentence. Second sentence.");
    expect(disconnect).toHaveBeenCalledOnce();
    expect(deleteSession).toHaveBeenCalledWith(helperSessionId);
  });
});

describe("computeEventsFingerprint", () => {
  it("changes when the file is appended to", async () => {
    const eventsPath = writeEventsFile([
      { type: "user.message", data: { content: "a" } },
    ]);
    const before = computeEventsFingerprint(eventsPath);
    expect(before).not.toBeNull();

    writeFileSync(eventsPath, "\n", { flag: "a" });
    writeFileSync(
      eventsPath,
      `${JSON.stringify({ type: "user.message", data: { content: "b" } })}\n`,
      { flag: "a" },
    );

    const after = computeEventsFingerprint(eventsPath);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("returns null for missing files", () => {
    expect(computeEventsFingerprint("/definitely/does/not/exist.jsonl")).toBeNull();
  });
});
