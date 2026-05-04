import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  WorkstreamConflict,
  WorkstreamRegistryListEntry,
  WorkstreamRegistryListResponse,
  WorkstreamRegistryWarning,
  WorkstreamSourceListEntry,
  WorkstreamSourceType,
} from "./workstream-registry-contract";
import { WorkstreamCanvas } from "./components/WorkstreamCanvas";
import { NodeInspector } from "./components/NodeInspector";
import { OperationalStatusStrip } from "./components/OperationalStatusStrip";
import { CheckpointStepper } from "./components/CheckpointStepper";
import { WorkstreamHeader } from "./components/WorkstreamHeader";
import {
  PawLaunchDialog,
  type PawLaunchDialogHandoff,
  type PawLaunchProgressEvent,
} from "./components/PawLaunchDialog";
import {
  DEFAULT_PAW_TERMINAL_CONFIGURATION,
  DEFAULT_PAW_WORKFLOW_INSTRUCTIONS,
  type PawLaunchDialogConfiguration,
  type PawLaunchDialogDefaults,
} from "./components/paw-launch-config";
import { SessionsPage } from "./components/SessionsPage";
import {
  deleteBrowserWorkstreamEntry,
  listBrowserWorkstreamEntries,
  readBrowserWorkstreamGraph,
} from "./browser-workstream-files";
import type {
  NodeLaunchRecord,
  NodeLaunchRecordResponse,
} from "./node-launch-record-contract";
import {
  encodeRouteSegment,
  handleInAppLinkClick,
  routePath,
  workstreamRoutePath,
  type DashboardRoute,
} from "./dashboard-routing";

const POLL_INTERVAL_MS = 2000;
const LAST_GRAPH_KEY = "streamliner:lastGraphPath";
const STREAMLINER_LOGO_URL = "/streamliner-logo.png";

interface GraphLoadError {
  code?: string;
  message: string;
}

interface PawLaunchPreparationResponse extends PawLaunchDialogHandoff {
  cwd: string;
  launchMetadata: {
    launchNonce: string | null;
    projectKey: string;
    workstreamId: string;
    nodeId: string;
  };
}

interface PawLaunchRunStartResponse {
  runId?: string;
  status?: string;
}

interface PawLaunchRunError {
  error?: string;
  code?: string;
  step?: string;
  input?: string;
}

interface PawLaunchRunFinishedPayload {
  result?: PawLaunchPreparationResponse;
  error?: PawLaunchRunError;
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

function parseMessageEventData<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
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
  return `/api/workstreams/${encodeRouteSegment(entry.projectKey)}/${encodeRouteSegment(entry.workstreamId)}/graph`;
}

function registryEntryUrl(entry: { projectKey: string; workstreamId: string }): string {
  return `/api/workstreams/${encodeRouteSegment(entry.projectKey)}/${encodeRouteSegment(entry.workstreamId)}`;
}

function registryArchiveUrl(entry: { projectKey: string; workstreamId: string }): string {
  return `${registryEntryUrl(entry)}/archive`;
}

function sourceEntryUrl(sourceId: string): string {
  return `/api/workstream-sources/${encodeRouteSegment(sourceId)}`;
}

function isBrowserWorkstreamEntry(entry: WorkstreamRegistryListEntry): boolean {
  return entry.source === "browser-directory";
}

function isSourceWorkstreamEntry(entry: WorkstreamRegistryListEntry): boolean {
  return entry.source === "source";
}

function isPathWorkstreamEntry(entry: WorkstreamRegistryListEntry): boolean {
  return !entry.source || entry.source === "path";
}

function isBackendReadableWorkstreamEntry(entry: WorkstreamRegistryListEntry): boolean {
  return !isBrowserWorkstreamEntry(entry) && entry.fileStatus === "available";
}

function createLaunchNonce(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `launch-${Date.now().toString(36)}`;
}

function mergeWorkstreamEntries(
  serverEntries: WorkstreamRegistryListEntry[],
  browserEntries: WorkstreamRegistryListEntry[],
): WorkstreamRegistryListEntry[] {
  const merged = new Map<string, WorkstreamRegistryListEntry>();
  for (const entry of serverEntries) {
    merged.set(registryKey(entry), entry);
  }
  for (const entry of browserEntries) {
    if (!merged.has(registryKey(entry))) {
      merged.set(registryKey(entry), entry);
    }
  }
  return [...merged.values()].sort(
    (left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt),
  );
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

async function loadNodeLaunchRecord(
  graphPath: string,
  nodeId: string,
): Promise<NodeLaunchRecord | null> {
  const params = new URLSearchParams({ graphPath, nodeId });
  const response = await fetch(`/api/node-launch-records?${params.toString()}`);
  if (!response.ok) {
    const parsed = await parseErrorResponse(response);
    throw new Error(parsed.message);
  }
  const body = await response.json() as NodeLaunchRecordResponse;
  return body.record ?? null;
}

function normalizeRegistryListResponse(
  body: Partial<WorkstreamRegistryListResponse>,
): WorkstreamRegistryListResponse {
  return {
    version: body.version ?? 1,
    migratedFromRecentsAt: body.migratedFromRecentsAt,
    migrationWarnings: body.migrationWarnings ?? [],
    workstreams: body.workstreams ?? [],
    archivedWorkstreams: body.archivedWorkstreams,
    sources: body.sources,
    conflicts: body.conflicts,
  };
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
  const [archivedWorkstreams, setArchivedWorkstreams] = useState<WorkstreamRegistryListEntry[]>([]);
  const [sources, setSources] = useState<WorkstreamSourceListEntry[]>([]);
  const [conflicts, setConflicts] = useState<WorkstreamConflict[]>([]);
  const [migrationWarnings, setMigrationWarnings] = useState<WorkstreamRegistryWarning[]>([]);
  const workstreamsRef = useRef<WorkstreamRegistryListEntry[]>([]);
  const lastModifiedRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyRegistryResponse = useCallback((body: WorkstreamRegistryListResponse) => {
    const mergedWorkstreams = mergeWorkstreamEntries(body.workstreams, listBrowserWorkstreamEntries());
    workstreamsRef.current = mergedWorkstreams;
    setWorkstreams(mergedWorkstreams);
    setArchivedWorkstreams(body.archivedWorkstreams ?? []);
    setSources(body.sources ?? []);
    setConflicts(body.conflicts ?? []);
    setMigrationWarnings(body.migrationWarnings ?? []);
    setRegistryError(null);
    return mergedWorkstreams;
  }, []);

  const fetchRegistry = useCallback(async () => {
    const res = await fetch("/api/workstreams");
    if (!res.ok) {
      const parsed = await parseErrorResponse(res);
      throw new Error(parsed.message);
    }
    return applyRegistryResponse(normalizeRegistryListResponse(
      await res.json() as Partial<WorkstreamRegistryListResponse>,
    ));
  }, [applyRegistryResponse]);

  const loadRegistered = useCallback(
    async (
      entry: { projectKey: string; workstreamId: string },
      options: { quiet?: boolean; entries?: WorkstreamRegistryListEntry[] } = {},
    ) => {
      const registryEntry = (options.entries ?? workstreamsRef.current).find(
        (candidate) => registryKey(candidate) === registryKey(entry),
      );
      if (registryEntry && isBrowserWorkstreamEntry(registryEntry)) {
        try {
          const graph = await readBrowserWorkstreamGraph(
            registryEntry,
            options.quiet ? lastModifiedRef.current : null,
          );
          if (graph.notModified) {
            return;
          }
          const doc = parseWorkstreamDocument(graph.content ?? "");
          lastModifiedRef.current = graph.lastModified;
          setWorkstream(doc);
          setError(null);
          const nextEntries = mergeWorkstreamEntries(
            workstreamsRef.current.filter((candidate) => !isBrowserWorkstreamEntry(candidate)),
            listBrowserWorkstreamEntries(),
          );
          workstreamsRef.current = nextEntries;
          setWorkstreams(nextEntries);
        } catch (nextError) {
          setWorkstream(null);
          setError({
            code: "browser_file_unavailable",
            message: nextError instanceof Error ? nextError.message : String(nextError),
          });
        }
        return;
      }

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
    lastModifiedRef.current = null;
  }, [activeProjectKey, activeWorkstreamId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void (async () => {
      try {
        const entries = await fetchRegistry();
        if (activeWorkstream) {
          await loadRegistered(activeWorkstream, { entries });
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

  const addSource = useCallback(
    async (type: WorkstreamSourceType, path: string) => {
      const res = await fetch("/api/workstream-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, path }),
      });
      if (!res.ok) {
        throw new Error((await parseErrorResponse(res)).message);
      }
      applyRegistryResponse(normalizeRegistryListResponse(
        await res.json() as Partial<WorkstreamRegistryListResponse>,
      ));
    },
    [applyRegistryResponse],
  );

  const refreshSources = useCallback(async () => {
    const res = await fetch("/api/workstream-sources/refresh", { method: "POST" });
    if (!res.ok) {
      throw new Error((await parseErrorResponse(res)).message);
    }
    applyRegistryResponse(normalizeRegistryListResponse(
      await res.json() as Partial<WorkstreamRegistryListResponse>,
    ));
  }, [applyRegistryResponse]);

  const deleteSource = useCallback(
    async (sourceId: string) => {
      const res = await fetch(sourceEntryUrl(sourceId), { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error((await parseErrorResponse(res)).message);
      }
      await fetchRegistry();
    },
    [fetchRegistry],
  );

  const archive = useCallback(
    async (entry: { projectKey: string; workstreamId: string }) => {
      const res = await fetch(registryArchiveUrl(entry), { method: "POST" });
      if (!res.ok) {
        throw new Error((await parseErrorResponse(res)).message);
      }
      applyRegistryResponse(normalizeRegistryListResponse(
        await res.json() as Partial<WorkstreamRegistryListResponse>,
      ));
    },
    [applyRegistryResponse],
  );

  const restore = useCallback(
    async (entry: { projectKey: string; workstreamId: string }) => {
      const res = await fetch(registryArchiveUrl(entry), { method: "DELETE" });
      if (!res.ok) {
        throw new Error((await parseErrorResponse(res)).message);
      }
      applyRegistryResponse(normalizeRegistryListResponse(
        await res.json() as Partial<WorkstreamRegistryListResponse>,
      ));
    },
    [applyRegistryResponse],
  );

  const untrack = useCallback(
    async (entry: { projectKey: string; workstreamId: string }) => {
      const current = workstreamsRef.current.find(
        (candidate) => registryKey(candidate) === registryKey(entry),
      );
      if (current && isBrowserWorkstreamEntry(current)) {
        await deleteBrowserWorkstreamEntry(entry);
        await fetchRegistry();
        return;
      }
      const res = await fetch(registryEntryUrl(entry), { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error((await parseErrorResponse(res)).message);
      }
      await fetchRegistry();
    },
    [fetchRegistry],
  );

  return {
    workstream,
    error,
    registryError,
    workstreams,
    archivedWorkstreams,
    sources,
    conflicts,
    migrationWarnings,
    activeWorkstream,
    addSource,
    refreshSources,
    deleteSource,
    archive,
    restore,
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
          <a
            className="sl-landing-card"
            href={routePath({ view: "workstreams" })}
            onClick={(event) => handleInAppLinkClick(event, onOpenWorkstreams)}
          >
            <span className="sl-landing-card-kicker">Graph workspace</span>
            <span className="sl-landing-card-title">Workstreams</span>
            <span className="sl-landing-card-copy">
              Open sticky graph URLs, add workstream directories, and untrack completed work.
            </span>
            <span className="sl-landing-card-meta">
              {workstreamCount === 1 ? "1 tracked workstream" : `${workstreamCount} tracked workstreams`}
            </span>
          </a>
          <a
            className="sl-landing-card"
            href={routePath({ view: "sessions" })}
            onClick={(event) => handleInAppLinkClick(event, onOpenSessions)}
          >
            <span className="sl-landing-card-kicker">Live activity</span>
            <span className="sl-landing-card-title">Sessions</span>
            <span className="sl-landing-card-copy">
              Browse, label, relaunch, and manage local Copilot CLI sessions.
            </span>
            <span className="sl-landing-card-meta">Open session registry</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function WorkstreamHome({
  message,
  registryError,
  workstreams,
  archivedWorkstreams,
  sources,
  conflicts,
  onOpenWorkstream,
  onAddSource,
  onRefreshSources,
  onDeleteSource,
  onArchiveWorkstream,
  onRestoreWorkstream,
  onUntrackWorkstream,
}: {
  message?: string;
  registryError: string | null;
  workstreams: WorkstreamRegistryListEntry[];
  archivedWorkstreams: WorkstreamRegistryListEntry[];
  sources: WorkstreamSourceListEntry[];
  conflicts: WorkstreamConflict[];
  onOpenWorkstream: (entry: WorkstreamRegistryListEntry) => void;
  onAddSource: (type: WorkstreamSourceType, path: string) => void | Promise<void>;
  onRefreshSources: () => void | Promise<void>;
  onDeleteSource: (sourceId: string) => void | Promise<void>;
  onArchiveWorkstream: (entry: WorkstreamRegistryListEntry) => void | Promise<void>;
  onRestoreWorkstream: (entry: WorkstreamRegistryListEntry) => void | Promise<void>;
  onUntrackWorkstream: (entry: WorkstreamRegistryListEntry) => void | Promise<void>;
}) {
  const [sourceType, setSourceType] = useState<WorkstreamSourceType>("workstreams-root");
  const [sourcePath, setSourcePath] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runAction = async (action: () => Promise<void> | void) => {
    setActionError(null);
    setBusy(true);
    try {
      await action();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const addSource = async () => {
    const trimmed = sourcePath.trim();
    if (!trimmed) {
      setActionError("Enter a local source path.");
      return;
    }
    await runAction(async () => {
      await onAddSource(sourceType, trimmed);
      setSourcePath("");
    });
  };

  const renderWorkstreamCard = (entry: WorkstreamRegistryListEntry, archived = false) => (
    <div className="sl-workstream-card" key={`${archived ? "archived" : "active"}-${registryKey(entry)}`}>
      <a
        className="sl-workstream-card-main"
        href={workstreamRoutePath(entry)}
        onClick={(event) => handleInAppLinkClick(event, () => onOpenWorkstream(entry))}
      >
        <span className="sl-workstream-card-title">{entry.title}</span>
        <span className="sl-workstream-card-id">{registryKey(entry)}</span>
        <span className="sl-workstream-card-meta">
          <span className={`sl-pill ${entry.fileStatus === "available" ? "green" : "amber"}`}>
            {entry.fileStatus}
          </span>
          <span className="sl-pill muted">{entry.source ?? "path"}</span>
          {entry.sourceId && <span className="sl-pill muted">{entry.sourceId}</span>}
        </span>
        <span className="sl-path-value">{entry.path}</span>
      </a>
      <div className="sl-workstream-card-actions">
        {archived ? (
          <button
            className="sl-action-btn"
            disabled={busy}
            onClick={() => void runAction(() => onRestoreWorkstream(entry))}
          >
            Restore
          </button>
        ) : (
          <button
            className="sl-action-btn"
            disabled={busy}
            onClick={() => void runAction(() => onArchiveWorkstream(entry))}
          >
            Archive
          </button>
        )}
        {!archived && (isPathWorkstreamEntry(entry) || isBrowserWorkstreamEntry(entry)) && (
          <button
            className="sl-action-btn danger"
            disabled={busy}
            onClick={() => void runAction(() => onUntrackWorkstream(entry))}
            aria-label={`Untrack ${entry.title}`}
          >
            Untrack
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="sl-shell-panel">
      <div className="sl-workstreams-home">
        <div className="sl-workstreams-home-header">
          <div>
            <span className="sl-eyebrow">WORKSTREAMS</span>
            <h1 className="sl-title">Tracked workstreams</h1>
            <p className="sl-summary">
              Register server-side source directories once, then open sticky workstream URLs from disk.
            </p>
          </div>
          <button className="sl-action-btn" disabled={busy} onClick={() => void runAction(onRefreshSources)}>
            Refresh sources
          </button>
        </div>
        {message && <div className="sl-action-error">{message}</div>}
        {registryError && <div className="sl-action-error">{registryError}</div>}
        {actionError && <div className="sl-action-error">{actionError}</div>}
        <section className="sl-source-panel">
          <div>
            <h2>Add source</h2>
            <p>
              Use a project root with <code>.streamliner\workstreams</code> or a workstreams root whose
              child directories contain <code>graph.json</code>.
            </p>
          </div>
          <div className="sl-source-form">
            <select
              className="sl-source-select"
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as WorkstreamSourceType)}
              disabled={busy}
            >
              <option value="workstreams-root">Workstreams root</option>
              <option value="project-root">Project root</option>
            </select>
            <input
              className="sl-source-input"
              value={sourcePath}
              onChange={(event) => setSourcePath(event.target.value)}
              placeholder="C:\Users\you\proj\example\workstreams"
              disabled={busy}
            />
            <button className="sl-action-btn primary" disabled={busy} onClick={() => void addSource()}>
              Add source
            </button>
          </div>
        </section>
        {sources.length > 0 && (
          <section className="sl-source-section">
            <h2>Sources</h2>
            <div className="sl-source-list">
              {sources.map((source) => (
                <div className="sl-source-card" key={source.id}>
                  <div>
                    <div className="sl-source-title-row">
                      <strong>{source.type}</strong>
                      <span className={`sl-pill ${source.health === "available" ? "green" : "amber"}`}>
                        {source.health}
                      </span>
                      <span className="sl-pill muted">{source.discoveredCount} discovered</span>
                    </div>
                    <div className="sl-path-value">{source.path}</div>
                    {source.lastScanAt && (
                      <div className="sl-source-meta">Last scan {new Date(source.lastScanAt).toLocaleString()}</div>
                    )}
                    {source.messages.length > 0 && (
                      <div className="sl-warning-list">
                        {source.messages.slice(0, 3).map((warning, index) => (
                          <div className="sl-warning-item" key={`${source.id}-${warning.code}-${warning.path ?? index}`}>
                            {warning.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    className="sl-action-btn danger"
                    disabled={busy}
                    onClick={() => void runAction(() => onDeleteSource(source.id))}
                  >
                    Delete source
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        {conflicts.length > 0 && (
          <section className="sl-source-section">
            <h2>Conflicts</h2>
            <div className="sl-warning-list">
              {conflicts.map((conflict) => (
                <div className="sl-warning-item" key={`${conflict.projectKey}/${conflict.workstreamId}`}>
                  <strong>{conflict.projectKey}/{conflict.workstreamId}</strong>: {conflict.message}
                  {conflict.archived ? " This identity is archived." : ""}
                  <div className="sl-conflict-candidates">
                    {conflict.candidates.map((candidate) => (
                      <span key={`${candidate.source}-${candidate.path}`}>
                        {candidate.selected ? "Using" : "Also found"} {candidate.source}: {candidate.path}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {workstreams.length === 0 ? (
          <div className="sl-empty-state">
            <h2>No tracked workstreams yet</h2>
            <p>Add a source directory to discover workstream graph files.</p>
          </div>
        ) : (
          <section className="sl-source-section">
            <h2>Active workstreams</h2>
            <div className="sl-workstreams-list">
              {workstreams.map((entry) => renderWorkstreamCard(entry))}
            </div>
          </section>
        )}
        {archivedWorkstreams.length > 0 && (
          <section className="sl-source-section">
            <h2>Archived workstreams</h2>
            <div className="sl-workstreams-list">
              {archivedWorkstreams.map((entry) => renderWorkstreamCard(entry, true))}
            </div>
          </section>
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
  archive,
  untrack,
  onOpenWorkstream,
  onManageSources,
  onRouteHome,
}: ReturnType<typeof useGraphLoader> & {
  onOpenWorkstream: (entry: WorkstreamRegistryListEntry) => void;
  onManageSources: () => void;
  onRouteHome: () => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [launchPreparing, setLaunchPreparing] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchHandoff, setLaunchHandoff] = useState<PawLaunchDialogHandoff | null>(null);
  const [launchProgressEvents, setLaunchProgressEvents] = useState<PawLaunchProgressEvent[]>([]);
  const [nodeLaunchRecord, setNodeLaunchRecord] = useState<NodeLaunchRecord | null>(null);
  const [nodeLaunchRecordLoading, setNodeLaunchRecordLoading] = useState(false);
  const [nodeLaunchRecordError, setNodeLaunchRecordError] = useState<string | null>(null);
  const [nodeLaunchRecordRefreshKey, setNodeLaunchRecordRefreshKey] = useState(0);

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

  const activeWorkstreamEntry = useMemo(() => {
    if (!activeWorkstream) return null;
    return workstreams.find((entry) => registryKey(entry) === registryKey(activeWorkstream)) ?? null;
  }, [activeWorkstream, workstreams]);

  const launchDisabledReason = useMemo(() => {
    if (!selectedEntry) return undefined;
    if (selectedEntry.operationalStatus !== "ready") {
      return "Only ready nodes can be launched.";
    }
    if (!activeWorkstreamEntry || !isBackendReadableWorkstreamEntry(activeWorkstreamEntry)) {
      return "Browser-only or missing graph sources cannot be prepared by the backend.";
    }
    return undefined;
  }, [activeWorkstreamEntry, selectedEntry]);

  const canLaunchSelectedNode = Boolean(selectedEntry && !launchDisabledReason);

  const launchDefaults = useMemo<PawLaunchDialogDefaults | null>(() => {
    if (!selectedEntry || !activeWorkstreamEntry) return null;
    return {
      workflowInstructions: DEFAULT_PAW_WORKFLOW_INSTRUCTIONS,
      cliArgsText: "--yolo",
      graphPath: activeWorkstreamEntry.path,
      terminalPreference: "Manual terminal launch after preparation",
      terminal: { ...DEFAULT_PAW_TERMINAL_CONFIGURATION },
    };
  }, [activeWorkstreamEntry, selectedEntry]);

  useEffect(() => {
    if (!selectedEntry || !activeWorkstreamEntry || !isBackendReadableWorkstreamEntry(activeWorkstreamEntry)) {
      setNodeLaunchRecord(null);
      setNodeLaunchRecordLoading(false);
      setNodeLaunchRecordError(null);
      return;
    }
    let cancelled = false;
    setNodeLaunchRecordLoading(true);
    setNodeLaunchRecordError(null);
    loadNodeLaunchRecord(activeWorkstreamEntry.path, selectedEntry.node.id)
      .then((record) => {
        if (!cancelled) {
          setNodeLaunchRecord(record);
        }
      })
      .catch((recordError: unknown) => {
        if (!cancelled) {
          setNodeLaunchRecord(null);
          setNodeLaunchRecordError(recordError instanceof Error ? recordError.message : String(recordError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setNodeLaunchRecordLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkstreamEntry, nodeLaunchRecordRefreshKey, selectedEntry]);

  const handleArchiveCurrent = async () => {
    if (!activeWorkstream) {
      return;
    }
    setActionError(null);
    try {
      await archive(activeWorkstream);
      onRouteHome();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const handleOpenLaunchDialog = () => {
    setLaunchError(null);
    setLaunchHandoff(null);
    setLaunchProgressEvents([]);
    setLaunchDialogOpen(true);
  };

  const handleCloseLaunchDialog = () => {
    if (launchPreparing) {
      return;
    }
    setLaunchDialogOpen(false);
    setLaunchError(null);
    setLaunchHandoff(null);
    setLaunchProgressEvents([]);
  };

  const handleSubmitLaunch = async (configuration: PawLaunchDialogConfiguration) => {
    if (!selectedEntry || !activeWorkstreamEntry) {
      return;
    }
    setLaunchPreparing(true);
    setLaunchError(null);
    setLaunchHandoff(null);
    setLaunchProgressEvents([]);
    let closeProgressStream: (() => void) | undefined;
    try {
      const response = await fetch("/api/launch-preparations/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: selectedEntry.node.id,
          graphPath: activeWorkstreamEntry.path,
          launchNonce: createLaunchNonce(),
          configuration: {
            workflowInstructions: configuration.workflowInstructions,
            cliArgs: configuration.cliArgs,
            terminal: configuration.terminal,
          },
        }),
      });
      if (!response.ok) {
        const parsed = await parseErrorResponse(response);
        throw new Error(parsed.message);
      }
      const started = await response.json() as PawLaunchRunStartResponse;
      if (!started.runId) {
        throw new Error("Launch preparation did not return a run id.");
      }

      await new Promise<void>((resolve, reject) => {
        const source = new EventSource(
          `/api/launch-preparations/runs/${encodeURIComponent(started.runId ?? "")}/events`,
        );
        closeProgressStream = () => source.close();
        source.addEventListener("progress", (event) => {
          const progress = parseMessageEventData<PawLaunchProgressEvent>(event);
          setLaunchProgressEvents((current) => [...current, progress].slice(-50));
        });
        source.addEventListener("completed", (event) => {
          const payload = parseMessageEventData<PawLaunchRunFinishedPayload>(event);
          const handoff = payload.result;
          if (!handoff) {
            reject(new Error("Launch preparation completed without a handoff."));
            return;
          }
          setLaunchHandoff({
            branch: handoff.branch,
            pawWorkDir: handoff.pawWorkDir,
            workflowContextPath: handoff.workflowContextPath,
            streamlinerContextPath: handoff.streamlinerContextPath,
            cliArgs: handoff.cliArgs,
            kickoffPrompt: handoff.kickoffPrompt,
          });
          setNodeLaunchRecordRefreshKey((current) => current + 1);
          resolve();
        });
        source.addEventListener("failed", (event) => {
          const payload = parseMessageEventData<PawLaunchRunFinishedPayload>(event);
          reject(new Error(payload.error?.error ?? "Launch preparation failed."));
        });
        source.onerror = () => {
          reject(new Error("Lost connection to launch preparation progress stream."));
        };
      });
    } catch (nextError) {
      setLaunchError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      closeProgressStream?.();
      setLaunchPreparing(false);
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
              <a
                className="sl-action-btn primary"
                href={routePath({ view: "workstreams" })}
                onClick={(event) => handleInAppLinkClick(event, onManageSources)}
              >
                Manage sources
              </a>
              <button className="sl-action-btn danger" onClick={handleArchiveCurrent}>
                Archive workstream
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
          onAddWorkstream={onManageSources}
          onUntrackWorkstream={(entry) => {
            void (async () => {
              if (isSourceWorkstreamEntry(entry)) {
                await archive(entry);
              } else {
                await untrack(entry);
              }
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
          <NodeInspector
            entry={selectedEntry}
            layout={layout}
            workstream={workstream}
            canLaunch={canLaunchSelectedNode}
            launchDisabledReason={launchDisabledReason}
            launchRecord={nodeLaunchRecord}
            launchRecordLoading={nodeLaunchRecordLoading}
            launchRecordError={nodeLaunchRecordError}
            onLaunch={handleOpenLaunchDialog}
          />
        </div>
      </div>
      {launchDialogOpen && selectedEntry && launchDefaults ? (
        <PawLaunchDialog
          key={`${selectedEntry.node.id}:${launchDefaults.graphPath}`}
          nodeTitle={selectedEntry.node.title}
          defaults={launchDefaults}
          preparing={launchPreparing}
          error={launchError}
          handoff={launchHandoff}
          progressEvents={launchProgressEvents}
          onCancel={handleCloseLaunchDialog}
          onSubmit={handleSubmitLaunch}
        />
      ) : null}
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
  const workstreamsActive = route.view === "workstreams" || route.view === "workstream";

  return (
    <div className="sl-shell-nav">
      <a
        className="sl-shell-brand"
        href="/"
        aria-label="Streamliner home"
        onClick={(event) => handleInAppLinkClick(event, () => onRouteChange({ view: "landing" }))}
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
        <a
          className={`sl-action-btn${workstreamsActive ? " active" : ""}`}
          href={routePath({ view: "workstreams" })}
          aria-current={workstreamsActive ? "page" : undefined}
          onClick={(event) => handleInAppLinkClick(event, () => onRouteChange({ view: "workstreams" }))}
        >
          Workstreams
        </a>
        <a
          className={`sl-action-btn${route.view === "sessions" ? " active" : ""}`}
          href={routePath({ view: "sessions" })}
          aria-current={route.view === "sessions" ? "page" : undefined}
          onClick={(event) => handleInAppLinkClick(event, () => onRouteChange({ view: "sessions" }))}
        >
          Sessions
        </a>
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

  const manageSources = useCallback(
    () => setRoute({ view: "workstreams" }),
    [setRoute],
  );

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
          onManageSources={manageSources}
          onRouteHome={() => setRoute({ view: "workstreams" }, "replace")}
        />
      ) : route.view === "workstreams" ? (
        <WorkstreamHome
          message={route.message}
          registryError={graphLoader.registryError}
          workstreams={graphLoader.workstreams}
          archivedWorkstreams={graphLoader.archivedWorkstreams}
          sources={graphLoader.sources}
          conflicts={graphLoader.conflicts}
          onOpenWorkstream={openWorkstream}
          onAddSource={graphLoader.addSource}
          onRefreshSources={graphLoader.refreshSources}
          onDeleteSource={graphLoader.deleteSource}
          onArchiveWorkstream={graphLoader.archive}
          onRestoreWorkstream={graphLoader.restore}
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
