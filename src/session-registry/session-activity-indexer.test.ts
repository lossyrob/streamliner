import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "../session-registry-contract";
import { DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE } from "../session-registry-schema";
import { indexSessionActivity } from "./session-activity-indexer";

const createdDirs: string[] = [];

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-session-activity-"));
  createdDirs.push(root);
  return root;
}

function buildSession(overrides: Partial<SessionRegistryListItem> = {}): SessionRegistryListItem {
  return {
    id: "activity-session",
    version: 0,
    title: "Activity session",
    titleSource: "auto",
    description: "",
    lifecycleStatus: "active",
    lastSeenAt: "2026-04-26T15:00:00.000Z",
    updatedAt: "2026-04-26T15:00:00.000Z",
    color: null,
    cwd: process.cwd(),
    repo: "lossyrob/streamliner",
    branch: "feature/manual-session-registry",
    tags: [],
    originKind: "observed",
    graphBinding: null,
    copilotSessionId: "activity-session",
    aiSummary: null,
    aiSummaryModel: null,
    aiSummaryUpdatedAt: null,
    aiSummaryEventsFingerprint: null,
    aiSummaryStatus: "missing",
    aiSummaryError: null,
    observedSessionKind: "interactive",
    copilotProcessState: "live",
    copilotProcessId: null,
    activityStatus: "unknown",
    activityStatusUpdatedAt: null,
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    trustedSignalSource: "copilot-cli-hook",
    trustedStartedAt: "2026-04-26T15:00:00.000Z",
    trustedEndedAt: null,
    trustedLastSignalAt: "2026-04-26T15:00:00.000Z",
    trustedStartSource: "resume",
    trustedEndReason: null,
    trustedExecutionKind: "copilot_cli",
    trustedInitialPromptLength: null,
    trustedLastPromptLength: null,
    derivedWorktreePath: null,
    derivedBranch: null,
    derivedGithubRefs: [],
    derivedContextUpdatedAt: null,
    derivedContextEventsOffset: 0,
    derivedContextEventsSize: 0,
    derivedContextEventsMtimeMs: null,
    ...overrides,
  };
}

function writeEvents(lines: Array<Record<string, unknown>>): string {
  const root = createRootDir();
  const eventsPath = join(root, "events.jsonl");
  writeFileSync(eventsPath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
  return eventsPath;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("indexSessionActivity", () => {
  it("marks sessions as working when the latest turn event is active", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_end", timestamp: "2026-04-26T15:01:00.000Z" },
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
      { type: "tool.execution_start", timestamp: "2026-04-26T15:02:05.000Z" },
    ]);

    expect(indexSessionActivity(buildSession(), eventsPath)).toEqual(
      expect.objectContaining({
        activityStatus: "working",
        activityStatusUpdatedAt: "2026-04-26T15:02:05.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "tool_execution_start",
          confidence: "high",
          pendingInputRequest: false,
          lastActivityEventAt: "2026-04-26T15:02:05.000Z",
          assistantTurnCount: 1,
        }),
      }),
    );
  });

  it("does not emit another patch when only the scan time changes", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
      { type: "tool.execution_start", timestamp: "2026-04-26T15:02:05.000Z" },
    ]);

    const firstPatch = indexSessionActivity(buildSession(), eventsPath, {
      now: () => new Date("2026-04-26T15:08:00.000Z"),
    });
    if (!firstPatch) {
      throw new Error("expected first activity patch");
    }

    expect(
      indexSessionActivity(buildSession(firstPatch), eventsPath, {
        now: () => new Date("2026-04-26T15:09:00.000Z"),
      }),
    ).toBeNull();
  });

  it("does not emit another patch when only scan metadata changes", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
      { type: "assistant.turn_end", timestamp: "2026-04-26T15:04:00.000Z" },
    ]);

    const firstPatch = indexSessionActivity(buildSession(), eventsPath, {
      now: () => new Date("2026-04-26T15:08:00.000Z"),
    });
    if (!firstPatch) {
      throw new Error("expected first activity patch");
    }
    appendFileSync(
      eventsPath,
      `\n${JSON.stringify({ type: "hook.start", timestamp: "2026-04-26T15:05:00.000Z" })}`,
      "utf8",
    );

    expect(
      indexSessionActivity(buildSession(firstPatch), eventsPath, {
        now: () => new Date("2026-04-26T15:09:00.000Z"),
      }),
    ).toBeNull();
  });

  it("marks sessions as waiting when the assistant turn ended", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
      { type: "assistant.turn_end", timestamp: "2026-04-26T15:04:00.000Z" },
    ]);

    expect(indexSessionActivity(buildSession(), eventsPath)).toEqual(
      expect.objectContaining({
        activityStatus: "waiting_for_input",
        activityStatusUpdatedAt: "2026-04-26T15:04:00.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "assistant_turn_end",
          confidence: "high",
          lastAssistantTurnEndedAt: "2026-04-26T15:04:00.000Z",
        }),
      }),
    );
  });

  it("marks sessions as waiting after a user-requested shell command completes", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_end", timestamp: "2026-04-26T15:04:00.000Z" },
      {
        type: "tool.user_requested",
        timestamp: "2026-04-26T15:05:00.000Z",
        data: {
          toolCallId: "shell-1",
          toolName: "shell",
        },
      },
      {
        type: "tool.execution_complete",
        timestamp: "2026-04-26T15:05:03.000Z",
        data: {
          toolCallId: "shell-1",
          isUserRequested: true,
          success: true,
        },
      },
    ]);

    expect(indexSessionActivity(buildSession(), eventsPath)).toEqual(
      expect.objectContaining({
        activityStatus: "waiting_for_input",
        activityStatusUpdatedAt: "2026-04-26T15:05:03.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "user_requested_tool_complete",
          confidence: "high",
          lastActivityEventAt: "2026-04-26T15:05:03.000Z",
        }),
      }),
    );
  });

  it("marks unresolved ask_user requests as pending input evidence", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
      {
        type: "assistant.message",
        timestamp: "2026-04-26T15:03:00.000Z",
        data: {
          toolRequests: [
            {
              id: "ask-1",
              name: "ask_user",
            },
          ],
        },
      },
    ]);

    expect(indexSessionActivity(buildSession(), eventsPath)).toEqual(
      expect.objectContaining({
        activityStatus: "waiting_for_input",
        activityStatusUpdatedAt: "2026-04-26T15:03:00.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "pending_input",
          confidence: "high",
          pendingInputRequest: true,
          pendingInputRequestCount: 1,
          lastActivityEventAt: "2026-04-26T15:03:00.000Z",
        }),
      }),
    );
  });

  it("clears anonymous ask_user requests on named ask_user tool completion", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
      {
        type: "assistant.message",
        timestamp: "2026-04-26T15:03:00.000Z",
        data: {
          toolRequests: [
            {
              name: "ask_user",
            },
          ],
        },
      },
      {
        type: "tool.execution_complete",
        timestamp: "2026-04-26T15:04:00.000Z",
        data: {
          toolName: "ask_user",
          success: true,
        },
      },
    ]);

    expect(indexSessionActivity(buildSession(), eventsPath)).toEqual(
      expect.objectContaining({
        activityStatus: "working",
        activityStatusUpdatedAt: "2026-04-26T15:04:00.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "tool_execution_complete",
          pendingInputRequest: false,
          pendingInputRequestCount: 0,
          lastActivityEventAt: "2026-04-26T15:04:00.000Z",
        }),
      }),
    );
  });

  it("keeps anonymous ask_user requests pending on unidentified tool completion", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
      {
        type: "assistant.message",
        timestamp: "2026-04-26T15:03:00.000Z",
        data: {
          toolRequests: [
            {
              name: "ask_user",
            },
          ],
        },
      },
      {
        type: "tool.execution_complete",
        timestamp: "2026-04-26T15:04:00.000Z",
        data: {
          success: true,
        },
      },
    ]);

    expect(indexSessionActivity(buildSession(), eventsPath)).toEqual(
      expect.objectContaining({
        activityStatus: "waiting_for_input",
        activityStatusUpdatedAt: "2026-04-26T15:03:00.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "pending_input",
          pendingInputRequest: true,
          pendingInputRequestCount: 1,
          lastActivityEventAt: "2026-04-26T15:03:00.000Z",
        }),
      }),
    );
  });

  it("ignores hook bookkeeping after assistant turn end", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
      { type: "assistant.message", timestamp: "2026-04-26T15:03:30.000Z" },
      { type: "assistant.turn_end", timestamp: "2026-04-26T15:04:00.000Z" },
      { type: "hook.start", timestamp: "2026-04-26T15:04:01.000Z" },
      { type: "hook.end", timestamp: "2026-04-26T15:04:03.000Z" },
    ]);

    expect(indexSessionActivity(buildSession(), eventsPath)).toEqual(
      expect.objectContaining({
        activityStatus: "waiting_for_input",
        activityStatusUpdatedAt: "2026-04-26T15:04:00.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "assistant_turn_end",
          confidence: "high",
        }),
      }),
    );
  });

  it("marks trusted sessions as interrupted when their live process is gone", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
    ]);

    expect(
      indexSessionActivity(
        buildSession({ copilotProcessState: "live", copilotProcessId: 12345 }),
        eventsPath,
        {
          now: () => new Date("2026-04-26T15:05:00.000Z"),
          processExists: () => false,
        },
      ),
    ).toEqual(
      expect.objectContaining({
        copilotProcessState: "none",
        copilotProcessId: null,
        activityStatus: "interrupted",
        activityStatusUpdatedAt: "2026-04-26T15:05:00.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "process_interrupted",
          confidence: "high",
        }),
      }),
    );
  });

  it("does not refresh interrupted evidence on later polls", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
    ]);

    const firstPatch = indexSessionActivity(
      buildSession({ copilotProcessState: "live", copilotProcessId: 12345 }),
      eventsPath,
      {
        now: () => new Date("2026-04-26T15:05:00.000Z"),
        processExists: () => false,
      },
    );
    if (!firstPatch) {
      throw new Error("expected first interrupted patch");
    }

    expect(
      indexSessionActivity(
        buildSession({
          ...firstPatch,
          copilotProcessState: "none",
          copilotProcessId: null,
        }),
        eventsPath,
        {
          now: () => new Date("2026-04-26T15:06:00.000Z"),
          processExists: () => false,
        },
      ),
    ).toBeNull();
  });

  it("marks ended sessions as exited", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
    ]);

    expect(
      indexSessionActivity(
        buildSession({
          lifecycleStatus: "ended",
          trustedEndedAt: "2026-04-26T15:06:00.000Z",
        }),
        eventsPath,
      ),
    ).toEqual(
      expect.objectContaining({
        activityStatus: "exited",
        activityStatusUpdatedAt: "2026-04-26T15:06:00.000Z",
        activityEvidence: expect.objectContaining({
          statusReason: "trusted_end",
          confidence: "high",
        }),
      }),
    );
  });

  it("surfaces low-confidence diagnostics when the event log is missing", () => {
    const root = createRootDir();
    const missingEventsPath = join(root, "missing-events.jsonl");

    const patch = indexSessionActivity(buildSession(), missingEventsPath, {
      now: () => new Date("2026-04-26T15:07:00.000Z"),
    });

    expect(patch).toEqual({
      activityEvidence: expect.objectContaining({
        statusReason: "events_missing",
        confidence: "low",
        diagnostics: ["events_missing"],
        eventsScannedAt: "2026-04-26T15:07:00.000Z",
      }),
    });
  });
});
