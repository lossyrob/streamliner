import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetCopilotDiscoveryCacheForTests } from "./copilot-session-discovery";
import { SessionRegistryFileStore } from "./file-store";
import { SessionRegistryBackgroundWorker } from "./background-worker";

const createdRoots: string[] = [];

function createRootDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

function writeSessionStateFiles(
  sessionRoot: string,
  sessionId: string,
  workspaceLines: string[],
  eventLines: Array<Record<string, unknown>>,
): void {
  const sessionDir = join(sessionRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, "workspace.yaml"), workspaceLines.join("\n"), "utf8");
  writeFileSync(
    join(sessionDir, "events.jsonl"),
    eventLines.map((line) => JSON.stringify(line)).join("\n"),
    "utf8",
  );
}

afterEach(() => {
  __resetCopilotDiscoveryCacheForTests();
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SessionRegistryBackgroundWorker", () => {
  it("discovers observed sessions, generates summaries, and skips unchanged fingerprints", async () => {
    const registryRoot = createRootDir("streamliner-session-worker-registry-");
    const sessionRoot = createRootDir("streamliner-session-worker-state-");

    writeSessionStateFiles(
      sessionRoot,
      "session-1",
      [
        "id: session-1",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: feature/manual-session-registry",
        "summary: Follow Paw-Lite Process",
        "updated_at: 2026-04-23T18:28:32.345Z",
      ],
      [
        { type: "assistant.turn_start" },
        {
          type: "user.message",
          data: { content: "Add a persistent worker that summarizes sessions." },
          timestamp: "2026-04-23T18:29:00.000Z",
        },
      ],
    );

    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    const summarizeSession = vi.fn(async () => ({
      summary: "Adding a persistent session worker",
      model: "test-model",
      durationMs: 12,
      rawContent: "Adding a persistent session worker",
    }));

    const worker = new SessionRegistryBackgroundWorker(store, {
      sessionRoot,
      now: () => new Date("2026-04-23T19:00:00.000Z"),
      summarizer: { summarizeSession },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await worker.runCycle();

    const firstRecord = store.getSession("session-1");
    expect(firstRecord).toEqual(
      expect.objectContaining({
        aiSummary: "Adding a persistent session worker",
        aiSummaryModel: "test-model",
        aiSummaryUpdatedAt: "2026-04-23T19:00:00.000Z",
        aiSummaryStatus: "ready",
      }),
    );
    const updatedAtAfterFirstCycle = firstRecord?.updatedAt;

    await worker.runCycle();

    const secondRecord = store.getSession("session-1");
    expect(secondRecord?.updatedAt).toBe(updatedAtAfterFirstCycle);
    expect(summarizeSession).toHaveBeenCalledTimes(1);
  });

  it("marks summaries as missing when the event log has no recent user turns", async () => {
    const registryRoot = createRootDir("streamliner-session-worker-registry-");
    const sessionRoot = createRootDir("streamliner-session-worker-state-");

    writeSessionStateFiles(
      sessionRoot,
      "session-2",
      [
        "id: session-2",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: feature/manual-session-registry",
        "summary: Follow Paw-Lite Process",
        "updated_at: 2026-04-23T18:28:32.345Z",
      ],
      [{ type: "assistant.message", data: { content: "No user turns here." } }],
    );

    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    const summarizeSession = vi.fn();
    const worker = new SessionRegistryBackgroundWorker(store, {
      sessionRoot,
      summarizer: { summarizeSession },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await worker.runCycle();

    const record = store.getSession("session-2");
    expect(record).toEqual(
      expect.objectContaining({
        aiSummary: null,
        aiSummaryModel: null,
        aiSummaryStatus: "missing",
      }),
    );
    expect(summarizeSession).not.toHaveBeenCalled();
  });

  it("re-summarizes when events.jsonl changes", async () => {
    const registryRoot = createRootDir("streamliner-session-worker-registry-");
    const sessionRoot = createRootDir("streamliner-session-worker-state-");
    const sessionDir = join(sessionRoot, "session-3");

    writeSessionStateFiles(
      sessionRoot,
      "session-3",
      [
        "id: session-3",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: feature/manual-session-registry",
        "summary: Follow Paw-Lite Process",
        "updated_at: 2026-04-23T18:28:32.345Z",
      ],
      [
        {
          type: "user.message",
          data: { content: "First summary input" },
          timestamp: "2026-04-23T18:29:00.000Z",
        },
      ],
    );

    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    const summarizeSession = vi
      .fn()
      .mockResolvedValueOnce({
        summary: "First pass summary",
        model: "test-model",
        durationMs: 1,
        rawContent: "First pass summary",
      })
      .mockResolvedValueOnce({
        summary: "Second pass summary",
        model: "test-model",
        durationMs: 1,
        rawContent: "Second pass summary",
      });

    const worker = new SessionRegistryBackgroundWorker(store, {
      sessionRoot,
      summarizer: { summarizeSession },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await worker.runCycle();
    const firstFingerprint = store.getSession("session-3")?.aiSummaryEventsFingerprint;

    writeFileSync(
      join(sessionDir, "events.jsonl"),
      `${readFileSync(join(sessionDir, "events.jsonl"), "utf8")}\n${JSON.stringify({
        type: "user.message",
        data: { content: "Second summary input" },
        timestamp: "2026-04-23T18:31:00.000Z",
      })}`,
      "utf8",
    );

    await worker.runCycle();

    const secondRecord = store.getSession("session-3");
    expect(secondRecord).toEqual(
      expect.objectContaining({
        aiSummary: "Second pass summary",
        aiSummaryStatus: "ready",
      }),
    );
    expect(secondRecord?.aiSummaryEventsFingerprint).not.toBe(firstFingerprint);
    expect(summarizeSession).toHaveBeenCalledTimes(2);
  });
});
