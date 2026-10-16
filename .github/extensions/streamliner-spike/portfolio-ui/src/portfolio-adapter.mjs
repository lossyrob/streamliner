const SUMMARY_WAVE_HEIGHT = 132;
const DETAIL_TASK_HEIGHT = 76;
const DETAIL_WAVE_BASE_HEIGHT = 126;
const HEADER_HEIGHT = 116;
const COLUMN_WIDTH = 356;
const COLUMN_GAP = 190;
const WAVE_GAP = 28;

export function formatPortfolioLabel(value) {
    return String(value || "unknown").replaceAll("_", " ").replaceAll("-", " ");
}

export function wavePositionId(workstreamId, waveId) {
    return `wave:${workstreamId}:${waveId}`;
}

export function workstreamAnchorId(workstreamId) {
    return `ws:${workstreamId}`;
}

export function applyPortfolioPositions(nodes, projection, positions = {}) {
    const next = nodes.map((node) => ({
        ...node,
        position: { ...node.position },
        data: { ...node.data, pinned: Boolean(positions[node.id]) },
    }));
    const byId = new Map(next.map((node) => [node.id, node]));
    for (const workstream of projection.workstreams) {
        const waveNodes = workstream.waves
            .map((wave) => byId.get(wavePositionId(workstream.id, wave.id)))
            .filter(Boolean);
        if (waveNodes.length === 0) continue;
        const baseX = Math.min(...waveNodes.map((node) => node.position.x));
        const baseY = Math.min(...waveNodes.map((node) => node.position.y));
        const anchor = positions[workstreamAnchorId(workstream.id)];
        if (anchor) {
            const dx = anchor.x - baseX;
            const dy = anchor.y - baseY;
            const header = byId.get(`header:${workstream.id}`);
            for (const node of [header, ...waveNodes].filter(Boolean)) {
                node.position = {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                };
            }
        }
        for (const wave of workstream.waves) {
            const id = wavePositionId(workstream.id, wave.id);
            const pin = positions[id];
            const node = byId.get(id);
            if (pin && node) {
                node.position = { x: pin.x, y: pin.y };
                node.data.pinned = true;
            }
        }
    }
    return next;
}

export function positionPatchForDraggedNodes(draggedNodes, currentNodes, projection) {
    const waveToWorkstream = new Map();
    for (const workstream of projection.workstreams) {
        for (const wave of workstream.waves) {
            waveToWorkstream.set(wavePositionId(workstream.id, wave.id), workstream.id);
        }
    }
    const upsert = {};
    const impacted = new Set();
    const draggedIds = new Set();
    for (const node of draggedNodes) {
        const workstreamId = waveToWorkstream.get(node.id);
        if (!workstreamId) continue;
        impacted.add(workstreamId);
        draggedIds.add(node.id);
        upsert[node.id] = { x: node.position.x, y: node.position.y };
    }
    const currentById = new Map(currentNodes.map((node) => [node.id, node]));
    for (const workstreamId of impacted) {
        const workstream = projection.workstreams.find((item) => item.id === workstreamId);
        const allWaveIds = workstream?.waves.map((wave) =>
            wavePositionId(workstreamId, wave.id)
        ) || [];
        if (!allWaveIds.length || !allWaveIds.every((id) => draggedIds.has(id))) {
            continue;
        }
        const positions = workstream?.waves
            .map((wave) => currentById.get(wavePositionId(workstreamId, wave.id))?.position)
            .filter(Boolean);
        if (positions?.length) {
            upsert[workstreamAnchorId(workstreamId)] = {
                x: Math.min(...positions.map((position) => position.x)),
                y: Math.min(...positions.map((position) => position.y)),
            };
        }
    }
    return { upsert, remove: [] };
}

export function filterPortfolio(projection, filters) {
    const workstreams = projection.workstreams.filter((workstream) =>
        !filters.attentionOnly || workstream.attention === "focus"
    );
    const included = new Set(workstreams.map((workstream) => workstream.id));
    const dependencies = projection.dependencies.filter((dependency) => {
        if (
            !included.has(dependency.from.workstreamId)
            || !included.has(dependency.to.workstreamId)
        ) {
            return false;
        }
        if (filters.dependencyState === "risk") {
            return !["validated", "mainline"].includes(dependency.state);
        }
        if (filters.dependencyState === "validated") {
            return ["validated", "mainline"].includes(dependency.state);
        }
        return true;
    });
    return { ...projection, workstreams, dependencies };
}

export function dependencyFocusIds(projection, selection) {
    if (!selection || selection.type === "project") return new Set();
    if (selection.type === "dependency") {
        const edge = projection.dependencies.find((item) => item.id === selection.id);
        return edge
            ? new Set([
                `wave:${edge.from.workstreamId}:${edge.from.waveId}`,
                `wave:${edge.to.workstreamId}:${edge.to.waveId}`,
                edge.id,
            ])
            : new Set();
    }
    const waveId = selection.waveId;
    const workstreamId = selection.workstreamId;
    const focus = new Set([
        `header:${workstreamId}`,
        waveId ? `wave:${workstreamId}:${waveId}` : "",
    ]);
    for (const edge of projection.dependencies) {
        if (
            (edge.from.workstreamId === workstreamId && (!waveId || edge.from.waveId === waveId))
            || (edge.to.workstreamId === workstreamId && (!waveId || edge.to.waveId === waveId))
        ) {
            focus.add(edge.id);
            focus.add(`wave:${edge.from.workstreamId}:${edge.from.waveId}`);
            focus.add(`wave:${edge.to.workstreamId}:${edge.to.waveId}`);
        }
    }
    focus.delete("");
    return focus;
}

function waveHeight(wave, level) {
    return level === "summary"
        ? SUMMARY_WAVE_HEIGHT
        : DETAIL_WAVE_BASE_HEIGHT + wave.nodes.length * DETAIL_TASK_HEIGHT;
}

export function portfolioToFlow(projection, options) {
    const filtered = filterPortfolio(projection, options.filters);
    const focus = dependencyFocusIds(filtered, options.selection);
    const nodes = [];
    const edges = [];
    const wavePositions = new Map();

    filtered.workstreams.forEach((workstream, columnIndex) => {
        const x = 40 + columnIndex * (COLUMN_WIDTH + COLUMN_GAP);
        nodes.push({
            id: `header:${workstream.id}`,
            type: "portfolioHeader",
            position: { x, y: 20 },
            width: COLUMN_WIDTH,
            height: HEADER_HEIGHT,
            style: { width: COLUMN_WIDTH, height: HEADER_HEIGHT },
            draggable: false,
            selectable: true,
            selected: options.selection?.type === "workstream"
                && options.selection.workstreamId === workstream.id,
            className: focus.size > 0 && !focus.has(`header:${workstream.id}`)
                ? "portfolio-element--dim"
                : "",
            data: { workstream },
        });
        let y = 20 + HEADER_HEIGHT + 30;
        workstream.waves.forEach((wave) => {
            const height = waveHeight(wave, options.level);
            const id = `wave:${workstream.id}:${wave.id}`;
            wavePositions.set(id, { x, y, height });
            nodes.push({
                id,
                type: "portfolioWave",
                position: { x, y },
                width: COLUMN_WIDTH,
                height,
                style: { width: COLUMN_WIDTH, height },
                draggable: true,
                selectable: true,
                selected: ["wave", "task"].includes(options.selection?.type)
                    && options.selection.workstreamId === workstream.id
                    && options.selection.waveId === wave.id,
                className: focus.size > 0 && !focus.has(id)
                    ? "portfolio-element--dim"
                    : "",
                data: {
                    workstream,
                    wave,
                    level: options.level,
                    selectedTaskId: options.selection?.type === "task"
                        ? options.selection.taskId
                        : null,
                    onSelectTask: options.onSelectTask,
                },
            });
            y += height + WAVE_GAP;
        });
        for (let index = 0; index < workstream.waves.length - 1; index += 1) {
            edges.push({
                id: `spine:${workstream.id}:${index}`,
                source: `wave:${workstream.id}:${workstream.waves[index].id}`,
                target: `wave:${workstream.id}:${workstream.waves[index + 1].id}`,
                sourceHandle: "spine-out",
                targetHandle: "spine-in",
                type: "smoothstep",
                selectable: false,
                className: "portfolio-spine",
            });
        }
    });

    for (const dependency of filtered.dependencies) {
        const selected = options.selection?.type === "dependency"
            && options.selection.id === dependency.id;
        edges.push({
            id: dependency.id,
            source: `wave:${dependency.from.workstreamId}:${dependency.from.waveId}`,
            target: `wave:${dependency.to.workstreamId}:${dependency.to.waveId}`,
            sourceHandle: "checkpoint-out",
            targetHandle: "checkpoint-in",
            type: "smoothstep",
            label: `${dependency.label} | ${dependency.state}`,
            animated: !["validated", "mainline"].includes(dependency.state),
            selectable: true,
            markerEnd: { type: "arrowclosed", width: 17, height: 17 },
            className: [
                "portfolio-dependency",
                `portfolio-dependency--${dependency.state}`,
                selected ? "portfolio-dependency--selected" : "",
                focus.size > 0 && !focus.has(dependency.id)
                    ? "portfolio-element--dim"
                    : "",
            ].filter(Boolean).join(" "),
            data: { dependency },
        });
    }
    const positionedNodes = applyPortfolioPositions(
        nodes,
        filtered,
        options.positions,
    );
    return {
        nodes: positionedNodes,
        edges,
        filtered,
        focus,
        wavePositions,
    };
}
