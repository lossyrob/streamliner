import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SessionRegistryListItem,
  SessionRegistryListOptions,
} from "./session-registry-contract";
import { sessionRegistryRecordMatchesOptions } from "./session-registry-filter";
import { useIsDocumentVisible } from "./use-document-visibility";
import {
  SESSION_REGISTRY_MANAGED_LIFECYCLE_STATES,
  SESSION_REGISTRY_RUNTIME_EVIDENCE_KINDS,
  SESSION_REGISTRY_RUNTIME_KINDS,
  SESSION_REGISTRY_RUNTIME_OWNERS,
  SESSION_REGISTRY_RUNTIME_PERMISSION_PROFILES,
  SESSION_REGISTRY_RUNTIME_PROGRESS_EVENT_TYPES,
  type SessionRegistryRuntimeEvidence,
  type SessionRegistryRuntimeMetadata,
  type SessionRegistryRuntimeProgressEvent,
} from "./session-registry-schema";

const SESSION_POLL_INTERVAL_MS = 15_000;
const SESSION_EVENT_REFETCH_DEBOUNCE_MS = 150;
const SESSION_EVENT_STALE_MS = 35_000;

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

export function sessionRegistryEventsUrl(query: SessionRegistryListQuery = {}): string {
  const listUrl = sessionRegistryListUrl(query);
  const queryStart = listUrl.indexOf("?");
  return queryStart >= 0
    ? `/api/sessions/events${listUrl.slice(queryStart)}`
    : "/api/sessions/events";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sessionFromEventPayload(value: unknown): SessionRegistryListItem | null {
  if (!isJsonObject(value) || typeof value.id !== "string") {
    return null;
  }
  const origin = isJsonObject(value.origin) ? value.origin : null;
  const originKind = typeof value.originKind === "string"
    ? value.originKind
    : origin && typeof origin.kind === "string"
      ? origin.kind
      : null;
  if (!originKind) {
    return null;
  }
  const launchCliArgs = Array.isArray(value.launchCliArgs)
    ? value.launchCliArgs
    : originKind === "launched" && origin && Array.isArray(origin.cliArgs)
      ? origin.cliArgs
      : null;
  return {
    ...value,
    originKind,
    launchCliArgs,
  } as unknown as SessionRegistryListItem;
}

export function sessionsFromSnapshotPayload(value: unknown): SessionRegistryListItem[] | null {
  if (!isJsonObject(value) || !Array.isArray(value.sessions)) {
    return null;
  }
  const sessions = value.sessions.map(sessionFromEventPayload);
  return sessions.every((session) => session !== null)
    ? (sessions as SessionRegistryListItem[])
    : null;
}

export function eventRegistryId(value: unknown): string | null {
  return isJsonObject(value) && typeof value.registryId === "string"
    ? value.registryId
    : null;
}

export interface RuntimeUpdatedPayload {
  registryId: string;
  runtime: SessionRegistryRuntimeMetadata | null;
  updatedAt?: string;
  version?: number;
}

export function runtimeUpdatedPayload(value: unknown): RuntimeUpdatedPayload | null {
  if (!isJsonObject(value) || typeof value.registryId !== "string") {
    return null;
  }
  const runtime = runtimeMetadataFromPayload(value.runtime);
  if (runtime === undefined) {
    return null;
  }
  const payload: RuntimeUpdatedPayload = {
    registryId: value.registryId,
    runtime,
  };
  if (typeof value.updatedAt === "string") {
    payload.updatedAt = value.updatedAt;
  }
  if (typeof value.version === "number" && Number.isInteger(value.version)) {
    payload.version = value.version;
  }
  return payload;
}

function runtimeMetadataFromPayload(
  value: unknown,
): SessionRegistryRuntimeMetadata | null | undefined {
  if (value === null) {
    return null;
  }
  if (!isJsonObject(value)) {
    return undefined;
  }
  if (
    !isKnownValue(value.runtimeKind, SESSION_REGISTRY_RUNTIME_KINDS) ||
    !isKnownValue(value.runtimeOwner, SESSION_REGISTRY_RUNTIME_OWNERS) ||
    !isNullableKnownValue(
      value.lifecycleState,
      SESSION_REGISTRY_MANAGED_LIFECYCLE_STATES,
    ) ||
    !isNullableKnownValue(
      value.permissionProfile,
      SESSION_REGISTRY_RUNTIME_PERMISSION_PROFILES,
    ) ||
    !runtimeProgressEventsFromPayload(value.progressEvents) ||
    !runtimeEvidenceFromPayload(value.evidence)
  ) {
    return undefined;
  }
  return value as unknown as SessionRegistryRuntimeMetadata;
}

function isKnownValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && allowed.includes(value as T[number]);
}

function isNullableKnownValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] | null {
  return value === null || isKnownValue(value, allowed);
}

function runtimeProgressEventsFromPayload(
  value: unknown,
): value is SessionRegistryRuntimeProgressEvent[] {
  return Array.isArray(value) && value.every((event) =>
    isJsonObject(event) &&
    typeof event.id === "string" &&
    typeof event.sequence === "number" &&
    isKnownValue(event.type, SESSION_REGISTRY_RUNTIME_PROGRESS_EVENT_TYPES) &&
    typeof event.message === "string" &&
    typeof event.timestamp === "string"
  );
}

function runtimeEvidenceFromPayload(
  value: unknown,
): value is SessionRegistryRuntimeEvidence[] {
  return Array.isArray(value) && value.every((evidence) =>
    isJsonObject(evidence) &&
    typeof evidence.id === "string" &&
    isKnownValue(evidence.kind, SESSION_REGISTRY_RUNTIME_EVIDENCE_KINDS) &&
    typeof evidence.source === "string" &&
    typeof evidence.detectedAt === "string"
  );
}

export function sessionMatchesQuery(
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
  return sessionRegistryRecordMatchesOptions(session, query);
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
  const sessionsRef = useRef<SessionRegistryListItem[]>([]);
  const eventRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventStreamLiveRef = useRef(false);
  const lastStreamEventAtRef = useRef(0);
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
  const isDocumentVisible = useIsDocumentVisible();

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

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

  const shouldPoll = useCallback(() => {
    if (!eventStreamLiveRef.current) {
      return true;
    }
    return Date.now() - lastStreamEventAtRef.current > SESSION_EVENT_STALE_MS;
  }, []);

  const markStreamEvent = useCallback(() => {
    eventStreamLiveRef.current = true;
    lastStreamEventAtRef.current = Date.now();
  }, []);

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
      eventStreamLiveRef.current = false;
      return;
    }

    setLoading(true);
    void fetchSessions();
    const timer = setInterval(() => {
      if (shouldPoll()) {
        void fetchSessions();
      }
    }, pollIntervalMs);
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden" && shouldPoll()) {
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
  }, [enabled, fetchSessions, pollIntervalMs, shouldPoll]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (typeof EventSource === "undefined") {
      eventStreamLiveRef.current = false;
      setSyncState("polling");
      return;
    }
    if (!isDocumentVisible) {
      // Tab is backgrounded; don't hold a long-lived SSE connection that
      // would consume one of the browser's six per-origin HTTP/1.1 slots
      // while doing no useful work. Polling-fallback path picks up when
      // the tab becomes visible again and this effect re-runs.
      eventStreamLiveRef.current = false;
      setSyncState("polling");
      return;
    }

    let closed = false;
    const source = new EventSource(eventsUrl);
    setSyncState("connecting");

    const handleOpen = () => {
      if (!closed) {
        markStreamEvent();
        setSyncState("live");
      }
    };
    const handleError = () => {
      if (!closed) {
        eventStreamLiveRef.current = false;
        setSyncState("reconnecting");
        void fetchSessions();
      }
    };
    const handleRefetchChange = () => {
      markStreamEvent();
      scheduleEventRefetch();
    };
    const handleHeartbeat = () => {
      markStreamEvent();
      setSyncState("live");
    };
    const handleSnapshot = (event: MessageEvent) => {
      markStreamEvent();
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
      markStreamEvent();
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
    const handleRuntimeUpdate = (event: MessageEvent) => {
      markStreamEvent();
      let payload: RuntimeUpdatedPayload | null = null;
      try {
        payload = runtimeUpdatedPayload(JSON.parse(event.data) as unknown);
      } catch {
        scheduleEventRefetch();
        return;
      }
      if (!payload) {
        scheduleEventRefetch();
        return;
      }
      const knownSession = sessionsRef.current.some(
        (session) => session.id === payload.registryId,
      );
      setSessions((currentSessions) => {
        const existingIndex = currentSessions.findIndex(
          (session) => session.id === payload.registryId,
        );
        if (existingIndex === -1) {
          return currentSessions;
        }
        const existing = currentSessions[existingIndex];
        if (
          payload.version !== undefined &&
          payload.version <= existing.version
        ) {
          return currentSessions;
        }
        const nextSessions = [...currentSessions];
        nextSessions[existingIndex] = {
          ...existing,
          runtime: payload.runtime,
          updatedAt: payload.updatedAt ?? existing.updatedAt,
          version: payload.version ?? existing.version,
        };
        return nextSessions;
      });
      if (!knownSession) {
        scheduleEventRefetch();
      }
      setError(null);
      setLoading(false);
    };
    const handleDelete = (event: MessageEvent) => {
      markStreamEvent();
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
    source.addEventListener("heartbeat", handleHeartbeat);
    source.addEventListener("snapshot", handleSnapshot);
    source.addEventListener("session.upserted", handleUpsert);
    source.addEventListener("session.runtime.updated", handleRuntimeUpdate);
    source.addEventListener("session.deleted", handleDelete);
    source.addEventListener("session.rebuilt", handleRefetchChange);

    return () => {
      closed = true;
      eventStreamLiveRef.current = false;
      source.close();
      if (eventRefetchTimerRef.current) {
        clearTimeout(eventRefetchTimerRef.current);
        eventRefetchTimerRef.current = null;
      }
    };
  }, [enabled, eventsUrl, fetchSessions, isDocumentVisible, listOptions, markStreamEvent, scheduleEventRefetch]);

  return { sessions, loading, error, syncState, refresh: fetchSessions };
}
