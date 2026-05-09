import { describe, expect, it } from "vitest";

import {
  MANAGED_RUNTIME_LIFECYCLE_STATES,
  MANAGED_RUNTIME_PROGRESS_EVENT_INPUT_CAP,
  MANAGED_RUNTIME_PROGRESS_SUMMARY_MAX_LENGTH,
  defaultManagedRuntimeActions,
  managedLifecycleStatusClass,
  managedRuntimeProjectionFromMetadata,
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

  it("projects state-aware actions for SDK-owned managed sessions", () => {
    const projection = managedRuntimeProjectionFromMetadata(managedRuntime());

    const actions = resolveManagedRuntimeActions(projection);
    expect(actions.find((action) => action.action === "interrupt")?.available).toBe(true);
    expect(actions.find((action) => action.action === "cancel")?.available).toBe(true);
    expect(actions.find((action) => action.action === "terminal-takeover")?.available).toBe(true);
    expect(actions.find((action) => action.action === "cleanup")?.available).toBe(false);
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
    });

    expect(projection).not.toBeNull();
    expect(projection?.runtimeOwner).toBe("builder-terminal");
    expect(projection).not.toHaveProperty("rawPrompt");
    expect(projection?.sdk).not.toHaveProperty("rawState");
    expect(projection?.progress?.[0]).not.toHaveProperty("stdout");
    expect(projection?.actions?.map((action) => action.action)).toEqual(["interrupt", "cancel"]);
  });
});
