import type { SessionRegistryListItem } from "./session-registry-contract";
import type { SessionRegistryManagedLifecycleState } from "./session-registry-schema";

const SESSION_ACTIVITY_ATTENTION_RANK: Record<
  SessionRegistryListItem["activityStatus"],
  number
> = {
  waiting_for_input: 4,
  interrupted: 3,
  working: 2,
  exited: 1,
  unknown: 1,
};

const MANAGED_LIFECYCLE_ATTENTION_RANK: Record<SessionRegistryManagedLifecycleState, number> = {
  waiting_for_builder: 6,
  interrupt_requested: 5,
  failed: 5,
  running: 4,
  starting: 4,
  preparing: 3,
  pr_ready: 3,
  review_ready: 3,
  cleanup_ready: 3,
  terminal_takeover: 3,
  cleaning_up: 3,
  idle: 2,
  interrupted: 2,
  canceled: 1,
  completed: 1,
  cleaned_up: 1,
};

export interface GraphNodeSessionStatusSummary {
  nodeId: string;
  sessions: SessionRegistryListItem[];
  primarySession: SessionRegistryListItem;
  count: number;
}

export type GraphNodeSessionStatusState = "loading" | "ready" | "error";

function activityAttentionRank(session: SessionRegistryListItem): number {
  const managedState = session.runtime?.lifecycleState;
  if (managedState) {
    return MANAGED_LIFECYCLE_ATTENTION_RANK[managedState];
  }
  return SESSION_ACTIVITY_ATTENTION_RANK[session.activityStatus] ?? 1;
}

function freshnessTimestamp(session: SessionRegistryListItem): number {
  const candidates = [
    session.trustedLastSignalAt,
    session.runtime?.lastStateChangedAt,
    session.activityStatusUpdatedAt,
    session.lastSeenAt,
    session.updatedAt,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return candidates.length > 0 ? Math.max(...candidates) : Number.NEGATIVE_INFINITY;
}

function compareSessionAttention(
  left: SessionRegistryListItem,
  right: SessionRegistryListItem,
): number {
  const attentionDelta = activityAttentionRank(right) - activityAttentionRank(left);
  if (attentionDelta !== 0) {
    return attentionDelta;
  }

  const freshnessDelta = freshnessTimestamp(right) - freshnessTimestamp(left);
  if (freshnessDelta !== 0) {
    return freshnessDelta;
  }

  return left.id.localeCompare(right.id);
}

export function buildGraphNodeSessionStatusMap(
  sessions: readonly SessionRegistryListItem[],
  workstreamId: string,
): Map<string, GraphNodeSessionStatusSummary> {
  const sessionsByNodeId = new Map<string, SessionRegistryListItem[]>();

  for (const session of sessions) {
    if (session.originKind === "manual") {
      continue;
    }
    const binding = session.graphBinding;
    if (!binding || binding.workstreamId !== workstreamId) {
      continue;
    }
    const existing = sessionsByNodeId.get(binding.nodeId);
    if (existing) {
      existing.push(session);
    } else {
      sessionsByNodeId.set(binding.nodeId, [session]);
    }
  }

  const summaries = new Map<string, GraphNodeSessionStatusSummary>();
  for (const [nodeId, nodeSessions] of sessionsByNodeId) {
    const orderedSessions = [...nodeSessions].sort(compareSessionAttention);
    const primarySession = orderedSessions[0];
    if (!primarySession) {
      continue;
    }
    summaries.set(nodeId, {
      nodeId,
      sessions: orderedSessions,
      primarySession,
      count: orderedSessions.length,
    });
  }

  return summaries;
}
