import { describe, expect, it } from "vitest";

import {
  MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT,
  MANAGED_RUNTIME_PROGRESS_STRING_LIMIT,
  isManagedRuntimeActive,
  mergeSessionRegistryRuntimeMetadata,
} from "./managed-runtime";

describe("managed runtime metadata", () => {
  it("normalizes managed metadata patches with sanitized bounded progress", () => {
    const runtime = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        lifecycleState: "running",
        permissionProfile: "managed-autonomous",
        launchClaimId: "claim-1",
        launchNonce: "nonce-1",
        startedAt: "2026-05-07T12:00:00.000Z",
        progressEvents: [{
          type: "tool_started",
          message: "x".repeat(MANAGED_RUNTIME_PROGRESS_STRING_LIMIT + 20),
          data: {
            toolName: "powershell",
            args: "do not keep raw tool arguments",
            nested: {
              safeLabel: "kept",
              output: "do not keep raw tool output",
            },
          },
        }],
      },
      new Date("2026-05-07T12:00:01.000Z"),
    );

    expect(runtime.lifecycleState).toBe("running");
    expect(runtime.lastStateChangedAt).toBe("2026-05-07T12:00:01.000Z");
    expect(runtime.progressEvents).toHaveLength(1);
    expect(runtime.progressEvents[0]).toEqual(expect.objectContaining({
      sequence: 1,
      type: "tool_started",
      timestamp: "2026-05-07T12:00:01.000Z",
    }));
    expect(runtime.progressEvents[0].message.length).toBe(
      MANAGED_RUNTIME_PROGRESS_STRING_LIMIT + 3,
    );
    expect(runtime.progressEvents[0].data).toEqual({
      toolName: "powershell",
      nested: { safeLabel: "kept" },
    });
  });

  it("retains only the most recent managed progress events", () => {
    const runtime = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        progressEvents: Array.from({ length: MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT + 5 }, (_, index) => ({
          type: "assistant_status",
          message: `event ${index + 1}`,
        })),
      },
      new Date("2026-05-07T12:00:00.000Z"),
    );

    expect(runtime.progressEvents).toHaveLength(MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT);
    expect(runtime.progressEvents[0].sequence).toBe(6);
    expect(runtime.progressEvents.at(-1)?.sequence).toBe(55);
  });

  it("deduplicates evidence and classifies active managed lifecycle states", () => {
    const first = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        lifecycleState: "running",
        evidence: [{
          kind: "pr_ready",
          source: "sdk-assistant-message",
          url: "https://github.com/lossyrob/streamliner/pull/123",
          repo: "lossyrob/streamliner",
          number: 123,
          summary: "first",
        }],
      },
      new Date("2026-05-07T12:00:00.000Z"),
    );
    const second = mergeSessionRegistryRuntimeMetadata(
      first,
      {
        lifecycleState: "completed",
        evidence: [{
          kind: "pr_ready",
          source: "sdk-assistant-message",
          url: "https://github.com/lossyrob/streamliner/pull/123",
          repo: "lossyrob/streamliner",
          number: 123,
          summary: "updated",
        }],
      },
      new Date("2026-05-07T12:01:00.000Z"),
    );

    expect(first.evidence).toHaveLength(1);
    expect(second.evidence).toHaveLength(1);
    expect(second.evidence[0].summary).toBe("updated");
    expect(isManagedRuntimeActive(first)).toBe(true);
    expect(isManagedRuntimeActive(second)).toBe(false);
  });
});
