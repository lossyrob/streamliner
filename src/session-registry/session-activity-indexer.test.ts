import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "../session-registry-contract";
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

    expect(indexSessionActivity(buildSession(), eventsPath)).toEqual({
      activityStatus: "working",
      activityStatusUpdatedAt: "2026-04-26T15:02:05.000Z",
    });
  });

  it("marks sessions as waiting when the assistant turn ended", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
      { type: "assistant.turn_end", timestamp: "2026-04-26T15:04:00.000Z" },
    ]);

    expect(indexSessionActivity(buildSession(), eventsPath)).toEqual({
      activityStatus: "waiting_for_input",
      activityStatusUpdatedAt: "2026-04-26T15:04:00.000Z",
    });
  });

  it("ignores hook bookkeeping after assistant turn end", () => {
    const eventsPath = writeEvents([
      { type: "assistant.turn_start", timestamp: "2026-04-26T15:02:00.000Z" },
      { type: "assistant.message", timestamp: "2026-04-26T15:03:30.000Z" },
      { type: "assistant.turn_end", timestamp: "2026-04-26T15:04:00.000Z" },
      { type: "hook.start", timestamp: "2026-04-26T15:04:01.000Z" },
      { type: "hook.end", timestamp: "2026-04-26T15:04:03.000Z" },
    ]);

    expect(indexSessionActivity(buildSession(), eventsPath)).toEqual({
      activityStatus: "waiting_for_input",
      activityStatusUpdatedAt: "2026-04-26T15:04:00.000Z",
    });
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
    ).toEqual({
      copilotProcessState: "none",
      copilotProcessId: null,
      activityStatus: "interrupted",
      activityStatusUpdatedAt: "2026-04-26T15:05:00.000Z",
    });
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
    ).toEqual({
      activityStatus: "exited",
      activityStatusUpdatedAt: "2026-04-26T15:06:00.000Z",
    });
  });
});
