import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./streamliner-theme.css";
import {
  parseWorkstreamDocument,
  buildWorkstreamViewModel,
} from "./workstream-view-model";
import { buildWorkstreamGraphLayout } from "./workstream-graph";
import type { WorkstreamDocument } from "./workstream-schema";
import { WorkstreamCanvas } from "./components/WorkstreamCanvas";
import { NodeInspector } from "./components/NodeInspector";
import { OperationalStatusStrip } from "./components/OperationalStatusStrip";
import { WorkstreamHeader } from "./components/WorkstreamHeader";

const POLL_INTERVAL_MS = 2000;
const LAST_GRAPH_KEY = "streamliner:lastGraphPath";

interface RecentEntry {
  path: string;
  title: string;
  id: string;
  lastOpened: string;
}

function useGraphLoader() {
  const [workstream, setWorkstream] = useState<WorkstreamDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "example" | "file" | null>(null);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const lastModifiedRef = useRef<string | null>(null);
  const graphPathRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRecents = useCallback(async () => {
    try {
      const res = await fetch("/api/recents");
      if (res.ok) setRecents(await res.json());
    } catch { /* ignore */ }
  }, []);

  const loadFromApi = useCallback(async (path?: string) => {
    const url = path ? `/api/graph.json?path=${encodeURIComponent(path)}` : "/api/graph.json";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
    const text = await res.text();
    const doc = parseWorkstreamDocument(text);
    lastModifiedRef.current = res.headers.get("Last-Modified");
    // Remember which path we're polling
    const effectivePath = path ?? "default";
    graphPathRef.current = effectivePath;
    localStorage.setItem(LAST_GRAPH_KEY, effectivePath);
    setWorkstream(doc);
    setSource("api");
    setError(null);
    await fetchRecents();
  }, [fetchRecents]);

  // Initial load: try last-used path, then default API, then example
  useEffect(() => {
    (async () => {
      const lastPath = localStorage.getItem(LAST_GRAPH_KEY);
      try {
        if (lastPath && lastPath !== "default") {
          await loadFromApi(lastPath);
        } else {
          await loadFromApi();
        }
      } catch {
        try {
          // If the remembered path failed, try default
          if (lastPath && lastPath !== "default") {
            await loadFromApi();
          } else {
            throw new Error("no default");
          }
        } catch {
          try {
            const res = await fetch("/example-project.json");
            if (!res.ok) throw new Error(`${res.status}`);
            const text = await res.text();
            setWorkstream(parseWorkstreamDocument(text));
            setSource("example");
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      }
      await fetchRecents();
    })();
  }, [loadFromApi, fetchRecents]);

  // Poll for changes when using the API source
  useEffect(() => {
    if (source !== "api") return;

    pollRef.current = setInterval(async () => {
      try {
        const path = graphPathRef.current;
        const url = path && path !== "default"
          ? `/api/graph.json?path=${encodeURIComponent(path)}`
          : "/api/graph.json";
        const headers: HeadersInit = {};
        if (lastModifiedRef.current) {
          headers["If-Modified-Since"] = lastModifiedRef.current;
        }
        const res = await fetch(url, { headers });
        if (res.status === 304) return;
        if (!res.ok) return;
        const text = await res.text();
        const doc = parseWorkstreamDocument(text);
        lastModifiedRef.current = res.headers.get("Last-Modified");
        setWorkstream(doc);
        setError(null);
      } catch { /* ignore */ }
    }, POLL_INTERVAL_MS);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [source]);

  const switchToRecent = useCallback(async (path: string) => {
    try {
      await loadFromApi(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadFromApi]);

  const loadByPath = useCallback(async (path: string) => {
    try {
      await loadFromApi(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadFromApi]);

  return { workstream, error, recents, loadByPath, switchToRecent };
}

export default function App() {
  const { workstream, error, recents, loadByPath, switchToRecent } = useGraphLoader();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const viewModel = useMemo(() => {
    if (!workstream) return null;
    return buildWorkstreamViewModel(workstream);
  }, [workstream]);

  const layout = useMemo(() => {
    if (!workstream || !viewModel) return null;
    return buildWorkstreamGraphLayout(workstream, viewModel, selectedNodeId);
  }, [workstream, viewModel, selectedNodeId]);

  const selectedEntry = useMemo(() => {
    if (!selectedNodeId || !viewModel) return null;
    return (
      viewModel.derivedNodes.find((e) => e.node.id === selectedNodeId) ?? null
    );
  }, [selectedNodeId, viewModel]);

  if (error) {
    const handlePick = async () => {
      try {
        const res = await fetch("/api/pick-file", { method: "POST" });
        if (res.status === 204) return;
        if (!res.ok) return;
        const { path } = await res.json();
        if (path) loadByPath(path);
      } catch { /* ignore */ }
    };
    return (
      <div className="sl-root">
        <div className="sl-status-shell">
          <div className="sl-status-card">
            <h2 className="sl-status-title">Failed to load workstream</h2>
            <div className="sl-action-error">{error}</div>
            <button
              className="sl-action-btn"
              style={{ alignSelf: "flex-start" }}
              onClick={handlePick}
            >
              Open graph…
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!workstream || !viewModel || !layout) {
    return (
      <div className="sl-root">
        <div className="sl-status-shell">
          <div className="sl-status-card">
            <h2 className="sl-status-title">Loading…</h2>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sl-root">
      <WorkstreamHeader
        workstream={workstream}
        viewModel={viewModel}
        onLoadPath={loadByPath}
        recents={recents}
        onSwitchRecent={switchToRecent}
      />
      <OperationalStatusStrip viewModel={viewModel} />
      <div className="sl-body">
        <ReactFlowProvider>
          <WorkstreamCanvas
            layout={layout}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
          />
        </ReactFlowProvider>
        <div className="sl-sidebar">
          <NodeInspector
            entry={selectedEntry}
            layout={layout}
            workstream={workstream}
          />
        </div>
      </div>
    </div>
  );
}
