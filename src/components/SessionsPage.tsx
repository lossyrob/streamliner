import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SessionRegistryListItem, SessionRegistryPatch } from "../session-registry-contract";
import type { SessionRegistryRecord } from "../session-registry-schema";

const SESSION_POLL_INTERVAL_MS = 2000;
const SESSION_AUTOSAVE_MS = 500;
const DEFAULT_STALE_SESSION_DAYS = 7;
const SESSION_STALE_DAYS_STORAGE_KEY = "streamliner:sessionsStaleDays";

interface SessionDraft {
  title: string;
  description: string;
  color: string;
  cwd: string;
  repo: string;
  branch: string;
  tagsText: string;
  lifecycleStatus: "active" | "paused" | "archived" | "ended";
}

type SaveState = "idle" | "saving" | "saved" | "error";

function draftFromSession(session: SessionRegistryListItem): SessionDraft {
  return {
    title: session.title,
    description: session.description,
    color: session.color ?? "",
    cwd: session.cwd,
    repo: session.repo ?? "",
    branch: session.branch ?? "",
    tagsText: session.tags.join(", "),
    lifecycleStatus: session.lifecycleStatus,
  };
}

function createEmptyDraft(): SessionDraft {
  return {
    title: "",
    description: "",
    color: "",
    cwd: "",
    repo: "",
    branch: "",
    tagsText: "",
    lifecycleStatus: "active",
  };
}

function toListItem(record: SessionRegistryRecord): SessionRegistryListItem {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    lifecycleStatus: record.lifecycleStatus,
    lastSeenAt: record.lastSeenAt,
    updatedAt: record.updatedAt,
    color: record.color,
    cwd: record.cwd,
    repo: record.repo,
    branch: record.branch,
    tags: record.tags,
    originKind: record.origin.kind,
    graphBinding: record.graphBinding,
    copilotSessionId: record.copilotSessionId,
  };
}

function normalizeTags(tagsText: string): string[] {
  const seen = new Set<string>();
  return tagsText
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && !seen.has(tag) && (seen.add(tag), true));
}

function draftKey(draft: SessionDraft): string {
  return JSON.stringify({
    title: draft.title.trim(),
    description: draft.description,
    color: draft.color.trim(),
    cwd: draft.cwd,
    repo: draft.repo,
    branch: draft.branch,
    tags: normalizeTags(draft.tagsText),
    lifecycleStatus: draft.lifecycleStatus,
  });
}

function buildPatch(
  session: SessionRegistryListItem,
  draft: SessionDraft,
): SessionRegistryPatch | null {
  const patch: SessionRegistryPatch = {};
  const nextTitle = draft.title.trim();
  if (nextTitle !== session.title) {
    patch.title = nextTitle;
  }
  if (draft.description !== session.description) {
    patch.description = draft.description;
  }

  const nextColor = draft.color.trim() || null;
  if (nextColor !== session.color) {
    patch.color = nextColor;
  }

  const nextTags = normalizeTags(draft.tagsText);
  if (JSON.stringify(nextTags) !== JSON.stringify(session.tags)) {
    patch.tags = nextTags;
  }

  if (
    session.lifecycleStatus !== "ended" &&
    draft.lifecycleStatus !== session.lifecycleStatus
  ) {
    const nextLifecycle = draft.lifecycleStatus;
    if (nextLifecycle !== "ended") {
      patch.lifecycleStatus = nextLifecycle;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function sessionSnapshotKey(session: SessionRegistryListItem | null): string | null {
  if (!session) {
    return null;
  }
  return JSON.stringify({
    id: session.id,
    title: session.title,
    description: session.description,
    lifecycleStatus: session.lifecycleStatus,
    lastSeenAt: session.lastSeenAt,
    updatedAt: session.updatedAt,
    color: session.color,
    cwd: session.cwd,
    repo: session.repo,
    branch: session.branch,
    tags: session.tags,
    originKind: session.originKind,
    graphBinding: session.graphBinding,
    copilotSessionId: session.copilotSessionId,
  });
}

function statusClass(status: SessionRegistryListItem["lifecycleStatus"]): string {
  switch (status) {
    case "active":
      return "green";
    case "paused":
      return "amber";
    case "ended":
    case "archived":
      return "muted";
    default:
      return "accent";
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Never observed";
  }
  return new Date(value).toLocaleString();
}

function getFreshnessTimestamp(session: SessionRegistryListItem): number {
  const freshnessSource = session.lastSeenAt ?? session.updatedAt;
  const freshnessTimestamp = Date.parse(freshnessSource);
  return Number.isFinite(freshnessTimestamp) ? freshnessTimestamp : Number.NEGATIVE_INFINITY;
}

function isSessionStale(
  session: SessionRegistryListItem,
  staleSessionDays: number,
): boolean {
  const staleCutoff = Date.now() - staleSessionDays * 24 * 60 * 60 * 1000;
  return getFreshnessTimestamp(session) < staleCutoff;
}

function readStaleSessionDays(): number {
  if (typeof window === "undefined") {
    return DEFAULT_STALE_SESSION_DAYS;
  }

  const persistedValue = Number(window.localStorage.getItem(SESSION_STALE_DAYS_STORAGE_KEY));
  if (!Number.isFinite(persistedValue) || persistedValue < 1) {
    return DEFAULT_STALE_SESSION_DAYS;
  }
  return Math.floor(persistedValue);
}

function useLatestValue<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

interface SessionSaveOptions {
  background?: boolean;
  keepalive?: boolean;
}

interface SessionsPageProps {
  registerBeforeLeave?: (handler: (() => Promise<boolean>) | null) => void;
}

export function SessionsPage({ registerBeforeLeave }: SessionsPageProps) {
  const [sessions, setSessions] = useState<SessionRegistryListItem[]>([]);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [staleSessionDays, setStaleSessionDays] = useState(readStaleSessionDays);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SessionDraft>(createEmptyDraft);
  const [selectedSnapshot, setSelectedSnapshot] = useState<SessionRegistryListItem | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [creatingState, setCreatingState] = useState<SaveState>("idle");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipUnmountFlushRef = useRef(false);
  const creatingRef = useLatestValue(creating);
  const selectedIdRef = useLatestValue(selectedId);
  const draftRef = useLatestValue(draft);
  const selectedSnapshotRef = useLatestValue(selectedSnapshot);
  const saveStateRef = useLatestValue(saveState);

  const fetchSessions = useCallback(
    async (keepSelection = true) => {
      try {
        const search = new URLSearchParams();
        if (showArchived) {
          search.set("includeArchived", "true");
        }
        if (query.trim().length > 0) {
          search.set("text", query.trim());
        }
        const suffix = search.toString();
        const response = await fetch(
          suffix.length > 0 ? `/api/sessions?${suffix}` : "/api/sessions",
        );
        if (!response.ok) {
          throw new Error(`Failed to load sessions (${response.status})`);
        }

        const nextSessions = (await response.json()) as SessionRegistryListItem[];
        setSessions(nextSessions);
        setError(null);
        const currentCreating = creatingRef.current;
        const currentSelectedId = selectedIdRef.current;
        const currentSelectedSnapshot = selectedSnapshotRef.current;
        const currentDraft = draftRef.current;
        const currentSaveState = saveStateRef.current;
        if (!keepSelection) {
          return;
        }
        if (currentCreating) {
          return;
        }

        if (currentSelectedId) {
          const matching =
            nextSessions.find((session) => session.id === currentSelectedId) ?? null;
          if (!matching) {
            setSelectedId(null);
            setSelectedSnapshot(null);
            setDraft(createEmptyDraft());
            setSaveState("idle");
            return;
          }

          const currentDraftKey = draftKey(currentDraft);
          const snapshotDraftKey = currentSelectedSnapshot
            ? draftKey(draftFromSession(currentSelectedSnapshot))
            : null;
          const nextSnapshotKey = sessionSnapshotKey(matching);
          const currentSnapshotKey = sessionSnapshotKey(currentSelectedSnapshot);
          if (
            currentSaveState !== "saving" &&
            currentSelectedSnapshot &&
            currentDraftKey === snapshotDraftKey
          ) {
            if (currentSnapshotKey !== nextSnapshotKey) {
              setSelectedSnapshot(matching);
            }
            const nextDraft = draftFromSession(matching);
            if (currentDraftKey !== draftKey(nextDraft)) {
              setDraft(nextDraft);
            }
          }
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setLoading(false);
      }
    },
    [creatingRef, draftRef, query, saveStateRef, selectedIdRef, selectedSnapshotRef, showArchived],
  );

  useEffect(() => {
    void fetchSessions();
    const timer = setInterval(() => {
      void fetchSessions();
    }, SESSION_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchSessions]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? selectedSnapshot,
    [selectedId, selectedSnapshot, sessions],
  );
  const selectedSessionRef = useLatestValue(selectedSession);
  const visibleSessions = useMemo(
    () => sessions.filter((session) => !isSessionStale(session, staleSessionDays)),
    [sessions, staleSessionDays],
  );
  const hiddenStaleSessionCount = sessions.length - visibleSessions.length;

  const existingDirty = useMemo(() => {
    if (!selectedSession || creating) {
      return false;
    }
    const patch = buildPatch(selectedSession, draft);
    return patch !== null;
  }, [creating, draft, selectedSession]);
  const existingDirtyRef = useLatestValue(existingDirty);
  const fetchSessionsRef = useLatestValue(fetchSessions);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const saveExistingSession = useCallback(
    async (options: SessionSaveOptions = {}): Promise<boolean> => {
      clearAutosaveTimer();

      const currentSelectedSession = selectedSessionRef.current;
      if (!currentSelectedSession || creatingRef.current) {
        return true;
      }

      const currentDraft = draftRef.current;
      const patch = buildPatch(currentSelectedSession, currentDraft);
      if (!patch) {
        if (!options.background) {
          setSaveState("saved");
          setSaveError(null);
        }
        return true;
      }

      if (currentDraft.title.trim().length === 0) {
        if (!options.background) {
          setSaveState("error");
          setSaveError("Title is required.");
        }
        return false;
      }

      if (!options.background) {
        setSaveState("saving");
      }

      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(currentSelectedSession.id)}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(patch),
            keepalive: options.keepalive,
          },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Failed to save session (${response.status})`);
        }

        if (options.background) {
          return true;
        }

        const updated = toListItem((await response.json()) as SessionRegistryRecord);
        setSelectedSnapshot(updated);
        setDraft(draftFromSession(updated));
        setSaveState("saved");
        setSaveError(null);
        await fetchSessionsRef.current();
        return true;
      } catch (nextError) {
        if (!options.background) {
          setSaveState("error");
          setSaveError(nextError instanceof Error ? nextError.message : String(nextError));
        }
        return false;
      }
    },
    [clearAutosaveTimer, creatingRef, draftRef, fetchSessionsRef, selectedSessionRef],
  );

  const handleBeforeLeave = useCallback(async () => {
    if (!existingDirtyRef.current) {
      return true;
    }
    const saved = await saveExistingSession({ keepalive: true });
    if (saved) {
      skipUnmountFlushRef.current = true;
    }
    return saved;
  }, [existingDirtyRef, saveExistingSession]);

  useEffect(() => {
    if (!registerBeforeLeave) {
      return;
    }
    registerBeforeLeave(handleBeforeLeave);
    return () => registerBeforeLeave(null);
  }, [handleBeforeLeave, registerBeforeLeave]);

  useEffect(() => {
    const handlePageHide = () => {
      if (!existingDirtyRef.current) {
        return;
      }
      void saveExistingSession({ background: true, keepalive: true });
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      if (skipUnmountFlushRef.current) {
        skipUnmountFlushRef.current = false;
        return;
      }
      void saveExistingSession({ background: true, keepalive: true });
    };
  }, [existingDirtyRef, saveExistingSession]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        SESSION_STALE_DAYS_STORAGE_KEY,
        String(staleSessionDays),
      );
    }
  }, [staleSessionDays]);

  useEffect(() => {
    if (creating) {
      return;
    }

    const selectedVisible =
      selectedId !== null
        ? visibleSessions.find((session) => session.id === selectedId) ?? null
        : null;
    if (selectedVisible) {
      return;
    }
    if (selectedId && (existingDirty || saveState === "saving")) {
      return;
    }

    const nextVisibleSession = visibleSessions[0] ?? null;
    if (nextVisibleSession) {
      setSelectedId(nextVisibleSession.id);
      setSelectedSnapshot(nextVisibleSession);
      setDraft(draftFromSession(nextVisibleSession));
      setSaveState("idle");
      return;
    }

    if (selectedId !== null) {
      setSelectedId(null);
      setSelectedSnapshot(null);
      setDraft(createEmptyDraft());
      setSaveState("idle");
    }
  }, [creating, existingDirty, saveState, selectedId, visibleSessions]);

  useEffect(() => {
    if (!selectedSession || creating || !existingDirty) {
      return;
    }

    clearAutosaveTimer();
    autosaveTimerRef.current = setTimeout(() => {
      void saveExistingSession();
    }, SESSION_AUTOSAVE_MS);

    return clearAutosaveTimer;
  }, [clearAutosaveTimer, creating, existingDirty, saveExistingSession, selectedSession]);

  const handleSelectSession = useCallback(
    async (session: SessionRegistryListItem) => {
      if (!creating && existingDirty && !(await saveExistingSession())) {
        return;
      }
      setCreating(false);
      setCreatingState("idle");
      setSelectedId(session.id);
      setSelectedSnapshot(session);
      setDraft(draftFromSession(session));
      setSaveState("idle");
      setSaveError(null);
    },
    [creating, existingDirty, saveExistingSession],
  );

  const startCreating = useCallback(async () => {
    if (!creating && existingDirty && !(await saveExistingSession())) {
      return;
    }
    setCreating(true);
    setSelectedId(null);
    setSelectedSnapshot(null);
    setDraft(createEmptyDraft());
    setCreatingState("idle");
    setSaveState("idle");
    setSaveError(null);
  }, [creating, existingDirty, saveExistingSession]);

  const handleCreate = useCallback(async () => {
    if (draft.title.trim().length === 0 || draft.cwd.trim().length === 0) {
      setCreatingState("error");
      setSaveError("New sessions need both a title and a cwd.");
      return;
    }

    setCreatingState("saving");
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description,
          color: draft.color.trim() || null,
          cwd: draft.cwd.trim(),
          repo: draft.repo.trim() || null,
          branch: draft.branch.trim() || null,
          tags: normalizeTags(draft.tagsText),
          lifecycleStatus:
            draft.lifecycleStatus === "paused" ? "paused" : "active",
          origin: { kind: "manual" },
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Failed to create session (${response.status})`);
      }

      const created = toListItem((await response.json()) as SessionRegistryRecord);
      setCreating(false);
      setSelectedId(created.id);
      setSelectedSnapshot(created);
      setDraft(draftFromSession(created));
      setCreatingState("saved");
      setSaveError(null);
      await fetchSessions();
    } catch (nextError) {
      setCreatingState("error");
      setSaveError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [draft, fetchSessions]);

  const handleArchive = useCallback(async () => {
    if (!selectedSession) {
      return;
    }
    if (existingDirty && !(await saveExistingSession())) {
      return;
    }
    setSaveState("saving");
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(selectedSession.id)}/archive`,
        { method: "POST" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Failed to archive session (${response.status})`);
      }
      setSaveState("saved");
      await fetchSessions();
    } catch (nextError) {
      setSaveState("error");
      setSaveError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [existingDirty, fetchSessions, saveExistingSession, selectedSession]);

  const handleDelete = useCallback(async () => {
    if (!selectedSession || !window.confirm(`Delete "${selectedSession.title}"?`)) {
      return;
    }
    if (existingDirty && !(await saveExistingSession())) {
      return;
    }
    setSaveState("saving");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(selectedSession.id)}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Failed to delete session (${response.status})`);
      }
      setSelectedId(null);
      setSelectedSnapshot(null);
      setDraft(createEmptyDraft());
      setSaveState("idle");
      await fetchSessions(false);
    } catch (nextError) {
      setSaveState("error");
      setSaveError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [existingDirty, fetchSessions, saveExistingSession, selectedSession]);

  const detailStatus = creating ? creatingState : saveState;
  const showDetailStatus = detailStatus !== "idle";

  return (
    <div className="sl-sessions">
      <div className="sl-sessions-list-panel">
        <div className="sl-sessions-toolbar">
          <div>
            <span className="sl-eyebrow">SESSIONS</span>
            <h2 className="sl-status-title">My Sessions</h2>
            <p className="sl-status-message">
              Track manual Copilot sessions that survive restarts, even before observation
              or graph binding exists.
            </p>
          </div>
          <div className="sl-header-actions">
            <button
              className={`sl-action-btn${showArchived ? " active" : ""}`}
              onClick={() => setShowArchived((value) => !value)}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
            <button
              className={`sl-action-btn${creating ? " active" : ""}`}
              onClick={() => void startCreating()}
            >
              New session
            </button>
          </div>
        </div>

        <div className="sl-sessions-filters">
          <input
            className="sl-text-field"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, description, or tags"
          />
          <label className="sl-session-stale-filter">
            <span className="sl-field-label">Old after</span>
            <div className="sl-session-stale-input">
              <input
                className="sl-text-field sl-session-stale-days"
                type="number"
                min={1}
                step={1}
                value={staleSessionDays}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  setStaleSessionDays(
                    Number.isFinite(nextValue) && nextValue >= 1
                      ? Math.floor(nextValue)
                      : DEFAULT_STALE_SESSION_DAYS,
                  );
                }}
              />
              <span className="sl-session-stale-suffix">days</span>
            </div>
          </label>
        </div>

        {hiddenStaleSessionCount > 0 && (
          <div className="sl-sessions-filter-note">
            Showing {visibleSessions.length} of {sessions.length} sessions updated within{" "}
            {staleSessionDays} day{staleSessionDays === 1 ? "" : "s"}.
          </div>
        )}

        {error && <div className="sl-action-error">{error}</div>}

        <div className="sl-session-list">
          {loading ? (
            <div className="sl-empty-state">Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div className="sl-empty-state">
              No sessions yet. Create one manually to start tracking restart-safe context.
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className="sl-empty-state">
              No sessions updated in the last {staleSessionDays} day
              {staleSessionDays === 1 ? "" : "s"}. Increase the stale window to show
              older sessions.
            </div>
          ) : (
            visibleSessions.map((session) => (
              <button
                key={session.id}
                className={`sl-session-card${session.id === selectedId ? " selected" : ""}`}
                onClick={() => void handleSelectSession(session)}
              >
                <div className="sl-session-card-header">
                  <div>
                    <div className="sl-session-title-row">
                      {session.color && (
                        <span
                          className="sl-session-color"
                          style={{ backgroundColor: session.color }}
                        />
                      )}
                      <span className="sl-sidebar-item-title">{session.title}</span>
                    </div>
                    <div className="sl-session-path">{session.cwd}</div>
                  </div>
                  <span className={`sl-pill ${statusClass(session.lifecycleStatus)}`}>
                    {session.lifecycleStatus}
                  </span>
                </div>
                <p className="sl-sidebar-item-summary">{session.description || "No description yet."}</p>
                <div className="sl-sidebar-item-meta">
                  <span>{session.originKind}</span>
                  <span>{session.repo ?? "repo unknown"}</span>
                  <span>{formatTimestamp(session.lastSeenAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="sl-sessions-editor-panel">
        <div className="sl-sessions-editor-card">
          <div className="sl-session-card-header">
            <div>
              <span className="sl-eyebrow">{creating ? "NEW SESSION" : "DETAILS"}</span>
              <h2 className="sl-status-title">
                {creating
                  ? "Create session"
                  : selectedSession
                    ? selectedSession.title
                    : "Select a session"}
              </h2>
            </div>
            {(creating || selectedSession) && showDetailStatus && (
              <span className={`sl-pill ${detailStatus === "error" ? "red" : "accent"}`}>
                {detailStatus}
              </span>
            )}
          </div>

          {!creating && !selectedSession ? (
            <div className="sl-empty-state">
              Pick a session from the list to inspect it, or create a new manual entry.
            </div>
          ) : (
            <div className="sl-session-editor">
              <label className="sl-field">
                <span className="sl-field-label">Title</span>
                <input
                  className="sl-text-field"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  onBlur={() => {
                    if (!creating) {
                      void saveExistingSession();
                    }
                  }}
                />
              </label>

              <label className="sl-field">
                <span className="sl-field-label">Description</span>
                <textarea
                  className="sl-text-area"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  onBlur={() => {
                    if (!creating) {
                      void saveExistingSession();
                    }
                  }}
                />
              </label>

              <div className="sl-field-grid">
                <label className="sl-field">
                  <span className="sl-field-label">Color</span>
                  <input
                    className="sl-text-field"
                    value={draft.color}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, color: event.target.value }))
                    }
                    placeholder="#5b7fff"
                    onBlur={() => {
                      if (!creating) {
                        void saveExistingSession();
                      }
                    }}
                  />
                </label>
                <label className="sl-field">
                  <span className="sl-field-label">Lifecycle</span>
                  <select
                    className="sl-select-field"
                    value={draft.lifecycleStatus}
                    disabled={selectedSession?.lifecycleStatus === "ended"}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        lifecycleStatus: event.target.value as SessionDraft["lifecycleStatus"],
                      }))
                    }
                    onBlur={() => {
                      if (!creating) {
                        void saveExistingSession();
                      }
                    }}
                  >
                    <option value="active">active</option>
                    <option value="paused">paused</option>
                    {!creating && <option value="archived">archived</option>}
                    {!creating && selectedSession?.lifecycleStatus === "ended" && (
                      <option value="ended">ended</option>
                    )}
                  </select>
                </label>
              </div>

              <label className="sl-field">
                <span className="sl-field-label">Cwd</span>
                <input
                  className="sl-text-field"
                  value={draft.cwd}
                  readOnly={!creating}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, cwd: event.target.value }))
                  }
                  placeholder="C:\\Users\\you\\proj\\repo"
                />
              </label>

              <div className="sl-field-grid">
                <label className="sl-field">
                  <span className="sl-field-label">Repo</span>
                  <input
                    className="sl-text-field"
                    value={draft.repo}
                    readOnly={!creating}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, repo: event.target.value }))
                    }
                    placeholder="owner/name"
                  />
                </label>
                <label className="sl-field">
                  <span className="sl-field-label">Branch</span>
                  <input
                    className="sl-text-field"
                    value={draft.branch}
                    readOnly={!creating}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, branch: event.target.value }))
                    }
                    placeholder="feature/manual-session-registry"
                  />
                </label>
              </div>

              <label className="sl-field">
                <span className="sl-field-label">Tags</span>
                <input
                  className="sl-text-field"
                  value={draft.tagsText}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, tagsText: event.target.value }))
                  }
                  onBlur={() => {
                    if (!creating) {
                      void saveExistingSession();
                    }
                  }}
                  placeholder="wave-2, registry"
                />
              </label>

              {!creating && selectedSession && (
                <div className="sl-session-facts">
                  <span>Origin: {selectedSession.originKind}</span>
                  <span>Last activity: {formatTimestamp(selectedSession.lastSeenAt)}</span>
                  <span>
                    Copilot session: {selectedSession.copilotSessionId ?? "Not linked yet"}
                  </span>
                </div>
              )}

              {saveError && <div className="sl-action-error">{saveError}</div>}

              <div className="sl-header-actions">
                {creating ? (
                  <>
                    <button className="sl-action-btn" onClick={() => void handleCreate()}>
                      Create session
                    </button>
                    <button
                      className="sl-action-btn"
                      onClick={() => {
                        setCreating(false);
                        setDraft(createEmptyDraft());
                        setCreatingState("idle");
                        setSaveError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button className="sl-action-btn" onClick={() => void saveExistingSession()}>
                      Save now
                    </button>
                    <button className="sl-action-btn" onClick={() => void handleArchive()}>
                      Archive
                    </button>
                    <button className="sl-action-btn" onClick={() => void handleDelete()}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
