import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SessionRegistryRuntimeMetadataPatch,
} from "../session-registry-contract";
import type { SessionRegistryRecord } from "../session-registry-schema";
import {
  ACTIVE_LIFECYCLE_STATES,
  CLOSE_AFTER_FLUSH_LIFECYCLE_STATES,
  ManagedRuntimePatchCoalescer,
  PROMPT_FLUSH_LIFECYCLE_STATES,
} from "./managed-runtime-patch-coalescer";

function createCoalescer(
  throttleMs = 250,
  patchRuntimeMetadata?: (
    id: string,
    patch: SessionRegistryRuntimeMetadataPatch,
  ) => SessionRegistryRecord,
) {
  const writes: SessionRegistryRuntimeMetadataPatch[] = [];
  const coalescer = new ManagedRuntimePatchCoalescer({
    throttleMs,
    closedRowRetentionMs: 60_000,
    patchRuntimeMetadata: patchRuntimeMetadata ?? ((_id, patch) => {
      writes.push(patch);
      return { id: "managed-row" } as SessionRegistryRecord;
    }),
  });
  return { coalescer, writes };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

describe("ManagedRuntimePatchCoalescer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes the first entry into a lifecycle state promptly", async () => {
    const { coalescer, writes } = createCoalescer();
    coalescer.begin("managed-row");

    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      progressEvents: [{ type: "lifecycle", message: "Running." }],
    });

    expect(writes).toEqual([]);
    await flushMicrotasks();

    expect(writes).toEqual([
      expect.objectContaining({
        lifecycleState: "running",
        progressEvents: [expect.objectContaining({ message: "Running." })],
      }),
    ]);
  });

  it("coalesces repeated routine lifecycle patches until the throttle expires", async () => {
    vi.useFakeTimers();
    const { coalescer, writes } = createCoalescer();
    coalescer.begin("managed-row", "running");

    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      progressEvents: [{ type: "tool_started", message: "Tool A." }],
    });
    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      progressEvents: [{ type: "tool_started", message: "Tool B." }],
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([
      expect.objectContaining({
        lifecycleState: "running",
        progressEvents: [
          expect.objectContaining({ message: "Tool A." }),
          expect.objectContaining({ message: "Tool B." }),
        ],
      }),
    ]);
  });

  it("flushes terminal transitions promptly and suppresses later enqueues", async () => {
    const { coalescer, writes } = createCoalescer();
    coalescer.begin("managed-row", "running");

    coalescer.enqueue("managed-row", {
      lifecycleState: "completed",
      progressEvents: [{ type: "lifecycle", message: "Completed." }],
    });
    await flushMicrotasks();

    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      progressEvents: [{ type: "lifecycle", message: "Late running." }],
    });
    await flushMicrotasks();

    expect(writes).toEqual([
      expect.objectContaining({
        lifecycleState: "completed",
        progressEvents: [expect.objectContaining({ message: "Completed." })],
      }),
    ]);
  });

  it("flushes evidence and force-lifecycle patches promptly", async () => {
    const { coalescer, writes } = createCoalescer();
    coalescer.begin("managed-row", "running");

    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      progressEvents: [{ type: "tool_started", message: "Tool before evidence." }],
    });
    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      forceLifecycleState: true,
      evidence: [{
        kind: "pr_ready",
        source: "managed-sdk-runner",
        detectedAt: "2026-05-07T12:00:00.000Z",
      }],
    });
    await flushMicrotasks();

    expect(writes).toEqual([
      expect.objectContaining({
        forceLifecycleState: true,
        progressEvents: [expect.objectContaining({ message: "Tool before evidence." })],
        evidence: [expect.objectContaining({ kind: "pr_ready" })],
      }),
    ]);
  });

  it("drops pending state and ignores later enqueues until the row is reopened", async () => {
    vi.useFakeTimers();
    const { coalescer, writes } = createCoalescer();
    coalescer.begin("managed-row", "running");

    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      progressEvents: [{ type: "tool_started", message: "Pending." }],
    });
    coalescer.close("managed-row");
    await vi.advanceTimersByTimeAsync(250);
    coalescer.enqueue("managed-row", {
      lifecycleState: "completed",
      progressEvents: [{ type: "lifecycle", message: "Ignored." }],
    });
    await flushMicrotasks();
    expect(writes).toEqual([]);

    coalescer.begin("managed-row", "running");
    coalescer.enqueue("managed-row", {
      lifecycleState: "completed",
      progressEvents: [{ type: "lifecycle", message: "Accepted." }],
    });
    await flushMicrotasks();

    expect(writes).toEqual([
      expect.objectContaining({
        lifecycleState: "completed",
        progressEvents: [expect.objectContaining({ message: "Accepted." })],
      }),
    ]);
  });

  it("records diagnostics for patches dropped after close and requires begin after retention expiry", async () => {
    vi.useFakeTimers();
    const { coalescer, writes } = createCoalescer();
    coalescer.begin("managed-row", "running");

    coalescer.close("managed-row");
    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      evidence: [{
        kind: "pr_ready",
        source: "managed-sdk-runner",
        detectedAt: "2026-05-07T12:00:00.000Z",
      }],
    });

    expect(coalescer.getDiagnostics().droppedAfterClose).toEqual({
      cosmetic: 0,
      withEvidence: 1,
    });
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(60_000);
    coalescer.enqueue("managed-row", {
      lifecycleState: "completed",
      progressEvents: [{ type: "lifecycle", message: "Still ignored." }],
    });
    await flushMicrotasks();

    expect(coalescer.getDiagnostics().droppedInactive).toEqual({
      cosmetic: 1,
      withEvidence: 0,
    });
    expect(writes).toEqual([]);
  });

  it("counts dropped patches when a safe flush write fails", async () => {
    const writes: SessionRegistryRuntimeMetadataPatch[] = [];
    let shouldThrow = true;
    const { coalescer } = createCoalescer(250, (_id, patch) => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("write failed");
      }
      writes.push(patch);
      return { id: "managed-row" } as SessionRegistryRecord;
    });
    coalescer.begin("managed-row", "running");

    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      evidence: [{
        kind: "review_ready",
        source: "managed-sdk-runner",
        detectedAt: "2026-05-07T12:00:00.000Z",
      }],
    });
    await flushMicrotasks();

    expect(writes).toEqual([]);
    expect(coalescer.getDiagnostics().flushFailures).toEqual({
      cosmetic: 0,
      withEvidence: 1,
    });
  });

  it("uses the latest prompt lifecycle state for same-tick prompt flushes", async () => {
    const { coalescer, writes } = createCoalescer();
    coalescer.begin("managed-row", "running");

    coalescer.enqueue("managed-row", {
      lifecycleState: "waiting_for_builder",
      progressEvents: [{ type: "lifecycle", message: "Waiting." }],
    });
    coalescer.enqueue("managed-row", {
      lifecycleState: "review_ready",
      progressEvents: [{ type: "lifecycle", message: "Review ready." }],
    });
    await flushMicrotasks();

    expect(writes).toEqual([
      expect.objectContaining({
        lifecycleState: "review_ready",
        progressEvents: [
          expect.objectContaining({ message: "Waiting." }),
          expect.objectContaining({ message: "Review ready." }),
        ],
      }),
    ]);
  });

  it("resets seen lifecycle state when a row is closed and reopened", async () => {
    const { coalescer, writes } = createCoalescer();
    coalescer.begin("managed-row");
    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      progressEvents: [{ type: "lifecycle", message: "Routine." }],
    });
    await flushMicrotasks();
    expect(writes).toHaveLength(1);

    coalescer.close("managed-row");
    coalescer.begin("managed-row");
    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      progressEvents: [{ type: "lifecycle", message: "Prompt after reopen." }],
    });
    await flushMicrotasks();

    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(
      expect.objectContaining({
        lifecycleState: "running",
        progressEvents: [expect.objectContaining({ message: "Prompt after reopen." })],
      }),
    );
  });

  it("preserves current scalar overwrite behavior for explicit undefined fields", async () => {
    const { coalescer, writes } = createCoalescer();
    coalescer.begin("managed-row");

    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      sdkSessionId: "sdk-before",
    });
    coalescer.enqueue("managed-row", {
      lifecycleState: "running",
      sdkSessionId: undefined,
    });
    await flushMicrotasks();

    expect(writes).toEqual([
      expect.objectContaining({
        lifecycleState: "running",
        sdkSessionId: undefined,
      }),
    ]);
  });

  it("documents lifecycle set invariants", () => {
    for (const state of CLOSE_AFTER_FLUSH_LIFECYCLE_STATES) {
      expect(PROMPT_FLUSH_LIFECYCLE_STATES.has(state)).toBe(true);
    }
    expect(ACTIVE_LIFECYCLE_STATES.has("terminal_takeover")).toBe(true);
    expect(CLOSE_AFTER_FLUSH_LIFECYCLE_STATES.has("terminal_takeover")).toBe(true);
  });
});
