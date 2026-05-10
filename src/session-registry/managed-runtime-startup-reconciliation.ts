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
}

export type ManagedRuntimeOwnerVerifier = (
  session: SessionRegistryListItem,
) => boolean;

function managedRuntimeStartupDiagnosticData(
  session: SessionRegistryListItem,
  previousLifecycleState: SessionRegistryManagedLifecycleState,
): Record<string, unknown> {
  const runtime = session.runtime;
  return {
    reason: MANAGED_RUNTIME_STARTUP_RECONCILIATION_REASON,
    action: MANAGED_RUNTIME_STARTUP_RECONCILIATION_ACTION_INTERRUPTED,
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
  } = {},
): ManagedRuntimeStartupReconciliationResult {
  const result: ManagedRuntimeStartupReconciliationResult = {
    rowsExamined: 0,
    activeRowsFound: 0,
    rowsReconciled: 0,
    rowsSkippedLiveOwner: 0,
    rowsSkippedTerminalTakeover: 0,
  };

  const now = options.now?.() ?? new Date();
  const timestamp = now.toISOString();
  for (const session of store.listSessions({ includeArchived: false })) {
    const runtime = session.runtime;
    if (runtime?.runtimeKind !== "managed-sdk" || !runtime.lifecycleState) {
      continue;
    }
    result.rowsExamined += 1;

    if (runtime.lifecycleState === "terminal_takeover") {
      result.rowsSkippedTerminalTakeover += 1;
      continue;
    }

    if (!isManagedRuntimeActive(runtime)) {
      continue;
    }
    result.activeRowsFound += 1;

    if (options.isOwnerLive?.(session) === true) {
      result.rowsSkippedLiveOwner += 1;
      continue;
    }

    store.patchRuntimeMetadata(
      session.id,
      {
        lifecycleState: "interrupted",
        progressEvents: [{
          type: "lifecycle",
          message:
            "Managed SDK startup reconciliation marked this background session interrupted because no live SDK owner could be verified.",
          timestamp,
          data: managedRuntimeStartupDiagnosticData(session, runtime.lifecycleState),
        }],
      },
      now,
    );
    result.rowsReconciled += 1;
  }

  return result;
}
