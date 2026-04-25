import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetCopilotDiscoveryCacheForTests } from "./copilot-session-discovery";
import { SessionRegistryFileStore } from "./file-store";
import { SessionRegistryBackgroundWorker } from "./background-worker";
import { writeTrustedSessionSignalSpoolFile } from "./trusted-session-signals";

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
  it("drains trusted signal spool files before discovery and summarization", async () => {
    const registryRoot = createRootDir("streamliner-session-worker-registry-");
    const sessionRoot = createRootDir("streamliner-session-worker-state-");
    const signalRoot = createRootDir("streamliner-session-worker-signals-");

    writeSessionStateFiles(
      sessionRoot,
      "trusted-spooled-session",
      [
        "id: trusted-spooled-session",
        "cwd: C:\\repo",
        "repository: lossyrob/streamliner",
        "branch: feature/manual-session-registry",
        "summary: Trusted hook session",
        "updated_at: 2026-04-24T20:01:00.000Z",
      ],
      [
        {
          type: "user.message",
          data: { content: "Use trusted hook events to track this session." },
          timestamp: "2026-04-24T20:01:00.000Z",
        },
      ],
    );
    writeTrustedSessionSignalSpoolFile(
      {
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: "trusted-spooled-session",
        timestamp: "2026-04-24T20:00:00.000Z",
        cwd: "C:\\repo",
        repo: "lossyrob/streamliner",
        branch: "feature/manual-session-registry",
        hookSource: "new",
        executionKind: "copilot_cli",
      },
      {
        rootDir: signalRoot,
        now: () => new Date("2026-04-24T20:00:01.000Z"),
      },
    );

    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    const summarizeSession = vi.fn(async () => ({
      summary: "Tracking a trusted hook session",
      model: "test-model",
      durationMs: 1,
      rawContent: "Tracking a trusted hook session",
    }));
    const worker = new SessionRegistryBackgroundWorker(store, {
      sessionRoot,
      signalSpoolRoot: signalRoot,
      summarizer: { summarizeSession },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await worker.runCycle();

    expect(store.getSession("trusted-spooled-session")).toEqual(
      expect.objectContaining({
        aiSummary: "Tracking a trusted hook session",
        trustedSignalSource: "copilot-cli-hook",
        trustedStartedAt: "2026-04-24T20:00:00.000Z",
        trustedStartSource: "new",
      }),
    );
  });

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

  it("waits for five more user turns before refreshing a ready summary", async () => {
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

    const appendUserTurn = (content: string, timestamp: string) => {
      writeFileSync(
        join(sessionDir, "events.jsonl"),
        `\n${JSON.stringify({
          type: "user.message",
          data: { content },
          timestamp,
        })}`,
        { flag: "a" },
      );
    };

    appendUserTurn("Second summary input", "2026-04-23T18:31:00.000Z");
    appendUserTurn("Third summary input", "2026-04-23T18:32:00.000Z");
    appendUserTurn("Fourth summary input", "2026-04-23T18:33:00.000Z");
    appendUserTurn("Fifth summary input", "2026-04-23T18:34:00.000Z");

    await worker.runCycle();

    const skippedRecord = store.getSession("session-3");
    expect(skippedRecord).toEqual(
      expect.objectContaining({
        aiSummary: "First pass summary",
        aiSummaryStatus: "ready",
      }),
    );
    expect(skippedRecord?.aiSummaryEventsFingerprint).not.toBe(firstFingerprint);
    expect(summarizeSession).toHaveBeenCalledTimes(1);

    appendUserTurn("Sixth summary input", "2026-04-23T18:35:00.000Z");

    await worker.runCycle();

    const secondRecord = store.getSession("session-3");
    expect(secondRecord).toEqual(
      expect.objectContaining({
        aiSummary: "Second pass summary",
        aiSummaryStatus: "ready",
      }),
    );
    expect(summarizeSession).toHaveBeenCalledTimes(2);
  });
});
