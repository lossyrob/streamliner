import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionRegistryListItem } from "./session-registry-contract";

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
    const source = new EventSource("/api/sessions/events");
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
    const handleChange = () => {
      scheduleEventRefetch();
    };

    source.addEventListener("open", handleOpen);
    source.addEventListener("error", handleError);
    source.addEventListener("snapshot", handleChange);
    source.addEventListener("session.upserted", handleChange);
    source.addEventListener("session.deleted", handleChange);
    source.addEventListener("session.rebuilt", handleChange);

    return () => {
      closed = true;
      source.close();
      if (eventRefetchTimerRef.current) {
        clearTimeout(eventRefetchTimerRef.current);
        eventRefetchTimerRef.current = null;
      }
    };
  }, [enabled, scheduleEventRefetch]);

  return { sessions, loading, error, syncState, refresh: fetchSessions };
}
