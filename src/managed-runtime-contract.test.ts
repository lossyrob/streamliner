import { describe, expect, it } from "vitest";

import {
  MANAGED_RUNTIME_LIFECYCLE_STATES,
  managedRuntimeProgressEvents,
  sanitizeManagedRuntimeProjection,
} from "./managed-runtime-contract";

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
    expect(progress[0]).not.toHaveProperty("rawPrompt");
    expect(progress[0]).not.toHaveProperty("toolArguments");
  });

  it("sanitizes managed runtime projection fields before API projection", () => {
    const projection = sanitizeManagedRuntimeProjection({
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      permissionProfile: "managed-autonomous",
      lifecycleState: "running",
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
    });

    expect(projection).not.toBeNull();
    expect(projection).not.toHaveProperty("rawPrompt");
    expect(projection?.sdk).not.toHaveProperty("rawState");
    expect(projection?.progress?.[0]).not.toHaveProperty("stdout");
  });
});
