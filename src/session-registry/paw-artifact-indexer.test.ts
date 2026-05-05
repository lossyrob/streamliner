import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "../session-registry-contract";
import { DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE } from "../session-registry-schema";
import { indexPawWorkflow } from "./paw-artifact-indexer";

const createdRoots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-paw-artifacts-"));
  createdRoots.push(root);
  return root;
}

function writeFile(path: string, content: string, mtime: Date): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  utimesSync(path, mtime, mtime);
}

function buildSession(overrides: Partial<SessionRegistryListItem> = {}): SessionRegistryListItem {
  return {
    id: "session-1",
    version: 0,
    title: "PAW session",
    titleSource: "auto",
    description: "",
    lifecycleStatus: "active",
    lastSeenAt: null,
    updatedAt: "2026-05-05T13:00:00.000Z",
    color: null,
    cwd: "C:\\repo",
    repo: "lossyrob/streamliner",
    branch: "feature/paw",
    copilotSessionId: "copilot-session-1",
    tags: [],
    originKind: "observed",
    graphBinding: null,
    aiSummary: null,
    aiSummaryModel: null,
    aiSummaryUpdatedAt: null,
    aiSummaryEventsFingerprint: null,
    aiSummaryStatus: "missing",
    aiSummaryError: null,
    observedSessionKind: "interactive",
    copilotProcessState: null,
    copilotProcessId: null,
    activityStatus: "unknown",
    activityStatusUpdatedAt: null,
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    pawWorkflow: null,
    trustedSignalSource: null,
    trustedStartedAt: null,
    trustedEndedAt: null,
    trustedLastSignalAt: null,
    trustedStartSource: null,
    trustedEndReason: null,
    trustedExecutionKind: null,
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
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("indexPawWorkflow", () => {
  it("derives workflow identity and stage from artifacts, not Control State", () => {
    const root = createRoot();
    const workDir = join(root, ".paw", "work", "artifact-observation");
    writeFile(
      join(workDir, "WorkflowContext.md"),
      [
        "Work Title: Artifact Observation",
        "Work ID: artifact-observation",
        "Workflow Identity: paw-lite",
        "",
        "## Control State",
        "- `final-pr` | `resolved` | `activity`",
      ].join("\n"),
      new Date("2026-05-05T13:00:00.000Z"),
    );
    writeFile(
      join(workDir, "Plan.md"),
      "# Plan\n",
      new Date("2026-05-05T13:01:00.000Z"),
    );
    writeFile(
      join(workDir, "implementation", "phase-1.md"),
      "# Implementation evidence\n",
      new Date("2026-05-05T13:02:00.000Z"),
    );

    const patch = indexPawWorkflow(buildSession(), {
      expectedWorkDir: workDir,
      now: () => new Date("2026-05-05T13:05:00.000Z"),
    });

    expect(patch?.pawWorkflow).toEqual(
      expect.objectContaining({
        status: "recognized",
        stage: "implementation",
        workflowKind: "paw-lite",
        workId: "artifact-observation",
        workTitle: "Artifact Observation",
        workDir,
        latestArtifactPath: "implementation/phase-1.md",
        scannedAt: "2026-05-05T13:05:00.000Z",
        diagnostics: [],
      }),
    );
    expect(patch?.pawWorkflow?.artifacts.map((artifact) => artifact.path).sort()).toEqual([
      "Plan.md",
      "WorkflowContext.md",
      "implementation/phase-1.md",
    ]);
  });

  it("reports an explicit missing PAW work directory as unavailable", () => {
    const workDir = join(createRoot(), ".paw", "work", "missing");

    const patch = indexPawWorkflow(buildSession(), {
      expectedWorkDir: workDir,
      now: () => new Date("2026-05-05T13:05:00.000Z"),
    });

    expect(patch?.pawWorkflow).toEqual(
      expect.objectContaining({
        status: "unavailable",
        stage: null,
        workDir,
        artifactCount: 0,
        diagnostics: ["paw_workdir_unavailable"],
      }),
    );
  });

  it("reports ambiguous fallback discovery instead of choosing a work directory", () => {
    const root = createRoot();
    const repo = join(root, "repo");
    mkdirSync(join(repo, ".paw", "work", "one"), { recursive: true });
    mkdirSync(join(repo, ".paw", "work", "two"), { recursive: true });

    const patch = indexPawWorkflow(buildSession({ cwd: join(repo, "src") }), {
      now: () => new Date("2026-05-05T13:05:00.000Z"),
    });

    expect(patch?.pawWorkflow).toEqual(
      expect.objectContaining({
        status: "ambiguous",
        stage: null,
        workDir: null,
        candidateWorkDirs: [
          join(repo, ".paw", "work", "one"),
          join(repo, ".paw", "work", "two"),
        ],
        diagnostics: ["paw_artifact_ambiguous"],
      }),
    );
  });

  it("reports unknown layout when a single candidate has no known artifacts", () => {
    const root = createRoot();
    const repo = join(root, "repo");
    const workDir = join(repo, ".paw", "work", "unknown-layout");
    writeFile(
      join(workDir, "notes.txt"),
      "unrecognized artifact\n",
      new Date("2026-05-05T13:01:00.000Z"),
    );

    const patch = indexPawWorkflow(buildSession({ derivedWorktreePath: repo }), {
      now: () => new Date("2026-05-05T13:05:00.000Z"),
    });

    expect(patch?.pawWorkflow).toEqual(
      expect.objectContaining({
        status: "unknown",
        stage: null,
        workDir,
        artifactCount: 1,
        latestArtifactPath: "notes.txt",
        diagnostics: ["paw_artifact_layout_unknown"],
      }),
    );
    expect(patch?.pawWorkflow?.artifacts).toEqual([
      expect.objectContaining({ path: "notes.txt", kind: "unknown", stage: null }),
    ]);
  });

  it("leaves non-PAW sessions without discovery noise", () => {
    const root = createRoot();
    const repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });

    expect(indexPawWorkflow(buildSession({ cwd: repo }))).toBeNull();
  });
});
