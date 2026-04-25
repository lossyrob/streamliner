import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "../session-registry-contract";
import { indexSessionContext } from "./session-context-indexer";

const createdDirs: string[] = [];

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-session-context-"));
  createdDirs.push(root);
  return root;
}

function buildSession(overrides: Partial<SessionRegistryListItem> = {}): SessionRegistryListItem {
  return {
    id: "context-session",
    title: "Context session",
    description: "",
    lifecycleStatus: "active",
    lastSeenAt: "2026-04-25T20:00:00.000Z",
    updatedAt: "2026-04-25T20:00:00.000Z",
    color: null,
    cwd: process.cwd(),
    repo: "lossyrob/streamliner",
    branch: "main",
    tags: [],
    originKind: "observed",
    graphBinding: null,
    copilotSessionId: "context-session",
    aiSummary: null,
    aiSummaryModel: null,
    aiSummaryUpdatedAt: null,
    aiSummaryEventsFingerprint: null,
    aiSummaryStatus: "missing",
    aiSummaryError: null,
    observedSessionKind: "interactive",
    copilotProcessState: "live",
    copilotProcessId: null,
    trustedSignalSource: "copilot-cli-hook",
    trustedStartedAt: "2026-04-25T20:00:00.000Z",
    trustedEndedAt: null,
    trustedLastSignalAt: "2026-04-25T20:00:00.000Z",
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

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("indexSessionContext", () => {
  it("extracts GitHub refs and advances the events cursor incrementally", () => {
    const root = createRootDir();
    const eventsPath = join(root, "events.jsonl");
    writeFileSync(
      eventsPath,
      [
        JSON.stringify({
          type: "user.message",
          timestamp: "2026-04-25T20:01:00.000Z",
          data: {
            content:
              "Let's keep working on https://github.com/lossyrob/streamliner/issues/13.",
          },
        }),
        JSON.stringify({
          type: "tool.execution",
          timestamp: "2026-04-25T20:02:00.000Z",
          data: { command: "gh pr view 14" },
        }),
        JSON.stringify({
          tool_start_name: "github-mcp-server-pull_request_read",
          timestamp: "2026-04-25T20:03:00.000Z",
          arguments_json:
            '{"owner":"lossyrob","repo":"streamliner","pullNumber":14}',
        }),
      ].join("\n"),
      "utf8",
    );

    const patch = indexSessionContext(buildSession(), eventsPath, {
      now: () => new Date("2026-04-25T20:04:00.000Z"),
    });

    expect(patch).toEqual(
      expect.objectContaining({
        derivedContextUpdatedAt: "2026-04-25T20:04:00.000Z",
        derivedContextEventsOffset: expect.any(Number),
        derivedContextEventsSize: expect.any(Number),
      }),
    );
    expect(patch?.derivedGithubRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "issue", repo: "lossyrob/streamliner", number: 13 }),
        expect.objectContaining({ type: "pr", repo: "lossyrob/streamliner", number: 14 }),
      ]),
    );
    expect(patch?.derivedWorktreePath).toBeTruthy();

    const unchanged = indexSessionContext(
      buildSession({
        ...patch,
        derivedGithubRefs: patch?.derivedGithubRefs ?? [],
      }),
      eventsPath,
    );
    expect(unchanged).toBeNull();
  });

  it("resolves git context from file paths mentioned in events", () => {
    const root = createRootDir();
    const repo = join(root, "repo");
    const nestedDir = join(repo, "src", "session-registry");
    const editedFile = join(nestedDir, "context.ts");
    const eventsPath = join(root, "events.jsonl");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(editedFile, "export const context = true;\n", "utf8");
    spawnSync("git", ["init", "-b", "context-test"], { cwd: repo, windowsHide: true });
    writeFileSync(
      eventsPath,
      JSON.stringify({
        type: "tool.execution",
        timestamp: "2026-04-25T20:05:00.000Z",
        data: { command: `Edited ${editedFile}` },
      }),
      "utf8",
    );

    const patch = indexSessionContext(
      buildSession({ cwd: root, repo: null, branch: null }),
      eventsPath,
    );

    expect(
      realpathSync.native(patch?.derivedWorktreePath ?? "").replace(/\\/g, "/"),
    ).toBe(realpathSync.native(repo).replace(/\\/g, "/"));
    expect(patch?.derivedBranch).toBe("context-test");
  });
});
