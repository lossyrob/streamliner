import type { WorkstreamGraphLayoutResult } from "../workstream-graph";

export function collectViewportFocusIds(
  layout: WorkstreamGraphLayoutResult,
  selectedNodeId: string | null,
): Set<string> {
  if (selectedNodeId) {
    return new Set([
      selectedNodeId,
      ...layout.ancestors,
      ...layout.descendants,
    ]);
  }

  const baseIds = new Set(
    layout.nodes
      .filter(
        ({ entry }) =>
          entry.node.attention === "focus" ||
          entry.operationalStatus === "ready" ||
          entry.operationalStatus === "in-progress" ||
          entry.operationalStatus === "waiting-for-review" ||
          entry.operationalStatus === "waiting-for-validation" ||
          entry.operationalStatus === "blocked",
      )
      .map(({ id }) => id),
  );

  if (baseIds.size === 0) {
    return new Set(
      [
        ...layout.nodes
          .filter(({ entry }) => entry.operationalStatus !== "completed")
          .map(({ id }) => id),
        ...layout.externalNodes.map(({ id }) => id),
      ],
    );
  }

  const focusIds = new Set(baseIds);

  for (const nodeId of baseIds) {
    for (const dependencyId of layout.dependenciesByNode.get(nodeId) ?? []) {
      focusIds.add(dependencyId);
    }
  }

  const queue = [...baseIds].map((nodeId) => ({ nodeId, depth: 0 }));
  const queuedIds = new Set(baseIds);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= 2) {
      continue;
    }

    for (const dependentId of layout.dependentsByNode.get(current.nodeId) ?? []) {
      focusIds.add(dependentId);
      if (queuedIds.has(dependentId)) {
        continue;
      }

      queuedIds.add(dependentId);
      queue.push({ nodeId: dependentId, depth: current.depth + 1 });
    }
  }

  return focusIds;
}
