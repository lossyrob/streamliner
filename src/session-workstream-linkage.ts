import type { SessionRegistryListItem } from "./session-registry-contract";
import { sessionRegistryEffectiveGraphBinding } from "./session-registry-filter";
import type { WorkstreamRegistryListEntry } from "./workstream-registry-contract";
import type { WorkstreamDocument, WorkstreamNode } from "./workstream-schema";

export type WorkstreamGraphLoadState =
  | { status: "loading" }
  | { status: "loaded"; document: WorkstreamDocument }
  | { status: "error"; message: string };

export interface WorkstreamRouteTarget {
  projectKey: string;
  workstreamId: string;
  nodeId?: string | null;
}

export type SessionWorkstreamLinkageStatus =
  | "unbound"
  | "missing-workstream"
  | "ambiguous-workstream"
  | "graph-loading"
  | "graph-unavailable"
  | "node-unresolved"
  | "resolved";

export interface SessionWorkstreamGroupInfo {
  key: string;
  label: string;
  code: string | null;
  order: number;
}

export interface SessionWorkstreamLinkageResolution {
  status: SessionWorkstreamLinkageStatus;
  workstreamId: string | null;
  nodeId: string | null;
  workstreamLabel: string | null;
  nodeLabel: string | null;
  note: string | null;
  matchCount: number;
  workstreamEntry: WorkstreamRegistryListEntry | null;
  node: WorkstreamNode | null;
  workstreamRouteTarget: WorkstreamRouteTarget | null;
  nodeRouteTarget: WorkstreamRouteTarget | null;
  group: SessionWorkstreamGroupInfo;
}

export const UNBOUND_SESSION_WORKSTREAM_GROUP: SessionWorkstreamGroupInfo = {
  key: "__unbound__",
  label: "Unbound / manual sessions",
  code: null,
  order: 0,
};

const UNRESOLVED_GROUP_ORDER = 1_000_000;

export function workstreamRegistryKey(entry: {
  projectKey: string;
  workstreamId: string;
}): string {
  return `${entry.projectKey}/${entry.workstreamId}`;
}

export function canLoadWorkstreamGraph(entry: WorkstreamRegistryListEntry): boolean {
  return entry.fileStatus === "available" && entry.source !== "browser-directory";
}

export function findGraphBindingWorkstreamMatches(
  workstreamId: string,
  workstreams: WorkstreamRegistryListEntry[],
): WorkstreamRegistryListEntry[] {
  return workstreams.filter((entry) => entry.workstreamId === workstreamId);
}

export function resolveSessionWorkstreamLinkage(
  session: Pick<
    SessionRegistryListItem,
    "graphBinding" | "description" | "originKind"
  >,
  workstreams: WorkstreamRegistryListEntry[],
  graphStates: ReadonlyMap<string, WorkstreamGraphLoadState> = new Map(),
): SessionWorkstreamLinkageResolution {
  const binding = sessionRegistryEffectiveGraphBinding(session);
  if (!binding) {
    return {
      status: "unbound",
      workstreamId: null,
      nodeId: null,
      workstreamLabel: null,
      nodeLabel: null,
      note: "This session is not bound to a workstream graph node.",
      matchCount: 0,
      workstreamEntry: null,
      node: null,
      workstreamRouteTarget: null,
      nodeRouteTarget: null,
      group: UNBOUND_SESSION_WORKSTREAM_GROUP,
    };
  }

  const matches = findGraphBindingWorkstreamMatches(binding.workstreamId, workstreams);
  if (matches.length === 0) {
    return {
      status: "missing-workstream",
      workstreamId: binding.workstreamId,
      nodeId: binding.nodeId,
      workstreamLabel: binding.workstreamId,
      nodeLabel: binding.nodeId,
      note: "No tracked workstream currently matches this binding.",
      matchCount: 0,
      workstreamEntry: null,
      node: null,
      workstreamRouteTarget: null,
      nodeRouteTarget: null,
      group: {
        key: `missing:${binding.workstreamId}`,
        label: "Unresolved workstream",
        code: binding.workstreamId,
        order: UNRESOLVED_GROUP_ORDER,
      },
    };
  }

  if (matches.length > 1) {
    return {
      status: "ambiguous-workstream",
      workstreamId: binding.workstreamId,
      nodeId: binding.nodeId,
      workstreamLabel: binding.workstreamId,
      nodeLabel: binding.nodeId,
      note: `Multiple tracked workstreams match this binding (${matches.length}); Streamliner cannot choose a route safely.`,
      matchCount: matches.length,
      workstreamEntry: null,
      node: null,
      workstreamRouteTarget: null,
      nodeRouteTarget: null,
      group: {
        key: `ambiguous:${binding.workstreamId}`,
        label: "Ambiguous workstream",
        code: binding.workstreamId,
        order: UNRESOLVED_GROUP_ORDER + 1,
      },
    };
  }

  const workstreamEntry = matches[0];
  const registryKey = workstreamRegistryKey(workstreamEntry);
  const workstreamRouteTarget: WorkstreamRouteTarget = {
    projectKey: workstreamEntry.projectKey,
    workstreamId: workstreamEntry.workstreamId,
  };
  const group: SessionWorkstreamGroupInfo = {
    key: `workstream:${registryKey}`,
    label: workstreamEntry.title,
    code: registryKey,
    order:
      workstreams.findIndex((entry) => workstreamRegistryKey(entry) === registryKey) + 1,
  };
  const graphState = graphStates.get(registryKey);

  if (graphState?.status === "loaded") {
    const node =
      graphState.document.nodes.find((candidate) => candidate.id === binding.nodeId) ??
      null;
    if (node) {
      return {
        status: "resolved",
        workstreamId: binding.workstreamId,
        nodeId: binding.nodeId,
        workstreamLabel: workstreamEntry.title,
        nodeLabel: node.title,
        note: null,
        matchCount: 1,
        workstreamEntry,
        node,
        workstreamRouteTarget,
        nodeRouteTarget: { ...workstreamRouteTarget, nodeId: binding.nodeId },
        group,
      };
    }

    return {
      status: "node-unresolved",
      workstreamId: binding.workstreamId,
      nodeId: binding.nodeId,
      workstreamLabel: workstreamEntry.title,
      nodeLabel: binding.nodeId,
      note: "The workstream graph loaded, but this node id was not found.",
      matchCount: 1,
      workstreamEntry,
      node: null,
      workstreamRouteTarget,
      nodeRouteTarget: null,
      group,
    };
  }

  if (graphState?.status === "error") {
    return {
      status: "graph-unavailable",
      workstreamId: binding.workstreamId,
      nodeId: binding.nodeId,
      workstreamLabel: workstreamEntry.title,
      nodeLabel: binding.nodeId,
      note: graphState.message,
      matchCount: 1,
      workstreamEntry,
      node: null,
      workstreamRouteTarget,
      nodeRouteTarget: null,
      group,
    };
  }

  const graphCanLoad = canLoadWorkstreamGraph(workstreamEntry);
  if (graphState?.status === "loading" || graphCanLoad) {
    return {
      status: "graph-loading",
      workstreamId: binding.workstreamId,
      nodeId: binding.nodeId,
      workstreamLabel: workstreamEntry.title,
      nodeLabel: binding.nodeId,
      note: "Loading the workstream graph to resolve the node title.",
      matchCount: 1,
      workstreamEntry,
      node: null,
      workstreamRouteTarget,
      nodeRouteTarget: null,
      group,
    };
  }

  return {
    status: "graph-unavailable",
    workstreamId: binding.workstreamId,
    nodeId: binding.nodeId,
    workstreamLabel: workstreamEntry.title,
    nodeLabel: binding.nodeId,
    note: "This tracked workstream graph is not backend-readable from the Sessions view.",
    matchCount: 1,
    workstreamEntry,
    node: null,
    workstreamRouteTarget,
    nodeRouteTarget: null,
    group,
  };
}
