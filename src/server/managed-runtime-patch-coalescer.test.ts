import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SessionRegistryRuntimeMetadataPatch,
} from "../session-registry-contract";
import type { SessionRegistryRecord } from "../session-registry-schema";
import { ManagedRuntimePatchCoalescer } from "./managed-runtime-patch-coalescer";

function createCoalescer(throttleMs = 250) {
  const writes: SessionRegistryRuntimeMetadataPatch[] = [];
  const coalescer = new ManagedRuntimePatchCoalescer({
    throttleMs,
    closedRowRetentionMs: 60_000,
    patchRuntimeMetadata: (_id, patch) => {
      writes.push(patch);
      return { id: "managed-row" } as SessionRegistryRecord;
    },
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
    coalescer.drop("managed-row");
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
});
