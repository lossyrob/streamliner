import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "../session-registry-contract";
import { DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE } from "../session-registry-schema";
import { indexSessionContext } from "./session-context-indexer";

const createdDirs: string[] = [];

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-session-context-"));
  createdDirs.push(root);
  return root;
}

function runGitSetup(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `git ${args.join(" ")} failed`,
        `status=${String(result.status)}`,
        `error=${result.error?.message ?? ""}`,
        `stderr=${result.stderr.trim()}`,
      ].join("; "),
    );
  }
}

function buildSession(overrides: Partial<SessionRegistryListItem> = {}): SessionRegistryListItem {
  return {
    id: "context-session",
    version: 0,
    title: "Context session",
    titleSource: "auto",
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
    activityStatus: "unknown",
    activityStatusUpdatedAt: null,
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
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
    const unchanged = indexSessionContext(
      buildSession({
        ...patch,
        derivedGithubRefs: patch?.derivedGithubRefs ?? [],
      }),
      eventsPath,
    );
    expect(unchanged).toBeNull();
  });

  it("advances past oversized records without pinning the cursor", () => {
    const root = createRootDir();
    const eventsPath = join(root, "events.jsonl");
    writeFileSync(
      eventsPath,
      [
        "x".repeat(256),
        JSON.stringify({
          type: "tool.execution",
          timestamp: "2026-04-25T20:10:00.000Z",
          data: { command: "gh pr view 14" },
        }),
      ].join("\n"),
      "utf8",
    );

    let session = buildSession();
    let iterations = 0;
    while (iterations < 10 && session.derivedGithubRefs.length === 0) {
      const patch = indexSessionContext(session, eventsPath, {
        maxBytesPerCycle: 128,
        now: () => new Date("2026-04-25T20:11:00.000Z"),
      });
      expect(patch?.derivedContextEventsOffset).toBeGreaterThan(
        session.derivedContextEventsOffset,
      );
      session = {
        ...session,
        ...patch,
        derivedGithubRefs: patch?.derivedGithubRefs ?? session.derivedGithubRefs,
      };
      iterations += 1;
    }

    expect(session.derivedGithubRefs).toEqual([
      expect.objectContaining({
        type: "pr",
        repo: "lossyrob/streamliner",
        number: 14,
      }),
    ]);
  });

  it("resolves git context from file paths mentioned in events", () => {
    const root = createRootDir();
    const repo = join(root, "repo");
    const nestedDir = join(repo, "src", "session-registry");
    const editedFile = join(nestedDir, "context.ts");
    const eventsPath = join(root, "events.jsonl");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(editedFile, "export const context = true;\n", "utf8");
    runGitSetup(repo, ["init", "-b", "context-test"]);
    runGitSetup(repo, ["remote", "add", "origin", "https://github.com/lossyrob/streamliner.git"]);
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
    expect(patch?.repo).toBe("lossyrob/streamliner");
    expect(patch?.branch).toBe("context-test");
    expect(patch?.derivedBranch).toBe("context-test");
  });

  it("backfills missing repo from git even when the event cursor is unchanged", () => {
    const root = createRootDir();
    const repo = join(root, "repo");
    const eventsPath = join(root, "events.jsonl");
    mkdirSync(repo, { recursive: true });
    writeFileSync(eventsPath, "", "utf8");
    runGitSetup(repo, ["init", "-b", "main"]);
    runGitSetup(repo, ["remote", "add", "origin", "git@github.com:lossyrob/streamliner.git"]);
    const stat = statSync(eventsPath);

    const patch = indexSessionContext(
      buildSession({
        cwd: repo,
        repo: null,
        branch: null,
        derivedWorktreePath: repo,
        derivedContextEventsOffset: stat.size,
        derivedContextEventsSize: stat.size,
        derivedContextEventsMtimeMs: stat.mtimeMs,
      }),
      eventsPath,
    );

    expect(patch).toEqual(
      expect.objectContaining({
        repo: "lossyrob/streamliner",
        branch: "main",
        derivedBranch: "main",
      }),
    );
  });

  it("backfills missing repo from username-prefixed GitHub HTTPS remotes", () => {
    const root = createRootDir();
    const repo = join(root, "repo");
    const eventsPath = join(root, "events.jsonl");
    mkdirSync(repo, { recursive: true });
    writeFileSync(eventsPath, "", "utf8");
    runGitSetup(repo, ["init", "-b", "main"]);
    runGitSetup(repo, [
      "remote",
      "add",
      "origin",
      "https://robemanuele_microsoft@github.com/azure-data-database-platform/dbagent.git",
    ]);
    const stat = statSync(eventsPath);

    const patch = indexSessionContext(
      buildSession({
        cwd: repo,
        repo: null,
        branch: "main",
        derivedWorktreePath: repo,
        derivedContextEventsOffset: stat.size,
        derivedContextEventsSize: stat.size,
        derivedContextEventsMtimeMs: stat.mtimeMs,
      }),
      eventsPath,
    );

    expect(patch).toEqual(
      expect.objectContaining({
        repo: "azure-data-database-platform/dbagent",
        branch: "main",
        derivedBranch: "main",
      }),
    );
  });

  it("skips unchanged logs with missing repo when no git worktree was derived", () => {
    const root = createRootDir();
    const nonGitDir = join(root, "not-a-repo");
    const eventsPath = join(root, "events.jsonl");
    mkdirSync(nonGitDir, { recursive: true });
    writeFileSync(eventsPath, "", "utf8");
    const stat = statSync(eventsPath);

    const patch = indexSessionContext(
      buildSession({
        cwd: nonGitDir,
        repo: null,
        branch: null,
        derivedWorktreePath: null,
        derivedContextEventsOffset: stat.size,
        derivedContextEventsSize: stat.size,
        derivedContextEventsMtimeMs: stat.mtimeMs,
      }),
      eventsPath,
    );

    expect(patch).toBeNull();
  });
});
