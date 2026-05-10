import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SessionRegistryListItem, SessionRegistryPatch } from "../session-registry-contract";
import type { SessionRegistryRecord } from "../session-registry-schema";
import type { ManagedRuntimeProjection } from "../managed-runtime-contract";
import {
  formatManagedRuntimeLabel,
  managedLifecycleStatusClass,
  managedRuntimeProjectionFromMetadata,
  managedRuntimeProgressEvents,
  resolveManagedRuntimeActions,
} from "../managed-runtime-contract";
import {
  handleInAppLinkClick,
  workstreamRoutePath,
} from "../dashboard-routing";
import {
  canLoadWorkstreamGraph,
  findGraphBindingWorkstreamMatches,
  resolveSessionWorkstreamLinkage,
  workstreamRegistryKey,
  type SessionWorkstreamLinkageResolution,
  type WorkstreamGraphLoadState,
  type WorkstreamRouteTarget,
} from "../session-workstream-linkage";
import type { WorkstreamRegistryListEntry } from "../workstream-registry-contract";
import { parseWorkstreamDocument } from "../workstream-view-model";
import {
  buildRestartCommand,
  canManuallyStop,
  canRelaunch,
  filterEndedSessions,
  getDisplaySessionId,
  isTrustedActiveSession,
  isTrustedInterruptedSession,
} from "./session-policies";
import {
  activitySignalClass,
  activityStatusClass,
  activityStatusHint,
  getEffectiveActivityStatus,
  getActivityStatusDescription,
  getActivityStatusLabel,
  getActivityTimestamp,
  getObservedStatusLabel,
  getTrustedStatusLabel,
  hasTrustedSignal,
  isHelperLikeObservedSession,
  isRecentlyEndedTrustedSession,
} from "./session-activity-status";
import {
  TerminalColorQuickPicker,
} from "./SessionColorPicker";
import { ManagedRuntimeActionButton } from "./ManagedRuntimeActionButton";
import { sessionRegistryListUrl } from "../session-registry-client";

const SESSION_POLL_INTERVAL_MS = 15_000;
const SESSION_EVENT_REFETCH_DEBOUNCE_MS = 150;
const DEFAULT_STALE_SESSION_DAYS = 7;
const SESSION_STALE_DAYS_STORAGE_KEY = "streamliner:sessionsStaleDays";
const SESSION_GROUP_MODE_STORAGE_KEY = "streamliner:sessionsGroupMode";

type GroupMode = "recency" | "repo" | "folder" | "workstream" | "flat";
type SheetTab = "overview" | "activity" | "settings";

const GROUP_MODES: Array<{ mode: GroupMode; label: string }> = [
  { mode: "recency", label: "Recency" },
  { mode: "repo", label: "Repo" },
  { mode: "folder", label: "Folder" },
  { mode: "workstream", label: "Workstream" },
  { mode: "flat", label: "Flat" },
];

const DEFAULT_GROUP_MODE: GroupMode = "recency";
const EMPTY_WORKSTREAMS: WorkstreamRegistryListEntry[] = [];

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
type SyncState = "connecting" | "live" | "reconnecting" | "polling";
type DerivedGithubRef = SessionRegistryListItem["derivedGithubRefs"][number];
type SessionDraftUpdater = (current: SessionDraft) => SessionDraft;

interface SessionConflictState {
  sessionId: string;
  latest: SessionRegistryListItem;
  fields: string[];
  message: string;
}

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
    version: record.version,
    title: record.title,
    titleSource: record.titleSource,
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
    launchCliArgs: record.origin.kind === "launched" && Array.isArray(record.origin.cliArgs)
      ? [...record.origin.cliArgs]
      : null,
    graphBinding: record.graphBinding,
    pawLaunch: record.pawLaunch,
    runtime: record.runtime ?? null,
    copilotSessionId: record.copilotSessionId,
    aiSummary: record.aiSummary,
    aiSummaryModel: record.aiSummaryModel,
    aiSummaryUpdatedAt: record.aiSummaryUpdatedAt,
    aiSummaryEventsFingerprint: record.aiSummaryEventsFingerprint,
    aiSummaryStatus: record.aiSummaryStatus,
    aiSummaryError: record.aiSummaryError,
    observedSessionKind: record.observedSessionKind,
    copilotProcessState: record.copilotProcessState,
    copilotProcessId: record.copilotProcessId,
    activityStatus: record.activityStatus,
    activityStatusUpdatedAt: record.activityStatusUpdatedAt,
    activityEvidence: record.activityEvidence,
    pawWorkflow: record.pawWorkflow,
    trustedSignalSource: record.trustedSignalSource,
    trustedStartedAt: record.trustedStartedAt,
    trustedEndedAt: record.trustedEndedAt,
    trustedLastSignalAt: record.trustedLastSignalAt,
    trustedStartSource: record.trustedStartSource,
    trustedEndReason: record.trustedEndReason,
    trustedExecutionKind: record.trustedExecutionKind,
    trustedInitialPromptLength: record.trustedInitialPromptLength,
    trustedLastPromptLength: record.trustedLastPromptLength,
    derivedWorktreePath: record.derivedWorktreePath,
    derivedBranch: record.derivedBranch,
    derivedGithubRefs: record.derivedGithubRefs,
    derivedContextUpdatedAt: record.derivedContextUpdatedAt,
    derivedContextEventsOffset: record.derivedContextEventsOffset,
    derivedContextEventsSize: record.derivedContextEventsSize,
    derivedContextEventsMtimeMs: record.derivedContextEventsMtimeMs,
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
  const patch: SessionRegistryPatch = { expectedVersion: session.version };
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

  return Object.keys(patch).length > 1 ? patch : null;
}

function applyPatchToListItem(
  session: SessionRegistryListItem,
  patch: SessionRegistryPatch,
): SessionRegistryListItem {
  const { expectedVersion, ...sessionPatch } = patch;
  void expectedVersion;
  return {
    ...session,
    ...sessionPatch,
  };
}

function sessionSnapshotKey(session: SessionRegistryListItem | null): string | null {
  if (!session) {
    return null;
  }
  return JSON.stringify({
    id: session.id,
    version: session.version,
    title: session.title,
    titleSource: session.titleSource,
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
    pawLaunch: session.pawLaunch,
    copilotSessionId: session.copilotSessionId,
    aiSummary: session.aiSummary,
    aiSummaryModel: session.aiSummaryModel,
    aiSummaryUpdatedAt: session.aiSummaryUpdatedAt,
    aiSummaryEventsFingerprint: session.aiSummaryEventsFingerprint,
    aiSummaryStatus: session.aiSummaryStatus,
    aiSummaryError: session.aiSummaryError,
    observedSessionKind: session.observedSessionKind,
    copilotProcessState: session.copilotProcessState,
    copilotProcessId: session.copilotProcessId,
    activityStatus: session.activityStatus,
    activityStatusUpdatedAt: session.activityStatusUpdatedAt,
    activityEvidence: session.activityEvidence,
    pawWorkflow: session.pawWorkflow,
    trustedSignalSource: session.trustedSignalSource,
    trustedStartedAt: session.trustedStartedAt,
    trustedEndedAt: session.trustedEndedAt,
    trustedLastSignalAt: session.trustedLastSignalAt,
    trustedStartSource: session.trustedStartSource,
    trustedEndReason: session.trustedEndReason,
    trustedExecutionKind: session.trustedExecutionKind,
    trustedInitialPromptLength: session.trustedInitialPromptLength,
    trustedLastPromptLength: session.trustedLastPromptLength,
    derivedWorktreePath: session.derivedWorktreePath,
    derivedBranch: session.derivedBranch,
    derivedGithubRefs: session.derivedGithubRefs,
    derivedContextUpdatedAt: session.derivedContextUpdatedAt,
    derivedContextEventsOffset: session.derivedContextEventsOffset,
    derivedContextEventsSize: session.derivedContextEventsSize,
    derivedContextEventsMtimeMs: session.derivedContextEventsMtimeMs,
  });
}

function builderSnapshotKey(session: SessionRegistryListItem | null): string | null {
  if (!session) {
    return null;
  }
  return JSON.stringify({
    id: session.id,
    version: session.version,
    title: session.title,
    description: session.description,
    lifecycleStatus: session.lifecycleStatus,
    color: session.color,
    tags: session.tags,
    graphBinding: session.graphBinding,
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

function sessionDisplayColor(session: Pick<SessionRegistryListItem, "color">): string {
  return session.color ?? "var(--sl-accent-border)";
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard copy is not available in this browser.");
  }
  await navigator.clipboard.writeText(text);
}

function getRowFallbackTitle(session: SessionRegistryListItem): string {
  const title = session.title.trim();
  const looksLikePrompt =
    (title.startsWith("Repo:") && title.includes("Existing title:")) ||
    title.includes("Cwd:") ||
    title.includes("Existing title:");
  if (!session.copilotSessionId || (!looksLikePrompt && title.length <= 80)) {
    return title;
  }

  const repoName = session.repo?.split("/").at(-1)?.trim();
  if (repoName) {
    return repoName;
  }

  const cwdLeaf = session.cwd.split(/[/\\]+/).filter(Boolean).at(-1);
  return cwdLeaf || title;
}

interface SessionSummaryDisplay {
  text: string | null;
  source: "ai" | "manual" | null;
  status: SessionRegistryListItem["aiSummaryStatus"];
  note: string | null;
}

function getSessionSummaryDisplay(session: SessionRegistryListItem): SessionSummaryDisplay {
  const aiSummary = session.aiSummary?.trim() ?? "";
  const manualDescription = session.description.trim();

  if (aiSummary.length > 0) {
    if (session.aiSummaryStatus === "pending") {
      return {
        text: aiSummary,
        source: "ai",
        status: "pending",
        note: "Description refresh queued.",
      };
    }
    if (session.aiSummaryStatus === "error") {
      return {
        text: aiSummary,
        source: "ai",
        status: "error",
        note: session.aiSummaryError || "Last AI summary may be stale.",
      };
    }
    return {
        text: aiSummary,
        source: "ai",
        status: "ready",
        note: session.aiSummaryUpdatedAt
          ? `Description updated ${formatTimestamp(session.aiSummaryUpdatedAt)}`
          : null,
      };
  }

  if (session.aiSummaryStatus === "pending" && session.copilotSessionId) {
    return {
      text: "Generating AI description…",
      source: "ai",
      status: "pending",
      note: "Using recent user turns from the Copilot session log.",
    };
  }

  if (manualDescription.length > 0) {
    return {
      text: manualDescription,
      source: "manual",
      status: session.aiSummaryStatus,
      note: null,
    };
  }

  if (session.aiSummaryStatus === "error") {
    return {
      text: "AI summary unavailable right now.",
      source: "ai",
      status: "error",
      note: session.aiSummaryError || "The worker will retry in the background.",
    };
  }

  if (session.copilotSessionId) {
    return {
      text: "Waiting for AI summary…",
      source: "ai",
      status: "missing",
      note: "No recent user turns have been summarized yet.",
    };
  }

  return {
    text: null,
    source: null,
    status: "missing",
    note: null,
  };
}

function getFreshnessTimestamp(session: SessionRegistryListItem): number {
  const freshnessSource = session.lastSeenAt ?? session.updatedAt;
  const freshnessTimestamp = Date.parse(freshnessSource);
  return Number.isFinite(freshnessTimestamp) ? freshnessTimestamp : Number.NEGATIVE_INFINITY;
}

function getSessionStartDescription(session: SessionRegistryListItem): string {
  if (hasTrustedSignal(session)) {
    const runner = session.trustedExecutionKind === "agency" ? "Agency" : "Copilot CLI";
    const action =
      session.trustedStartSource === "resume"
        ? "Resumed"
        : session.trustedStartSource === "startup"
          ? "Observed at startup"
          : "Started";
    const startedAt = session.trustedStartedAt
      ? ` on ${formatTimestamp(session.trustedStartedAt)}`
      : "";
    return `${action} from ${runner}${startedAt}.`;
  }

  if (session.originKind === "manual") {
    return "Created manually in Streamliner.";
  }

  if (session.originKind === "launched") {
    return "Launched from Streamliner.";
  }

  return "Discovered from local Copilot session state.";
}

function getSessionLatestDescription(
  session: SessionRegistryListItem,
  summary: SessionSummaryDisplay,
): string {
  if (summary.text) {
    return summary.text;
  }
  if (session.description.trim().length > 0) {
    return session.description;
  }
  if (session.lastSeenAt) {
    return `Last observed ${formatTimestamp(session.lastSeenAt)}.`;
  }
  return "No conversation description has been generated yet.";
}

function isSessionStale(
  session: SessionRegistryListItem,
  staleSessionDays: number,
): boolean {
  const staleCutoff = Date.now() - staleSessionDays * 24 * 60 * 60 * 1000;
  return getFreshnessTimestamp(session) < staleCutoff;
}

function isRelevantSession(session: SessionRegistryListItem): boolean {
  if (session.originKind !== "observed") {
    return true;
  }
  if (isHelperLikeObservedSession(session)) {
    return false;
  }
  return hasTrustedSignal(session);
}

type PawWorkflowSummary = NonNullable<SessionRegistryListItem["pawWorkflow"]>;
type VisiblePawWorkflowSummary = PawWorkflowSummary & { status: "recognized" };

function pawWorkflowStageLabel(stage: PawWorkflowSummary["stage"]): string {
  switch (stage) {
    case "init":
      return "init";
    case "planning":
      return "planning";
    case "implementation":
      return "implementation";
    case "review":
      return "review";
    case "finalization":
      return "finalization";
    default:
      return "not inferred";
  }
}

function pawArtifactKindLabel(kind: PawWorkflowSummary["artifacts"][number]["kind"]): string {
  switch (kind) {
    case "specification":
      return "spec";
    case "finalization":
      return "final";
    default:
      return kind;
  }
}

function getPawWorkflowLabel(workflow: VisiblePawWorkflowSummary): string {
  return `🐾 PAW ${pawWorkflowStageLabel(workflow.stage)}`;
}

function isRecognizedPawWorkflow(
  workflow: PawWorkflowSummary,
): workflow is VisiblePawWorkflowSummary {
  return workflow.status === "recognized";
}

function visiblePawWorkflow(session: SessionRegistryListItem): VisiblePawWorkflowSummary | null {
  const workflow = session.pawWorkflow;
  if (!workflow || session.originKind !== "launched" || !isRecognizedPawWorkflow(workflow)) {
    return null;
  }
  return workflow;
}

function getPawWorkflowDescription(workflow: VisiblePawWorkflowSummary): string {
  return `Artifact scan recognized ${workflow.artifactCount} PAW artifact${
    workflow.artifactCount === 1 ? "" : "s"
  }.`;
}

function formatPawArtifactMtime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "mtime unavailable";
  }
  return new Date(value).toLocaleString();
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

function readGroupMode(): GroupMode {
  if (typeof window === "undefined") {
    return DEFAULT_GROUP_MODE;
  }
  const stored = window.localStorage.getItem(SESSION_GROUP_MODE_STORAGE_KEY);
  if (
    stored === "recency" ||
    stored === "repo" ||
    stored === "folder" ||
    stored === "workstream" ||
    stored === "flat"
  ) {
    return stored;
  }
  return DEFAULT_GROUP_MODE;
}

// Parent directory of a cwd, robust to `/`, `\\`, trailing separators, and Windows roots.
// Used as the grouping key for "Folder" mode and as a display label.
function folderOf(cwd: string): string {
  if (!cwd) {
    return "";
  }
  // Normalize separators and collapse duplicates, preserving UNC `//` prefix.
  const unc = /^[\\/]{2}/.test(cwd);
  let normalized = cwd.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (unc && !normalized.startsWith("//")) {
    normalized = "/" + normalized;
  }
  // Strip trailing separator, except for pure root markers.
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.replace(/\/+$/, "");
  }

  // UNC: "//server/share/..." — parent is one level up but never above "//server/share".
  if (unc) {
    const parts = normalized.slice(2).split("/").filter((part) => part.length > 0);
    if (parts.length <= 2) {
      return "//" + parts.join("/");
    }
    parts.pop();
    return "//" + parts.join("/");
  }

  const lastSep = normalized.lastIndexOf("/");
  if (lastSep < 0) {
    return normalized;
  }
  const parent = normalized.slice(0, lastSep);
  // Drive root like "C:" → return "C:/".
  if (/^[A-Za-z]:$/.test(parent)) {
    return parent + "/";
  }
  if (parent.length === 0) {
    return "/";
  }
  return parent;
}

function leafName(path: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/[\\/]+$/, "").split(/[/\\]+/).filter(Boolean).at(-1) ?? trimmed;
}

function displayBranch(session: SessionRegistryListItem): string | null {
  return session.derivedBranch ?? session.branch;
}

function displayWorktree(session: SessionRegistryListItem): string | null {
  return session.derivedWorktreePath ?? null;
}

function githubRefLabel(ref: DerivedGithubRef): string {
  const prefix = ref.type === "pr" ? "PR" : ref.type === "issue" ? "Issue" : "GitHub";
  return `${prefix} #${ref.number}`;
}

function githubRefRepo(ref: DerivedGithubRef, session: SessionRegistryListItem): string | null {
  return ref.repo ?? session.repo;
}

function normalizeGithubRepoForUrl(repo: string | null): string | null {
  const trimmed = repo?.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!match) {
    return null;
  }
  return `${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`;
}

function safeGithubRefUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.hostname.toLowerCase() === "github.com" &&
      /^\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/\d+\/?$/i.test(parsed.pathname)
    ) {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

function githubRefUrl(ref: DerivedGithubRef, session: SessionRegistryListItem): string | null {
  const explicitUrl = safeGithubRefUrl(ref.url);
  if (explicitUrl) {
    return explicitUrl;
  }
  if (ref.type !== "pr" && ref.type !== "issue") {
    return null;
  }
  const repo = normalizeGithubRepoForUrl(githubRefRepo(ref, session));
  if (!repo) {
    return null;
  }
  const segment = ref.type === "pr" ? "pull" : "issues";
  return `https://github.com/${repo}/${segment}/${ref.number}`;
}

interface GithubRefChipProps {
  refItem: DerivedGithubRef;
  session: SessionRegistryListItem;
  className: string;
  showRepo?: boolean;
}

function GithubRefChip({ refItem, session, className, showRepo = false }: GithubRefChipProps) {
  const label = githubRefLabel(refItem);
  const repo = githubRefRepo(refItem, session);
  const url = githubRefUrl(refItem, session);
  const content = (
    <>
      {label}
      {showRepo && repo ? ` · ${repo}` : ""}
    </>
  );

  if (!url) {
    return <span className={className}>{content}</span>;
  }

  return (
    <a
      className={`${className} linkable`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${label} in GitHub`}
      onClick={(event) => event.stopPropagation()}
    >
      {content}
    </a>
  );
}

interface WorkstreamLinkChipProps {
  target: WorkstreamRouteTarget | null;
  className: string;
  label: string;
  title?: string;
  onOpenWorkstream?: (target: WorkstreamRouteTarget) => void | Promise<void>;
  children: ReactNode;
}

function WorkstreamLinkChip({
  target,
  className,
  label,
  title,
  onOpenWorkstream,
  children,
}: WorkstreamLinkChipProps) {
  if (!target) {
    return (
      <span className={className} title={title}>
        {children}
      </span>
    );
  }

  return (
    <a
      className={`${className} linkable`}
      href={workstreamRoutePath(target)}
      title={title}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        if (onOpenWorkstream) {
          handleInAppLinkClick(event, () => onOpenWorkstream(target));
        }
      }}
    >
      {children}
    </a>
  );
}

function workstreamLinkageTitle(
  linkage: SessionWorkstreamLinkageResolution,
): string {
  switch (linkage.status) {
    case "resolved":
      return "Open bound workstream node";
    case "graph-loading":
      return linkage.note ?? "Resolving bound workstream node";
    case "graph-unavailable":
    case "node-unresolved":
    case "missing-workstream":
    case "ambiguous-workstream":
      return linkage.note ?? "Bound workstream context is unresolved";
    case "unbound":
      return "This session is not bound to a workstream";
  }
}

function workstreamLinkageStatusLabel(
  linkage: SessionWorkstreamLinkageResolution,
): string {
  switch (linkage.status) {
    case "resolved":
      return "Resolved";
    case "graph-loading":
      return "Resolving node";
    case "graph-unavailable":
      return "Graph unavailable";
    case "node-unresolved":
      return "Node not found";
    case "missing-workstream":
      return "Workstream not tracked";
    case "ambiguous-workstream":
      return "Ambiguous workstream";
    case "unbound":
      return "Unbound";
  }
}

function SessionWorkstreamContextChips({
  linkage,
  onOpenWorkstream,
}: {
  linkage: SessionWorkstreamLinkageResolution;
  onOpenWorkstream?: (target: WorkstreamRouteTarget) => void | Promise<void>;
}) {
  if (linkage.status === "unbound") {
    return null;
  }

  const title = workstreamLinkageTitle(linkage);
  const workstreamLabel = linkage.workstreamLabel ?? linkage.workstreamId ?? "unknown";
  const nodeLabel = linkage.nodeLabel ?? linkage.nodeId;

  return (
    <>
      <WorkstreamLinkChip
        target={linkage.workstreamRouteTarget}
        className="sl-session-row-context-chip important"
        label={`Open workstream ${workstreamLabel}`}
        title={title}
        onOpenWorkstream={onOpenWorkstream}
      >
        workstream {workstreamLabel}
      </WorkstreamLinkChip>
      {nodeLabel && (
        <WorkstreamLinkChip
          target={linkage.nodeRouteTarget}
          className="sl-session-row-context-chip"
          label={`Open workstream node ${nodeLabel}`}
          title={title}
          onOpenWorkstream={onOpenWorkstream}
        >
          node {nodeLabel}
        </WorkstreamLinkChip>
      )}
    </>
  );
}

function getManagedRuntime(
  session: SessionRegistryListItem,
): ManagedRuntimeProjection | null {
  return managedRuntimeProjectionFromMetadata(session.runtime);
}

function managedRuntimeLifecycleText(runtime: ManagedRuntimeProjection): string {
  return formatManagedRuntimeLabel(runtime.lifecycleState);
}

function managedRuntimeSummaryText(runtime: ManagedRuntimeProjection): string {
  return (
    runtime.summary ??
    runtime.blockerSummary ??
    runtime.errorSummary ??
    `Background session is ${managedRuntimeLifecycleText(runtime)}.`
  );
}

type RecencyBucketKey =
  | "trusted-active"
  | "trusted-interrupted"
  | "trusted-recently-ended"
  | "trusted-ended"
  | "pinned"
  | "diagnostic"
  | "today"
  | "yesterday"
  | "week"
  | "older"
  | "never";

interface RecencyBucketInfo {
  key: RecencyBucketKey;
  label: string;
  order: number;
}

function recencyBucket(session: SessionRegistryListItem): RecencyBucketInfo {
  if (isTrustedActiveSession(session)) {
    return { key: "trusted-active", label: "Active Copilot sessions", order: 0 };
  }
  if (isTrustedInterruptedSession(session)) {
    return { key: "trusted-interrupted", label: "Interrupted / resumable", order: 1 };
  }
  if (hasTrustedSignal(session)) {
    return isRecentlyEndedTrustedSession(session)
      ? { key: "trusted-recently-ended", label: "Recently ended", order: 2 }
      : { key: "trusted-ended", label: "Older trusted sessions", order: 3 };
  }
  if (session.originKind === "manual" || session.originKind === "launched") {
    return { key: "pinned", label: "Pinned / launched", order: 4 };
  }
  if (session.originKind === "observed") {
    return { key: "diagnostic", label: "Observed diagnostics", order: 5 };
  }
  const ts = getActivityTimestamp(session);
  if (ts === null) {
    return { key: "never", label: "Never observed", order: 10 };
  }
  const hours = (Date.now() - ts) / 3_600_000;
  if (hours < 24) return { key: "today", label: "Today", order: 6 };
  if (hours < 48) return { key: "yesterday", label: "Yesterday", order: 7 };
  if (hours < 168) return { key: "week", label: "This week", order: 8 };
  return { key: "older", label: "Older", order: 9 };
}

interface SessionGroup {
  key: string;
  label: string;
  code: string | null;
  latestTs: number;
  order: number;
  sessions: SessionRegistryListItem[];
}

function repoGroupKey(session: SessionRegistryListItem): string {
  return session.repo ?? "__no_repo__";
}

function folderGroupKey(session: SessionRegistryListItem): string {
  return folderOf(session.cwd) || "__no_cwd__";
}

function displayRepoLabel(repoKey: string): { label: string; code: string | null } {
  if (repoKey === "__no_repo__") {
    return { label: "(no repo)", code: null };
  }
  const shortName = repoKey.includes("/") ? repoKey.split("/").slice(-1)[0] : repoKey;
  return { label: shortName, code: repoKey };
}

function displayFolderLabel(folderKey: string): { label: string; code: string | null } {
  if (folderKey === "__no_cwd__") {
    return { label: "(no cwd)", code: null };
  }
  // Show last one or two path segments for compact display.
  const cleaned = folderKey.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = cleaned.split("/").filter((seg) => seg.length > 0);
  const short = segments.slice(-2).join("/") || cleaned;
  return { label: short || folderKey, code: folderKey };
}

function workstreamGraphApiUrl(entry: {
  projectKey: string;
  workstreamId: string;
}): string {
  return `/api/workstreams/${encodeURIComponent(entry.projectKey)}/${encodeURIComponent(entry.workstreamId)}/graph`;
}

function groupSessions(
  sessions: SessionRegistryListItem[],
  mode: GroupMode,
  linkages: ReadonlyMap<string, SessionWorkstreamLinkageResolution>,
): SessionGroup[] {
  if (mode === "flat") {
    const sorted = [...sessions].sort(
      (a, b) => getFreshnessTimestamp(b) - getFreshnessTimestamp(a),
    );
    const latestTs = sorted.length > 0 ? getFreshnessTimestamp(sorted[0]) : 0;
    return [
      {
        key: "__all__",
        label: "All sessions",
        code: null,
        latestTs,
        order: 0,
        sessions: sorted,
      },
    ];
  }

  const buckets = new Map<string, SessionRegistryListItem[]>();
  const workstreamGroups = new Map<string, SessionWorkstreamLinkageResolution["group"]>();
  for (const session of sessions) {
    let key: string;
    if (mode === "recency") {
      key = recencyBucket(session).key;
    } else if (mode === "repo") {
      key = repoGroupKey(session);
    } else if (mode === "workstream") {
      const group = linkages.get(session.id)?.group;
      key = group?.key ?? "__unbound__";
      if (group) {
        workstreamGroups.set(key, group);
      }
    } else {
      key = folderGroupKey(session);
    }
    const existing = buckets.get(key);
    if (existing) {
      existing.push(session);
    } else {
      buckets.set(key, [session]);
    }
  }

  const groups: SessionGroup[] = [];
  for (const [key, list] of buckets) {
    const sorted = [...list].sort(
      (a, b) => getFreshnessTimestamp(b) - getFreshnessTimestamp(a),
    );
    const latestTs = getFreshnessTimestamp(sorted[0]);

    let label = key;
    let code: string | null = null;
    let order = Number.MAX_SAFE_INTEGER;
    if (mode === "recency") {
      // label comes from the bucket metadata
      const sample = sorted[0];
      const info = recencyBucket(sample);
      label = info.label;
      order = info.order;
    } else if (mode === "repo") {
      const display = displayRepoLabel(key);
      label = display.label;
      code = display.code;
    } else if (mode === "workstream") {
      const group = workstreamGroups.get(key);
      if (group) {
        label = group.label;
        code = group.code;
        order = group.order;
      }
    } else {
      const display = displayFolderLabel(key);
      label = display.label;
      code = display.code;
    }

    groups.push({ key, label, code, latestTs, order, sessions: sorted });
  }

  if (mode === "recency") {
    // Semantic bucket ordering — not frozen.
    const order: Record<RecencyBucketKey, number> = {
      "trusted-active": 0,
      "trusted-interrupted": 1,
      "trusted-recently-ended": 2,
      "trusted-ended": 3,
      pinned: 4,
      diagnostic: 5,
      today: 6,
      yesterday: 7,
      week: 8,
      older: 9,
      never: 10,
    };
    groups.sort((a, b) => (order[a.key as RecencyBucketKey] ?? 99) - (order[b.key as RecencyBucketKey] ?? 99));
  } else if (mode === "workstream") {
    groups.sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.label.localeCompare(b.label);
    });
  }
  return groups;
}

// Apply a frozen group order (by key) to the computed groups.
// Groups in `frozenOrder` that no longer exist are dropped; new groups are appended
// in freshness-desc order.
function applyFrozenOrder(groups: SessionGroup[], frozenOrder: string[]): SessionGroup[] {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const ordered: SessionGroup[] = [];
  for (const key of frozenOrder) {
    const group = byKey.get(key);
    if (group) {
      ordered.push(group);
      byKey.delete(key);
    }
  }
  const extras = [...byKey.values()].sort((a, b) => b.latestTs - a.latestTs);
  return [...ordered, ...extras];
}

function computeFreshOrder(groups: SessionGroup[]): string[] {
  return [...groups]
    .sort((a, b) => b.latestTs - a.latestTs)
    .map((group) => group.key);
}

function timeAgo(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function useLatestValue<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

function isPlainEnterKey(event: ReactKeyboardEvent<HTMLInputElement>): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

interface SessionSaveOptions {
  background?: boolean;
  keepalive?: boolean;
  optimistic?: boolean;
  surfaceErrorGlobally?: boolean;
}

interface SessionsPageProps {
  registerBeforeLeave?: (handler: (() => Promise<boolean>) | null) => void;
  workstreams?: WorkstreamRegistryListEntry[];
  defaultCliArgs?: readonly string[] | null;
  onOpenWorkstream?: (target: WorkstreamRouteTarget) => void | Promise<void>;
  routeWorkstreamId?: string | null;
  routeNodeId?: string | null;
}

function buildVisibleRestartCommand(
  session: SessionRegistryListItem,
  defaultCliArgs: readonly string[] | null,
): string | null {
  if (!session.copilotSessionId) {
    return null;
  }
  if (session.launchCliArgs === null && defaultCliArgs === null) {
    return null;
  }
  return buildRestartCommand(session, defaultCliArgs ?? []);
}

function restartUnavailableMessage(
  session: SessionRegistryListItem,
  defaultCliArgs: readonly string[] | null,
): string {
  if (!session.copilotSessionId) {
    return "Restart unavailable; no Copilot session ID";
  }
  if (session.launchCliArgs === null && defaultCliArgs === null) {
    return "Restart unavailable; session launch settings are still loading";
  }
  return "Restart unavailable";
}

export function SessionsPage({
  registerBeforeLeave,
  workstreams = EMPTY_WORKSTREAMS,
  defaultCliArgs = null,
  onOpenWorkstream,
  routeWorkstreamId = null,
  routeNodeId = null,
}: SessionsPageProps) {
  const [sessions, setSessions] = useState<SessionRegistryListItem[]>([]);
  const [workstreamGraphs, setWorkstreamGraphs] = useState<
    Record<string, WorkstreamGraphLoadState>
  >({});
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [showAllObserved, setShowAllObserved] = useState(false);
  const [staleSessionDays, setStaleSessionDays] = useState(readStaleSessionDays);
  const [groupMode, setGroupMode] = useState<GroupMode>(readGroupMode);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SessionDraft>(createEmptyDraft);
  const [selectedSnapshot, setSelectedSnapshot] = useState<SessionRegistryListItem | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<SheetTab>("overview");
  const [headerColorPaletteOpen, setHeaderColorPaletteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("connecting");
  const [conflictPending, setConflictPending] = useState<SessionConflictState | null>(null);
  const [creatingState, setCreatingState] = useState<SaveState>("idle");
  const eventRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipUnmountFlushRef = useRef(false);
  const saveRequestIdRef = useRef(0);
  // Frozen group order per mode. Filled lazily on first render for a mode; cleared by Resort.
  const frozenOrderRef = useRef<Partial<Record<GroupMode, string[]>>>({});
  const creatingRef = useLatestValue(creating);
  const selectedIdRef = useLatestValue(selectedId);
  const draftRef = useLatestValue(draft);
  const selectedSnapshotRef = useLatestValue(selectedSnapshot);
  const saveStateRef = useLatestValue(saveState);
  const conflictPendingRef = useLatestValue(conflictPending);
  const workstreamGraphsRef = useLatestValue(workstreamGraphs);
  const mountedRef = useRef(false);
  const loadingWorkstreamGraphKeysRef = useRef(new Set<string>());

  const applySessionList = useCallback(
    (nextSessions: SessionRegistryListItem[], keepSelection = true) => {
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
            setConflictPending(null);
            setSheetOpen(false);
            return;
          }

          const currentDraftKey = draftKey(currentDraft);
          const snapshotDraftKey = currentSelectedSnapshot
            ? draftKey(draftFromSession(currentSelectedSnapshot))
            : null;
          const nextSnapshotKey = sessionSnapshotKey(matching);
          const currentSnapshotKey = sessionSnapshotKey(currentSelectedSnapshot);
          const nextBuilderKey = builderSnapshotKey(matching);
          const currentBuilderKey = builderSnapshotKey(currentSelectedSnapshot);
          if (
            currentSaveState !== "saving" &&
            currentSelectedSnapshot &&
            currentDraftKey === snapshotDraftKey
          ) {
            const nextDraft = draftFromSession(matching);
            if (currentSnapshotKey !== nextSnapshotKey) {
              setSelectedSnapshot(matching);
              setSaveError(null);
            }
            if (currentDraftKey !== draftKey(nextDraft)) {
              setDraft(nextDraft);
            }
            setConflictPending((current) =>
              current?.sessionId === matching.id ? null : current,
            );
          } else if (
            currentSaveState !== "saving" &&
            currentSelectedSnapshot &&
            currentBuilderKey !== nextBuilderKey
          ) {
            const message =
              "This session changed elsewhere. Your unsaved edits are preserved; edit a field to re-apply them after reviewing the latest row.";
            setConflictPending({
              sessionId: matching.id,
              latest: matching,
              fields: ["builder-owned fields"],
              message,
            });
            setSaveError(message);
          }
        }
    },
    [creatingRef, draftRef, saveStateRef, selectedIdRef, selectedSnapshotRef],
  );

  const fetchSessions = useCallback(
    async (keepSelection = true) => {
      try {
        const response = await fetch(
          sessionRegistryListUrl({
            includeArchived: showArchived,
            text: query,
            workstreamId: routeWorkstreamId,
            nodeId: routeNodeId,
          }),
        );
        if (!response.ok) {
          throw new Error(`Failed to load sessions (${response.status})`);
        }

        applySessionList((await response.json()) as SessionRegistryListItem[], keepSelection);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        setLoading(false);
      }
    },
    [applySessionList, query, routeNodeId, routeWorkstreamId, showArchived],
  );

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

  const updateDraft = useCallback(
    (updater: SessionDraftUpdater) => {
      const currentConflict = conflictPendingRef.current;
      if (currentConflict?.sessionId === selectedIdRef.current) {
        setSelectedSnapshot(currentConflict.latest);
        setConflictPending(null);
        setSaveError(null);
      }
      setDraft(updater);
    },
    [conflictPendingRef, selectedIdRef],
  );

  useEffect(() => {
    void fetchSessions();
    const timer = setInterval(() => {
      void fetchSessions();
    }, SESSION_POLL_INTERVAL_MS);
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
  }, [fetchSessions]);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setSyncState("polling");
      return;
    }

    let closed = false;
    const source = new EventSource("/api/sessions/events");
    setSyncState("connecting");

    const handleChange = () => {
      scheduleEventRefetch();
    };
    const handleSnapshot = (event: MessageEvent) => {
      if (query.trim().length > 0 || showArchived || routeWorkstreamId || routeNodeId) {
        scheduleEventRefetch(0);
        return;
      }
      try {
        const payload = JSON.parse(event.data) as { sessions?: unknown };
        if (!Array.isArray(payload.sessions)) {
          scheduleEventRefetch(0);
          return;
        }
        applySessionList(payload.sessions as SessionRegistryListItem[]);
        setLoading(false);
      } catch {
        scheduleEventRefetch(0);
      }
    };
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

    source.addEventListener("open", handleOpen);
    source.addEventListener("error", handleError);
    source.addEventListener("snapshot", handleSnapshot);
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
  }, [
    applySessionList,
    query,
    routeNodeId,
    routeWorkstreamId,
    scheduleEventRefetch,
    showArchived,
  ]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? selectedSnapshot,
    [selectedId, selectedSnapshot, sessions],
  );
  const selectedPawWorkflow = selectedSession ? visiblePawWorkflow(selectedSession) : null;
  const selectedSessionRef = useLatestValue(selectedSession);
  const graphScopedSessions = useMemo(
    () =>
      routeWorkstreamId || routeNodeId
        ? sessions.filter((session) => session.originKind !== "manual")
        : sessions,
    [routeNodeId, routeWorkstreamId, sessions],
  );
  const relevanceFilteredSessions = useMemo(
    () =>
      showAllObserved
        ? graphScopedSessions
        : graphScopedSessions.filter((session) => isRelevantSession(session)),
    [graphScopedSessions, showAllObserved],
  );
  const endedFilteredSessions = useMemo(
    () => filterEndedSessions(relevanceFilteredSessions, showEnded),
    [relevanceFilteredSessions, showEnded],
  );
  const visibleSessions = useMemo(
    () =>
      endedFilteredSessions.filter(
        (session) => !isSessionStale(session, staleSessionDays),
      ),
    [endedFilteredSessions, staleSessionDays],
  );
  const hiddenGraphScopedManualCount = sessions.length - graphScopedSessions.length;
  const hiddenObservedSessionCount =
    graphScopedSessions.length - relevanceFilteredSessions.length;
  const hiddenEndedSessionCount =
    relevanceFilteredSessions.length - endedFilteredSessions.length;
  const hiddenStaleSessionCount =
    endedFilteredSessions.length - visibleSessions.length;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const entriesToLoad = new Map<string, WorkstreamRegistryListEntry>();
    const graphStateSnapshot = workstreamGraphsRef.current;
    for (const session of visibleSessions) {
      const binding = session.graphBinding;
      if (!binding) {
        continue;
      }
      const matches = findGraphBindingWorkstreamMatches(
        binding.workstreamId,
        workstreams,
      );
      if (matches.length !== 1 || !canLoadWorkstreamGraph(matches[0])) {
        continue;
      }
      const key = workstreamRegistryKey(matches[0]);
      if (!graphStateSnapshot[key] && !loadingWorkstreamGraphKeysRef.current.has(key)) {
        entriesToLoad.set(key, matches[0]);
      }
    }

    if (entriesToLoad.size === 0) {
      return;
    }

    setWorkstreamGraphs((current) => {
      const next = { ...current };
      for (const key of entriesToLoad.keys()) {
        next[key] = { status: "loading" };
        loadingWorkstreamGraphKeysRef.current.add(key);
      }
      return next;
    });

    for (const [key, entry] of entriesToLoad) {
      void (async () => {
        try {
          const response = await fetch(workstreamGraphApiUrl(entry));
          if (!response.ok) {
            throw new Error(`Failed to load workstream graph (${response.status})`);
          }
          const document = parseWorkstreamDocument(await response.text());
          if (mountedRef.current) {
            setWorkstreamGraphs((current) => ({
              ...current,
              [key]: { status: "loaded", document },
            }));
          }
        } catch (nextError) {
          if (mountedRef.current) {
            setWorkstreamGraphs((current) => ({
              ...current,
              [key]: {
                status: "error",
                message:
                  nextError instanceof Error ? nextError.message : String(nextError),
              },
            }));
          }
        } finally {
          loadingWorkstreamGraphKeysRef.current.delete(key);
        }
      })();
    }
  }, [visibleSessions, workstreamGraphsRef, workstreams]);

  const workstreamGraphStateMap = useMemo(
    () => new Map(Object.entries(workstreamGraphs)),
    [workstreamGraphs],
  );

  const sessionLinkages = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          session.id,
          resolveSessionWorkstreamLinkage(
            session,
            workstreams,
            workstreamGraphStateMap,
          ),
        ]),
      ),
    [sessions, workstreamGraphStateMap, workstreams],
  );

  const selectedSessionLinkage = useMemo(
    () =>
      selectedSession
        ? resolveSessionWorkstreamLinkage(
            selectedSession,
            workstreams,
            workstreamGraphStateMap,
          )
        : null,
    [selectedSession, workstreamGraphStateMap, workstreams],
  );

  const computedGroups = useMemo(
    () => groupSessions(visibleSessions, groupMode, sessionLinkages),
    [visibleSessions, groupMode, sessionLinkages],
  );

  const orderedGroups = useMemo(() => {
    if (groupMode === "recency" || groupMode === "flat" || groupMode === "workstream") {
      return computedGroups;
    }
    const frozen = frozenOrderRef.current[groupMode];
    if (!frozen) {
      // First time rendering this mode — freeze fresh order.
      const fresh = computeFreshOrder(computedGroups);
      frozenOrderRef.current[groupMode] = fresh;
      return applyFrozenOrder(computedGroups, fresh);
    }
    return applyFrozenOrder(computedGroups, frozen);
  }, [computedGroups, groupMode]);

  const saveExistingSession = useCallback(
    async (options: SessionSaveOptions = {}): Promise<boolean> => {
      const currentSelectedSession =
        selectedSnapshotRef.current ?? selectedSessionRef.current;
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

      const currentConflict = conflictPendingRef.current;
      if (currentConflict?.sessionId === currentSelectedSession.id) {
        if (!options.background) {
          setSaveState("error");
          setSaveError(currentConflict.message);
        }
        return false;
      }

      if (currentDraft.title.trim().length === 0) {
        if (!options.background) {
          setSaveState("error");
          setSaveError("Title is required.");
        }
        return false;
      }

      const requestId = ++saveRequestIdRef.current;
      const savedDraftKey = draftKey(currentDraft);
      const optimisticUpdate = options.optimistic
        ? applyPatchToListItem(currentSelectedSession, patch)
        : null;

      if (optimisticUpdate) {
        setSessions((current) =>
          current.map((session) =>
            session.id === optimisticUpdate.id ? optimisticUpdate : session,
          ),
        );
        if (selectedIdRef.current === optimisticUpdate.id) {
          setSelectedSnapshot(optimisticUpdate);
        }
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
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
            latest?: SessionRegistryRecord;
            conflictingFields?: string[];
          };
          if (response.status === 409 && payload.latest) {
            const latest = toListItem(payload.latest);
            setSessions((current) =>
              current.map((session) => (session.id === latest.id ? latest : session)),
            );
            const fields =
              payload.conflictingFields && payload.conflictingFields.length > 0
                ? payload.conflictingFields
                : [];
            const fieldText =
              fields.length > 0
                ? ` (${fields.join(", ")})`
                : "";
            const message =
              `${payload.error ?? "Session changed elsewhere."}${fieldText} Edit a field to re-apply your draft after reviewing the latest row.`;
            setConflictPending({
              sessionId: latest.id,
              latest,
              fields,
              message,
            });
            throw new Error(message);
          }
          throw new Error(payload.error ?? `Failed to save session (${response.status})`);
        }

        if (options.background) {
          return true;
        }

        const updated = toListItem((await response.json()) as SessionRegistryRecord);
        if (requestId !== saveRequestIdRef.current) {
          return true;
        }

        setSessions((current) =>
          current.map((session) => (session.id === updated.id ? updated : session)),
        );
        const currentDraftKey = draftKey(draftRef.current);
        const draftStillMatchesSavedRequest = currentDraftKey === savedDraftKey;
        if (selectedIdRef.current === updated.id) {
          setSelectedSnapshot(updated);
          if (draftStillMatchesSavedRequest) {
            setDraft(draftFromSession(updated));
          }
        }
        setSaveState(draftStillMatchesSavedRequest ? "saved" : "idle");
        setSaveError(null);
        setConflictPending(null);
        if (options.surfaceErrorGlobally) {
          setError(null);
        }
        return true;
      } catch (nextError) {
        if (requestId !== saveRequestIdRef.current) {
          return true;
        }
        const message = nextError instanceof Error ? nextError.message : String(nextError);
        if (!options.background) {
          setSaveState("error");
          setSaveError(message);
        }
        if (options.surfaceErrorGlobally) {
          setError(message);
          setSheetOpen(true);
        }
        return false;
      }
    },
    [
      conflictPendingRef,
      creatingRef,
      draftRef,
      selectedIdRef,
      selectedSessionRef,
      selectedSnapshotRef,
    ],
  );

  const getExistingDraftPatch = useCallback((): SessionRegistryPatch | null => {
    const currentSelectedSession =
      selectedSnapshotRef.current ?? selectedSessionRef.current;
    if (creatingRef.current || !currentSelectedSession) {
      return null;
    }
    return buildPatch(currentSelectedSession, draftRef.current);
  }, [creatingRef, draftRef, selectedSessionRef, selectedSnapshotRef]);

  const handleBeforeLeave = useCallback(async () => {
    if (!getExistingDraftPatch()) {
      return true;
    }
    const saved = await saveExistingSession({ keepalive: true });
    if (saved) {
      skipUnmountFlushRef.current = true;
    }
    return saved;
  }, [getExistingDraftPatch, saveExistingSession]);

  useEffect(() => {
    if (!registerBeforeLeave) {
      return;
    }
    registerBeforeLeave(handleBeforeLeave);
    return () => registerBeforeLeave(null);
  }, [handleBeforeLeave, registerBeforeLeave]);

  const flushDirtyDraftOnExit = useCallback(() => {
    if (!getExistingDraftPatch()) {
      return;
    }
    void saveExistingSession({ background: true, keepalive: true });
  }, [getExistingDraftPatch, saveExistingSession]);

  useEffect(() => {
    const handlePageHide = () => {
      flushDirtyDraftOnExit();
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      if (skipUnmountFlushRef.current) {
        skipUnmountFlushRef.current = false;
        return;
      }
      flushDirtyDraftOnExit();
    };
  }, [flushDirtyDraftOnExit]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        SESSION_STALE_DAYS_STORAGE_KEY,
        String(staleSessionDays),
      );
    }
  }, [staleSessionDays]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SESSION_GROUP_MODE_STORAGE_KEY, groupMode);
    }
  }, [groupMode]);

  const openSessionSheet = useCallback(
    async (session: SessionRegistryListItem) => {
      // If another session is currently dirty, flush before swapping.
      if (getExistingDraftPatch() && !(await saveExistingSession())) {
        return;
      }
      setCreating(false);
      setCreatingState("idle");
      setSelectedId(session.id);
      setSelectedSnapshot(session);
      setDraft(draftFromSession(session));
      setSaveState("idle");
      setSaveError(null);
      setConflictPending(null);
      setSheetTab("overview");
      setHeaderColorPaletteOpen(false);
      setSheetOpen(true);
    },
    [getExistingDraftPatch, saveExistingSession],
  );

  const startCreating = useCallback(async () => {
    if (getExistingDraftPatch() && !(await saveExistingSession())) {
      return;
    }
    setCreating(true);
    setSelectedId(null);
    setSelectedSnapshot(null);
    setDraft(createEmptyDraft());
    setCreatingState("idle");
    setSaveState("idle");
    setSaveError(null);
    setConflictPending(null);
    setSheetTab("settings"); // only settings is actionable while creating
    setHeaderColorPaletteOpen(false);
    setSheetOpen(true);
  }, [getExistingDraftPatch, saveExistingSession]);

  const closeSheet = useCallback(async () => {
    const currentDraft = draftRef.current;
    const currentPatch = getExistingDraftPatch();
    if (currentPatch) {
      const currentConflict = conflictPendingRef.current;
      if (currentConflict?.sessionId === selectedIdRef.current) {
        setSaveState("error");
        setSaveError(currentConflict.message);
        return;
      }
      if (currentDraft.title.trim().length === 0) {
        setSaveState("error");
        setSaveError("Title is required.");
        return;
      }
      setSheetOpen(false);
      setHeaderColorPaletteOpen(false);
      void saveExistingSession({
        optimistic: true,
        surfaceErrorGlobally: true,
        keepalive: true,
      });
      return;
    }
    setSheetOpen(false);
    setHeaderColorPaletteOpen(false);
    if (creating) {
      setCreating(false);
      setCreatingState("idle");
      setDraft(createEmptyDraft());
    }
  }, [
    conflictPendingRef,
    creating,
    draftRef,
    getExistingDraftPatch,
    saveExistingSession,
    selectedIdRef,
  ]);

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
      setConflictPending(null);
      setSheetTab("overview");
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
    if (getExistingDraftPatch() && !(await saveExistingSession())) {
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
  }, [fetchSessions, getExistingDraftPatch, saveExistingSession, selectedSession]);

  const handleDelete = useCallback(async () => {
    if (!selectedSession || !window.confirm(`Delete "${selectedSession.title}"?`)) {
      return;
    }
    if (getExistingDraftPatch() && !(await saveExistingSession())) {
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
      setConflictPending(null);
      setSheetOpen(false);
      await fetchSessions(false);
    } catch (nextError) {
      setSaveState("error");
      setSaveError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [fetchSessions, getExistingDraftPatch, saveExistingSession, selectedSession]);

  // Close sheet on Escape.
  useEffect(() => {
    if (!sheetOpen) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void closeSheet();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [closeSheet, sheetOpen]);

  const handleResort = useCallback(() => {
    if (groupMode === "recency" || groupMode === "flat") {
      return;
    }
    delete frozenOrderRef.current[groupMode];
    // Trigger re-render by flipping groupMode through itself.
    setGroupMode(groupMode);
    // Force the memo to recompute by updating a dependency — we flip state via a
    // transient no-op by re-setting sessions to a new array reference.
    setSessions((current) => current.slice());
  }, [groupMode]);

  const commitSheetOnEnter = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (!isPlainEnterKey(event)) {
        return;
      }
      event.preventDefault();
      void closeSheet();
    },
    [closeSheet],
  );

  const detailStatus = creating ? creatingState : saveState;
  const showDetailStatus = detailStatus !== "idle";
  const syncNote =
    syncState === "live"
      ? null
      : syncState === "polling"
        ? "Live session events are unavailable in this browser; using polling and focus refresh."
        : syncState === "connecting"
          ? "Connecting to live session updates..."
          : "Reconnecting to live session updates; polling remains active.";
  const freezeNote =
    groupMode === "recency"
      ? "Recency buckets — order is semantic"
      : groupMode === "flat"
        ? "No grouping — rows sorted by most recent activity"
        : groupMode === "workstream"
          ? "Workstream groups — unbound first, then tracked order"
          : "Group order frozen at page load · use ↻ Resort to refresh";

  return (
    <div className="sl-sessions sl-sessions-v2">
      <div className="sl-sessions-header">
        <div>
          <h2 className="sl-status-title">Copilot CLI sessions</h2>
        </div>
        <div className="sl-header-actions">
          <button
            className={`sl-action-btn${showAllObserved ? " active" : ""}`}
            onClick={() => setShowAllObserved((value) => !value)}
          >
            {showAllObserved ? "Show relevant only" : "Show all observed"}
          </button>
          <button
            className={`sl-action-btn${showArchived ? " active" : ""}`}
            onClick={() => setShowArchived((value) => !value)}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
          <button
            className={`sl-action-btn${showEnded ? " active" : ""}`}
            onClick={() => setShowEnded((value) => !value)}
          >
            {showEnded ? "Hide ended" : "Show ended"}
          </button>
          <button
            className="sl-action-btn primary"
            onClick={() => void startCreating()}
          >
            + New session
          </button>
        </div>
      </div>

      <div className="sl-sessions-filters">
        <input
          className="sl-text-field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sessions, repos, tags…"
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

      <div className="sl-sessions-group-bar">
        <span className="sl-seg-label">Group by</span>
        <div className="sl-seg" role="tablist">
          {GROUP_MODES.map(({ mode, label }) => (
            <button
              key={mode}
              role="tab"
              aria-selected={mode === groupMode}
              className={`sl-seg-btn${mode === groupMode ? " active" : ""}`}
              onClick={() => setGroupMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="sl-seg-resort"
          disabled={groupMode === "recency" || groupMode === "flat" || groupMode === "workstream"}
          onClick={handleResort}
          title="Re-sort groups by most recent activity"
        >
          ↻ Resort
        </button>
        <span className="sl-seg-note">{freezeNote}</span>
      </div>

      {(routeWorkstreamId || routeNodeId) && (
        <div className="sl-sessions-filter-note">
          Showing graph-bound sessions
          {routeNodeId ? (
            <>
              {" "}for node <code>{routeNodeId}</code>
            </>
          ) : null}
          {routeWorkstreamId ? (
            <>
              {" "}in workstream <code>{routeWorkstreamId}</code>
            </>
          ) : null}
          . Use the Sessions nav item to clear this graph filter.
        </div>
      )}

      {hiddenGraphScopedManualCount > 0 && (
        <div className="sl-sessions-filter-note">
          Hiding {hiddenGraphScopedManualCount} manual session
          {hiddenGraphScopedManualCount === 1 ? "" : "s"} from this graph-node
          projection. Manual sessions remain available in the unfiltered Sessions view.
        </div>
      )}

      {hiddenObservedSessionCount > 0 && (
        <div className="sl-sessions-filter-note">
          Hiding {hiddenObservedSessionCount} observed session
          {hiddenObservedSessionCount === 1 ? "" : "s"} without trusted Copilot CLI
          hook signals. Use Show all observed to inspect diagnostics.
        </div>
      )}

      {hiddenEndedSessionCount > 0 && (
        <div className="sl-sessions-filter-note">
          Hiding {hiddenEndedSessionCount} ended session
          {hiddenEndedSessionCount === 1 ? "" : "s"}. Interrupted / resumable sessions
          stay visible for recovery.
        </div>
      )}

      {hiddenStaleSessionCount > 0 && (
        <div className="sl-sessions-filter-note">
          Hiding {hiddenStaleSessionCount} session
          {hiddenStaleSessionCount === 1 ? "" : "s"} with no activity in the last{" "}
          {staleSessionDays} day{staleSessionDays === 1 ? "" : "s"}.
        </div>
      )}

      {syncNote && <div className="sl-sessions-filter-note">{syncNote}</div>}

      {error && <div className="sl-action-error">{error}</div>}

      <div className="sl-sessions-groups">
        {loading ? (
          <div className="sl-empty-state">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="sl-empty-state">
            No sessions yet. Create one manually to start tracking restart-safe context.
          </div>
        ) : relevanceFilteredSessions.length === 0 ? (
          <div className="sl-empty-state">
            No active or recently closed Copilot CLI sessions right now. Show all observed
            to inspect older or helper sessions.
          </div>
        ) : endedFilteredSessions.length === 0 ? (
          <div className="sl-empty-state">
            No open or interrupted Copilot CLI sessions right now. Show ended to inspect
            sessions that closed cleanly.
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="sl-empty-state">
            No sessions updated in the last {staleSessionDays} day
            {staleSessionDays === 1 ? "" : "s"}. Increase the stale window to show
            older sessions.
          </div>
        ) : (
          orderedGroups.map((group) => (
            <section key={group.key} className="sl-session-group">
              <div className="sl-session-group-head">
                <span className="sl-session-group-title">
                  {group.label}
                  {group.code && group.code !== group.label && (
                    <code className="sl-session-group-code">{group.code}</code>
                  )}
                </span>
                <span className="sl-session-group-count">{group.sessions.length}</span>
                <span className="sl-session-group-latest">
                  latest: {timeAgo(group.latestTs)}
                </span>
              </div>
                <div className="sl-session-rows">
                  {group.sessions.map((session) => {
                    const summary = getSessionSummaryDisplay(session);
                    const observedStatus = getObservedStatusLabel(session);
                    const trustedStatus = getTrustedStatusLabel(session);
                    const rowTitle = getRowFallbackTitle(session);
                    const rowBranch = displayBranch(session);
                    const rowWorktree = displayWorktree(session);
                    const rowRestartCommand = buildVisibleRestartCommand(session, defaultCliArgs);
                    const activityLabel = getActivityStatusLabel(session);
                    const effectiveActivityStatus = getEffectiveActivityStatus(session);
                    const activityHint = activityStatusHint(effectiveActivityStatus);
                    const signalClass = activitySignalClass(effectiveActivityStatus);
                    const signalDetail = trustedStatus ?? observedStatus ?? session.originKind;
                    const rowFolderLeaf = leafName(rowWorktree ?? session.cwd);
                    const rowManagedRuntime = getManagedRuntime(session);
                    const rowPawWorkflow = visiblePawWorkflow(session);
                    const rowLinkage =
                      sessionLinkages.get(session.id) ??
                      resolveSessionWorkstreamLinkage(
                        session,
                        workstreams,
                        workstreamGraphStateMap,
                      );
                    const rowDetail =
                      summary.text && summary.status !== "missing"
                        ? summary.text
                        : rowManagedRuntime
                          ? managedRuntimeSummaryText(rowManagedRuntime)
                          : session.description || null;
                    return (
                      <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open session ${rowTitle}`}
                        className={`sl-session-row${
                          session.id === selectedId && sheetOpen ? " selected" : ""
                        }`}
                        onClick={() => void openSessionSheet(session)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return;
                          }
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void openSessionSheet(session);
                          }
                        }}
                      >
                        <div className="sl-session-row-body">
                          <span
                            className="sl-session-row-stripe"
                            style={{ backgroundColor: sessionDisplayColor(session) }}
                          />
                          <div className="sl-session-row-main">
                            <div className="sl-session-row-title-line">
                              <span
                                className="sl-session-row-swatch"
                                style={{ backgroundColor: sessionDisplayColor(session) }}
                                aria-hidden="true"
                              />
                              <span className="sl-session-row-title">{rowTitle}</span>
                            </div>
                            <p className="sl-session-row-summary">
                              {rowDetail ? (
                                rowDetail
                              ) : (
                                <em className="sl-session-row-summary-empty">
                                  No description yet.
                                </em>
                              )}
                            </p>
                            <div className="sl-session-row-meta">
                              <span className="sl-session-row-repo">
                                {session.repo ?? "(no repo)"}
                              </span>
                              {rowBranch && (
                                <>
                                  <span className="sl-session-row-sep">·</span>
                                  <span className="sl-session-row-branch">{rowBranch}</span>
                                </>
                              )}
                              {rowFolderLeaf && (
                                <span
                                  className="sl-session-row-context-chip"
                                  title={session.cwd}
                                >
                                  folder {rowFolderLeaf}
                                </span>
                              )}
                              <SessionWorkstreamContextChips
                                linkage={rowLinkage}
                                onOpenWorkstream={onOpenWorkstream}
                              />
                              {rowManagedRuntime && (
                                <>
                                  <span className="sl-session-row-context-chip managed-runtime">
                                    background session
                                  </span>
                                  <span
                                    className={`sl-session-row-context-chip managed-runtime ${managedLifecycleStatusClass(rowManagedRuntime.lifecycleState)}`}
                                    title={managedRuntimeSummaryText(rowManagedRuntime)}
                                  >
                                    {managedRuntimeLifecycleText(rowManagedRuntime)}
                                  </span>
                                </>
                              )}
                              {rowPawWorkflow && (
                                <span
                                  className="sl-session-row-context-chip paw-workflow recognized"
                                  title={getPawWorkflowDescription(rowPawWorkflow)}
                                >
                                  {getPawWorkflowLabel(rowPawWorkflow)}
                                </span>
                              )}
                              {session.derivedGithubRefs.slice(0, 3).map((ref) => (
                                <GithubRefChip
                                  key={`${ref.type}-${ref.repo ?? ""}-${ref.number}`}
                                  refItem={ref}
                                  session={session}
                                  className="sl-session-row-context-chip important"
                                />
                              ))}
                              {session.tags.map((tag) => (
                                <span key={tag} className="sl-session-row-tag">
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div
                            className={`sl-session-row-status-dock ${signalClass}`}
                            aria-label={`${activityLabel} status`}
                          >
                            <div className="sl-session-row-status-dock-line">
                              <span
                                className={`sl-session-row-status-pill ${signalClass}`}
                                title={`${activityHint} · ${signalDetail}`}
                              >
                                {activityLabel}
                              </span>
                              <span className="sl-session-row-signal-track" aria-hidden="true">
                                <span className="sl-session-row-signal-pulse" />
                              </span>
                            </div>
                            <div className="sl-session-row-status-dock-actions">
                              <CopyButton
                                text={rowRestartCommand ?? ""}
                                label={
                                  rowRestartCommand
                                    ? "Copy restart command"
                                    : restartUnavailableMessage(session, defaultCliArgs)
                                }
                                copiedLabel="Copied restart command"
                                iconOnly
                              />
                              <RelaunchButton
                                session={session}
                                compact
                              />
                              {session.activityStatus === "interrupted" && (
                                <StopButton
                                  session={session}
                                  compact
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
            </section>
          ))
        )}
      </div>

      {sheetOpen && (
        <>
          <div
            className="sl-sheet-backdrop open"
            onClick={() => void closeSheet()}
          />
          <div className="sl-sheet open" role="dialog" aria-modal="true">
            <div className="sl-sheet-head">
              <div>
                <div className="sl-sheet-head-pills">
                  {selectedSession && (
                    <>
                      <span
                        className={`sl-pill ${activityStatusClass(getEffectiveActivityStatus(selectedSession))}`}
                      >
                        {getActivityStatusLabel(selectedSession)}
                      </span>
                      <span className={`sl-pill ${statusClass(selectedSession.lifecycleStatus)}`}>
                        {selectedSession.lifecycleStatus}
                      </span>
                      <span className="sl-pill muted">{selectedSession.originKind}</span>
                      {getTrustedStatusLabel(selectedSession) && (
                        <span className="sl-pill accent">
                          {getTrustedStatusLabel(selectedSession)}
                        </span>
                      )}
                      {getObservedStatusLabel(selectedSession) && (
                        <span className="sl-pill muted">
                          {getObservedStatusLabel(selectedSession)}
                        </span>
                      )}
                      {selectedPawWorkflow && (
                        <span
                          className="sl-pill paw-workflow recognized"
                          title={getPawWorkflowDescription(selectedPawWorkflow)}
                        >
                          {getPawWorkflowLabel(selectedPawWorkflow)}
                        </span>
                      )}
                    </>
                  )}
                  {creating && <span className="sl-pill accent">new</span>}
                </div>
                {selectedSession && !creating ? (
                  <div className="sl-sheet-title-editor">
                    <div className="sl-sheet-color-menu">
                      <button
                        type="button"
                        className="sl-sheet-color-button"
                        aria-label="Show terminal color quick picks"
                        aria-expanded={headerColorPaletteOpen}
                        onClick={() => setHeaderColorPaletteOpen((value) => !value)}
                      >
                        <span
                          className="sl-sheet-color-button-swatch"
                          style={{
                            backgroundColor:
                              draft.color.trim() || sessionDisplayColor(selectedSession),
                          }}
                        />
                      </button>
                      {headerColorPaletteOpen && (
                        <div className="sl-sheet-color-popover">
                          <TerminalColorQuickPicker
                            value={draft.color}
                            onChange={(color) => {
                              updateDraft((current) => ({ ...current, color }));
                              setHeaderColorPaletteOpen(false);
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <input
                      className="sl-sheet-title-input"
                      aria-label="Session title"
                      value={draft.title}
                      onChange={(event) =>
                        updateDraft((current) => ({ ...current, title: event.target.value }))
                      }
                      onKeyDown={commitSheetOnEnter}
                    />
                  </div>
                ) : (
                  <h2 className="sl-sheet-title">{creating ? "Create session" : "Session"}</h2>
                )}
                {selectedSession && !creating && (
                  <div className="sl-session-path">{selectedSession.cwd}</div>
                )}
              </div>
              <div className="sl-sheet-head-right">
                {showDetailStatus && (
                  <span className={`sl-pill ${detailStatus === "error" ? "red" : "accent"}`}>
                    {detailStatus}
                  </span>
                )}
                <button
                  type="button"
                  className="sl-sheet-close"
                  onClick={() => void closeSheet()}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="sl-sheet-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={sheetTab === "overview"}
                disabled={creating}
                className={`sl-sheet-tab${sheetTab === "overview" ? " active" : ""}`}
                onClick={() => setSheetTab("overview")}
              >
                Overview
              </button>
              <button
                role="tab"
                aria-selected={sheetTab === "activity"}
                disabled={creating}
                className={`sl-sheet-tab${sheetTab === "activity" ? " active" : ""}`}
                onClick={() => setSheetTab("activity")}
              >
                Activity
              </button>
              <button
                role="tab"
                aria-selected={sheetTab === "settings"}
                className={`sl-sheet-tab${sheetTab === "settings" ? " active" : ""}`}
                onClick={() => setSheetTab("settings")}
              >
                Settings
              </button>
            </div>

            <div className="sl-sheet-body">
              {saveError && <div className="sl-action-error">{saveError}</div>}

              {sheetTab === "overview" && selectedSession && !creating && (
                <SessionOverview
                  session={selectedSession}
                  workstreamLinkage={selectedSessionLinkage}
                  defaultCliArgs={defaultCliArgs}
                  onOpenWorkstream={onOpenWorkstream}
                  onSessionActionComplete={fetchSessions}
                />
              )}

              {sheetTab === "activity" && selectedSession && !creating && (
                <SessionActivity session={selectedSession} />
              )}

              {sheetTab === "settings" && (creating || selectedSession) && (
                <SessionSettingsForm
                  draft={draft}
                  creating={creating}
                  selectedSession={selectedSession}
                  onChange={updateDraft}
                  onCommit={() => {
                    void (creating ? handleCreate() : closeSheet());
                  }}
                />
              )}
            </div>

            <div className="sl-sheet-foot">
              {creating ? (
                <>
                  <button
                    className="sl-action-btn primary"
                    onClick={() => void handleCreate()}
                    disabled={creatingState === "saving"}
                  >
                    {creatingState === "saving" ? "Creating…" : "Create session"}
                  </button>
                  <button className="sl-action-btn" onClick={() => void closeSheet()}>
                    Cancel
                  </button>
                </>
              ) : (
                selectedSession && (
                  <>
                    {selectedSession.lifecycleStatus !== "archived" && (
                      <button className="sl-action-btn" onClick={() => void handleArchive()}>
                        Archive
                      </button>
                    )}
                    <button
                      className="sl-action-btn danger"
                      onClick={() => void handleDelete()}
                    >
                      Delete
                    </button>
                    <button
                      className="sl-action-btn primary"
                      style={{ marginLeft: "auto" }}
                      onClick={() => void closeSheet()}
                    >
                      Done
                    </button>
                  </>
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface SessionOverviewProps {
  session: SessionRegistryListItem;
  workstreamLinkage: SessionWorkstreamLinkageResolution | null;
  defaultCliArgs: readonly string[] | null;
  onOpenWorkstream?: (target: WorkstreamRouteTarget) => void | Promise<void>;
  onSessionActionComplete?: () => void | Promise<void>;
}

type CopyState = "idle" | "copied" | "error";

interface CopyButtonProps {
  text: string;
  label: string;
  copiedLabel: string;
  className?: string;
  iconOnly?: boolean;
  children?: string;
}

function CopyButton({
  text,
  label,
  copiedLabel,
  className,
  iconOnly = false,
  children = "Copy",
}: CopyButtonProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const markCopyState = useCallback((state: CopyState) => {
    setCopyState(state);
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setCopyState("idle");
      resetTimerRef.current = null;
    }, 1_500);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await copyTextToClipboard(text);
      markCopyState("copied");
    } catch {
      markCopyState("error");
    }
  }, [markCopyState, text]);

  const stateLabel =
    copyState === "copied" ? copiedLabel : copyState === "error" ? "Copy failed" : children;

  return (
    <button
      type="button"
      className={`sl-copy-btn${iconOnly ? " icon" : ""}${
        copyState === "copied" ? " copied" : ""
      }${copyState === "error" ? " error" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={copyState === "copied" ? copiedLabel : label}
      disabled={text.trim().length === 0}
      onClick={(event) => {
        event.stopPropagation();
        void handleCopy();
      }}
    >
      <span className="sl-copy-btn-icon" aria-hidden="true">
        ⧉
      </span>
      {!iconOnly && <span>{stateLabel}</span>}
    </button>
  );
}

type RelaunchState = "idle" | "launching" | "launched" | "error";

interface RelaunchButtonProps {
  session: SessionRegistryListItem;
  className?: string;
  compact?: boolean;
}

function RelaunchButton({ session, className, compact = false }: RelaunchButtonProps) {
  const [state, setState] = useState<RelaunchState>("idle");
  const [detail, setDetail] = useState("");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eligible = canRelaunch(session);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleRelaunch = useCallback(async () => {
    if (!eligible || state === "launching") {
      return;
    }
    setState("launching");
    setDetail("");
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(session.id)}/relaunch`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const body = await response.json();
      if (response.ok) {
        const method = body.method === "powershell" ? "PowerShell" : "Windows Terminal";
        const info = body.copilotResumed ? `Resumed in ${method}` : `Opened in ${method}`;
        setState("launched");
        setDetail(info);
      } else {
        setState("error");
        setDetail(body.message ?? "Relaunch failed");
      }
    } catch {
      setState("error");
      setDetail("Network error");
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setState("idle");
      setDetail("");
      resetTimerRef.current = null;
    }, 15_000);
  }, [eligible, session.id, state]);

  const label = !eligible
    ? session.lifecycleStatus === "archived"
      ? "Archived — unarchive to relaunch"
      : session.copilotProcessState === "live"
        ? "Session is live"
        : "No working directory"
    : state === "launching"
      ? "Launching…"
      : state === "launched"
        ? detail
        : state === "error"
          ? detail
          : "Relaunch session";

  const buttonText = compact
    ? state === "launching" ? "…" : state === "launched" ? "✓" : state === "error" ? "✗" : "⟳"
    : label;

  return (
    <button
      type="button"
      className={`sl-relaunch-btn${state === "launched" ? " success" : ""}${
        state === "error" ? " error" : ""
      }${state === "launching" ? " launching" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      disabled={!eligible || state === "launching"}
      onClick={(event) => {
        event.stopPropagation();
        void handleRelaunch();
      }}
    >
      {buttonText}
    </button>
  );
}

interface CopyableValueProps {
  value: string;
  label: string;
}

type StopState = "idle" | "stopping" | "stopped" | "error";

interface StopButtonProps {
  session: SessionRegistryListItem;
  className?: string;
  compact?: boolean;
  confirmBeforeStopping?: boolean;
}

function StopButton({ session, className, compact = false, confirmBeforeStopping = true }: StopButtonProps) {
  const [state, setState] = useState<StopState>("idle");
  const [detail, setDetail] = useState("");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eligible = canManuallyStop(session);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleStop = useCallback(async () => {
    if (!eligible || state === "stopping") {
      return;
    }
    if (confirmBeforeStopping) {
      const ok = window.confirm(
        `Mark "${session.title}" as ended? Use this only if the Copilot CLI session is no longer running but the registry still shows it as active or interrupted.`,
      );
      if (!ok) return;
    }
    setState("stopping");
    setDetail("");
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(session.id)}/stop`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const body = await response.json();
      if (response.ok) {
        setState("stopped");
        setDetail("Marked as ended");
      } else {
        setState("error");
        setDetail(body.message ?? "Stop failed");
      }
    } catch {
      setState("error");
      setDetail("Network error");
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setState("idle");
      setDetail("");
      resetTimerRef.current = null;
    }, 5_000);
  }, [confirmBeforeStopping, eligible, session.id, session.title, state]);

  const label = !eligible
    ? session.lifecycleStatus === "archived"
      ? "Archived"
      : session.lifecycleStatus === "ended" && session.trustedEndedAt
        ? "Already ended"
        : "No Copilot session ID"
    : state === "stopping"
      ? "Marking ended…"
      : state === "stopped"
        ? detail
        : state === "error"
          ? detail
          : "Mark as ended";

  const buttonText = compact
    ? state === "stopping" ? "…" : state === "stopped" ? "✓" : state === "error" ? "✗" : "■"
    : label;

  return (
    <button
      type="button"
      className={`sl-stop-btn${state === "stopped" ? " success" : ""}${
        state === "error" ? " error" : ""
      }${state === "stopping" ? " stopping" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      disabled={!eligible || state === "stopping"}
      onClick={(event) => {
        event.stopPropagation();
        void handleStop();
      }}
    >
      {buttonText}
    </button>
  );
}

function CopyableValue({ value, label }: CopyableValueProps) {
  return (
    <span className="sl-copyable-value">
      <code>{value}</code>
      <CopyButton text={value} label={label} copiedLabel="Copied" iconOnly />
    </span>
  );
}

function ManagedRuntimeOverview({
  sessionId,
  runtime,
  onActionComplete,
}: {
  sessionId: string;
  runtime: ManagedRuntimeProjection;
  onActionComplete?: () => void | Promise<void>;
}) {
  const progressEvents = managedRuntimeProgressEvents(runtime.progress);
  const sdk = runtime.sdk ?? null;
  const actions = resolveManagedRuntimeActions(runtime);

  return (
    <section className="sl-session-overview-section managed-runtime">
      <h3 className="sl-session-overview-heading">Background session</h3>
      <div className="sl-session-managed-runtime-banner">
        <span
          className={`sl-managed-runtime-state ${managedLifecycleStatusClass(runtime.lifecycleState)}`}
        >
          {managedRuntimeLifecycleText(runtime)}
        </span>
        <span>{managedRuntimeSummaryText(runtime)}</span>
      </div>
      <dl className="sl-session-kv">
        <dt>Runtime</dt>
        <dd>background session</dd>
        <dt>Owner</dt>
        <dd>{formatManagedRuntimeLabel(runtime.runtimeOwner)}</dd>
        <dt>Permission profile</dt>
        <dd>{formatManagedRuntimeLabel(runtime.permissionProfile)}</dd>
        <dt>Lifecycle</dt>
        <dd>{managedRuntimeLifecycleText(runtime)}</dd>
        <dt>Updated</dt>
        <dd>{formatTimestamp(runtime.lifecycleUpdatedAt ?? null)}</dd>
        {sdk?.sdkSessionId && (
          <>
            <dt>SDK session</dt>
            <dd>
              <CopyableValue
                value={sdk.sdkSessionId}
                label={`Copy SDK session ID ${sdk.sdkSessionId}`}
              />
            </dd>
          </>
        )}
        {sdk?.sdkWorkspacePath && (
          <>
            <dt>SDK workspace</dt>
            <dd>{sdk.sdkWorkspacePath}</dd>
          </>
        )}
        {sdk?.sdkStateRoot && (
          <>
            <dt>SDK state</dt>
            <dd>{sdk.sdkStateRoot}</dd>
          </>
        )}
      </dl>
      <div className="sl-session-managed-actions">
        {actions.map((action) => (
          <ManagedRuntimeActionButton
            key={action.action}
            sessionId={sessionId}
            action={action}
            onComplete={onActionComplete}
          />
        ))}
      </div>
      {progressEvents.length > 0 && (
        <ol className="sl-session-managed-progress">
          {progressEvents.map((event) => (
            <li key={`${event.timestamp}-${event.phase}-${event.summary}`}>
              <span className="sl-session-managed-progress-time">
                {formatTimestamp(event.timestamp)}
              </span>
              <span className="sl-session-managed-progress-phase">
                {formatManagedRuntimeLabel(event.phase)}
              </span>
              <span>{event.summary}</span>
            </li>
          ))}
        </ol>
      )}
      {(runtime.blockerSummary || runtime.errorSummary) && (
        <div className="sl-session-overview-note">
          {runtime.blockerSummary ?? runtime.errorSummary}
        </div>
      )}
    </section>
  );
}

function SessionOverview({
  session,
  workstreamLinkage,
  defaultCliArgs,
  onOpenWorkstream,
  onSessionActionComplete,
}: SessionOverviewProps) {
  const summary = getSessionSummaryDisplay(session);
  const latestDescription = getSessionLatestDescription(session, summary);
  const contextBranch = displayBranch(session);
  const contextWorktree = displayWorktree(session);
  const displaySessionId = getDisplaySessionId(session);
  const restartCommand = buildVisibleRestartCommand(session, defaultCliArgs);
  const pawWorkflow = visiblePawWorkflow(session);
  const managedRuntime = getManagedRuntime(session);
  return (
    <div className="sl-session-overview">
      <section className="sl-session-overview-section">
        <h3 className="sl-session-overview-heading">Restart</h3>
        <div className="sl-session-quick-actions">
          <RelaunchButton session={session} />
          <StopButton session={session} />
          <CopyButton
            text={restartCommand ?? ""}
            label={
              restartCommand
                ? "Copy restart command"
                : restartUnavailableMessage(session, defaultCliArgs)
            }
            copiedLabel="Copied restart command"
          >
            {restartCommand ? "Copy restart command" : "Restart unavailable"}
          </CopyButton>
          <CopyButton
            text={displaySessionId}
            label={`Copy session ID ${displaySessionId}`}
            copiedLabel="Copied session ID"
          >
            Copy session ID
          </CopyButton>
        </div>
        <code className="sl-session-command-preview">
          {restartCommand ??
            (session.copilotSessionId
              ? "Session launch settings are still loading. Restart command preview will appear when defaults load."
              : "No Copilot session ID recorded. Copy the registry ID instead.")}
        </code>
      </section>

      <section className="sl-session-overview-section narrative">
        <h3 className="sl-session-overview-heading">Conversation</h3>
        <div className="sl-session-narrative">
          <p>
            <strong>Started:</strong> {getSessionStartDescription(session)}
          </p>
          <p>
            <strong>Latest:</strong> {latestDescription}
          </p>
        </div>
        {summary.note && <div className="sl-session-overview-note">{summary.note}</div>}
      </section>

      {managedRuntime && (
        <ManagedRuntimeOverview
          sessionId={session.id}
          runtime={managedRuntime}
          onActionComplete={onSessionActionComplete}
        />
      )}

      {workstreamLinkage && workstreamLinkage.status !== "unbound" && (
        <section className="sl-session-overview-section">
          <h3 className="sl-session-overview-heading">Workstream binding</h3>
          <dl className="sl-session-kv">
            <dt>Workstream</dt>
            <dd>
              <WorkstreamLinkChip
                target={workstreamLinkage.workstreamRouteTarget}
                className="sl-session-context-ref"
                label={`Open workstream ${workstreamLinkage.workstreamLabel ?? workstreamLinkage.workstreamId ?? "unknown"}`}
                title={workstreamLinkageTitle(workstreamLinkage)}
                onOpenWorkstream={onOpenWorkstream}
              >
                {workstreamLinkage.workstreamLabel ??
                  workstreamLinkage.workstreamId ??
                  "unknown"}
              </WorkstreamLinkChip>
            </dd>
            {workstreamLinkage.nodeId && (
              <>
                <dt>Node</dt>
                <dd>
                  <WorkstreamLinkChip
                    target={workstreamLinkage.nodeRouteTarget}
                    className="sl-session-context-ref"
                    label={`Open workstream node ${workstreamLinkage.nodeLabel ?? workstreamLinkage.nodeId}`}
                    title={workstreamLinkageTitle(workstreamLinkage)}
                    onOpenWorkstream={onOpenWorkstream}
                  >
                    {workstreamLinkage.nodeLabel ?? workstreamLinkage.nodeId}
                  </WorkstreamLinkChip>
                </dd>
              </>
            )}
            <dt>Binding status</dt>
            <dd>{workstreamLinkageStatusLabel(workstreamLinkage)}</dd>
            {workstreamLinkage.matchCount > 1 && (
              <>
                <dt>Matches</dt>
                <dd>{workstreamLinkage.matchCount} tracked workstreams</dd>
              </>
            )}
          </dl>
          {workstreamLinkage.note && (
            <div className="sl-session-overview-note">{workstreamLinkage.note}</div>
          )}
        </section>
      )}

      {pawWorkflow && (
        <section className="sl-session-overview-section">
          <h3 className="sl-session-overview-heading">PAW workflow</h3>
          <div className="sl-session-paw-summary recognized">
            <strong>{getPawWorkflowLabel(pawWorkflow)}</strong>
            <span>{getPawWorkflowDescription(pawWorkflow)}</span>
          </div>
          <dl className="sl-session-kv">
            <dt>Status</dt>
            <dd>{pawWorkflow.status}</dd>
            <dt>Stage</dt>
            <dd>{pawWorkflowStageLabel(pawWorkflow.stage)}</dd>
            <dt>Workflow</dt>
            <dd>{pawWorkflow.workflowKind}</dd>
            <dt>Work ID</dt>
            <dd>{pawWorkflow.workId ?? "—"}</dd>
            {pawWorkflow.workTitle && (
              <>
                <dt>Work title</dt>
                <dd>{pawWorkflow.workTitle}</dd>
              </>
            )}
            <dt>Work dir</dt>
            <dd>{pawWorkflow.workDir ?? "—"}</dd>
            <dt>Artifacts</dt>
            <dd>{pawWorkflow.artifactCount}</dd>
            <dt>Latest artifact</dt>
            <dd>{pawWorkflow.latestArtifactPath ?? "—"}</dd>
            <dt>Latest mtime</dt>
            <dd>{formatPawArtifactMtime(pawWorkflow.latestArtifactMtimeMs)}</dd>
            <dt>Scanned</dt>
            <dd>{formatTimestamp(pawWorkflow.scannedAt)}</dd>
          </dl>
          {pawWorkflow.diagnostics.length > 0 && (
            <div className="sl-session-paw-diagnostics">
              {pawWorkflow.diagnostics.map((diagnostic) => (
                <code key={diagnostic}>{diagnostic}</code>
              ))}
            </div>
          )}
          {pawWorkflow.artifacts.length > 0 && (
            <ul className="sl-session-paw-artifacts">
              {pawWorkflow.artifacts.slice(0, 6).map((artifact) => (
                <li key={`${artifact.kind}-${artifact.path}`}>
                  <span>{pawArtifactKindLabel(artifact.kind)}</span>
                  <code>{artifact.path}</code>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(contextBranch || contextWorktree || session.derivedGithubRefs.length > 0) && (
        <section className="sl-session-overview-section">
          <h3 className="sl-session-overview-heading">Derived context</h3>
          <dl className="sl-session-kv">
            {contextWorktree && (
              <>
                <dt>Worktree</dt>
                <dd>{contextWorktree}</dd>
              </>
            )}
            {contextBranch && (
              <>
                <dt>Active branch</dt>
                <dd>{contextBranch}</dd>
              </>
            )}
            {session.derivedGithubRefs.length > 0 && (
              <>
                <dt>GitHub refs</dt>
                <dd>
                  <div className="sl-session-context-ref-list">
                    {session.derivedGithubRefs.map((ref) => (
                      <GithubRefChip
                        key={`${ref.type}-${ref.repo ?? ""}-${ref.number}`}
                        refItem={ref}
                        session={session}
                        className="sl-session-context-ref"
                        showRepo
                      />
                    ))}
                  </div>
                </dd>
              </>
            )}
          </dl>
          {session.derivedContextUpdatedAt && (
            <div className="sl-session-overview-note">
              Context indexed {formatTimestamp(session.derivedContextUpdatedAt)}
            </div>
          )}
        </section>
      )}

      <section className="sl-session-overview-section">
        <h3 className="sl-session-overview-heading">Session</h3>
        <dl className="sl-session-kv">
          <dt>Title</dt>
          <dd>{session.title}</dd>
          <dt>Activity</dt>
          <dd>
            {getActivityStatusLabel(session)}
            {session.activityStatusUpdatedAt
              ? ` · ${formatTimestamp(session.activityStatusUpdatedAt)}`
              : ""}
          </dd>
          <dt>Activity note</dt>
          <dd>{getActivityStatusDescription(session)}</dd>
          <dt>Status</dt>
          <dd>{getTrustedStatusLabel(session) ?? session.lifecycleStatus}</dd>
          <dt>Repo</dt>
          <dd>{session.repo ?? "—"}</dd>
          <dt>Branch</dt>
          <dd>{session.branch ?? "—"}</dd>
          <dt>Cwd</dt>
          <dd>{session.cwd}</dd>
          <dt>Parent folder</dt>
          <dd>{folderOf(session.cwd) || "—"}</dd>
          <dt>Session id</dt>
          <dd>
            <CopyableValue
              value={session.id}
              label={`Copy registry session ID ${session.id}`}
            />
          </dd>
          <dt>Origin</dt>
          <dd>{session.originKind}</dd>
          {hasTrustedSignal(session) && (
            <>
              <dt>Trusted signal</dt>
              <dd>{getTrustedStatusLabel(session) ?? "trusted"}</dd>
              <dt>Started</dt>
              <dd>{formatTimestamp(session.trustedStartedAt)}</dd>
              <dt>Last signal</dt>
              <dd>{formatTimestamp(session.trustedLastSignalAt)}</dd>
              {session.trustedEndedAt && (
                <>
                  <dt>Ended</dt>
                  <dd>{formatTimestamp(session.trustedEndedAt)}</dd>
                </>
              )}
              {session.trustedEndReason && (
                <>
                  <dt>End reason</dt>
                  <dd>{session.trustedEndReason}</dd>
                </>
              )}
            </>
          )}
          {session.originKind === "observed" && (
            <>
              <dt>Observed kind</dt>
              <dd>{isHelperLikeObservedSession(session) ? "helper" : "interactive"}</dd>
              <dt>CLI presence</dt>
              <dd>{getObservedStatusLabel(session) ?? "—"}</dd>
              {session.copilotProcessId && (
                <>
                  <dt>CLI pid</dt>
                  <dd>{session.copilotProcessId}</dd>
                </>
              )}
            </>
          )}
          <dt>Lifecycle</dt>
          <dd>{session.lifecycleStatus}</dd>
          <dt>Last activity</dt>
          <dd>{formatTimestamp(session.lastSeenAt)}</dd>
          <dt>Updated</dt>
          <dd>{formatTimestamp(session.updatedAt)}</dd>
          <dt>Tags</dt>
          <dd>{session.tags.length > 0 ? session.tags.map((t) => `#${t}`).join(" ") : "—"}</dd>
          {session.copilotSessionId && (
            <>
              <dt>Copilot session</dt>
              <dd>
                <CopyableValue
                  value={session.copilotSessionId}
                  label={`Copy session ID ${session.copilotSessionId}`}
                />
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="sl-session-overview-section secondary">
        <h3 className="sl-session-overview-heading">Description source</h3>
        <div className="sl-session-overview-summary">
          {summary.text || (
            <em className="sl-session-overview-empty">
              No AI description yet. The background worker will generate one after enough
              user turns accumulate in the Copilot session log.
            </em>
          )}
        </div>
      </section>
    </div>
  );
}

interface SessionActivityProps {
  session: SessionRegistryListItem;
}

function SessionActivity({ session }: SessionActivityProps) {
  return (
    <div className="sl-session-activity">
      <p className="sl-session-activity-placeholder">
        Turn-by-turn activity is not wired up yet. Once Copilot session transcripts are
        piped in, we'll show the last few user prompts and assistant responses here for{" "}
        <strong>{session.title}</strong>.
      </p>
      <div className="sl-session-activity-facts">
        <div>
          <span className="sl-field-label">Last observed</span>
          <div>{formatTimestamp(session.lastSeenAt)}</div>
        </div>
        <div>
          <span className="sl-field-label">Updated</span>
          <div>{formatTimestamp(session.updatedAt)}</div>
        </div>
      </div>
    </div>
  );
}

interface SessionSettingsFormProps {
  draft: SessionDraft;
  creating: boolean;
  selectedSession: SessionRegistryListItem | null;
  onChange: (updater: (current: SessionDraft) => SessionDraft) => void;
  onCommit: () => void;
}

function SessionSettingsForm({
  draft,
  creating,
  selectedSession,
  onChange,
  onCommit,
}: SessionSettingsFormProps) {
  const lifecycleLocked = selectedSession?.lifecycleStatus === "ended";
  const setColor = (color: string) => {
    onChange((current) => ({ ...current, color }));
  };
  const commitOnEnter = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!isPlainEnterKey(event)) {
      return;
    }
    event.preventDefault();
    onCommit();
  };
  return (
    <div className="sl-session-editor">
      <label className="sl-field">
        <span className="sl-field-label">Title</span>
        <input
          className="sl-text-field"
          value={draft.title}
          onChange={(event) =>
            onChange((current) => ({ ...current, title: event.target.value }))
          }
          onKeyDown={commitOnEnter}
        />
      </label>

      <label className="sl-field">
        <span className="sl-field-label">Description</span>
        <textarea
          className="sl-text-area"
          value={draft.description}
          onChange={(event) =>
            onChange((current) => ({ ...current, description: event.target.value }))
          }
        />
      </label>

      <div className="sl-field-grid">
        <label className="sl-field">
          <span className="sl-field-label">Color</span>
          <div className="sl-color-editor">
            <TerminalColorQuickPicker value={draft.color} onChange={setColor} />
            <input
              className="sl-text-field"
              value={draft.color}
              onChange={(event) => setColor(event.target.value)}
              placeholder="#5b7fff"
              onKeyDown={commitOnEnter}
            />
          </div>
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Lifecycle</span>
          <select
            className="sl-select-field"
            value={draft.lifecycleStatus}
            disabled={lifecycleLocked}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                lifecycleStatus: event.target.value as SessionDraft["lifecycleStatus"],
              }))
            }
          >
            <option value="active">active</option>
            <option value="paused">paused</option>
            {!creating && <option value="archived">archived</option>}
            {!creating && lifecycleLocked && <option value="ended">ended</option>}
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
            onChange((current) => ({ ...current, cwd: event.target.value }))
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
              onChange((current) => ({ ...current, repo: event.target.value }))
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
              onChange((current) => ({ ...current, branch: event.target.value }))
            }
            placeholder="main"
          />
        </label>
      </div>

      <label className="sl-field">
        <span className="sl-field-label">Tags (comma-separated)</span>
        <input
          className="sl-text-field"
          value={draft.tagsText}
          onChange={(event) =>
            onChange((current) => ({ ...current, tagsText: event.target.value }))
          }
          onKeyDown={commitOnEnter}
          placeholder="paw-lite, ui, session-registry"
        />
      </label>
    </div>
  );
}
