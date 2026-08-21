import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
    Background,
    BackgroundVariant,
    Controls,
    Handle,
    Panel,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
    dependencyFocusIds,
    filterPortfolio,
    formatPortfolioLabel,
    portfolioToFlow,
} from "./portfolio-adapter.mjs";
import "./styles.css";

const PROJECT_SELECTION = { type: "project" };

function WorkstreamHeader({ data }) {
    const workstream = data.workstream;
    return (
        <article className={`portfolio-header portfolio-tone--${workstream.risk}`}>
            <span className="eyebrow">{workstream.region}</span>
            <h2>{workstream.title}</h2>
            <p>{workstream.summary}</p>
            <footer>
                <span>{workstream.waves.length} waves</span>
                <span>{workstream.runtimeBindings} bindings</span>
                <span>{workstream.attention}</span>
            </footer>
        </article>
    );
}

function WaveNode({ data }) {
    const { wave, workstream, level } = data;
    const first = workstream.waves[0]?.id === wave.id;
    const last = workstream.waves.at(-1)?.id === wave.id;
    return (
        <article className={`portfolio-wave portfolio-wave--${wave.status}`}>
            {!first ? <Handle id="spine-in" type="target" position={Position.Top} /> : null}
            {!last ? <Handle id="spine-out" type="source" position={Position.Bottom} /> : null}
            <Handle id="checkpoint-in" type="target" position={Position.Left} />
            <Handle id="checkpoint-out" type="source" position={Position.Right} />
            <header>
                <span className="wave-index">{String(wave.index + 1).padStart(2, "0")}</span>
                <div>
                    <span className="eyebrow">{wave.publicCheckpoint.title}</span>
                    <h3>{wave.title}</h3>
                </div>
                <span className={`availability availability--${wave.publicCheckpoint.availability}`}>
                    {formatPortfolioLabel(wave.publicCheckpoint.availability)}
                </span>
            </header>
            <p>{wave.summary}</p>
            <div className="wave-meta">
                <span>{wave.completedNodes}/{wave.totalNodes} complete</span>
                <span>Exports {wave.publicCheckpoint.export}</span>
            </div>
            {level === "detail" ? (
                <div className="wave-tasks">
                    {wave.nodes.map((node) => (
                        <button
                            key={node.id}
                            type="button"
                            className={data.selectedTaskId === node.id ? "task-row task-row--selected" : "task-row"}
                            onClick={(event) => {
                                event.stopPropagation();
                                data.onSelectTask(workstream.id, wave.id, node.id);
                            }}
                        >
                            <span>
                                <strong>{node.title}</strong>
                                <small>{node.type} | {node.attention}</small>
                            </span>
                            <span className="task-status">{formatPortfolioLabel(node.runtimeStatus)}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </article>
    );
}

const nodeTypes = {
    portfolioHeader: WorkstreamHeader,
    portfolioWave: WaveNode,
};

function useNarrowPanel() {
    const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 760px)").matches);
    useEffect(() => {
        const media = matchMedia("(max-width: 760px)");
        const update = () => setNarrow(media.matches);
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    return narrow;
}

function PortfolioFlow({ projection, level, filters, selection, setSelection }) {
    const reactFlow = useReactFlow();
    const onSelectTask = useCallback((workstreamId, waveId, taskId) => {
        setSelection({ type: "task", workstreamId, waveId, taskId });
    }, [setSelection]);
    const flow = useMemo(() => portfolioToFlow(projection, {
        level,
        filters,
        selection,
        onSelectTask,
    }), [projection, level, filters, selection, onSelectTask]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            if (selection.type === "dependency") {
                const edge = flow.filtered.dependencies.find((item) => item.id === selection.id);
                const ids = edge ? [
                    `wave:${edge.from.workstreamId}:${edge.from.waveId}`,
                    `wave:${edge.to.workstreamId}:${edge.to.waveId}`,
                ] : [];
                const nodes = flow.nodes.filter((node) => ids.includes(node.id));
                if (nodes.length) {
                    void reactFlow.fitView({ nodes, padding: 0.35, maxZoom: 0.86, duration: 250 });
                    return;
                }
            }
            void reactFlow.fitView({ padding: 0.1, maxZoom: 0.82, duration: 220 });
        }, 50);
        return () => clearTimeout(timeout);
    }, [flow.filtered.dependencies, flow.nodes, level, filters, selection, reactFlow]);

    return (
        <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            minZoom={0.25}
            maxZoom={1.35}
            panOnScroll
            onNodeClick={(_event, node) => {
                if (node.id.startsWith("header:")) {
                    setSelection({ type: "workstream", workstreamId: node.id.slice(7) });
                } else if (node.id.startsWith("wave:")) {
                    const [, workstreamId, waveId] = node.id.split(":");
                    setSelection({ type: "wave", workstreamId, waveId });
                }
            }}
            onEdgeClick={(_event, edge) => {
                if (!edge.id.startsWith("spine:")) {
                    setSelection({ type: "dependency", id: edge.id });
                }
            }}
            onPaneClick={() => setSelection(PROJECT_SELECTION)}
            className="portfolio-flow"
        >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1.1} />
            <Controls fitViewOptions={{ padding: 0.1, maxZoom: 0.82 }} />
            <Panel position="bottom-right" className="geometry-key">
                <strong>{level === "summary" ? "Checkpoint summary" : "Wave tasks"}</strong>
                <span>Cross-workstream edges attach only at public checkpoints.</span>
            </Panel>
        </ReactFlow>
    );
}

function selectionEntity(projection, selection) {
    if (selection.type === "dependency") {
        return projection.dependencies.find((item) => item.id === selection.id) || null;
    }
    if (selection.type === "workstream") {
        return projection.workstreams.find((item) => item.id === selection.workstreamId) || null;
    }
    if (["wave", "task"].includes(selection.type)) {
        const workstream = projection.workstreams.find((item) => item.id === selection.workstreamId);
        const wave = workstream?.waves.find((item) => item.id === selection.waveId);
        const task = selection.type === "task"
            ? wave?.nodes.find((item) => item.id === selection.taskId)
            : null;
        return { workstream, wave, task };
    }
    return projection.portfolio;
}

function Inspector({ projection, selection }) {
    const entity = selectionEntity(projection, selection);
    if (selection.type === "dependency" && entity) {
        return (
            <aside className="portfolio-inspector">
                <span className="eyebrow">Checkpoint dependency</span>
                <h2>{entity.label}</h2>
                <div className="inspector-pills">
                    <span className={`availability availability--${entity.state}`}>{formatPortfolioLabel(entity.state)}</span>
                    <span className="muted-pill">focused path</span>
                </div>
                <section><h3>Risk</h3><p>{entity.risk}</p></section>
                <section><h3>Action</h3><p>{entity.action}</p></section>
                <section><h3>Contract path</h3><p><strong>{entity.from.export}</strong> becomes <strong>{entity.to.import}</strong>.</p></section>
            </aside>
        );
    }
    if (selection.type === "workstream" && entity) {
        return (
            <aside className="portfolio-inspector">
                <span className="eyebrow">Workstream | {entity.region}</span>
                <h2>{entity.title}</h2>
                <p>{entity.summary}</p>
                <div className="inspector-pills">
                    <span className={`risk-pill risk-pill--${entity.risk}`}>{entity.risk} risk</span>
                    <span className="muted-pill">{entity.availability}</span>
                </div>
                <section><h3>Runtime</h3><p>{entity.runtimeBindings} local launch bindings at this exact revision.</p></section>
            </aside>
        );
    }
    if (["wave", "task"].includes(selection.type) && entity?.wave) {
        const subject = entity.task || entity.wave;
        return (
            <aside className="portfolio-inspector">
                <span className="eyebrow">{entity.task ? "Task" : "Public checkpoint"}</span>
                <h2>{subject.title}</h2>
                <p>{subject.summary}</p>
                <div className="inspector-pills">
                    <span className="muted-pill">{formatPortfolioLabel(entity.task?.runtimeStatus || entity.wave.status)}</span>
                    <span className="muted-pill">{entity.workstream.title}</span>
                </div>
                {entity.task?.binding ? (
                    <section><h3>Runtime completion</h3><p>{entity.task.binding.completionSummary || entity.task.binding.status}</p></section>
                ) : null}
                <section><h3>Availability</h3><p>{entity.wave.publicCheckpoint.availability} | {entity.wave.completedNodes}/{entity.wave.totalNodes} nodes complete.</p></section>
            </aside>
        );
    }
    return (
        <aside className="portfolio-inspector">
            <span className="eyebrow">Project overview</span>
            <h2>{projection.portfolio.project.title}</h2>
            <p>{projection.portfolio.summary}</p>
            <div className="overview-grid">
                <div><strong>{projection.summary.workstreamCount}</strong><span>Workstreams</span></div>
                <div><strong>{projection.summary.checkpointCount}</strong><span>Checkpoints</span></div>
                <div><strong>{projection.summary.dependencyCount}</strong><span>Dependencies</span></div>
                <div><strong>{projection.summary.runtimeBindingCount}</strong><span>Bindings</span></div>
            </div>
            <section><h3>Geometry rule</h3><p>Public wave checkpoints carry cross-workstream contracts. Internal task geometry remains inside its workstream.</p></section>
        </aside>
    );
}

function NarrowPortfolio({ projection, level, filters, selection, setSelection }) {
    const filtered = filterPortfolio(projection, filters);
    const focus = dependencyFocusIds(filtered, selection);
    return (
        <div className="narrow-portfolio">
            {filtered.workstreams.map((workstream) => (
                <section key={workstream.id} className="narrow-workstream">
                    <button type="button" onClick={() => setSelection({ type: "workstream", workstreamId: workstream.id })}>
                        <span className="eyebrow">{workstream.region}</span>
                        <strong>{workstream.title}</strong>
                        <small>{workstream.risk} risk | {workstream.runtimeBindings} bindings</small>
                    </button>
                    <div className="narrow-waves">
                        {workstream.waves.map((wave) => (
                            <article key={wave.id} className={focus.has(`wave:${workstream.id}:${wave.id}`) ? "narrow-wave narrow-wave--focused" : "narrow-wave"}>
                                <button type="button" onClick={() => setSelection({ type: "wave", workstreamId: workstream.id, waveId: wave.id })}>
                                    <span>{String(wave.index + 1).padStart(2, "0")}</span>
                                    <strong>{wave.title}</strong>
                                    <small>{wave.publicCheckpoint.availability} | {wave.completedNodes}/{wave.totalNodes}</small>
                                </button>
                                {level === "detail" ? wave.nodes.map((node) => (
                                    <button key={node.id} className="narrow-task" type="button" onClick={() => setSelection({ type: "task", workstreamId: workstream.id, waveId: wave.id, taskId: node.id })}>
                                        {node.title}<small>{formatPortfolioLabel(node.runtimeStatus)}</small>
                                    </button>
                                )) : null}
                            </article>
                        ))}
                    </div>
                </section>
            ))}
            <section className="narrow-dependencies">
                <span className="eyebrow">Checkpoint contracts</span>
                {filtered.dependencies.map((edge) => (
                    <button key={edge.id} type="button" onClick={() => setSelection({ type: "dependency", id: edge.id })}>
                        <strong>{edge.label}</strong>
                        <span>{edge.state} | {edge.from.workstreamId} to {edge.to.workstreamId}</span>
                    </button>
                ))}
            </section>
        </div>
    );
}

function App() {
    const [projection, setProjection] = useState(null);
    const [selection, setSelection] = useState(PROJECT_SELECTION);
    const [level, setLevel] = useState("summary");
    const [filters, setFilters] = useState({ attentionOnly: false, dependencyState: "all" });
    const [error, setError] = useState(null);
    const narrow = useNarrowPanel();
    const load = useCallback(async (refresh = false) => {
        try {
            const response = await fetch(refresh ? "/api/portfolio/refresh" : "/api/portfolio/projection", {
                method: refresh ? "POST" : "GET",
            });
            if (!response.ok) throw new Error(await response.text());
            setProjection(await response.json());
            setError(null);
        } catch (failure) {
            setError(failure.message);
        }
    }, []);
    useEffect(() => {
        void load();
        const events = new EventSource("/events");
        events.addEventListener("projection", (event) => setProjection(JSON.parse(event.data)));
        return () => events.close();
    }, [load]);

    return (
        <main className="portfolio-shell">
            <header className="portfolio-toolbar">
                <div>
                    <span className="eyebrow">Project portfolio | exact revision</span>
                    <h1>{projection?.portfolio.title || "Streamliner portfolio"}</h1>
                    <p>{projection?.portfolio.summary || "Loading portfolio projection..."}</p>
                </div>
                <div className="toolbar-actions">
                    <div className="segmented" aria-label="Semantic zoom">
                        {["summary", "detail"].map((value) => (
                            <button key={value} className={level === value ? "active" : ""} type="button" onClick={() => setLevel(value)}>
                                {value}
                            </button>
                        ))}
                    </div>
                    <label><input type="checkbox" checked={filters.attentionOnly} onChange={(event) => setFilters({ ...filters, attentionOnly: event.target.checked })} /> Focus only</label>
                    <select value={filters.dependencyState} onChange={(event) => setFilters({ ...filters, dependencyState: event.target.value })} aria-label="Dependency state filter">
                        <option value="all">All dependencies</option>
                        <option value="risk">At-risk dependencies</option>
                        <option value="validated">Validated dependencies</option>
                    </select>
                    <button type="button" onClick={() => void load(true)}>Refresh</button>
                </div>
            </header>
            {projection ? (
                <div className="portfolio-stats">
                    <span><strong>{projection.summary.workstreamCount}</strong> workstreams</span>
                    <span><strong>{projection.summary.checkpointCount}</strong> public checkpoints</span>
                    <span><strong>{projection.summary.dependencyCount}</strong> dependencies</span>
                    <span><strong>{projection.summary.runtimeBindingCount}</strong> runtime bindings</span>
                    <code>{projection.artifact.revision.slice(0, 12)}</code>
                </div>
            ) : null}
            {error ? <div className="portfolio-error">{error}</div> : null}
            {projection ? (
                <div className="portfolio-body">
                    <section className="portfolio-canvas">
                        {narrow ? (
                            <NarrowPortfolio projection={projection} level={level} filters={filters} selection={selection} setSelection={setSelection} />
                        ) : (
                            <ReactFlowProvider>
                                <PortfolioFlow projection={projection} level={level} filters={filters} selection={selection} setSelection={setSelection} />
                            </ReactFlowProvider>
                        )}
                    </section>
                    <Inspector projection={projection} selection={selection} />
                </div>
            ) : <div className="portfolio-loading">Loading exact-revision portfolio...</div>}
        </main>
    );
}

createRoot(document.getElementById("root")).render(<App />);
