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

const PROMPT_FLUSH_LIFECYCLE_STATES = new Set<SessionRegistryManagedLifecycleState>([
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

const CLOSE_AFTER_FLUSH_LIFECYCLE_STATES = new Set<SessionRegistryManagedLifecycleState>([
  "interrupted",
  "failed",
  "terminal_takeover",
  "completed",
  "canceled",
  "cleaned_up",
]);

const ACTIVE_LIFECYCLE_STATES = new Set<SessionRegistryManagedLifecycleState>([
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
  private readonly closedRows = new Map<string, ReturnType<typeof setTimeout> | null>();
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
    if (this.closedRows.has(id)) {
      return;
    }
    const row = this.rowFor(id);
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
    return this.flush(id) ?? this.patchRuntimeMetadata(id, patch);
  }

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

  flushAndClose(id: string): SessionRegistryRecord | null {
    const record = this.flush(id);
    this.close(id);
    return record;
  }

  drop(id: string): void {
    this.close(id);
  }

  close(id: string): void {
    const row = this.rows.get(id);
    if (row) {
      this.clearThrottle(row);
      row.patch = null;
      this.rows.delete(id);
    }
    const existingTimer = this.closedRows.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    if (this.closedRowRetentionMs <= 0) {
      this.closedRows.delete(id);
      return;
    }
    const timer = setTimeout(() => {
      this.closedRows.delete(id);
    }, this.closedRowRetentionMs);
    unrefTimer(timer);
    this.closedRows.set(id, timer);
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
    const existingTimer = this.closedRows.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
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
    try {
      this.flush(id);
    } catch (error: unknown) {
      this.logger.warn("managed runtime patch flush failed", {
        registryId: id,
        err: error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
      });
    }
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
  const merged: SessionRegistryRuntimeMetadataPatch = {
    ...current,
    ...next,
    ...(current.forceLifecycleState === true || next.forceLifecycleState === true
      ? { forceLifecycleState: true }
      : {}),
  };
  const progressEvents = [
    ...(current.progressEvents ?? []),
    ...(next.progressEvents ?? []),
  ];
  if (progressEvents.length > 0) {
    merged.progressEvents = progressEvents;
  }
  const evidence = [
    ...(current.evidence ?? []),
    ...(next.evidence ?? []),
  ];
  if (evidence.length > 0) {
    merged.evidence = evidence;
  }
  return merged;
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

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }
}
