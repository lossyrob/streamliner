import type { SessionRegistryListItem } from "../session-registry-contract";
import type { SessionRegistryManagedLifecycleState } from "../session-registry-schema";
import type { SessionRegistryFileStore } from "./file-store";
import { isManagedRuntimeActive } from "./managed-runtime";

export const MANAGED_RUNTIME_STARTUP_RECONCILIATION_REASON =
  "startup-reconciliation-sdk-owner-unverified" as const;
export const MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_INTERRUPTED =
  "marked-interrupted-for-builder-recovery" as const;
export const MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_PRESERVED_TAKEOVER =
  "preserved-terminal-takeover" as const;

export type ManagedRuntimeStartupReconciliationReason =
  typeof MANAGED_RUNTIME_STARTUP_RECONCILIATION_REASON;
export type ManagedRuntimeStartupReconciliationAction =
  | typeof MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_INTERRUPTED
  | typeof MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_PRESERVED_TAKEOVER;

export interface ManagedRuntimeStartupReconciliationResult {
  rowsExamined: number;
  activeRowsFound: number;
  rowsReconciled: number;
  rowsSkippedLiveOwner: number;
  rowsSkippedTerminalTakeover: number;
  rowsSkippedTerminalTakeoverSdkOwnedAnomaly: number;
  rowsFailed: number;
}

export type ManagedRuntimeOwnerVerifier = (
  session: SessionRegistryListItem,
) => boolean;

function managedRuntimeStartupDiagnosticData(
  session: SessionRegistryListItem,
  previousLifecycleState: SessionRegistryManagedLifecycleState,
  action: ManagedRuntimeStartupReconciliationAction,
): Record<string, unknown> {
  const runtime = session.runtime;
  return {
    reason: MANAGED_RUNTIME_STARTUP_RECONCILIATION_REASON,
    action,
    previousLifecycleState,
    runtimeOwner: runtime?.runtimeOwner ?? null,
    launchClaimId: runtime?.launchClaimId ?? null,
    launchNonce: runtime?.launchNonce ?? null,
    sdkSessionIdPresent: Boolean(runtime?.sdkSessionId),
    workstreamId: session.graphBinding?.workstreamId ?? null,
    nodeId: session.graphBinding?.nodeId ?? null,
  };
}

export function reconcileManagedRuntimeStartupRows(
  store: SessionRegistryFileStore,
  options: {
    now?: () => Date;
    isOwnerLive?: ManagedRuntimeOwnerVerifier;
    logger?: Pick<Console, "warn">;
  } = {},
): ManagedRuntimeStartupReconciliationResult {
  const result: ManagedRuntimeStartupReconciliationResult = {
    rowsExamined: 0,
    activeRowsFound: 0,
    rowsReconciled: 0,
    rowsSkippedLiveOwner: 0,
    rowsSkippedTerminalTakeover: 0,
    rowsSkippedTerminalTakeoverSdkOwnedAnomaly: 0,
    rowsFailed: 0,
  };

  const now = options.now?.() ?? new Date();
  const timestamp = now.toISOString();
  for (const session of store.listSessions({ includeArchived: false })) {
    const runtime = session.runtime;
    if (runtime?.runtimeKind !== "managed-sdk" || !runtime.lifecycleState) {
      continue;
    }
    result.rowsExamined += 1;

    if (!isManagedRuntimeActive(runtime)) {
      if (runtime.lifecycleState === "terminal_takeover") {
        result.rowsSkippedTerminalTakeover += 1;
      }
      continue;
    }
    result.activeRowsFound += 1;

    if (runtime.lifecycleState === "terminal_takeover") {
      result.rowsSkippedTerminalTakeoverSdkOwnedAnomaly += 1;
      try {
        store.patchRuntimeMetadata(
          session.id,
          {
            progressEvents: [{
              type: "lifecycle",
              message:
                "Managed SDK startup reconciliation preserved terminal takeover state because SDK-to-terminal ownership transfer is final.",
              timestamp,
              data: managedRuntimeStartupDiagnosticData(
                session,
                runtime.lifecycleState,
                MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_PRESERVED_TAKEOVER,
              ),
            }],
          },
          now,
        );
      } catch (error) {
        result.rowsFailed += 1;
        options.logger?.warn(
          `[session-worker] managed-runtime startup reconciliation failed for ${session.id}`,
          error,
        );
      }
      continue;
    }

    if (options.isOwnerLive?.(session) === true) {
      result.rowsSkippedLiveOwner += 1;
      continue;
    }

    try {
      store.patchRuntimeMetadata(
        session.id,
        {
          lifecycleState: "interrupted",
          lastStateChangedAt: timestamp,
          progressEvents: [{
            type: "lifecycle",
            message:
              "Managed SDK startup reconciliation marked this background session interrupted because no live SDK owner could be verified.",
            timestamp,
            data: managedRuntimeStartupDiagnosticData(
              session,
              runtime.lifecycleState,
              MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_INTERRUPTED,
            ),
          }],
        },
        now,
      );
      result.rowsReconciled += 1;
    } catch (error) {
      result.rowsFailed += 1;
      options.logger?.warn(
        `[session-worker] managed-runtime startup reconciliation failed for ${session.id}`,
        error,
      );
    }
  }

  return result;
}
