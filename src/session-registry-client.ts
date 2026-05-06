import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SessionRegistryListItem,
  SessionRegistryListOptions,
} from "./session-registry-contract";

const SESSION_POLL_INTERVAL_MS = 15_000;
const SESSION_EVENT_REFETCH_DEBOUNCE_MS = 150;

export type SessionRegistrySyncState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "polling";

export interface SessionRegistryListQuery {
  includeArchived?: boolean;
  repo?: string | null;
  text?: string;
  workstreamId?: string | null;
  nodeId?: string | null;
}

export interface UseSessionRegistryListOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
}

export function sessionRegistryListUrl(query: SessionRegistryListQuery = {}): string {
  const search = new URLSearchParams();
  if (query.includeArchived) {
    search.set("includeArchived", "true");
  }
  if (query.repo !== undefined) {
    search.set("repo", query.repo ?? "null");
  }
  if (query.text?.trim()) {
    search.set("text", query.text.trim());
  }
  if (query.workstreamId?.trim()) {
    search.set("workstreamId", query.workstreamId.trim());
  }
  if (query.nodeId?.trim()) {
    search.set("nodeId", query.nodeId.trim());
  }
  const suffix = search.toString();
  return suffix.length > 0 ? `/api/sessions?${suffix}` : "/api/sessions";
}

function sessionRegistryEventsUrl(query: SessionRegistryListQuery = {}): string {
  const listUrl = sessionRegistryListUrl(query);
  const queryStart = listUrl.indexOf("?");
  return queryStart >= 0
    ? `/api/sessions/events${listUrl.slice(queryStart)}`
    : "/api/sessions/events";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionFromEventPayload(value: unknown): SessionRegistryListItem | null {
  if (!isJsonObject(value) || typeof value.id !== "string") {
    return null;
  }
  const originKind = typeof value.originKind === "string"
    ? value.originKind
    : isJsonObject(value.origin) && typeof value.origin.kind === "string"
      ? value.origin.kind
      : null;
  if (!originKind) {
    return null;
  }
  return {
    ...value,
    originKind,
  } as unknown as SessionRegistryListItem;
}

function sessionsFromSnapshotPayload(value: unknown): SessionRegistryListItem[] | null {
  if (!isJsonObject(value) || !Array.isArray(value.sessions)) {
    return null;
  }
  const sessions = value.sessions.map(sessionFromEventPayload);
  return sessions.every((session) => session !== null)
    ? (sessions as SessionRegistryListItem[])
    : null;
}

function eventRegistryId(value: unknown): string | null {
  return isJsonObject(value) && typeof value.registryId === "string"
    ? value.registryId
    : null;
}

function sessionTextMatches(session: SessionRegistryListItem, text: string): boolean {
  const refs = session.derivedGithubRefs.map((ref) =>
    [ref.repo, ref.type, `#${ref.number}`, `${ref.type} #${ref.number}`]
      .filter(Boolean)
      .join(" "),
  );
  const pawWorkflowHaystacks = session.pawWorkflow
    ? [
        session.pawWorkflow.status,
        session.pawWorkflow.stage ?? "",
        session.pawWorkflow.workflowKind,
        session.pawWorkflow.workId ?? "",
        session.pawWorkflow.workTitle ?? "",
        session.pawWorkflow.workDir ?? "",
        ...session.pawWorkflow.diagnostics,
      ]
    : [];
  const pawLaunchHaystacks = session.pawLaunch
    ? [
        session.pawLaunch.workId,
        session.pawLaunch.workTitle,
        session.pawLaunch.workflowKind,
        session.pawLaunch.pawWorkDir,
      ]
    : [];
  return [
    session.title,
    session.description,
    session.aiSummary ?? "",
    session.cwd,
    session.repo ?? "",
    session.branch ?? "",
    session.derivedBranch ?? "",
    session.derivedWorktreePath ?? "",
    ...refs,
    ...pawWorkflowHaystacks,
    ...pawLaunchHaystacks,
    ...session.tags,
  ].some((candidate) => candidate.toLowerCase().includes(text));
}

function sessionMatchesQuery(
  session: SessionRegistryListItem,
  query: SessionRegistryListOptions,
): boolean {
  if (!query.includeArchived && session.lifecycleStatus === "archived") {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(query, "repo") &&
    session.repo !== query.repo
  ) {
    return false;
  }
  if (
    query.workstreamId &&
    session.graphBinding?.workstreamId !== query.workstreamId
  ) {
    return false;
  }
  if (query.nodeId && session.graphBinding?.nodeId !== query.nodeId) {
    return false;
  }
  const text = query.text?.trim().toLowerCase();
  return text ? sessionTextMatches(session, text) : true;
}

export function useSessionRegistryList(
  query: SessionRegistryListQuery,
  options: UseSessionRegistryListOptions = {},
) {
  const enabled = options.enabled ?? true;
  const pollIntervalMs = options.pollIntervalMs ?? SESSION_POLL_INTERVAL_MS;
  const {
    includeArchived,
    nodeId,
    repo,
    text,
    workstreamId,
  } = query;
  const [sessions, setSessions] = useState<SessionRegistryListItem[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SessionRegistrySyncState>("connecting");
  const eventRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = useMemo(
    () =>
      sessionRegistryListUrl({
        includeArchived,
        nodeId,
        repo,
        text,
        workstreamId,
      }),
    [includeArchived, nodeId, repo, text, workstreamId],
  );
  const eventsUrl = useMemo(
    () =>
      sessionRegistryEventsUrl({
        includeArchived,
        nodeId,
        repo,
        text,
        workstreamId,
      }),
    [includeArchived, nodeId, repo, text, workstreamId],
  );
  const listOptions = useMemo<SessionRegistryListOptions>(() => {
    const nextOptions: SessionRegistryListOptions = {
      includeArchived,
      text,
      workstreamId: workstreamId?.trim() ? workstreamId : undefined,
      nodeId: nodeId?.trim() ? nodeId : undefined,
    };
    if (repo !== undefined) {
      nextOptions.repo = repo;
    }
    return nextOptions;
  }, [includeArchived, nodeId, repo, text, workstreamId]);

  const fetchSessions = useCallback(async () => {
    if (!enabled) {
      return;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load sessions (${response.status})`);
      }
      setSessions((await response.json()) as SessionRegistryListItem[]);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [enabled, url]);

  const scheduleEventRefetch = useCallback(
    (delayMs = SESSION_EVENT_REFETCH_DEBOUNCE_MS) => {
      if (eventRefetchTimerRef.current) {
        clearTimeout(eventRefetchTimerRef.current);
      }
      eventRefetchTimerRef.current = setTimeout(() => {
        eventRefetchTimerRef.current = null;
        void fetchSessions();
      }, delayMs);
    },
    [fetchSessions],
  );

  useEffect(() => {
    if (!enabled) {
      setSessions([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    void fetchSessions();
    const timer = setInterval(() => {
      void fetchSessions();
    }, pollIntervalMs);
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden") {
        void fetchSessions();
      }
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enabled, fetchSessions, pollIntervalMs]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (typeof EventSource === "undefined") {
      setSyncState("polling");
      return;
    }

    let closed = false;
    const source = new EventSource(eventsUrl);
    setSyncState("connecting");

    const handleOpen = () => {
      if (!closed) {
        setSyncState("live");
      }
    };
    const handleError = () => {
      if (!closed) {
        setSyncState("reconnecting");
      }
    };
    const handleRefetchChange = () => {
      scheduleEventRefetch();
    };
    const handleSnapshot = (event: MessageEvent) => {
      let nextSessions: SessionRegistryListItem[] | null = null;
      try {
        nextSessions = sessionsFromSnapshotPayload(JSON.parse(event.data) as unknown);
      } catch {
        // Fall back to the list endpoint if the SSE payload is malformed.
      }
      if (!nextSessions) {
        scheduleEventRefetch(0);
        return;
      }
      setSessions(nextSessions);
      setError(null);
      setLoading(false);
    };
    const handleUpsert = (event: MessageEvent) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data) as unknown;
      } catch {
        scheduleEventRefetch();
        return;
      }
      const nextSession = isJsonObject(payload)
        ? sessionFromEventPayload(payload.session)
        : null;
      if (!nextSession) {
        scheduleEventRefetch();
        return;
      }
      setSessions((currentSessions) => {
        const existingIndex = currentSessions.findIndex(
          (session) => session.id === nextSession.id,
        );
        const matches = sessionMatchesQuery(nextSession, listOptions);
        if (existingIndex === -1) {
          return matches ? [nextSession, ...currentSessions] : currentSessions;
        }
        if (!matches) {
          return currentSessions.filter((session) => session.id !== nextSession.id);
        }
        const nextSessions = [...currentSessions];
        nextSessions[existingIndex] = nextSession;
        return nextSessions;
      });
      setError(null);
      setLoading(false);
    };
    const handleDelete = (event: MessageEvent) => {
      let registryId: string | null = null;
      try {
        registryId = eventRegistryId(JSON.parse(event.data) as unknown);
      } catch {
        scheduleEventRefetch();
        return;
      }
      if (!registryId) {
        scheduleEventRefetch();
        return;
      }
      setSessions((currentSessions) =>
        currentSessions.filter((session) => session.id !== registryId),
      );
      setError(null);
      setLoading(false);
    };

    source.addEventListener("open", handleOpen);
    source.addEventListener("error", handleError);
    source.addEventListener("snapshot", handleSnapshot);
    source.addEventListener("session.upserted", handleUpsert);
    source.addEventListener("session.deleted", handleDelete);
    source.addEventListener("session.rebuilt", handleRefetchChange);

    return () => {
      closed = true;
      source.close();
      if (eventRefetchTimerRef.current) {
        clearTimeout(eventRefetchTimerRef.current);
        eventRefetchTimerRef.current = null;
      }
    };
  }, [enabled, eventsUrl, listOptions, scheduleEventRefetch]);

  return { sessions, loading, error, syncState, refresh: fetchSessions };
}
