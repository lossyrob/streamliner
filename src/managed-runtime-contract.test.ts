import { describe, expect, it } from "vitest";

import {
  MANAGED_RUNTIME_LIFECYCLE_STATES,
  MANAGED_RUNTIME_ACTION_ROUTE_SUFFIXES,
  MANAGED_RUNTIME_PROGRESS_EVENT_INPUT_CAP,
  MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH,
  MANAGED_RUNTIME_REPLAY_RETAINED_EVENT_LIMIT,
  defaultManagedRuntimeActions,
  isManagedRuntimeCleanupAvailable,
  managedLifecycleStatusClass,
  managedRuntimeProjectionFromMetadata,
  managedRuntimeProjectionFromSession,
  managedRuntimeProgressEvents,
  resolveManagedRuntimeActions,
  sanitizeManagedRuntimeProjection,
} from "./managed-runtime-contract";
import type { SessionRegistryRuntimeMetadata } from "./session-registry-schema";

function managedRuntime(
  overrides: Partial<SessionRegistryRuntimeMetadata> = {},
): SessionRegistryRuntimeMetadata {
  return {
    runtimeKind: "managed-sdk",
    runtimeOwner: "streamliner-sdk",
    lifecycleState: "running",
    permissionProfile: "managed-autonomous",
    launchClaimId: "claim-1",
    launchNonce: "nonce-1",
    sdkSessionId: "sdk-session",
    sdkWorkspacePath: "C:\\repo\\worktree",
    sdkStateRoot: "C:\\state",
    startedAt: "2026-05-05T12:00:00.000Z",
    lastStateChangedAt: "2026-05-05T12:01:00.000Z",
    progressEvents: [],
    evidence: [],
    ...overrides,
  };
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("managed runtime contract", () => {
  it("defines the launch lifecycle states used by the managed SDK UI", () => {
    expect(MANAGED_RUNTIME_LIFECYCLE_STATES).toEqual([
      "preparing",
      "starting",
      "running",
      "idle",
      "waiting_for_builder",
      "interrupt_requested",
      "interrupted",
      "canceled",
      "failed",
      "pr_ready",
      "review_ready",
      "completed",
      "cleanup_ready",
      "cleaning_up",
      "cleaned_up",
      "terminal_takeover",
    ]);
  });

  it("bounds and sanitizes progress events to the allowlisted projection fields", () => {
    const progress = managedRuntimeProgressEvents(
      Array.from({ length: 10 }, (_, index) => ({
        timestamp: `2026-05-05T12:${String(index).padStart(2, "0")}:00.000Z`,
        phase: "implementation",
        summary: `${"x".repeat(260)} ${index}`,
        kind: "summary" as const,
        status: "info" as const,
        rawPrompt: "do not expose",
        toolArguments: { secret: "do not expose" },
      })),
    );

    expect(progress).toHaveLength(8);
    expect(progress[0]?.timestamp).toBe("2026-05-05T12:02:00.000Z");
    expect(progress[0]?.summary.endsWith("...")).toBe(true);
    expect(progress[0]?.summary.length).toBeLessThanOrEqual(
      MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH,
    );
    expect(progress[0]).not.toHaveProperty("rawPrompt");
    expect(progress[0]).not.toHaveProperty("toolArguments");
  });

  it("truncates progress summaries without splitting surrogate pairs", () => {
    const progress = managedRuntimeProgressEvents([
      {
        timestamp: "2026-05-05T12:00:00.000Z",
        phase: "implementation",
        summary: `${"a".repeat(MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH - 2)}\u{1f642}x`,
      },
    ]);

    expect(progress[0]?.summary.length).toBeLessThanOrEqual(
      MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH,
    );
    expect(progress[0]?.summary.endsWith("...")).toBe(true);
    expect(hasLoneSurrogate(progress[0]?.summary ?? "")).toBe(false);
  });

  it("caps progress input before filtering", () => {
    const progress = managedRuntimeProgressEvents([
      {
        timestamp: "2026-05-05T12:00:00.000Z",
        phase: "implementation",
        summary: "outside cap",
      },
      ...Array.from({ length: MANAGED_RUNTIME_PROGRESS_EVENT_INPUT_CAP }, () => ({
        ignored: "invalid",
      })),
    ]);

    expect(progress).toEqual([]);
  });

  it("defines a status class for every managed lifecycle state", () => {
    for (const state of MANAGED_RUNTIME_LIFECYCLE_STATES) {
      expect(managedLifecycleStatusClass(state)).toMatch(/^(green|amber|red|muted|accent)$/);
    }
  });

  it("provides default managed runtime action placeholders", () => {
    const actions = defaultManagedRuntimeActions();

    expect(resolveManagedRuntimeActions(null)).toEqual(actions);
    expect(resolveManagedRuntimeActions({
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      permissionProfile: "managed-autonomous",
      lifecycleState: "running",
      actions: [],
    })).toEqual(actions);
    expect(actions.every((action) => action.available === false)).toBe(true);
    expect(actions.map((action) => action.action)).toEqual([
      "interrupt",
      "cancel",
      "terminal-takeover",
      "cleanup",
    ]);
  });

  it("centralizes managed action route suffixes", () => {
    expect(MANAGED_RUNTIME_ACTION_ROUTE_SUFFIXES).toEqual({
      interrupt: "interrupt",
      cancel: "cancel",
      "terminal-takeover": "takeover",
      cleanup: "cleanup",
    });
  });

  it("projects state-aware actions for SDK-owned managed sessions", () => {
    const projection = managedRuntimeProjectionFromMetadata(managedRuntime());

    const actions = resolveManagedRuntimeActions(projection);
    expect(actions.find((action) => action.action === "interrupt")?.available).toBe(true);
    expect(actions.find((action) => action.action === "cancel")?.available).toBe(true);
    expect(actions.find((action) => action.action === "terminal-takeover")?.available).toBe(true);
    expect(actions.find((action) => action.action === "cleanup")?.available).toBe(false);
  });

  it("allows terminal takeover while an SDK interrupt is in progress", () => {
    const projection = managedRuntimeProjectionFromMetadata(managedRuntime({
      lifecycleState: "interrupt_requested",
    }));

    expect(resolveManagedRuntimeActions(projection).find((action) =>
      action.action === "terminal-takeover"
    )?.available).toBe(true);
  });

  it("keeps cancel available for failed SDK-owned sessions", () => {
    const projection = managedRuntimeProjectionFromMetadata(managedRuntime({
      lifecycleState: "failed",
    }));

    const actions = resolveManagedRuntimeActions(projection);
    expect(actions.find((action) => action.action === "interrupt")?.available).toBe(false);
    expect(actions.find((action) => action.action === "cancel")?.available).toBe(true);
  });

  it("enables cleanup when cleanup-ready evidence is present", () => {
    const projection = managedRuntimeProjectionFromMetadata(managedRuntime({
      lifecycleState: "completed",
      evidence: [{
        id: "evidence-1",
        kind: "cleanup_ready",
        source: "managed-sdk",
        detectedAt: "2026-05-05T12:02:00.000Z",
        url: "https://github.com/lossyrob/streamliner/pull/75",
        repo: "lossyrob/streamliner",
        number: 75,
        sha: "abc123",
        summary: "PR merged and cleanup is ready.",
      }],
    }));

    expect(resolveManagedRuntimeActions(projection).find((action) =>
      action.action === "cleanup"
    )?.available).toBe(true);
    expect(isManagedRuntimeCleanupAvailable(managedRuntime({
      lifecycleState: "completed",
      evidence: [{
        id: "evidence-1",
        kind: "cleanup_ready",
        source: "managed-sdk",
        detectedAt: "2026-05-05T12:02:00.000Z",
        url: "https://github.com/lossyrob/streamliner/pull/75",
        repo: "lossyrob/streamliner",
        number: 75,
        sha: "abc123",
        summary: "PR merged and cleanup is ready.",
      }],
    }))).toBe(true);
  });

  it("projects terminal-owned takeover sessions with SDK actions disabled", () => {
    const projection = managedRuntimeProjectionFromMetadata(managedRuntime({
      runtimeOwner: "builder-terminal",
      lifecycleState: "terminal_takeover",
    }));

    expect(projection?.runtimeOwner).toBe("builder-terminal");
    expect(resolveManagedRuntimeActions(projection).filter((action) =>
      action.action !== "cleanup"
    ).every((action) => action.available === false)).toBe(true);
  });

  it("projects typed waiting reasons and replay metadata from sanitized runtime progress", () => {
    const projection = managedRuntimeProjectionFromMetadata(managedRuntime({
      lifecycleState: "waiting_for_builder",
      progressEvents: [{
        id: "progress-cleanup-blocked",
        sequence: 1,
        timestamp: "2026-05-05T12:03:00.000Z",
        type: "error",
        message: "Cleanup is blocked by managed runtime guardrails.",
        data: {
          firstBlockerCode: "dirty-worktree",
          rawPrompt: "do not expose",
        },
      }],
    }));

    expect(projection?.waitingReason).toEqual(expect.objectContaining({
      code: "cleanup_blocked",
      label: "Cleanup blocked",
      blockerCode: "dirty-worktree",
    }));
    expect(projection?.replay).toEqual({
      retainedEventCount: 1,
      retainedEventLimit: MANAGED_RUNTIME_REPLAY_RETAINED_EVENT_LIMIT,
      truncated: false,
    });
  });

  it("projects PR-ready trust context from evidence, progress, and session context", () => {
    const projection = managedRuntimeProjectionFromSession({
      runtime: managedRuntime({
        lifecycleState: "pr_ready",
        progressEvents: [{
          id: "progress-pr-ready",
          sequence: 1,
          timestamp: "2026-05-05T12:03:00.000Z",
          type: "evidence",
          message: "PR trust context updated.",
          data: {
            baseBranch: "main",
            worktreeClean: true,
            headSha: "abc123",
            prHeadSha: "abc123",
            prHeadMatchesBranch: true,
          },
        }],
        evidence: [{
          id: "evidence-pr",
          kind: "pr_ready",
          source: "test",
          detectedAt: "2026-05-05T12:04:00.000Z",
          url: "https://github.com/lossyrob/streamliner/pull/85",
          repo: "lossyrob/streamliner",
          number: 85,
          sha: "abc123",
          summary: "PR ready.",
        }],
      }),
      branch: "feature/managed-session-console",
      derivedWorktreePath: "C:\\repo\\streamliner-managed-session-console",
    });

    expect(projection?.prReady).toEqual(expect.objectContaining({
      url: "https://github.com/lossyrob/streamliner/pull/85",
      repo: "lossyrob/streamliner",
      number: 85,
      branchName: "feature/managed-session-console",
      baseBranch: "main",
      branchToBaseDiffUrl:
        "https://github.com/lossyrob/streamliner/compare/main...feature%2Fmanaged-session-console",
      worktreeClean: true,
      prHeadMatchesBranch: true,
    }));
    expect(projection?.prReady?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Branch-to-base diff", status: "pass" }),
      expect.objectContaining({ label: "Worktree cleanliness", status: "pass" }),
      expect.objectContaining({ label: "PR/head-state check", status: "pass" }),
    ]));
  });

  it("drops unsafe PR-ready URLs while preserving derived GitHub links", () => {
    const projection = managedRuntimeProjectionFromSession({
      runtime: managedRuntime({
        lifecycleState: "pr_ready",
        progressEvents: [{
          id: "progress-pr-ready",
          sequence: 1,
          timestamp: "2026-05-05T12:03:00.000Z",
          type: "evidence",
          message: "PR trust context updated.",
          data: {
            baseBranch: "main",
            diffUrl: "javascript:alert(1)",
          },
        }],
        evidence: [{
          id: "evidence-pr",
          kind: "pr_ready",
          source: "test",
          detectedAt: "2026-05-05T12:04:00.000Z",
          url: "javascript:alert(1)",
          repo: "lossyrob/streamliner",
          number: 85,
          sha: "abc123",
          summary: "PR ready.",
        }],
      }),
      branch: "feature/managed-session-console",
    });

    expect(projection?.prReady?.url).toBe(
      "https://github.com/lossyrob/streamliner/pull/85",
    );
    expect(projection?.prReady?.branchToBaseDiffUrl).toBe(
      "https://github.com/lossyrob/streamliner/compare/main...feature%2Fmanaged-session-console",
    );
    expect(projection?.prReady?.headSha).toBeNull();
    expect(projection?.prReady?.prHeadSha).toBe("abc123");
    expect(projection?.prReady?.prHeadMatchesBranch).toBeNull();
    expect(projection?.prReady?.checks.some((check) =>
      check.label === "PR/head-state check"
    )).toBe(false);

    const sanitized = sanitizeManagedRuntimeProjection({
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      permissionProfile: "managed-autonomous",
      lifecycleState: "pr_ready",
      prReady: {
        url: "javascript:alert(1)",
        branchToBaseDiffUrl: "javascript:alert(1)",
        checks: [],
      },
    });

    expect(sanitized?.prReady?.url).toBeNull();
    expect(sanitized?.prReady?.branchToBaseDiffUrl).toBeNull();
  });

  it("sanitizes managed runtime projection fields before API projection", () => {
    const projection = sanitizeManagedRuntimeProjection({
      runtimeKind: "managed-sdk",
      runtimeOwner: "builder-terminal",
      permissionProfile: "managed-autonomous",
      lifecycleState: "terminal_takeover",
      rawPrompt: "do not expose",
      sdk: {
        sdkSessionId: "sdk-session",
        rawState: "do not expose",
      },
      progress: [
        {
          timestamp: "2026-05-05T12:00:00.000Z",
          phase: "running",
          summary: "Worker is running.",
          stdout: "do not expose",
        },
      ],
      actions: [
        {
          action: "interrupt",
          label: "Interrupt",
          available: false,
          reason: "Terminal owns this session after takeover.",
        },
        {
          action: "cancel",
          label: "Cancel",
          available: false,
        },
      ],
      waitingReason: {
        code: "sdk_process_loss",
        label: "SDK process lost",
        suggestedAction: "Resume the background session.",
        detail: "No active managed SDK session is attached.",
        rawPrompt: "do not expose",
      },
      prReady: {
        url: "https://github.com/lossyrob/streamliner/pull/85",
        repo: "lossyrob/streamliner",
        number: 85,
        branchName: "feature/managed-session-console",
        baseBranch: "main",
        branchToBaseDiffUrl:
          "https://github.com/lossyrob/streamliner/compare/main...feature%2Fmanaged-session-console",
        worktreeClean: true,
        prHeadMatchesBranch: true,
        checks: [{
          label: "PR/head-state check",
          status: "pass",
          summary: "Recorded PR head matches the branch head.",
          rawOutput: "do not expose",
        }],
      },
      replay: {
        retainedEventCount: 8,
        retainedEventLimit: 50,
        truncated: false,
      },
    });

    expect(projection).not.toBeNull();
    expect(projection?.runtimeOwner).toBe("builder-terminal");
    expect(projection).not.toHaveProperty("rawPrompt");
    expect(projection?.sdk).not.toHaveProperty("rawState");
    expect(projection?.progress?.[0]).not.toHaveProperty("stdout");
    expect(projection?.actions?.map((action) => action.action)).toEqual(["interrupt", "cancel"]);
    expect(projection?.waitingReason).toEqual(expect.objectContaining({
      code: "sdk_process_loss",
    }));
    expect(projection?.waitingReason).not.toHaveProperty("rawPrompt");
    expect(projection?.prReady?.checks[0]).not.toHaveProperty("rawOutput");
    expect(projection?.replay?.retainedEventCount).toBe(8);
  });
});
