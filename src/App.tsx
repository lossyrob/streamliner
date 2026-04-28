import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
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
import { CheckpointStepper } from "./components/CheckpointStepper";
import { WorkstreamHeader } from "./components/WorkstreamHeader";
import { SessionsPage } from "./components/SessionsPage";

const POLL_INTERVAL_MS = 2000;
const LAST_GRAPH_KEY = "streamliner:lastGraphPath";
const STREAMLINER_LOGO_URL = "/streamliner-logo.png";

interface RecentEntry {
  path: string;
  title: string;
  id: string;
  lastOpened: string;
}

type DashboardView = "graph" | "sessions";

function readDashboardView(): DashboardView {
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get("view") === "sessions" ? "sessions" : "graph";
}

function useDashboardView() {
  const [view, setViewState] = useState<DashboardView>(() => readDashboardView());

  useEffect(() => {
    const handlePopState = () => setViewState(readDashboardView());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const setView = useCallback((nextView: DashboardView) => {
    const nextUrl = new URL(window.location.href);
    if (nextView === "graph") {
      nextUrl.searchParams.delete("view");
    } else {
      nextUrl.searchParams.set("view", "sessions");
    }
    window.history.pushState({}, "", nextUrl);
    setViewState(nextView);
  }, []);

  return { view, setView };
}

function useGraphLoader(enabled: boolean) {
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
    } catch {
      /* ignore */
    }
  }, []);

  const loadFromApi = useCallback(
    async (path?: string) => {
      const url = path ? `/api/graph.json?path=${encodeURIComponent(path)}` : "/api/graph.json";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
      const text = await res.text();
      const doc = parseWorkstreamDocument(text);
      lastModifiedRef.current = res.headers.get("Last-Modified");
      const effectivePath = path ?? "default";
      graphPathRef.current = effectivePath;
      localStorage.setItem(LAST_GRAPH_KEY, effectivePath);
      setWorkstream(doc);
      setSource("api");
      setError(null);
      await fetchRecents();
    },
    [fetchRecents],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void (async () => {
      const lastPath = localStorage.getItem(LAST_GRAPH_KEY);
      try {
        if (lastPath && lastPath !== "default") {
          await loadFromApi(lastPath);
        } else {
          await loadFromApi();
        }
      } catch {
        try {
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
          } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : String(nextError));
          }
        }
      }
      await fetchRecents();
    })();
  }, [enabled, fetchRecents, loadFromApi]);

  useEffect(() => {
    if (!enabled || source !== "api") return;

    pollRef.current = setInterval(async () => {
      try {
        const path = graphPathRef.current;
        const url =
          path && path !== "default"
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
      } catch {
        /* ignore */
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [enabled, source]);

  const switchToRecent = useCallback(
    async (path: string) => {
      try {
        await loadFromApi(path);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    },
    [loadFromApi],
  );

  const loadByPath = useCallback(
    async (path: string) => {
      try {
        await loadFromApi(path);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    },
    [loadFromApi],
  );

  return { workstream, error, recents, loadByPath, switchToRecent };
}

function GraphDashboard({
  workstream,
  error,
  recents,
  loadByPath,
  switchToRecent,
}: ReturnType<typeof useGraphLoader>) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const viewModel = useMemo(() => {
    if (!workstream) return null;
    return buildWorkstreamViewModel(workstream);
  }, [workstream]);

  const layout = useMemo(() => {
    if (!workstream || !viewModel) return null;
    return buildWorkstreamGraphLayout(workstream, viewModel, selectedNodeId);
  }, [selectedNodeId, viewModel, workstream]);

  const selectedEntry = useMemo(() => {
    if (!selectedNodeId || !viewModel) return null;
    return viewModel.derivedNodes.find((entry) => entry.node.id === selectedNodeId) ?? null;
  }, [selectedNodeId, viewModel]);

  if (error) {
    const handlePick = async () => {
      try {
        const res = await fetch("/api/pick-file", { method: "POST" });
        if (res.status === 204 || !res.ok) return;
        const { path } = await res.json();
        if (path) {
          await loadByPath(path);
        }
      } catch {
        /* ignore */
      }
    };

    return (
      <div className="sl-shell-panel">
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
      <div className="sl-shell-panel">
        <div className="sl-status-shell">
          <div className="sl-status-card">
            <h2 className="sl-status-title">Loading…</h2>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sl-shell-panel">
      <WorkstreamHeader
        workstream={workstream}
        viewModel={viewModel}
        onLoadPath={loadByPath}
        recents={recents}
        onSwitchRecent={switchToRecent}
      />
      <OperationalStatusStrip viewModel={viewModel} />
      <CheckpointStepper checkpoints={viewModel.checkpoints} />
      <div className="sl-body">
        <ReactFlowProvider>
          <WorkstreamCanvas
            layout={layout}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
          />
        </ReactFlowProvider>
        <div className="sl-sidebar">
          <NodeInspector entry={selectedEntry} layout={layout} workstream={workstream} />
        </div>
      </div>
    </div>
  );
}

function DashboardNav({
  view,
  onViewChange,
}: {
  view: DashboardView;
  onViewChange: (view: DashboardView) => void | Promise<void>;
}) {
  const handleBrandClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    void onViewChange("graph");
  };

  return (
    <div className="sl-shell-nav">
      <a
        className="sl-shell-brand"
        href="/"
        aria-label="Streamliner home"
        onClick={handleBrandClick}
      >
        <img
          className="sl-shell-brand-logo"
          src={STREAMLINER_LOGO_URL}
          alt=""
          aria-hidden="true"
        />
        <div className="sl-shell-brand-stack">
          <span className="sl-shell-brand-wordmark">Streamliner</span>
          <span className="sl-shell-brand-rail" aria-hidden="true" />
        </div>
      </a>
      <div className="sl-header-actions">
        <button
          className={`sl-action-btn${view === "graph" ? " active" : ""}`}
          onClick={() => {
            void onViewChange("graph");
          }}
        >
          Workstream
        </button>
        <button
          className={`sl-action-btn${view === "sessions" ? " active" : ""}`}
          onClick={() => {
            void onViewChange("sessions");
          }}
        >
          My Sessions
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { view, setView } = useDashboardView();
  const graphLoader = useGraphLoader(view === "graph");
  const beforeLeaveRef = useRef<(() => Promise<boolean>) | null>(null);

  const handleViewChange = useCallback(
    async (nextView: DashboardView) => {
      if (nextView === view) {
        return;
      }
      if (view === "sessions") {
        const beforeLeave = beforeLeaveRef.current;
        if (beforeLeave && !(await beforeLeave())) {
          return;
        }
      }
      setView(nextView);
    },
    [setView, view],
  );

  const registerBeforeLeave = useCallback((handler: (() => Promise<boolean>) | null) => {
    beforeLeaveRef.current = handler;
  }, []);

  return (
    <div className="sl-root">
      <DashboardNav view={view} onViewChange={handleViewChange} />
      {view === "graph" ? (
        <GraphDashboard {...graphLoader} />
      ) : (
        <SessionsPage registerBeforeLeave={registerBeforeLeave} />
      )}
    </div>
  );
}
