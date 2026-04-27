import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  computeEventsFingerprint,
  countUserMessageTurns,
  extractRecentUserTurns,
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
