import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
    Background,
    BackgroundVariant,
    Controls,
    Handle,
    MiniMap,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { formatStatusLabel, projectionToFlow } from "./projection-adapter.mjs";
import "./styles.css";

function WorkstreamNode({ data }) {
    const { node, statusLabel, tone } = data;
    const gate = node.type === "gate";
    const durableDiffers = node.durableStatus !== node.runtimeStatus;
    return (
        <article className={`flow-card flow-card--${tone} ${gate ? "flow-card--gate" : ""}`}>
            <Handle type="target" position={Position.Top} isConnectable={false} />
            <header className="flow-card__header">
                <span className="flow-card__kind">{gate ? "Acceptance gate" : node.type}</span>
                <span className={`status-pill status-pill--${tone}`}>{statusLabel}</span>
            </header>
            <h2>{node.title}</h2>
            <p>{node.summary}</p>
            <footer className="flow-card__footer">
                <span>
                    {node.dependencies.length === 0
                        ? "No dependencies"
                        : `${node.dependencies.filter((item) => item.complete).length}/${node.dependencies.length} dependencies complete`}
                </span>
                {durableDiffers ? (
                    <span>Artifact: {formatStatusLabel(node.durableStatus)}</span>
                ) : null}
            </footer>
            {node.binding ? (
                <div className="flow-card__binding">
                    <span className="binding-dot" aria-hidden="true" />
                    App binding {formatStatusLabel(node.binding.status)}
                </div>
            ) : null}
            <Handle type="source" position={Position.Bottom} isConnectable={false} />
        </article>
    );
}

const nodeTypes = {
    workstreamTask: WorkstreamNode,
    workstreamGate: WorkstreamNode,
};

function useCanvasColorMode() {
    const readMode = useCallback(() => {
        const value = document.documentElement.getAttribute("data-color-mode")
            || document.body.getAttribute("data-color-mode");
        return value === "dark" ? "dark" : "light";
    }, []);
    const [mode, setMode] = useState(readMode);
    useEffect(() => {
        const observer = new MutationObserver(() => setMode(readMode()));
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-color-mode"],
        });
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ["data-color-mode"],
        });
        return () => observer.disconnect();
    }, [readMode]);
    return mode;
}

function NodeDetails({ node, onClose }) {
    if (!node) {
        return (
            <aside className="details-panel details-panel--empty">
                <div>
                    <span className="eyebrow">Node detail</span>
                    <h2>Select a graph node</h2>
                    <p>Inspect dependencies, exact-revision status, and App binding evidence.</p>
                </div>
            </aside>
        );
    }
    return (
        <aside className="details-panel">
            <header className="details-panel__header">
                <div>
                    <span className="eyebrow">{node.type === "gate" ? "Acceptance gate" : node.type}</span>
                    <h2>{node.title}</h2>
                </div>
                <button className="icon-button" type="button" onClick={onClose} aria-label="Close node details">
                    Close
                </button>
            </header>
            <p className="details-panel__summary">{node.summary}</p>
            <dl className="detail-grid">
                <div>
                    <dt>Node ID</dt>
                    <dd><code>{node.id}</code></dd>
                </div>
                <div>
                    <dt>Runtime</dt>
                    <dd>{formatStatusLabel(node.runtimeStatus)}</dd>
                </div>
                <div>
                    <dt>Artifact</dt>
                    <dd>{formatStatusLabel(node.durableStatus)}</dd>
                </div>
                <div>
                    <dt>Dependencies</dt>
                    <dd>{node.dependenciesComplete ? "Complete" : "Waiting"}</dd>
                </div>
            </dl>
            <section className="details-section">
                <h3>Dependency path</h3>
                {node.dependencies.length === 0 ? (
                    <p>Root node with no prerequisites.</p>
                ) : (
                    <ul className="dependency-list">
                        {node.dependencies.map((dependency) => (
                            <li key={dependency.id}>
                                <span className={dependency.complete ? "dependency-state dependency-state--done" : "dependency-state"}>
                                    {dependency.complete ? "Complete" : "Waiting"}
                                </span>
                                <span>{dependency.title}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <section className="details-section">
                <h3>App runtime overlay</h3>
                {node.binding ? (
                    <dl className="binding-grid">
                        <div>
                            <dt>Launch</dt>
                            <dd><code>{node.binding.launchId}</code></dd>
                        </div>
                        <div>
                            <dt>Status</dt>
                            <dd>{formatStatusLabel(node.binding.status)}</dd>
                        </div>
                        <div>
                            <dt>Claimed session</dt>
                            <dd><code>{node.binding.claimedBySessionId || "Not claimed"}</code></dd>
                        </div>
                        <div>
                            <dt>Evidence</dt>
                            <dd><code>{node.binding.completionEvidence || "Pending"}</code></dd>
                        </div>
                    </dl>
                ) : (
                    <p>No prepared or claimed App launch is bound to this node at the selected revision.</p>
                )}
            </section>
        </aside>
    );
}

function WorkstreamFlow({ projection, selectedNodeId, onSelect }) {
    const elements = useMemo(() => projectionToFlow(projection), [projection]);
    const displayNodes = useMemo(
        () => elements.nodes.map((node) => ({
            ...node,
            selected: node.id === selectedNodeId,
        })),
        [elements.nodes, selectedNodeId],
    );
    const colorMode = useCanvasColorMode();
    const flowHostRef = useRef(null);
    const reactFlow = useReactFlow();
    useEffect(() => {
        let fitTimeout = null;
        const fit = () => {
            window.clearTimeout(fitTimeout);
            fitTimeout = window.setTimeout(() => {
                void reactFlow.fitView({
                    padding: 0.24,
                    maxZoom: 0.92,
                    duration: 180,
                });
            }, 90);
        };
        const observer = new ResizeObserver(fit);
        if (flowHostRef.current) {
            observer.observe(flowHostRef.current);
        }
        fit();
        return () => {
            observer.disconnect();
            window.clearTimeout(fitTimeout);
        };
    }, [elements.nodes, reactFlow]);
    const minimapColor = useCallback((node) => {
        switch (node.data?.tone) {
            case "gate":
            case "blocked":
                return "var(--true-color-red, #cf222e)";
            case "completed":
            case "active":
                return "var(--true-color-blue, #0969da)";
            default:
                return "var(--text-color-muted, #656d76)";
        }
    }, []);
    return (
        <div className="flow-host" ref={flowHostRef}>
            <ReactFlow
                nodes={displayNodes}
                edges={elements.edges}
                nodeTypes={nodeTypes}
                colorMode={colorMode}
                fitView
                fitViewOptions={{ padding: 0.24, maxZoom: 0.92, duration: 250 }}
                minZoom={0.18}
                maxZoom={1.6}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                selectionOnDrag={false}
                panOnDrag
                panOnScroll
                zoomOnScroll
                zoomOnPinch
                onNodeClick={(_event, node) => onSelect(node.id)}
                onPaneClick={() => onSelect(null)}
                className="workstream-flow"
                aria-label="Read-only workstream dependency graph"
            >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
                <Controls
                    position="bottom-left"
                    showInteractive={false}
                    fitViewOptions={{ padding: 0.24, maxZoom: 0.92, duration: 250 }}
                />
                <MiniMap
                    position="bottom-right"
                    pannable
                    zoomable
                    nodeBorderRadius={8}
                    nodeColor={minimapColor}
                    bgColor="var(--background-color-default, #ffffff)"
                />
            </ReactFlow>
        </div>
    );
}

function App() {
    const [projection, setProjection] = useState(null);
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [requestState, setRequestState] = useState("loading");
    const [error, setError] = useState(null);

    const loadProjection = useCallback(async (refresh = false) => {
        setRequestState("loading");
        try {
            const response = await fetch(refresh ? "/api/refresh" : "/api/projection", {
                method: refresh ? "POST" : "GET",
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            setProjection(await response.json());
            setError(null);
            setRequestState("ready");
        } catch (failure) {
            setError(failure.message);
            setRequestState("error");
        }
    }, []);

    useEffect(() => {
        void loadProjection();
        const events = new EventSource("/events");
        events.addEventListener("projection", (event) => {
            setProjection(JSON.parse(event.data));
            setError(null);
            setRequestState("ready");
        });
        events.addEventListener("error", () => {
            setRequestState((current) => current === "loading" ? current : "stale");
        });
        return () => events.close();
    }, [loadProjection]);

    const selectedNode = projection?.nodes.find((node) => node.id === selectedNodeId) || null;
    const bindingCount = projection
        ? projection.summary.preparedCount
            + projection.summary.claimedCount
            + projection.summary.completedCount
        : 0;

    return (
        <main className="app-shell">
            <header className="app-header">
                <div className="app-header__copy">
                    <span className="eyebrow">Exact-revision workstream</span>
                    <h1>{projection?.workstream.title || "App-native Streamliner spike"}</h1>
                    <p>{projection?.workstream.summary || "Loading durable graph and App runtime overlay..."}</p>
                </div>
                <div className="app-header__actions">
                    <span className={`connection-pill connection-pill--${requestState}`}>
                        {requestState === "ready" ? "Live projection" : formatStatusLabel(requestState)}
                    </span>
                    <button
                        className="refresh-button"
                        type="button"
                        onClick={() => void loadProjection(true)}
                        disabled={requestState === "loading"}
                    >
                        Refresh
                    </button>
                </div>
            </header>
            {projection ? (
                <section className="provenance-strip" aria-label="Artifact and runtime summary">
                    <div>
                        <span>Revision</span>
                        <code title={projection.artifact.revision}>
                            {projection.artifact.revision.slice(0, 12)}
                        </code>
                    </div>
                    <div>
                        <span>Nodes</span>
                        <strong>{projection.summary.nodeCount}</strong>
                    </div>
                    <div>
                        <span>Gates</span>
                        <strong>{projection.summary.gateCount}</strong>
                    </div>
                    <div>
                        <span>App bindings</span>
                        <strong>{bindingCount}</strong>
                    </div>
                    <div>
                        <span>Mode</span>
                        <strong>Read only</strong>
                    </div>
                </section>
            ) : null}
            {error ? <div className="error-banner" role="alert">{error}</div> : null}
            <section className={`canvas-layout ${selectedNode ? "canvas-layout--selected" : ""}`}>
                <div className="graph-panel">
                    {projection ? (
                        <ReactFlowProvider>
                            <WorkstreamFlow
                                projection={projection}
                                selectedNodeId={selectedNodeId}
                                onSelect={setSelectedNodeId}
                            />
                        </ReactFlowProvider>
                    ) : (
                        <div className="loading-state">Loading exact-revision graph...</div>
                    )}
                </div>
                <NodeDetails node={selectedNode} onClose={() => setSelectedNodeId(null)} />
            </section>
        </main>
    );
}

createRoot(document.getElementById("root")).render(<App />);
