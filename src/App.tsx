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
import type {
  WorkstreamRegistryListEntry,
  WorkstreamRegistryListResponse,
  WorkstreamRegistryWarning,
} from "./workstream-registry-contract";
import { WorkstreamCanvas } from "./components/WorkstreamCanvas";
import { NodeInspector } from "./components/NodeInspector";
import { OperationalStatusStrip } from "./components/OperationalStatusStrip";
import { CheckpointStepper } from "./components/CheckpointStepper";
import { WorkstreamHeader } from "./components/WorkstreamHeader";
import { SessionsPage } from "./components/SessionsPage";

const POLL_INTERVAL_MS = 2000;
const LAST_GRAPH_KEY = "streamliner:lastGraphPath";
const STREAMLINER_LOGO_URL = "/streamliner-logo.png";

type DashboardRoute =
  | { view: "landing"; message?: string }
  | { view: "workstreams"; message?: string }
  | { view: "sessions" }
  | { view: "workstream"; projectKey: string; workstreamId: string };

interface GraphLoadError {
  code?: string;
  message: string;
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function isKebabCaseId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function workstreamRoutePath(entry: {
  projectKey: string;
  workstreamId: string;
}): string {
  return `/workstreams/${encodeSegment(entry.projectKey)}/${encodeSegment(entry.workstreamId)}`;
}

function readDashboardRoute(): DashboardRoute {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get("view") === "sessions" || window.location.pathname === "/sessions") {
    return { view: "sessions" };
  }
  if (window.location.pathname === "/" || window.location.pathname === "") {
    return { view: "landing" };
  }

  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments[0] !== "workstreams") {
    return { view: "landing", message: "Choose a Streamliner view." };
  }
  if (segments.length === 1) {
    return { view: "workstreams" };
  }
  if (segments.length !== 3) {
    return { view: "workstreams", message: "That workstream URL is incomplete." };
  }

  const projectKey = decodeSegment(segments[1]);
  const workstreamId = decodeSegment(segments[2]);
  if (
    !projectKey ||
    !workstreamId ||
    !isKebabCaseId(projectKey) ||
    !isKebabCaseId(workstreamId)
  ) {
    return { view: "workstreams", message: "That workstream URL is invalid." };
  }
  return { view: "workstream", projectKey, workstreamId };
}

function routePath(route: DashboardRoute): string {
  switch (route.view) {
    case "sessions":
      return "/sessions";
    case "workstream":
      return workstreamRoutePath(route);
    case "workstreams":
      return "/workstreams";
    case "landing":
      return "/";
  }
}

function useDashboardRoute() {
  const [route, setRouteState] = useState<DashboardRoute>(() => readDashboardRoute());

  useEffect(() => {
    window.localStorage.removeItem(LAST_GRAPH_KEY);
  }, []);

  useEffect(() => {
    const handlePopState = () => setRouteState(readDashboardRoute());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "sessions") {
      window.history.replaceState({}, "", "/sessions");
    }
  }, []);

  const setRoute = useCallback((nextRoute: DashboardRoute, mode: "push" | "replace" = "push") => {
    const path = routePath(nextRoute);
    if (`${window.location.pathname}${window.location.search}` !== path) {
      if (mode === "replace") {
        window.history.replaceState({}, "", path);
      } else {
        window.history.pushState({}, "", path);
      }
    }
    setRouteState(nextRoute);
  }, []);

  return { route, setRoute };
}

function registryKey(entry: { projectKey: string; workstreamId: string }): string {
  return `${entry.projectKey}/${entry.workstreamId}`;
}

function registryGraphUrl(entry: { projectKey: string; workstreamId: string }): string {
  return `/api/workstreams/${encodeSegment(entry.projectKey)}/${encodeSegment(entry.workstreamId)}/graph`;
}

function registryEntryUrl(entry: { projectKey: string; workstreamId: string }): string {
  return `/api/workstreams/${encodeSegment(entry.projectKey)}/${encodeSegment(entry.workstreamId)}`;
}

async function parseErrorResponse(res: Response): Promise<GraphLoadError> {
  try {
    const body = await res.json() as { code?: unknown; error?: unknown };
    return {
      code: typeof body.code === "string" ? body.code : undefined,
      message: typeof body.error === "string" ? body.error : `Request failed (${res.status})`,
    };
  } catch {
    return { message: `Request failed (${res.status})` };
  }
}

function useGraphLoader(route: DashboardRoute, enabled: boolean) {
  const activeProjectKey = route.view === "workstream" ? route.projectKey : null;
  const activeWorkstreamId = route.view === "workstream" ? route.workstreamId : null;
  const activeWorkstream = useMemo(
    () =>
      activeProjectKey && activeWorkstreamId
        ? { projectKey: activeProjectKey, workstreamId: activeWorkstreamId }
        : null,
    [activeProjectKey, activeWorkstreamId],
  );
  const [workstream, setWorkstream] = useState<WorkstreamDocument | null>(null);
  const [error, setError] = useState<GraphLoadError | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [workstreams, setWorkstreams] = useState<WorkstreamRegistryListEntry[]>([]);
  const [migrationWarnings, setMigrationWarnings] = useState<WorkstreamRegistryWarning[]>([]);
  const lastModifiedRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRegistry = useCallback(async () => {
    const res = await fetch("/api/workstreams");
    if (!res.ok) {
      const parsed = await parseErrorResponse(res);
      throw new Error(parsed.message);
    }
    const body = await res.json() as WorkstreamRegistryListResponse;
    setWorkstreams(body.workstreams);
    setMigrationWarnings(body.migrationWarnings);
    setRegistryError(null);
    return body.workstreams;
  }, []);

  const loadRegistered = useCallback(
    async (entry: { projectKey: string; workstreamId: string }, options: { quiet?: boolean } = {}) => {
      const res = await fetch(registryGraphUrl(entry), {
        headers:
          lastModifiedRef.current && options.quiet
            ? { "If-Modified-Since": lastModifiedRef.current }
            : undefined,
      });
      if (res.status === 304) {
        return;
      }
      if (!res.ok) {
        const parsed = await parseErrorResponse(res);
        setWorkstream(null);
        setError(parsed);
        return;
      }
      const text = await res.text();
      const doc = parseWorkstreamDocument(text);
      lastModifiedRef.current = res.headers.get("Last-Modified");
      setWorkstream(doc);
      setError(null);
      await fetchRegistry();
    },
    [fetchRegistry],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void (async () => {
      try {
        await fetchRegistry();
        if (activeWorkstream) {
          await loadRegistered(activeWorkstream);
        } else {
          setWorkstream(null);
          setError(null);
        }
      } catch (nextError) {
        setRegistryError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    })();
  }, [activeWorkstream, enabled, fetchRegistry, loadRegistered]);

  useEffect(() => {
    if (!enabled || !activeWorkstream || error) {
      return;
    }

    pollRef.current = setInterval(() => {
      void loadRegistered(activeWorkstream, { quiet: true });
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [activeWorkstream, enabled, error, loadRegistered]);

  const registerPath = useCallback(
    async (path: string) => {
      const res = await fetch("/api/workstreams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        throw new Error((await parseErrorResponse(res)).message);
      }
      const body = await res.json() as { workstream: WorkstreamRegistryListEntry };
      await fetchRegistry();
      return body.workstream;
    },
    [fetchRegistry],
  );

  const relinkPath = useCallback(
    async (path: string) => {
      if (!activeWorkstream) {
        throw new Error("No active workstream to relink.");
      }
      const res = await fetch(registryEntryUrl(activeWorkstream), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        throw new Error((await parseErrorResponse(res)).message);
      }
      const body = await res.json() as { workstream: WorkstreamRegistryListEntry };
      await fetchRegistry();
      await loadRegistered(activeWorkstream);
      return body.workstream;
    },
    [activeWorkstream, fetchRegistry, loadRegistered],
  );

  const untrack = useCallback(
    async (entry: { projectKey: string; workstreamId: string }) => {
      const res = await fetch(registryEntryUrl(entry), { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error((await parseErrorResponse(res)).message);
      }
      await fetchRegistry();
    },
    [fetchRegistry],
  );

  const pickAndRegister = useCallback(async () => {
    const res = await fetch("/api/pick-file", { method: "POST" });
    if (res.status === 204) return null;
    if (!res.ok) {
      throw new Error((await parseErrorResponse(res)).message);
    }
    const { path } = await res.json() as { path?: unknown };
    if (typeof path !== "string" || path.trim().length === 0) {
      return null;
    }
    return registerPath(path);
  }, [registerPath]);

  const pickAndRelink = useCallback(async () => {
    const res = await fetch("/api/pick-file", { method: "POST" });
    if (res.status === 204) return null;
    if (!res.ok) {
      throw new Error((await parseErrorResponse(res)).message);
    }
    const { path } = await res.json() as { path?: unknown };
    if (typeof path !== "string" || path.trim().length === 0) {
      return null;
    }
    return relinkPath(path);
  }, [relinkPath]);

  return {
    workstream,
    error,
    registryError,
    workstreams,
    migrationWarnings,
    activeWorkstream,
    pickAndRegister,
    pickAndRelink,
    untrack,
  };
}

function LandingPage({
  message,
  workstreamCount,
  registryError,
  onOpenSessions,
  onOpenWorkstreams,
}: {
  message?: string;
  workstreamCount: number;
  registryError: string | null;
  onOpenSessions: () => void | Promise<void>;
  onOpenWorkstreams: () => void | Promise<void>;
}) {
  return (
    <div className="sl-shell-panel">
      <div className="sl-landing">
        <section className="sl-landing-hero">
          <span className="sl-eyebrow">STREAMLINER</span>
          <h1>Keep parallel work visible.</h1>
          <p>
            Jump into tracked workstream graphs or review your active Copilot CLI sessions.
          </p>
          {message && <div className="sl-action-error">{message}</div>}
          {registryError && <div className="sl-action-error">{registryError}</div>}
        </section>
        <div className="sl-landing-cards">
          <button className="sl-landing-card" onClick={() => void onOpenWorkstreams()}>
            <span className="sl-landing-card-kicker">Graph workspace</span>
            <span className="sl-landing-card-title">Workstreams</span>
            <span className="sl-landing-card-copy">
              Open sticky graph URLs, add workstream files, and untrack completed work.
            </span>
            <span className="sl-landing-card-meta">
              {workstreamCount === 1 ? "1 tracked workstream" : `${workstreamCount} tracked workstreams`}
            </span>
          </button>
          <button className="sl-landing-card" onClick={() => void onOpenSessions()}>
            <span className="sl-landing-card-kicker">Live activity</span>
            <span className="sl-landing-card-title">Sessions</span>
            <span className="sl-landing-card-copy">
              Browse, label, relaunch, and manage local Copilot CLI sessions.
            </span>
            <span className="sl-landing-card-meta">Open session registry</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkstreamHome({
  message,
  registryError,
  workstreams,
  onOpenWorkstream,
  onAddWorkstream,
  onUntrackWorkstream,
}: {
  message?: string;
  registryError: string | null;
  workstreams: WorkstreamRegistryListEntry[];
  onOpenWorkstream: (entry: WorkstreamRegistryListEntry) => void;
  onAddWorkstream: () => void | Promise<void>;
  onUntrackWorkstream: (entry: WorkstreamRegistryListEntry) => void | Promise<void>;
}) {
  return (
    <div className="sl-shell-panel">
      <div className="sl-workstreams-home">
        <div className="sl-workstreams-home-header">
          <div>
            <span className="sl-eyebrow">WORKSTREAMS</span>
            <h1 className="sl-title">Tracked workstreams</h1>
            <p className="sl-summary">
              Open a registered graph, or add a graph file to keep it addressable by URL.
            </p>
          </div>
          <button className="sl-action-btn primary" onClick={() => void onAddWorkstream()}>
            Add workstream…
          </button>
        </div>
        {message && <div className="sl-action-error">{message}</div>}
        {registryError && <div className="sl-action-error">{registryError}</div>}
        {workstreams.length === 0 ? (
          <div className="sl-empty-state">
            <h2>No tracked workstreams yet</h2>
            <p>Add a `graph.json` file to register it with Streamliner.</p>
          </div>
        ) : (
          <div className="sl-workstreams-list">
            {workstreams.map((entry) => (
              <div className="sl-workstream-card" key={registryKey(entry)}>
                <button className="sl-workstream-card-main" onClick={() => onOpenWorkstream(entry)}>
                  <span className="sl-workstream-card-title">{entry.title}</span>
                  <span className="sl-workstream-card-id">{registryKey(entry)}</span>
                  <span className={`sl-pill ${entry.fileStatus === "available" ? "green" : "amber"}`}>
                    {entry.fileStatus}
                  </span>
                </button>
                <button
                  className="sl-action-btn danger"
                  onClick={() => void onUntrackWorkstream(entry)}
                  aria-label={`Untrack ${entry.title}`}
                >
                  Untrack
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GraphDashboard({
  workstream,
  error,
  workstreams,
  activeWorkstream,
  pickAndRelink,
  untrack,
  onOpenWorkstream,
  onAddWorkstream,
  onRouteHome,
}: ReturnType<typeof useGraphLoader> & {
  onOpenWorkstream: (entry: WorkstreamRegistryListEntry) => void;
  onAddWorkstream: () => void | Promise<void>;
  onRouteHome: () => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const handleRelink = async () => {
    setActionError(null);
    try {
      const entry = await pickAndRelink();
      if (entry) {
        onOpenWorkstream(entry);
      }
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const handleUntrackCurrent = async () => {
    if (!activeWorkstream) {
      return;
    }
    setActionError(null);
    try {
      await untrack(activeWorkstream);
      onRouteHome();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  if (error) {
    return (
      <div className="sl-shell-panel">
        <div className="sl-status-shell">
          <div className="sl-status-card">
            <h2 className="sl-status-title">Workstream unavailable</h2>
            <div className="sl-action-error">{error.message}</div>
            {actionError && <div className="sl-action-error">{actionError}</div>}
            <div className="sl-header-actions" style={{ justifyContent: "flex-start" }}>
              <button className="sl-action-btn" onClick={handleRelink}>
                Relink graph…
              </button>
              <button className="sl-action-btn danger" onClick={handleUntrackCurrent}>
                Untrack workstream
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!workstream || !viewModel || !layout || !activeWorkstream) {
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
        activeWorkstream={activeWorkstream}
        trackedWorkstreams={workstreams}
        onOpenWorkstream={onOpenWorkstream}
        onAddWorkstream={onAddWorkstream}
        onUntrackWorkstream={(entry) => {
          void (async () => {
            await untrack(entry);
            if (registryKey(entry) === registryKey(activeWorkstream)) {
              onRouteHome();
            }
          })();
        }}
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

function MigrationWarningsBanner({
  warnings,
}: {
  warnings: WorkstreamRegistryWarning[];
}) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="sl-global-warning-list">
      {warnings.map((warning, index) => (
        <div className="sl-warning-item" key={`${warning.code}-${warning.path ?? index}`}>
          {warning.message}
        </div>
      ))}
    </div>
  );
}

function DashboardNav({
  route,
  onRouteChange,
}: {
  route: DashboardRoute;
  onRouteChange: (route: DashboardRoute) => void | Promise<void>;
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
    void onRouteChange({ view: "landing" });
  };

  const workstreamsActive = route.view === "workstreams" || route.view === "workstream";

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
          className={`sl-action-btn${workstreamsActive ? " active" : ""}`}
          onClick={() => {
            void onRouteChange({ view: "workstreams" });
          }}
        >
          Workstreams
        </button>
        <button
          className={`sl-action-btn${route.view === "sessions" ? " active" : ""}`}
          onClick={() => {
            void onRouteChange({ view: "sessions" });
          }}
        >
          Sessions
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { route, setRoute } = useDashboardRoute();
  const graphLoader = useGraphLoader(route, route.view !== "sessions");
  const beforeLeaveRef = useRef<(() => Promise<boolean>) | null>(null);

  const handleRouteChange = useCallback(
    async (nextRoute: DashboardRoute) => {
      if (routePath(nextRoute) === routePath(route)) {
        return;
      }
      if (route.view === "sessions") {
        const beforeLeave = beforeLeaveRef.current;
        if (beforeLeave && !(await beforeLeave())) {
          return;
        }
      }
      setRoute(nextRoute);
    },
    [route, setRoute],
  );

  const registerBeforeLeave = useCallback((handler: (() => Promise<boolean>) | null) => {
    beforeLeaveRef.current = handler;
  }, []);

  const openWorkstream = useCallback(
    (entry: { projectKey: string; workstreamId: string }) => {
      setRoute({ view: "workstream", projectKey: entry.projectKey, workstreamId: entry.workstreamId });
    },
    [setRoute],
  );

  const addWorkstream = useCallback(async () => {
    const entry = await graphLoader.pickAndRegister();
    if (entry) {
      openWorkstream(entry);
    }
  }, [graphLoader, openWorkstream]);

  const untrackFromHome = useCallback(
    async (entry: WorkstreamRegistryListEntry) => {
      await graphLoader.untrack(entry);
    },
    [graphLoader],
  );

  return (
    <div className="sl-root">
      <DashboardNav route={route} onRouteChange={handleRouteChange} />
      <MigrationWarningsBanner warnings={graphLoader.migrationWarnings} />
      {route.view === "sessions" ? (
        <SessionsPage registerBeforeLeave={registerBeforeLeave} />
      ) : route.view === "workstream" ? (
        <GraphDashboard
          {...graphLoader}
          onOpenWorkstream={openWorkstream}
          onAddWorkstream={addWorkstream}
          onRouteHome={() => setRoute({ view: "workstreams" }, "replace")}
        />
      ) : route.view === "workstreams" ? (
        <WorkstreamHome
          message={route.message}
          registryError={graphLoader.registryError}
          workstreams={graphLoader.workstreams}
          onOpenWorkstream={openWorkstream}
          onAddWorkstream={addWorkstream}
          onUntrackWorkstream={untrackFromHome}
        />
      ) : (
        <LandingPage
          message={route.message}
          registryError={graphLoader.registryError}
          workstreamCount={graphLoader.workstreams.length}
          onOpenSessions={() => handleRouteChange({ view: "sessions" })}
          onOpenWorkstreams={() => handleRouteChange({ view: "workstreams" })}
        />
      )}
    </div>
  );
}
