import type {
  SessionRegistryManagedLifecycleState,
  SessionRegistryRecord,
} from "../session-registry-schema";
import type {
  SessionRegistryRuntimeMetadataPatch,
} from "../session-registry-contract";
import { getApiLogger } from "./logger";

export const DEFAULT_MANAGED_RUNTIME_PATCH_THROTTLE_MS = 250;
export const DEFAULT_MANAGED_RUNTIME_CLOSED_ROW_RETENTION_MS = 5 * 60 * 1000;

type PatchRuntimeMetadata = (
  id: string,
  patch: SessionRegistryRuntimeMetadataPatch,
) => SessionRegistryRecord;

interface ManagedRuntimePatchCoalescerOptions {
  patchRuntimeMetadata: PatchRuntimeMetadata;
  throttleMs?: number;
  closedRowRetentionMs?: number;
}

interface PendingRuntimePatchState {
  patch: SessionRegistryRuntimeMetadataPatch | null;
  throttleTimer: ReturnType<typeof setTimeout> | null;
  urgentFlushScheduled: boolean;
  lastLifecycleState: SessionRegistryManagedLifecycleState | null;
  seenLifecycleStates: Set<SessionRegistryManagedLifecycleState>;
}

interface ClosedRuntimePatchState {
  timer: ReturnType<typeof setTimeout> | null;
  lifecycleStateAtClose: SessionRegistryManagedLifecycleState | null;
}

export interface ManagedRuntimePatchCoalescerDiagnostics {
  droppedAfterClose: {
    cosmetic: number;
    withEvidence: number;
  };
  droppedInactive: {
    cosmetic: number;
    withEvidence: number;
  };
  flushFailures: {
    cosmetic: number;
    withEvidence: number;
  };
}

// Flush policy is split across three sets:
// - PROMPT_FLUSH states are user-visible boundaries and bypass the routine throttle.
// - CLOSE_AFTER_FLUSH states are terminal PROMPT_FLUSH states that release row state.
// - ACTIVE states gate lifecycle phase transitions; terminal_takeover remains active
//   until the terminal handoff flush closes the row.
export const PROMPT_FLUSH_LIFECYCLE_STATES = new Set<SessionRegistryManagedLifecycleState>([
  "waiting_for_builder",
  "interrupt_requested",
  "interrupted",
  "failed",
  "pr_ready",
  "review_ready",
  "cleanup_ready",
  "cleaning_up",
  "cleaned_up",
  "terminal_takeover",
  "completed",
  "canceled",
]);

export const CLOSE_AFTER_FLUSH_LIFECYCLE_STATES = new Set<SessionRegistryManagedLifecycleState>([
  "interrupted",
  "failed",
  "terminal_takeover",
  "completed",
  "canceled",
  "cleaned_up",
]);

export const ACTIVE_LIFECYCLE_STATES = new Set<SessionRegistryManagedLifecycleState>([
  "preparing",
  "starting",
  "running",
  "idle",
  "waiting_for_builder",
  "interrupt_requested",
  "pr_ready",
  "review_ready",
  "cleanup_ready",
  "cleaning_up",
  "terminal_takeover",
]);

export class ManagedRuntimePatchCoalescer {
  private readonly patchRuntimeMetadata: PatchRuntimeMetadata;
  private readonly throttleMs: number;
  private readonly closedRowRetentionMs: number;
  private readonly rows = new Map<string, PendingRuntimePatchState>();
  private readonly closedRows = new Map<string, ClosedRuntimePatchState>();
  private readonly diagnostics: ManagedRuntimePatchCoalescerDiagnostics = {
    droppedAfterClose: { cosmetic: 0, withEvidence: 0 },
    droppedInactive: { cosmetic: 0, withEvidence: 0 },
    flushFailures: { cosmetic: 0, withEvidence: 0 },
  };
  private readonly logger = getApiLogger().withScope("managed-runtime.coalescer");

  constructor(options: ManagedRuntimePatchCoalescerOptions) {
    this.patchRuntimeMetadata = options.patchRuntimeMetadata;
    this.throttleMs = options.throttleMs ?? DEFAULT_MANAGED_RUNTIME_PATCH_THROTTLE_MS;
    this.closedRowRetentionMs =
      options.closedRowRetentionMs ?? DEFAULT_MANAGED_RUNTIME_CLOSED_ROW_RETENTION_MS;
  }

  begin(
    id: string,
    lifecycleState: SessionRegistryManagedLifecycleState | null = null,
  ): void {
    this.reopen(id);
    const row = this.rowFor(id);
    row.lastLifecycleState = lifecycleState;
    if (lifecycleState) {
      row.seenLifecycleStates.add(lifecycleState);
    }
  }

  enqueue(
    id: string,
    patch: SessionRegistryRuntimeMetadataPatch,
  ): void {
    const closedRow = this.closedRows.get(id);
    if (closedRow) {
      this.recordDroppedPatch("after-close", id, patch, closedRow.lifecycleStateAtClose);
      return;
    }
    const row = this.rows.get(id);
    if (!row) {
      this.recordDroppedPatch("inactive", id, patch, null);
      return;
    }
    const shouldFlushSoon = this.shouldFlushPromptly(row, patch);
    row.patch = mergeRuntimePatches(row.patch, patch);
    if (shouldFlushSoon) {
      this.scheduleUrgentFlush(id, row);
      return;
    }
    this.scheduleThrottleFlush(id, row);
  }

  patchNow(
    id: string,
    patch: SessionRegistryRuntimeMetadataPatch,
  ): SessionRegistryRecord {
    this.reopen(id);
    const row = this.rowFor(id);
    row.patch = mergeRuntimePatches(row.patch, patch);
    const record = this.flush(id);
    if (!record) {
      throw new Error("Managed runtime patch invariant violated: patchNow did not flush.");
    }
    return record;
  }

  /**
   * Drain the pending patch for a row. The patch is consumed before the store
   * write; flushSafely records diagnostic counters if that write then fails.
   * Terminal lifecycle states also release the row after the write succeeds.
   */
  flush(id: string): SessionRegistryRecord | null {
    const row = this.rows.get(id);
    if (!row?.patch) {
      return null;
    }
    this.clearThrottle(row);
    const patch = row.patch;
    row.patch = null;
    const record = this.patchRuntimeMetadata(id, patch);
    this.recordLifecycle(row, patch.lifecycleState);
    if (
      patch.lifecycleState &&
      CLOSE_AFTER_FLUSH_LIFECYCLE_STATES.has(patch.lifecycleState)
    ) {
      this.close(id);
    }
    return record;
  }

  /** Release row state without draining pending patches. */
  close(id: string): void {
    const row = this.rows.get(id);
    const existingClosedRow = this.closedRows.get(id);
    const lifecycleStateAtClose =
      row?.patch?.lifecycleState ??
      row?.lastLifecycleState ??
      existingClosedRow?.lifecycleStateAtClose ??
      null;
    if (row) {
      this.clearThrottle(row);
      row.patch = null;
      this.rows.delete(id);
    }
    if (existingClosedRow?.timer) {
      clearTimeout(existingClosedRow.timer);
    }
    if (this.closedRowRetentionMs <= 0) {
      this.closedRows.delete(id);
      return;
    }
    const timer = setTimeout(() => {
      this.closedRows.delete(id);
    }, this.closedRowRetentionMs);
    unrefTimer(timer);
    this.closedRows.set(id, {
      timer,
      lifecycleStateAtClose,
    });
  }

  getDiagnostics(): ManagedRuntimePatchCoalescerDiagnostics {
    return {
      droppedAfterClose: { ...this.diagnostics.droppedAfterClose },
      droppedInactive: { ...this.diagnostics.droppedInactive },
      flushFailures: { ...this.diagnostics.flushFailures },
    };
  }

  private rowFor(id: string): PendingRuntimePatchState {
    let row = this.rows.get(id);
    if (!row) {
      row = {
        patch: null,
        throttleTimer: null,
        urgentFlushScheduled: false,
        lastLifecycleState: null,
        seenLifecycleStates: new Set(),
      };
      this.rows.set(id, row);
    }
    return row;
  }

  private reopen(id: string): void {
    const existingClosedRow = this.closedRows.get(id);
    if (existingClosedRow?.timer) {
      clearTimeout(existingClosedRow.timer);
    }
    this.closedRows.delete(id);
  }

  private shouldFlushPromptly(
    row: PendingRuntimePatchState,
    patch: SessionRegistryRuntimeMetadataPatch,
  ): boolean {
    if (
      patch.forceLifecycleState === true ||
      (patch.evidence?.length ?? 0) > 0
    ) {
      return true;
    }
    const state = patch.lifecycleState;
    if (!state) {
      return false;
    }
    if (
      PROMPT_FLUSH_LIFECYCLE_STATES.has(state) ||
      !row.seenLifecycleStates.has(state)
    ) {
      return true;
    }
    const previousClassification = lifecycleClassification(row.lastLifecycleState);
    const nextClassification = lifecycleClassification(state);
    return previousClassification !== nextClassification;
  }

  private scheduleThrottleFlush(id: string, row: PendingRuntimePatchState): void {
    if (row.throttleTimer || row.urgentFlushScheduled) {
      return;
    }
    row.throttleTimer = setTimeout(() => {
      row.throttleTimer = null;
      this.flushSafely(id);
    }, this.throttleMs);
  }

  private scheduleUrgentFlush(id: string, row: PendingRuntimePatchState): void {
    this.clearThrottle(row);
    if (row.urgentFlushScheduled) {
      return;
    }
    row.urgentFlushScheduled = true;
    queueMicrotask(() => {
      row.urgentFlushScheduled = false;
      this.flushSafely(id);
    });
  }

  private flushSafely(id: string): void {
    const row = this.rows.get(id);
    const droppedWithEvidence = patchHasEvidence(row?.patch ?? null);
    try {
      this.flush(id);
    } catch (error: unknown) {
      incrementDroppedCounter(this.diagnostics.flushFailures, droppedWithEvidence);
      this.logger.warn("managed runtime patch flush failed", {
        registryId: id,
        droppedWithEvidence,
        err: error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
      });
    }
  }

  private recordDroppedPatch(
    reason: "after-close" | "inactive",
    id: string,
    patch: SessionRegistryRuntimeMetadataPatch,
    lifecycleStateAtClose: SessionRegistryManagedLifecycleState | null,
  ): void {
    const droppedWithEvidence = patchHasEvidence(patch);
    incrementDroppedCounter(
      reason === "after-close"
        ? this.diagnostics.droppedAfterClose
        : this.diagnostics.droppedInactive,
      droppedWithEvidence,
    );
    this.logger.warn("managed runtime patch dropped", {
      registryId: id,
      reason,
      lifecycleStateAtClose,
      droppedLifecycleState: patch.lifecycleState ?? null,
      droppedWithEvidence,
    });
  }

  private clearThrottle(row: PendingRuntimePatchState): void {
    if (row.throttleTimer) {
      clearTimeout(row.throttleTimer);
      row.throttleTimer = null;
    }
  }

  private recordLifecycle(
    row: PendingRuntimePatchState,
    lifecycleState: SessionRegistryManagedLifecycleState | null | undefined,
  ): void {
    if (!lifecycleState) {
      return;
    }
    row.lastLifecycleState = lifecycleState;
    row.seenLifecycleStates.add(lifecycleState);
  }
}

function mergeRuntimePatches(
  current: SessionRegistryRuntimeMetadataPatch | null,
  next: SessionRegistryRuntimeMetadataPatch,
): SessionRegistryRuntimeMetadataPatch {
  if (!current) {
    return clonePatch(next);
  }
  const existingProgressEvents = current.progressEvents;
  const existingEvidence = current.evidence;
  const forceLifecycleState =
    current.forceLifecycleState === true || next.forceLifecycleState === true;
  Object.assign(current, next);
  if (forceLifecycleState) {
    current.forceLifecycleState = true;
  }
  if (existingProgressEvents || next.progressEvents) {
    const progressEvents = existingProgressEvents ?? [];
    if (next.progressEvents?.length) {
      progressEvents.push(...next.progressEvents);
    }
    current.progressEvents = progressEvents;
  }
  if (existingEvidence || next.evidence) {
    const evidence = existingEvidence ?? [];
    if (next.evidence?.length) {
      evidence.push(...next.evidence);
    }
    current.evidence = evidence;
  }
  return current;
}

function clonePatch(
  patch: SessionRegistryRuntimeMetadataPatch,
): SessionRegistryRuntimeMetadataPatch {
  return {
    ...patch,
    ...(patch.progressEvents ? { progressEvents: [...patch.progressEvents] } : {}),
    ...(patch.evidence ? { evidence: [...patch.evidence] } : {}),
  };
}

function lifecycleClassification(
  state: SessionRegistryManagedLifecycleState | null,
): "active" | "terminal" | "none" {
  if (!state) {
    return "none";
  }
  return ACTIVE_LIFECYCLE_STATES.has(state) ? "active" : "terminal";
}

function patchHasEvidence(patch: SessionRegistryRuntimeMetadataPatch | null): boolean {
  return (patch?.evidence?.length ?? 0) > 0;
}

function incrementDroppedCounter(
  counter: { cosmetic: number; withEvidence: number },
  withEvidence: boolean,
): void {
  if (withEvidence) {
    counter.withEvidence += 1;
  } else {
    counter.cosmetic += 1;
  }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }
}
