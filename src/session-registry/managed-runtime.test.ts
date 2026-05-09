import { describe, expect, it } from "vitest";

import {
  MANAGED_RUNTIME_PROGRESS_EVENT_LIMIT,
  MANAGED_RUNTIME_PROGRESS_STRING_LIMIT,
  isManagedRuntimeActive,
  mergeSessionRegistryRuntimeMetadata,
  normalizeSessionRegistryRuntimeMetadata,
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

  it("keeps safe summary telemetry while redacting explicit sensitive keys", () => {
    const runtime = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        progressEvents: [{
          type: "assistant_status",
          message: "Telemetry summary.",
          data: {
            contentLength: 123,
            inputTokens: 456,
            outputTokens: 789,
            argumentCount: 2,
            questionLength: 42,
            choiceCount: 3,
            command: "Remove-Item secret.txt",
            content: "raw assistant text",
            args: { raw: true },
            toolResult: "raw tool result",
            nested: {
              payload: "raw payload",
              errorCount: 1,
            },
          },
        }],
      },
      new Date("2026-05-07T12:00:00.000Z"),
    );

    expect(runtime.progressEvents[0].data).toEqual({
      contentLength: 123,
      inputTokens: 456,
      outputTokens: 789,
      argumentCount: 2,
      questionLength: 42,
      choiceCount: 3,
      nested: {
        errorCount: 1,
      },
    });
  });

  it("preserves opaque IDs and paths through merge and normalize", () => {
    const sdkSessionId = `sdk-${"s".repeat(300)}`;
    const sdkWorkspacePath = `C:\\${"deep\\".repeat(70)}workspace.yaml`;
    const sdkStateRoot = sdkWorkspacePath.slice(0, -"\\workspace.yaml".length);

    const runtime = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        lifecycleState: "running",
        launchClaimId: `claim-${"c".repeat(300)}`,
        launchNonce: `nonce-${"n".repeat(300)}`,
        sdkSessionId,
        sdkWorkspacePath,
        sdkStateRoot,
      },
      new Date("2026-05-07T12:00:00.000Z"),
    );
    const normalized = normalizeSessionRegistryRuntimeMetadata(runtime, "runtime");

    expect(normalized?.sdkSessionId).toBe(sdkSessionId);
    expect(normalized?.sdkWorkspacePath).toBe(sdkWorkspacePath);
    expect(normalized?.sdkStateRoot).toBe(sdkStateRoot);
  });

  it("retains only the most recent managed progress events", () => {
    const runtime = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
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
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
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

  it("does not treat terminal-owned takeover rows as active SDK runs", () => {
    const sdkOwned = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "streamliner-sdk",
        lifecycleState: "running",
      },
      new Date("2026-05-07T12:00:00.000Z"),
    );
    const terminalOwned = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "builder-terminal",
        lifecycleState: "terminal_takeover",
      },
      new Date("2026-05-07T12:00:00.000Z"),
    );

    expect(isManagedRuntimeActive(sdkOwned)).toBe(true);
    expect(isManagedRuntimeActive(terminalOwned)).toBe(false);
  });

  it("requires runtime identity when creating managed runtime metadata", () => {
    expect(() =>
      mergeSessionRegistryRuntimeMetadata(
        null,
        {
          lifecycleState: "running",
        },
      )
    ).toThrow(/runtimeKind is required/);
  });

  it("keeps terminal lifecycle states sticky while retaining late progress", () => {
    const rows = [
      { initial: "failed", late: "running", expected: "failed" },
      { initial: "canceled", late: "interrupted", expected: "canceled" },
      { initial: "completed", late: undefined, expected: "completed" },
    ] as const;

    for (const row of rows) {
      const current = mergeSessionRegistryRuntimeMetadata(
        null,
        {
          runtimeKind: "managed-sdk",
          runtimeOwner: "streamliner-sdk",
          lifecycleState: row.initial,
          progressEvents: [{
            type: "lifecycle",
            message: `Initial ${row.initial}.`,
          }],
        },
        new Date("2026-05-07T12:00:00.000Z"),
      );
      const next = mergeSessionRegistryRuntimeMetadata(
        current,
        {
          lifecycleState: row.late,
          progressEvents: [{
            type: "lifecycle",
            message: "Late lifecycle callback observed.",
          }],
        },
        new Date("2026-05-07T12:01:00.000Z"),
      );

      expect(next.lifecycleState).toBe(row.expected);
      expect(next.progressEvents.at(-1)?.message).toBe("Late lifecycle callback observed.");
      expect(next.lastStateChangedAt).toBe(current.lastStateChangedAt);
    }
  });

  it("keeps builder-terminal takeover ownership sticky across late SDK callbacks", () => {
    const current = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "builder-terminal",
        lifecycleState: "terminal_takeover",
        progressEvents: [{
          type: "terminal_takeover",
          message: "Visible terminal took over the SDK session.",
        }],
      },
      new Date("2026-05-07T12:00:00.000Z"),
    );
    const next = mergeSessionRegistryRuntimeMetadata(
      current,
      {
        runtimeOwner: "streamliner-sdk",
        lifecycleState: "running",
        progressEvents: [{
          type: "assistant_status",
          message: "Late SDK status callback observed.",
        }],
      },
      new Date("2026-05-07T12:01:00.000Z"),
    );

    expect(next.runtimeOwner).toBe("builder-terminal");
    expect(next.lifecycleState).toBe("terminal_takeover");
    expect(next.progressEvents.at(-1)?.message).toBe("Late SDK status callback observed.");
  });

  it("allows explicit cleanup transitions from builder-terminal takeover", () => {
    const current = mergeSessionRegistryRuntimeMetadata(
      null,
      {
        runtimeKind: "managed-sdk",
        runtimeOwner: "builder-terminal",
        lifecycleState: "terminal_takeover",
      },
      new Date("2026-05-07T12:00:00.000Z"),
    );
    const cleaning = mergeSessionRegistryRuntimeMetadata(
      current,
      {
        runtimeOwner: "builder-terminal",
        lifecycleState: "cleaning_up",
        progressEvents: [{
          type: "lifecycle",
          message: "Managed cleanup-after-merge started.",
        }],
      },
      new Date("2026-05-07T12:01:00.000Z"),
    );
    const cleaned = mergeSessionRegistryRuntimeMetadata(
      cleaning,
      {
        runtimeOwner: "builder-terminal",
        lifecycleState: "cleaned_up",
      },
      new Date("2026-05-07T12:02:00.000Z"),
    );

    expect(cleaning.runtimeOwner).toBe("builder-terminal");
    expect(cleaning.lifecycleState).toBe("cleaning_up");
    expect(cleaned.runtimeOwner).toBe("builder-terminal");
    expect(cleaned.lifecycleState).toBe("cleaned_up");
  });
});
