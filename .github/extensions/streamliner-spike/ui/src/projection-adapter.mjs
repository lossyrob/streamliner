import dagre from "@dagrejs/dagre";

export const FLOW_NODE_WIDTH = 292;
export const FLOW_TASK_HEIGHT = 184;
export const FLOW_GATE_HEIGHT = 154;

export function formatStatusLabel(value) {
    return String(value || "unknown").replaceAll("_", " ").replaceAll("-", " ");
}

export function statusToneFor(node) {
    if (node.type === "gate") {
        return "gate";
    }
    switch (node.runtimeStatus) {
        case "runtime-completed":
        case "completed":
            return "completed";
        case "session-claimed":
        case "launch-prepared":
        case "operationally-ready":
        case "ready":
            return "active";
        case "blocked":
            return "blocked";
        default:
            return "planned";
    }
}

export function projectionToFlow(projection) {
    if (!projection || !Array.isArray(projection.nodes) || !Array.isArray(projection.edges)) {
        throw new Error("Projection must contain node and edge arrays.");
    }
    const layout = new dagre.graphlib.Graph();
    layout.setGraph({
        rankdir: "TB",
        ranksep: 88,
        nodesep: 56,
        marginx: 28,
        marginy: 28,
    });
    layout.setDefaultEdgeLabel(() => ({}));

    for (const node of projection.nodes) {
        layout.setNode(node.id, {
            width: FLOW_NODE_WIDTH,
            height: node.type === "gate" ? FLOW_GATE_HEIGHT : FLOW_TASK_HEIGHT,
        });
    }
    for (const edge of projection.edges) {
        layout.setEdge(edge.from, edge.to);
    }
    dagre.layout(layout);

    const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
    const nodes = projection.nodes.map((node) => {
        const dimensions = {
            width: FLOW_NODE_WIDTH,
            height: node.type === "gate" ? FLOW_GATE_HEIGHT : FLOW_TASK_HEIGHT,
        };
        const point = layout.node(node.id);
        return {
            id: node.id,
            type: node.type === "gate" ? "workstreamGate" : "workstreamTask",
            position: {
                x: point.x - dimensions.width / 2,
                y: point.y - dimensions.height / 2,
            },
            width: dimensions.width,
            height: dimensions.height,
            style: dimensions,
            draggable: false,
            connectable: false,
            selectable: true,
            data: {
                node,
                tone: statusToneFor(node),
                statusLabel: formatStatusLabel(node.runtimeStatus),
            },
            ariaLabel: `${node.title}, ${formatStatusLabel(node.runtimeStatus)}`,
        };
    });
    const edges = projection.edges.map((edge) => {
        const target = nodeById.get(edge.to);
        const dependency = target?.dependencies?.find((item) => item.id === edge.from);
        const active = ["launch-prepared", "session-claimed"].includes(
            target?.runtimeStatus,
        );
        return {
            id: `dependency:${edge.from}:${edge.to}`,
            source: edge.from,
            target: edge.to,
            type: "smoothstep",
            animated: active,
            className: dependency?.complete
                ? "flow-edge flow-edge--complete"
                : "flow-edge flow-edge--pending",
            markerEnd: {
                type: "arrowclosed",
                width: 16,
                height: 16,
            },
            data: {
                complete: Boolean(dependency?.complete),
            },
        };
    });
    return { nodes, edges };
}
