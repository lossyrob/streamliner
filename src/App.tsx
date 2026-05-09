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
import {
  buildGraphNodeSessionStatusMap,
  type GraphNodeSessionStatusSummary,
  type GraphNodeSessionStatusState,
} from "./graph-node-session-status";
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
  type PawTerminalLaunchInput,
  type PawLaunchProgressEvent,
} from "./components/PawLaunchDialog";
import { PawProfilesPage } from "./components/PawProfilesPage";
import {
  loadPromptProfiles,
  mergePromptProfiles,
  type PawPromptProfile,
} from "./components/paw-prompt-profiles";
import {
  WorkstreamConfigurationDialog,
  type WorkstreamConfigurationValues,
} from "./components/WorkstreamConfigurationDialog";
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
  NodeLaunchHandoff,
  NodeLaunchClaimState,
  NodeLaunchOperation,
  NodeLaunchRecord,
  NodeLaunchRecordResponse,
  NodeManagedSdkLaunchResponse,
  NodeTerminalLaunchResponse,
} from "./node-launch-record-contract";
import { loadGraphNodeLaunchRecords } from "./node-launch-record-client";
import {
  encodeRouteSegment,
  handleInAppLinkClick,
  routePath,
  workstreamRoutePath,
  type DashboardRoute,
} from "./dashboard-routing";
import {
  trackerLabel as workstreamTrackerLabel,
  trackerUrl as workstreamTrackerUrl,
} from "./workstream-links";
import { renderWorkstreamTerminalTitleTemplate } from "./workstream-launch-templates";
import { evaluateNodeLaunchPolicy } from "./workstream-launch-policy";
import { useSessionRegistryList } from "./session-registry-client";
import {
  buildWorkstreamRuntimeOverlay,
  type WorkstreamRuntimeOverlay,
} from "./workstream-runtime-overlay";

const POLL_INTERVAL_MS = 2000;
const LAST_GRAPH_KEY = "streamliner:lastGraphPath";
const PAW_LAUNCH_CWD_OVERRIDES_KEY = "streamliner:pawLaunchCwdByRepo";
const STREAMLINER_LOGO_URL = "/streamliner-logo.png";

interface GraphLoadError {
  code?: string;
  message: string;
}

type PawLaunchPreparationResponse = NodeLaunchHandoff;

interface PawLaunchRunStartResponse {
  runId?: string;
  status?: string;
  operation?: NodeLaunchOperation | null;
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

interface LoadedNodeLaunchState {
  record: NodeLaunchRecord | null;
  operation: NodeLaunchOperation | null;
}

interface ManagedSdkLaunchApiResponse {
  runtimeKind: "managed-sdk";
  launchClaim: NodeLaunchClaimState;
  managedSdk: {
    registryId: string;
    sdkSessionId: string | null;
    sdkWorkspacePath: string | null;
    sdkStateRoot: string | null;
    permissionProfile: "managed-autonomous";
  };
}

interface LaunchOperationTarget {
  graphPath: string;
  nodeId: string;
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
    const workstreamId = searchParams.get("workstreamId");
    const nodeId = searchParams.get("nodeId");
    return {
      view: "sessions",
      workstreamId: workstreamId && isKebabCaseId(workstreamId) ? workstreamId : null,
      nodeId: nodeId && isKebabCaseId(nodeId) ? nodeId : null,
    };
  }
  if (
    window.location.pathname === "/settings" ||
    window.location.pathname === "/settings/profiles" ||
    window.location.pathname === "/profiles"
  ) {
    return { view: "settings", section: "profiles" };
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
  if (segments.length !== 3 && segments.length !== 5) {
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
  if (segments.length === 3) {
    return { view: "workstream", projectKey, workstreamId };
  }

  if (segments[3] !== "nodes") {
    return { view: "workstreams", message: "That workstream URL is incomplete." };
  }
  const nodeId = decodeSegment(segments[4]);
  if (!nodeId || !isKebabCaseId(nodeId)) {
    return { view: "workstreams", message: "That workstream node URL is invalid." };
  }
  return { view: "workstream", projectKey, workstreamId, nodeId };
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

function launchCwdRepoKey(
  workstream: WorkstreamDocument,
  repoIds: string[],
): string | null {
  const repoId = repoIds[0] ?? workstream.repos[0]?.id;
  if (!repoId) {
    return null;
  }
  const repo = workstream.repos.find((candidate) => candidate.id === repoId);
  if (repo) {
    return `${repo.owner}/${repo.name}`;
  }
  return `${workstream.projectKey ?? workstream.id}/${repoId}`;
}

function readLaunchCwdOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(PAW_LAUNCH_CWD_OVERRIDES_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const entries = Object.entries(parsed)
      .filter((entry): entry is [string, string] =>
        typeof entry[0] === "string" &&
        typeof entry[1] === "string" &&
        entry[0].trim().length > 0 &&
        entry[1].trim().length > 0
      );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

function readLaunchCwdOverride(repoKey: string | null): string | null {
  if (!repoKey) {
    return null;
  }
  return readLaunchCwdOverrides()[repoKey] ?? null;
}

function writeLaunchCwdOverride(repoKey: string | null, cwd: string | null): void {
  if (!repoKey) {
    return;
  }
  try {
    const overrides = readLaunchCwdOverrides();
    if (cwd?.trim()) {
      overrides[repoKey] = cwd.trim();
    } else {
      delete overrides[repoKey];
    }
    window.localStorage.setItem(PAW_LAUNCH_CWD_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // Local storage is a convenience; launch should continue if it is unavailable.
  }
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

function registryConfigurationUrl(entry: { projectKey: string; workstreamId: string }): string {
  return `${registryEntryUrl(entry)}/configuration`;
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

function launchOperationKey(target: LaunchOperationTarget): string {
  return `${target.graphPath.toLowerCase()}\0${target.nodeId}`;
}

function createClientLaunchOperation(
  target: LaunchOperationTarget,
  status: NodeLaunchOperation["status"],
  overrides: Partial<NodeLaunchOperation> = {},
): NodeLaunchOperation {
  const timestamp = new Date().toISOString();
  return {
    id: `${target.nodeId}-client`,
    graphPath: target.graphPath,
    nodeId: target.nodeId,
    status,
    preparationRunId: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    handoff: null,
    terminalLaunch: null,
    managedLaunch: null,
    error: null,
    progressEvents: [],
    ...overrides,
  };
}

function operationError(
  code: string,
  error: string,
): NodeLaunchOperation["error"] {
  return {
    code,
    error,
    timestamp: new Date().toISOString(),
  };
}

function managedLaunchFromApiResponse(
  result: ManagedSdkLaunchApiResponse,
): NodeManagedSdkLaunchResponse {
  return {
    launchClaim: result.launchClaim,
    runtimeKind: "managed-sdk",
    registryId: result.managedSdk.registryId,
    sdkSessionId: result.managedSdk.sdkSessionId,
    sdkWorkspacePath: result.managedSdk.sdkWorkspacePath,
    sdkStateRoot: result.managedSdk.sdkStateRoot,
    permissionProfile: result.managedSdk.permissionProfile,
  };
}

function appendProgressEvent(
  events: PawLaunchProgressEvent[],
  event: PawLaunchProgressEvent,
): PawLaunchProgressEvent[] {
  const eventKey = `${event.timestamp}\0${event.type}\0${event.message}`;
  if (events.some((candidate) => `${candidate.timestamp}\0${candidate.type}\0${candidate.message}` === eventKey)) {
    return events;
  }
  return [...events, event].slice(-50);
}

function clientHandoffFromPreparation(
  handoff: PawLaunchPreparationResponse,
): PawLaunchPreparationResponse {
  return {
    cwd: handoff.cwd,
    branch: handoff.branch,
    pawWorkDir: handoff.pawWorkDir,
    workflowContextPath: handoff.workflowContextPath,
    streamlinerContextPath: handoff.streamlinerContextPath,
    cliArgs: handoff.cliArgs,
    terminal: handoff.terminal,
    environment: handoff.environment,
    sessionStateRoot: handoff.sessionStateRoot,
    kickoffPrompt: handoff.kickoffPrompt,
    kickoffAdditionalInstructions: handoff.kickoffAdditionalInstructions,
    runtimeKind: handoff.runtimeKind ?? "terminal-cli",
    launchMetadata: handoff.launchMetadata,
    contextPackage: handoff.contextPackage,
    sdkSession: handoff.sdkSession,
  };
}

function sameLaunchTarget(
  left: LaunchOperationTarget | null,
  right: LaunchOperationTarget | null,
): boolean {
  return Boolean(left && right && launchOperationKey(left) === launchOperationKey(right));
}

function mergeNodeLaunchRecord(
  records: NodeLaunchRecord[],
  target: LaunchOperationTarget,
  record: NodeLaunchRecord | null,
): NodeLaunchRecord[] {
  const nextRecords = records.filter(
    (candidate) =>
      candidate.graphPath !== target.graphPath || candidate.nodeId !== target.nodeId,
  );
  return record ? [...nextRecords, record] : nextRecords;
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
): Promise<LoadedNodeLaunchState> {
  const params = new URLSearchParams({ graphPath, nodeId });
  const response = await fetch(`/api/node-launch-records?${params.toString()}`);
  if (!response.ok) {
    const parsed = await parseErrorResponse(response);
    throw new Error(parsed.message);
  }
  const body = await response.json() as NodeLaunchRecordResponse;
  return {
    record: body.record ?? null,
    operation: body.operation ?? null,
  };
}

interface NodeLaunchReleaseResponse {
  launchClaim: NodeLaunchClaimState;
  detachedRegistryIds: string[];
}

async function releaseNodeLaunchClaim(launchClaimId: string): Promise<NodeLaunchReleaseResponse> {
  const response = await fetch(
    `/api/node-launch-records/launch-claims/${encodeURIComponent(launchClaimId)}/release`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  if (!response.ok) {
    const parsed = await parseErrorResponse(response);
    throw new Error(parsed.message);
  }
  return await response.json() as NodeLaunchReleaseResponse;
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
  const [registryLoaded, setRegistryLoaded] = useState(false);
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
    setRegistryLoaded(true);
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
        setRegistryLoaded(true);
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

  const saveWorkstreamConfiguration = useCallback(
    async (
      entry: { projectKey: string; workstreamId: string },
      configuration: WorkstreamConfigurationValues,
    ) => {
      const res = await fetch(registryConfigurationUrl(entry), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configuration),
      });
      if (!res.ok) {
        throw new Error((await parseErrorResponse(res)).message);
      }
      const body = await res.json() as { workstream?: unknown };
      if (typeof body.workstream !== "object" || body.workstream === null) {
        throw new Error("Configuration update did not return a workstream graph.");
      }
      const parsed = parseWorkstreamDocument(JSON.stringify(body.workstream));
      lastModifiedRef.current = res.headers.get("Last-Modified");
      setWorkstream(parsed);
      setError(null);
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
    registryLoading: !registryLoaded,
    activeWorkstream,
    addSource,
    refreshSources,
    deleteSource,
    archive,
    restore,
    untrack,
    saveWorkstreamConfiguration,
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
  registryLoading,
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
  registryLoading: boolean;
  onOpenWorkstream: (entry: WorkstreamRegistryListEntry) => void | Promise<void>;
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
        {registryLoading ? (
          <div className="sl-empty-state sl-loading-state" role="status" aria-live="polite">
            <span className="sl-spinner" aria-hidden="true" />
            <div>
              <h2>Loading workstreams…</h2>
              <p>Scanning tracked sources and recent graph registrations.</p>
            </div>
          </div>
        ) : workstreams.length === 0 ? (
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

function usePromptProfilesState() {
  const [profiles, setProfiles] = useState<PawPromptProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  const mutationVersionRef = useRef(0);
  const deletedProfileIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const noteProfilesChanged = useCallback((changedProfiles: PawPromptProfile[]) => {
    mutationVersionRef.current += 1;
    for (const profile of changedProfiles) {
      deletedProfileIdsRef.current.delete(profile.id);
    }
    setProfiles((current) => mergePromptProfiles(current, changedProfiles));
  }, []);

  const noteProfileDeleted = useCallback((id: string) => {
    mutationVersionRef.current += 1;
    deletedProfileIdsRef.current.add(id);
    setProfiles((current) => current.filter((profile) => profile.id !== id));
  }, []);

  const refresh = useCallback(() => {
    if (requestRef.current) {
      return requestRef.current;
    }
    setLoading(true);
    setError(null);
    const requestMutationVersion = mutationVersionRef.current;
    const request = loadPromptProfiles()
      .then((loadedProfiles) => {
        if (mountedRef.current) {
          if (mutationVersionRef.current === requestMutationVersion) {
            deletedProfileIdsRef.current.clear();
            setProfiles(() => mergePromptProfiles([], loadedProfiles));
          } else {
            const deletedProfileIds = deletedProfileIdsRef.current;
            const retainedProfiles = loadedProfiles.filter((profile) => !deletedProfileIds.has(profile.id));
            setProfiles((current) => mergePromptProfiles(current, retainedProfiles));
          }
        }
      })
      .catch((loadError: unknown) => {
        if (mountedRef.current) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        requestRef.current = null;
        if (mountedRef.current) {
          setLoading(false);
        }
      });
    requestRef.current = request;
    return request;
  }, []);

  return {
    profiles,
    loading,
    error,
    refresh,
    noteProfilesChanged,
    noteProfileDeleted,
  };
}

function GraphDashboard({
  workstream,
  error,
  workstreams,
  activeWorkstream,
  archive,
  untrack,
  saveWorkstreamConfiguration,
  onOpenWorkstream,
  onOpenSessions,
  onManageSources,
  onRouteHome,
  selectedNodeIdFromRoute,
  promptProfiles,
  promptProfilesLoading,
  promptProfilesError,
  onRefreshPromptProfiles,
  onPromptProfilesChanged,
}: ReturnType<typeof useGraphLoader> & {
  onOpenWorkstream: (entry: WorkstreamRegistryListEntry) => void | Promise<void>;
  onOpenSessions: (target?: { workstreamId?: string | null; nodeId?: string | null }) => void | Promise<void>;
  onManageSources: () => void;
  onRouteHome: () => void;
  selectedNodeIdFromRoute?: string | null;
  promptProfiles: PawPromptProfile[];
  promptProfilesLoading: boolean;
  promptProfilesError: string | null;
  onRefreshPromptProfiles: () => Promise<void> | void;
  onPromptProfilesChanged: (profiles: PawPromptProfile[]) => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    selectedNodeIdFromRoute ?? null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [launchDialogTarget, setLaunchDialogTarget] = useState<LaunchOperationTarget | null>(null);
  const [launchOperationByKey, setLaunchOperationByKey] = useState<Record<string, NodeLaunchOperation>>({});
  const [launchReleasing, setLaunchReleasing] = useState(false);
  const [launchReleaseError, setLaunchReleaseError] = useState<string | null>(null);
  const [launchReleaseStatus, setLaunchReleaseStatus] = useState<string | null>(null);
  const [nodeLaunchRecords, setNodeLaunchRecords] = useState<NodeLaunchRecord[]>([]);
  const [nodeLaunchRecordLoading, setNodeLaunchRecordLoading] = useState(false);
  const [nodeLaunchRecordError, setNodeLaunchRecordError] = useState<string | null>(null);
  const [selectedNodeLaunchRecordLoading, setSelectedNodeLaunchRecordLoading] = useState(false);
  const [selectedNodeLaunchRecordError, setSelectedNodeLaunchRecordError] = useState<string | null>(null);
  const [nodeLaunchRecordRefreshKey, setNodeLaunchRecordRefreshKey] = useState(0);
  const [configurationDialogOpen, setConfigurationDialogOpen] = useState(false);
  const [configurationSaving, setConfigurationSaving] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const failedRunReattachRef = useRef<Set<string>>(new Set());
  const localRunStreamsRef = useRef<Set<string>>(new Set());
  const activeWorkstreamKey = activeWorkstream ? registryKey(activeWorkstream) : "";
  const sessionList = useSessionRegistryList(
    { workstreamId: activeWorkstream?.workstreamId ?? null },
    { enabled: Boolean(activeWorkstream) },
  );
  const nodeSessionStatuses = useMemo(
    () =>
      activeWorkstream
        ? buildGraphNodeSessionStatusMap(sessionList.sessions, activeWorkstream.workstreamId)
        : new Map<string, GraphNodeSessionStatusSummary>(),
    [activeWorkstream, sessionList.sessions],
  );
  const nodeSessionStatusState: GraphNodeSessionStatusState = sessionList.loading
    ? "loading"
    : sessionList.error
      ? "error"
      : "ready";
  const nodeLaunchRecordsByNodeId = useMemo(() => {
    const recordsByNodeId = new Map<string, NodeLaunchRecord>();
    for (const record of nodeLaunchRecords) {
      recordsByNodeId.set(record.nodeId, record);
    }
    return recordsByNodeId;
  }, [nodeLaunchRecords]);
  const initialViewportFitKey = `${activeWorkstreamKey}:${selectedNodeIdFromRoute ?? ""}`;

  useEffect(() => {
    setSelectedNodeId(selectedNodeIdFromRoute ?? null);
  }, [activeWorkstreamKey, selectedNodeIdFromRoute]);

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
  const nodeLaunchRecord = selectedEntry
    ? nodeLaunchRecordsByNodeId.get(selectedEntry.node.id) ?? null
    : null;

  const activeWorkstreamEntry = useMemo(() => {
    if (!activeWorkstream) return null;
    return workstreams.find((entry) => registryKey(entry) === registryKey(activeWorkstream)) ?? null;
  }, [activeWorkstream, workstreams]);
  const runtimeOverlay = useMemo<WorkstreamRuntimeOverlay | null>(() => {
    if (!viewModel) {
      return null;
    }
    return buildWorkstreamRuntimeOverlay({
      viewModel,
      nodeSessionStatuses,
      sessionStatusState: nodeSessionStatusState,
      sessionStatusError: sessionList.error,
      nodeLaunchRecords: nodeLaunchRecordsByNodeId,
      launchRecordsState: nodeLaunchRecordLoading
        ? "loading"
        : nodeLaunchRecordError
          ? "error"
          : "ready",
      launchRecordsError: nodeLaunchRecordError,
    });
  }, [
    nodeLaunchRecordsByNodeId,
    nodeLaunchRecordError,
    nodeLaunchRecordLoading,
    nodeSessionStatusState,
    nodeSessionStatuses,
    sessionList.error,
    viewModel,
  ]);
  const selectedRuntimeOverlay = selectedEntry
    ? runtimeOverlay?.nodesById.get(selectedEntry.node.id) ?? null
    : null;

  const selectedLaunchTarget = useMemo<LaunchOperationTarget | null>(() => {
    if (!selectedEntry || !activeWorkstreamEntry) {
      return null;
    }
    return {
      graphPath: activeWorkstreamEntry.path,
      nodeId: selectedEntry.node.id,
    };
  }, [activeWorkstreamEntry, selectedEntry]);

  const selectedLaunchOperation = selectedLaunchTarget
    ? launchOperationByKey[launchOperationKey(selectedLaunchTarget)] ?? null
    : null;

  const launchDialogEntry = useMemo(() => {
    if (!launchDialogTarget || !viewModel) {
      return null;
    }
    return viewModel.derivedNodes.find((entry) => entry.node.id === launchDialogTarget.nodeId) ?? null;
  }, [launchDialogTarget, viewModel]);

  const launchDialogOperation = launchDialogTarget
    ? launchOperationByKey[launchOperationKey(launchDialogTarget)] ?? null
    : null;

  const launchDialogLatestClaim = launchDialogOperation?.latestClaim
    ?? (sameLaunchTarget(launchDialogTarget, selectedLaunchTarget) ? nodeLaunchRecord?.latestClaim ?? null : null);

  const configureDisabledReason = useMemo(() => {
    if (!activeWorkstreamEntry || !isBackendReadableWorkstreamEntry(activeWorkstreamEntry)) {
      return "Only backend-readable workstream graph files can be configured.";
    }
    return null;
  }, [activeWorkstreamEntry]);

  const launchDisabledReason = useMemo(() => {
    if (!selectedEntry) return undefined;
    if (selectedEntry.operationalStatus !== "ready") {
      return "Only ready nodes can be launched.";
    }
    if (!activeWorkstreamEntry || !isBackendReadableWorkstreamEntry(activeWorkstreamEntry)) {
      return "Browser-only or missing graph sources cannot be prepared by the backend.";
    }
    if (workstream) {
      const policyDecision = evaluateNodeLaunchPolicy(workstream, selectedEntry.node);
      if (!policyDecision.allowed) {
        return policyDecision.violation.message;
      }
    }
    return undefined;
  }, [activeWorkstreamEntry, selectedEntry, workstream]);

  const canLaunchSelectedNode = Boolean(selectedEntry && !launchDisabledReason);

  const sessionRouteForNode = useCallback(
    (nodeId: string) => {
      const route: DashboardRoute = {
        view: "sessions",
        workstreamId: activeWorkstream?.workstreamId ?? null,
        nodeId,
      };
      return {
        href: routePath(route),
        onOpen: () =>
          onOpenSessions({
            workstreamId: activeWorkstream?.workstreamId ?? null,
            nodeId,
          }),
      };
    },
    [activeWorkstream?.workstreamId, onOpenSessions],
  );

  const launchActionDisabledReason = useMemo(() => {
    const operation = launchDialogOperation ?? selectedLaunchOperation;
    const latestClaim = launchDialogTarget ? launchDialogLatestClaim : nodeLaunchRecord?.latestClaim;
    if (!latestClaim?.blocksLaunch) {
      return null;
    }
    const activeRuntimeLabel =
      operation?.managedLaunch || operation?.handoff?.runtimeKind === "managed-sdk"
        ? "background session"
        : "terminal launch";
    if (latestClaim.status === "bound") {
      return `A ${activeRuntimeLabel} is already bound to this node. The dialog remains available for the issue and prepared launch details, but Streamliner will not start another PAW init or launch while that session is active.`;
    }
    return `A ${activeRuntimeLabel} is already active for this node. The dialog remains available for the issue and prepared launch details, but Streamliner will not start another PAW init or launch until the active claim resolves.`;
  }, [
    launchDialogLatestClaim,
    launchDialogOperation,
    launchDialogTarget,
    nodeLaunchRecord,
    selectedLaunchOperation,
  ]);

  const launchDefaults = useMemo<PawLaunchDialogDefaults | null>(() => {
    const defaultsEntry = launchDialogTarget ? launchDialogEntry : selectedEntry;
    const graphPath = launchDialogTarget?.graphPath ?? activeWorkstreamEntry?.path;
    if (!defaultsEntry || !graphPath) return null;
    const inferredCwd = "";
    const cwdPreferenceKey = workstream
      ? launchCwdRepoKey(workstream, defaultsEntry.node.repoIds)
      : null;
    const savedCwd = readLaunchCwdOverride(cwdPreferenceKey);
    return {
      workflowInstructions: DEFAULT_PAW_WORKFLOW_INSTRUCTIONS,
      runtimeKind: "terminal-cli",
      cliArgsText: "--yolo",
      cwd: savedCwd ?? inferredCwd,
      inferredCwd,
      cwdPreferenceKey,
      graphPath,
      terminalPreference: "Manual terminal launch after preparation",
      githubIssueLabel: defaultsEntry.node.tracker?.type === "github"
        ? workstreamTrackerLabel(defaultsEntry.node.tracker)
        : null,
      githubIssueUrl: workstreamTrackerUrl(defaultsEntry.node.tracker),
      terminal: {
        ...DEFAULT_PAW_TERMINAL_CONFIGURATION,
        preferredTerminal:
          workstream?.launchDefaults?.terminal?.preferredTerminal ??
          DEFAULT_PAW_TERMINAL_CONFIGURATION.preferredTerminal,
        title:
          renderWorkstreamTerminalTitleTemplate(
            workstream?.launchDefaults?.terminal?.titleTemplate,
            defaultsEntry.node,
          ) ?? defaultsEntry.node.title,
        tabColor: workstream?.launchDefaults?.terminal?.tabColor ?? null,
      },
    };
  }, [activeWorkstreamEntry?.path, launchDialogEntry, launchDialogTarget, selectedEntry, workstream]);

  useEffect(() => {
    if (!activeWorkstreamEntry || !isBackendReadableWorkstreamEntry(activeWorkstreamEntry)) {
      setNodeLaunchRecords([]);
      setNodeLaunchRecordLoading(false);
      setNodeLaunchRecordError(null);
      return;
    }
    let cancelled = false;
    setNodeLaunchRecords([]);
    setNodeLaunchRecordLoading(true);
    setNodeLaunchRecordError(null);
    loadGraphNodeLaunchRecords(activeWorkstreamEntry.path)
      .then((records) => {
        if (!cancelled) {
          setNodeLaunchRecords(records);
        }
      })
      .catch((recordError: unknown) => {
        if (!cancelled) {
          setNodeLaunchRecords([]);
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
  }, [activeWorkstreamEntry, nodeLaunchRecordRefreshKey]);

  useEffect(() => {
    if (
      !activeWorkstreamEntry ||
      !isBackendReadableWorkstreamEntry(activeWorkstreamEntry) ||
      !selectedEntry
    ) {
      setSelectedNodeLaunchRecordLoading(false);
      setSelectedNodeLaunchRecordError(null);
      return;
    }
    const target = {
      graphPath: activeWorkstreamEntry.path,
      nodeId: selectedEntry.node.id,
    };
    let cancelled = false;
    setSelectedNodeLaunchRecordLoading(true);
    setSelectedNodeLaunchRecordError(null);
    loadNodeLaunchRecord(target.graphPath, target.nodeId)
      .then((state) => {
        if (cancelled) {
          return;
        }
        setNodeLaunchRecords((current) =>
          mergeNodeLaunchRecord(current, target, state.record)
        );
        const key = launchOperationKey(target);
        setLaunchOperationByKey((current) => {
          if (!state.operation) {
            return current;
          }
          const existing = current[key];
          const progressEvents = existing &&
              existing.preparationRunId === state.operation.preparationRunId &&
              existing.progressEvents.length > state.operation.progressEvents.length
            ? existing.progressEvents
            : state.operation.progressEvents;
          return {
            ...current,
            [key]: {
              ...state.operation,
              progressEvents,
              handoff: state.operation.handoff ?? existing?.handoff ?? null,
              terminalLaunch: state.operation.terminalLaunch ?? existing?.terminalLaunch ?? null,
              error: state.operation.error ?? existing?.error ?? null,
            },
          };
        });
      })
      .catch((recordError: unknown) => {
        if (!cancelled) {
          setSelectedNodeLaunchRecordError(
            recordError instanceof Error ? recordError.message : String(recordError),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedNodeLaunchRecordLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkstreamEntry, nodeLaunchRecordRefreshKey, selectedEntry]);

  const setLaunchOperation = useCallback((
    target: LaunchOperationTarget,
    nextOperation: NodeLaunchOperation,
  ) => {
    const key = launchOperationKey(target);
    setLaunchOperationByKey((current) => ({
      ...current,
      [key]: nextOperation,
    }));
  }, []);

  const updateLaunchOperation = useCallback((
    target: LaunchOperationTarget,
    updater: (current: NodeLaunchOperation | null) => NodeLaunchOperation,
  ) => {
    const key = launchOperationKey(target);
    setLaunchOperationByKey((current) => ({
      ...current,
      [key]: updater(current[key] ?? null),
    }));
  }, []);

  const prefetchPromptProfiles = useCallback(() => {
    return onRefreshPromptProfiles();
  }, [onRefreshPromptProfiles]);

  useEffect(() => {
    if (!selectedLaunchTarget || !canLaunchSelectedNode) {
      return;
    }
    void prefetchPromptProfiles();
  }, [canLaunchSelectedNode, prefetchPromptProfiles, selectedLaunchTarget]);

  const applyPreparedLaunchHandoff = useCallback((
    target: LaunchOperationTarget,
    handoff: PawLaunchPreparationResponse,
  ): PawLaunchPreparationResponse => {
    const nextHandoff = clientHandoffFromPreparation(handoff);
    updateLaunchOperation(target, (current) =>
      createClientLaunchOperation(target, "prepared", {
        ...(current ?? {}),
        status: "prepared",
        handoff: nextHandoff,
        terminalLaunch: null,
        error: null,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
    setNodeLaunchRecordRefreshKey((current) => current + 1);
    return nextHandoff;
  }, [updateLaunchOperation]);

  const applyPreparationFailure = useCallback((
    target: LaunchOperationTarget,
    payload: PawLaunchRunFinishedPayload,
  ): string => {
    const message = payload.error?.error ?? "Launch preparation failed.";
    updateLaunchOperation(target, (current) =>
      createClientLaunchOperation(target, "preparation_failed", {
        ...(current ?? {}),
        status: "preparation_failed",
        handoff: null,
        error: operationError(payload.error?.code ?? "launch_preparation_failed", message),
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
    return message;
  }, [updateLaunchOperation]);

  useEffect(() => {
    if (
      !launchDialogOpen ||
      !launchDialogTarget ||
      !launchDialogOperation?.preparationRunId ||
      launchDialogOperation.status !== "preparing"
    ) {
      return;
    }
    const runId = launchDialogOperation.preparationRunId;
    if (localRunStreamsRef.current.has(runId) || failedRunReattachRef.current.has(runId)) {
      return;
    }
    let closed = false;
    const source = new EventSource(
      `/api/launch-preparations/runs/${encodeURIComponent(runId)}/events`,
    );
    source.addEventListener("progress", (event) => {
      if (closed) {
        return;
      }
      const progress = parseMessageEventData<PawLaunchProgressEvent>(event);
      updateLaunchOperation(launchDialogTarget, (current) => {
        const operation = current ?? createClientLaunchOperation(launchDialogTarget, "preparing");
        return {
          ...operation,
          status: "preparing",
          error: null,
          updatedAt: progress.timestamp,
          progressEvents: appendProgressEvent(operation.progressEvents, progress),
        };
      });
    });
    source.addEventListener("completed", (event) => {
      if (closed) {
        return;
      }
      const payload = parseMessageEventData<PawLaunchRunFinishedPayload>(event);
      if (payload.result) {
        applyPreparedLaunchHandoff(launchDialogTarget, payload.result);
      }
      source.close();
    });
    source.addEventListener("failed", (event) => {
      if (closed) {
        return;
      }
      applyPreparationFailure(launchDialogTarget, parseMessageEventData<PawLaunchRunFinishedPayload>(event));
      source.close();
    });
    source.onerror = () => {
      if (closed) {
        return;
      }
      failedRunReattachRef.current.add(runId);
      source.close();
      void loadNodeLaunchRecord(launchDialogTarget.graphPath, launchDialogTarget.nodeId)
        .then((state) => {
          if (closed) {
            return;
          }
          if (sameLaunchTarget(launchDialogTarget, selectedLaunchTarget)) {
            setNodeLaunchRecords((current) =>
              mergeNodeLaunchRecord(current, launchDialogTarget, state.record)
            );
          }
          if (state.operation) {
            setLaunchOperation(launchDialogTarget, state.operation);
          }
        })
        .catch((recordError: unknown) => {
          if (!closed) {
            setNodeLaunchRecordError(recordError instanceof Error ? recordError.message : String(recordError));
          }
        });
    };
    return () => {
      closed = true;
      source.close();
    };
  }, [
    applyPreparationFailure,
    applyPreparedLaunchHandoff,
    launchDialogOpen,
    launchDialogOperation?.preparationRunId,
    launchDialogOperation?.status,
    launchDialogTarget,
    selectedLaunchTarget,
    setLaunchOperation,
    updateLaunchOperation,
  ]);

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
    if (!selectedLaunchTarget) {
      return;
    }
    void prefetchPromptProfiles();
    setLaunchDialogTarget(selectedLaunchTarget);
    setLaunchReleaseError(null);
    setLaunchReleaseStatus(null);
    setLaunchDialogOpen(true);
  };

  const handleOpenConfigurationDialog = () => {
    void prefetchPromptProfiles();
    setConfigurationError(null);
    setConfigurationDialogOpen(true);
  };

  const handleCloseConfigurationDialog = () => {
    if (configurationSaving) {
      return;
    }
    setConfigurationError(null);
    setConfigurationDialogOpen(false);
  };

  const handleSaveConfiguration = async (configuration: WorkstreamConfigurationValues) => {
    if (!activeWorkstream) {
      return;
    }
    setConfigurationSaving(true);
    setConfigurationError(null);
    try {
      await saveWorkstreamConfiguration(activeWorkstream, configuration);
      setConfigurationDialogOpen(false);
    } catch (nextError) {
      setConfigurationError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setConfigurationSaving(false);
    }
  };

  const handleCloseLaunchDialog = () => {
    setLaunchDialogOpen(false);
    setLaunchDialogTarget(null);
    setLaunchReleaseError(null);
    setLaunchReleaseStatus(null);
  };

  const handleReleaseLaunch = async () => {
    const target = launchDialogTarget ?? selectedLaunchTarget;
    const latestClaim = launchDialogTarget ? launchDialogLatestClaim : nodeLaunchRecord?.latestClaim;
    const currentOperation = launchDialogTarget ? launchDialogOperation : selectedLaunchOperation;
    if (!target || !latestClaim) {
      return;
    }
    setLaunchReleasing(true);
    setLaunchReleaseError(null);
    setLaunchReleaseStatus(null);
    try {
      const release = await releaseNodeLaunchClaim(latestClaim.launchClaimId);
      setLaunchReleaseStatus(
        release.detachedRegistryIds.length > 0
          ? "Released the launch claim and detached the linked session."
          : "Released the launch claim.",
      );
      if (currentOperation) {
        setLaunchOperation(target, {
          ...currentOperation,
          latestClaim: release.launchClaim,
          updatedAt: release.launchClaim.updatedAt,
        });
      }
      const refreshed = await loadNodeLaunchRecord(target.graphPath, target.nodeId);
      if (sameLaunchTarget(target, selectedLaunchTarget)) {
        setNodeLaunchRecords((current) =>
          mergeNodeLaunchRecord(current, target, refreshed.record)
        );
      }
      if (refreshed.operation) {
        setLaunchOperation(target, refreshed.operation);
      }
      setNodeLaunchRecordRefreshKey((current) => current + 1);
    } catch (releaseError: unknown) {
      setLaunchReleaseError(releaseError instanceof Error ? releaseError.message : String(releaseError));
    } finally {
      setLaunchReleasing(false);
    }
  };

  const launchTerminalFromHandoff = async (
    handoff: PawLaunchPreparationResponse,
    input: PawTerminalLaunchInput,
    target: LaunchOperationTarget,
  ) => {
    updateLaunchOperation(target, (current) =>
      createClientLaunchOperation(target, "launching", {
        ...(current ?? {}),
        status: "launching",
        handoff,
        terminalLaunch: null,
        error: null,
        updatedAt: new Date().toISOString(),
      })
    );
    try {
      const response = await fetch("/api/node-launches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handoff: {
            ...handoff,
            kickoffPrompt: input.kickoffPrompt,
            terminal: {
              ...handoff.terminal,
              title: input.terminalTitle,
              tabColor: input.terminalColor,
            },
          },
        }),
      });
      if (!response.ok) {
        const parsed = await parseErrorResponse(response);
        throw new Error(parsed.message);
      }
      const result = await response.json() as NodeTerminalLaunchResponse;
      updateLaunchOperation(target, (current) =>
        createClientLaunchOperation(target, "launched_pending_binding", {
          ...(current ?? {}),
          status: "launched_pending_binding",
          handoff,
          terminalLaunch: result,
          error: null,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
      setNodeLaunchRecordRefreshKey((current) => current + 1);
    } catch (nextError) {
      updateLaunchOperation(target, (current) =>
        createClientLaunchOperation(target, "terminal_failed", {
          ...(current ?? {}),
          status: "terminal_failed",
          handoff,
          terminalLaunch: null,
          error: operationError(
            "terminal_launch_failed",
            nextError instanceof Error ? nextError.message : String(nextError),
          ),
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
      setNodeLaunchRecordRefreshKey((current) => current + 1);
    }
  };

  const launchManagedSdkFromHandoff = async (
    handoff: PawLaunchPreparationResponse,
    target: LaunchOperationTarget,
  ) => {
    const timestamp = new Date().toISOString();
    updateLaunchOperation(target, (current) =>
      createClientLaunchOperation(target, "managed_starting", {
        ...(current ?? {}),
        status: "managed_starting",
        handoff,
        terminalLaunch: null,
        managedLaunch: null,
        error: null,
        progressEvents: [
          {
            type: "managed-runtime-starting",
            message: "Submitting background session launch request.",
            timestamp,
          },
        ],
        startedAt: timestamp,
        completedAt: null,
        updatedAt: timestamp,
      })
    );
    try {
      const response = await fetch("/api/node-launches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handoff: {
            ...handoff,
            runtimeKind: "managed-sdk",
          },
        }),
      });
      if (!response.ok) {
        const parsed = await parseErrorResponse(response);
        throw new Error(parsed.message);
      }
      const result = await response.json() as ManagedSdkLaunchApiResponse;
      const managedLaunch = managedLaunchFromApiResponse(result);
      const refreshed = await loadNodeLaunchRecord(target.graphPath, target.nodeId);
      if (refreshed.record) {
        setNodeLaunchRecords((current) =>
          mergeNodeLaunchRecord(current, target, refreshed.record)
        );
      }
      setLaunchOperation(
        target,
        refreshed.operation ??
          createClientLaunchOperation(target, "managed_running", {
            status: "managed_running",
            handoff,
            terminalLaunch: null,
            managedLaunch,
            latestClaim: result.launchClaim,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
      );
      setNodeLaunchRecordRefreshKey((current) => current + 1);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      updateLaunchOperation(target, (current) =>
        createClientLaunchOperation(
          target,
          "managed_failed",
          {
            ...(current ?? {}),
            status: "managed_failed",
            managedLaunch: null,
            error: operationError("managed_runtime_failed", message),
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        )
      );
      setNodeLaunchRecordRefreshKey((current) => current + 1);
    }
  };

  const handleSubmitLaunch = async (configuration: PawLaunchDialogConfiguration) => {
    const target = launchDialogTarget ?? selectedLaunchTarget;
    const targetEntry = launchDialogEntry ?? selectedEntry;
    if (!target || !targetEntry || !activeWorkstreamEntry || !launchDefaults) {
      return;
    }
    const trimmedCwd = configuration.cwd.trim();
    const trimmedInferredCwd = launchDefaults.inferredCwd.trim();
    const cwdOverride = trimmedCwd && trimmedCwd !== trimmedInferredCwd
      ? trimmedCwd
      : undefined;
    writeLaunchCwdOverride(launchDefaults.cwdPreferenceKey, cwdOverride ?? null);
    updateLaunchOperation(target, (current) =>
      createClientLaunchOperation(target, "preparing", {
        ...(current ?? {}),
        status: "preparing",
        preparationRunId: null,
        handoff: null,
        terminalLaunch: null,
        managedLaunch: null,
        error: null,
        progressEvents: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
    let closeProgressStream: (() => void) | undefined;
    let activeRunId: string | null = null;
    try {
      const response = await fetch("/api/launch-preparations/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: targetEntry.node.id,
          graphPath: target.graphPath,
          launchNonce: createLaunchNonce(),
          configuration: {
            ...(cwdOverride ? { cwd: cwdOverride } : {}),
            runtimeKind: configuration.runtimeKind,
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
      activeRunId = started.runId;
      localRunStreamsRef.current.add(activeRunId);
      if (started.operation) {
        setLaunchOperation(target, started.operation);
      } else {
        updateLaunchOperation(target, (current) =>
          createClientLaunchOperation(target, "preparing", {
            ...(current ?? {}),
            status: "preparing",
            preparationRunId: started.runId ?? null,
            updatedAt: new Date().toISOString(),
          })
        );
      }

      const preparedHandoff = await new Promise<PawLaunchPreparationResponse>((resolve, reject) => {
        const source = new EventSource(
          `/api/launch-preparations/runs/${encodeURIComponent(started.runId ?? "")}/events`,
        );
        closeProgressStream = () => source.close();
        source.addEventListener("progress", (event) => {
          const progress = parseMessageEventData<PawLaunchProgressEvent>(event);
          updateLaunchOperation(target, (current) => {
            const operation = current ?? createClientLaunchOperation(target, "preparing");
            return {
              ...operation,
              status: "preparing",
              error: null,
              updatedAt: progress.timestamp,
              progressEvents: appendProgressEvent(operation.progressEvents, progress),
            };
          });
        });
        source.addEventListener("completed", (event) => {
          const payload = parseMessageEventData<PawLaunchRunFinishedPayload>(event);
          const handoff = payload.result;
          if (!handoff) {
            reject(new Error("Launch preparation completed without a handoff."));
            return;
          }
          const nextHandoff = applyPreparedLaunchHandoff(target, handoff);
          resolve(nextHandoff);
        });
        source.addEventListener("failed", (event) => {
          const payload = parseMessageEventData<PawLaunchRunFinishedPayload>(event);
          const message = applyPreparationFailure(target, payload);
          reject(new Error(message));
        });
        source.onerror = () => {
          reject(new Error("Lost connection to launch preparation progress stream."));
        };
      });
      if (preparedHandoff.runtimeKind === "managed-sdk") {
        await launchManagedSdkFromHandoff(preparedHandoff, target);
      } else if (configuration.launchAfterInit) {
        await launchTerminalFromHandoff(preparedHandoff, {
          kickoffPrompt: preparedHandoff.kickoffPrompt,
          terminalTitle: preparedHandoff.terminal.title ?? preparedHandoff.launchMetadata.workTitle,
          terminalColor: preparedHandoff.terminal.tabColor ?? null,
        }, target);
      }
    } catch (nextError) {
      updateLaunchOperation(target, (current) => {
        if (current?.status === "preparation_failed" || current?.status === "terminal_failed") {
          return current;
        }
        return createClientLaunchOperation(target, "preparation_failed", {
          ...(current ?? {}),
          status: "preparation_failed",
          handoff: null,
          error: operationError(
            "launch_preparation_failed",
            nextError instanceof Error ? nextError.message : String(nextError),
          ),
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      });
    } finally {
      closeProgressStream?.();
      if (activeRunId) {
        localRunStreamsRef.current.delete(activeRunId);
      }
    }
  };

  const handleLaunchTerminal = async (input: PawTerminalLaunchInput) => {
    if (!launchDialogOperation?.handoff || !launchDialogTarget) {
      return;
    }
    if (launchDialogOperation.handoff.runtimeKind === "managed-sdk") {
      await launchManagedSdkFromHandoff(launchDialogOperation.handoff, launchDialogTarget);
      return;
    }
    await launchTerminalFromHandoff(launchDialogOperation.handoff, input, launchDialogTarget);
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
        onConfigureWorkstream={handleOpenConfigurationDialog}
        configureDisabledReason={configureDisabledReason}
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
            initialFitKey={initialViewportFitKey}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
            nodeSessionStatuses={nodeSessionStatuses}
            nodeSessionStatusState={nodeSessionStatusState}
            runtimeOverlay={runtimeOverlay}
            sessionRouteForNode={sessionRouteForNode}
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
            launchOperation={selectedLaunchOperation}
            launchRecordLoading={nodeLaunchRecordLoading || selectedNodeLaunchRecordLoading}
            launchRecordError={nodeLaunchRecordError ?? selectedNodeLaunchRecordError}
            runtimeOverlay={selectedRuntimeOverlay}
            onLaunch={handleOpenLaunchDialog}
          />
        </div>
      </div>
      {launchDialogOpen && launchDialogEntry && launchDefaults ? (
        <PawLaunchDialog
          key={`${launchDialogEntry.node.id}:${launchDefaults.graphPath}`}
          nodeTitle={launchDialogEntry.node.title}
          defaults={launchDefaults}
          defaultPromptProfileId={workstream.launchDefaults?.promptProfileId ?? null}
          promptProfiles={promptProfiles}
          promptProfilesLoading={promptProfilesLoading}
          promptProfilesError={promptProfilesError}
          preparing={
            launchDialogOperation?.status === "preparing" ||
            launchDialogOperation?.status === "managed_starting"
          }
          launching={launchDialogOperation?.status === "launching"}
          error={launchDialogOperation?.error?.error ?? null}
          handoff={launchDialogOperation?.handoff ?? null}
          terminalLaunchResult={launchDialogOperation?.terminalLaunch ?? null}
          managedLaunchResult={launchDialogOperation?.managedLaunch ?? null}
          latestLaunchClaim={launchDialogLatestClaim}
          progressEvents={launchDialogOperation?.progressEvents ?? []}
          actionDisabledReason={launchActionDisabledReason}
          releasingLaunch={launchReleasing}
          releaseError={launchReleaseError}
          releaseStatus={launchReleaseStatus}
          onCancel={handleCloseLaunchDialog}
          onSubmit={handleSubmitLaunch}
          onLaunchTerminal={handleLaunchTerminal}
          onPromptProfilesChanged={onPromptProfilesChanged}
          onReleaseLaunch={launchDialogLatestClaim?.blocksLaunch ? handleReleaseLaunch : undefined}
        />
      ) : null}
      {configurationDialogOpen && workstream ? (
        <WorkstreamConfigurationDialog
          key={`${workstream.projectKey ?? ""}:${workstream.id}:${workstream.updatedAt}`}
          workstream={workstream}
          promptProfiles={promptProfiles}
          promptProfilesLoading={promptProfilesLoading}
          promptProfilesError={promptProfilesError}
          saving={configurationSaving}
          error={configurationError}
          onCancel={handleCloseConfigurationDialog}
          onSave={handleSaveConfiguration}
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

function SettingsPage({
  profiles,
  profilesLoading,
  profilesError,
  onRefreshProfiles,
  onProfilesChanged,
  onProfileDeleted,
}: {
  profiles: PawPromptProfile[];
  profilesLoading: boolean;
  profilesError: string | null;
  onRefreshProfiles: () => Promise<void>;
  onProfilesChanged: (profiles: PawPromptProfile[]) => void;
  onProfileDeleted: (profileId: string) => void;
}) {
  return (
    <div className="sl-shell-panel">
      <div className="sl-settings-page">
        <aside className="sl-settings-sidebar" aria-label="Streamliner settings sections">
          <div className="sl-settings-sidebar-head">
            <span className="sl-eyebrow">Settings</span>
          </div>
          <nav className="sl-settings-nav" aria-label="Streamliner settings">
            <a
              className="sl-settings-nav-item active"
              href={routePath({ view: "settings", section: "profiles" })}
              aria-current="page"
              onClick={(event) => event.preventDefault()}
            >
              <span>PAW profiles</span>
              <small>Launch prompt defaults</small>
            </a>
          </nav>
        </aside>
        <main className="sl-settings-content">
          <PawProfilesPage
            profiles={profiles}
            loading={profilesLoading}
            error={profilesError}
            onRefresh={onRefreshProfiles}
            onProfilesChanged={onProfilesChanged}
            onProfileDeleted={onProfileDeleted}
          />
        </main>
      </div>
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
  const settingsActive = route.view === "settings";

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
        <a
          className={`sl-action-btn sl-icon-action${settingsActive ? " active" : ""}`}
          href={routePath({ view: "settings", section: "profiles" })}
          aria-label="Streamliner settings"
          title="Streamliner settings"
          aria-current={settingsActive ? "page" : undefined}
          onClick={(event) => handleInAppLinkClick(event, () => onRouteChange({ view: "settings", section: "profiles" }))}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path
              d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.4h-4l-.4 2.6A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
              fill="currentColor"
            />
          </svg>
          <span className="sl-visually-hidden">Streamliner settings</span>
        </a>
      </div>
    </div>
  );
}

export default function App() {
  const { route, setRoute } = useDashboardRoute();
  const graphLoader = useGraphLoader(route, true);
  const promptProfileState = usePromptProfilesState();
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
    async (entry: { projectKey: string; workstreamId: string; nodeId?: string | null }) => {
      await handleRouteChange({
        view: "workstream",
        projectKey: entry.projectKey,
        workstreamId: entry.workstreamId,
        nodeId: entry.nodeId ?? undefined,
      });
    },
    [handleRouteChange],
  );

  const openSessions = useCallback(
    async (target?: { workstreamId?: string | null; nodeId?: string | null }) => {
      await handleRouteChange({
        view: "sessions",
        workstreamId: target?.workstreamId ?? null,
        nodeId: target?.nodeId ?? null,
      });
    },
    [handleRouteChange],
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
      {route.view === "settings" ? (
        <SettingsPage
          profiles={promptProfileState.profiles}
          profilesLoading={promptProfileState.loading}
          profilesError={promptProfileState.error}
          onRefreshProfiles={promptProfileState.refresh}
          onProfilesChanged={promptProfileState.noteProfilesChanged}
          onProfileDeleted={promptProfileState.noteProfileDeleted}
        />
      ) : route.view === "sessions" ? (
        <SessionsPage
          registerBeforeLeave={registerBeforeLeave}
          workstreams={graphLoader.workstreams}
          onOpenWorkstream={openWorkstream}
          routeWorkstreamId={route.workstreamId ?? null}
          routeNodeId={route.nodeId ?? null}
        />
      ) : route.view === "workstream" ? (
        <GraphDashboard
          {...graphLoader}
          onOpenWorkstream={openWorkstream}
          onOpenSessions={openSessions}
          onManageSources={manageSources}
          onRouteHome={() => setRoute({ view: "workstreams" }, "replace")}
          selectedNodeIdFromRoute={route.nodeId ?? null}
          promptProfiles={promptProfileState.profiles}
          promptProfilesLoading={promptProfileState.loading}
          promptProfilesError={promptProfileState.error}
          onRefreshPromptProfiles={promptProfileState.refresh}
          onPromptProfilesChanged={promptProfileState.noteProfilesChanged}
        />
      ) : route.view === "workstreams" ? (
        <WorkstreamHome
          message={route.message}
          registryError={graphLoader.registryError}
          workstreams={graphLoader.workstreams}
          archivedWorkstreams={graphLoader.archivedWorkstreams}
          sources={graphLoader.sources}
          conflicts={graphLoader.conflicts}
          registryLoading={graphLoader.registryLoading}
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
          onOpenSessions={() => openSessions()}
          onOpenWorkstreams={() => handleRouteChange({ view: "workstreams" })}
        />
      )}
    </div>
  );
}
