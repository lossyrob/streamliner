import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { SessionRegistryListItem, SessionRegistryPatch } from "../session-registry-contract";
import type { SessionRegistryRecord } from "../session-registry-schema";
import {
  buildRestartCommand,
  filterEndedSessions,
  getDisplaySessionId,
  isTrustedActiveSession,
  isTrustedInterruptedSession,
} from "./session-policies";

const SESSION_POLL_INTERVAL_MS = 15_000;
const SESSION_AUTOSAVE_MS = 500;
const DEFAULT_STALE_SESSION_DAYS = 7;
const DEFAULT_RECENTLY_CLOSED_HOURS = 6;
const SESSION_STALE_DAYS_STORAGE_KEY = "streamliner:sessionsStaleDays";
const SESSION_GROUP_MODE_STORAGE_KEY = "streamliner:sessionsGroupMode";
const TERMINAL_COLOR_QUICK_PICKS = [
  "#e8114b",
  "#4891c8",
  "#41b878",
  "#ff8c0a",
  "#c71585",
  "#2897f0",
  "#2fcf32",
  "#ffff00",
  "#9825d7",
  "#6754d7",
  "#00ff00",
  "#d6bd93",
  "#f000e8",
  "#19d9df",
  "#82c6df",
  "#b8b8b8",
] as const;

type GroupMode = "recency" | "repo" | "folder" | "flat";
type SheetTab = "overview" | "activity" | "settings";

const GROUP_MODES: Array<{ mode: GroupMode; label: string }> = [
  { mode: "recency", label: "Recency" },
  { mode: "repo", label: "Repo" },
  { mode: "folder", label: "Folder" },
  { mode: "flat", label: "Flat" },
];

const DEFAULT_GROUP_MODE: GroupMode = "recency";

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
type DerivedGithubRef = SessionRegistryListItem["derivedGithubRefs"][number];

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
    graphBinding: record.graphBinding,
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

function applyPatchToListItem(
  session: SessionRegistryListItem,
  patch: SessionRegistryPatch,
): SessionRegistryListItem {
  return {
    ...session,
    ...patch,
  };
}

function sessionSnapshotKey(session: SessionRegistryListItem | null): string | null {
  if (!session) {
    return null;
  }
  return JSON.stringify({
    id: session.id,
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

function looksLikeSummarizerPrompt(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("Repo:") && trimmed.includes("Existing title:");
}

function isHelperLikeObservedSession(session: SessionRegistryListItem): boolean {
  return (
    session.originKind === "observed" &&
    (session.observedSessionKind === "helper" ||
      looksLikeSummarizerPrompt(session.title) ||
      session.description.startsWith("AI summary helper ·"))
  );
}

function hasTrustedSignal(session: SessionRegistryListItem): boolean {
  return session.trustedSignalSource !== null;
}

function sessionDisplayColor(session: Pick<SessionRegistryListItem, "color">): string {
  return session.color ?? "var(--sl-accent-border)";
}

function colorInputValue(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : "#5b7fff";
}

function normalizeColor(value: string): string {
  return value.trim().toLowerCase();
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
    looksLikeSummarizerPrompt(title) ||
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

function getActivityTimestamp(session: SessionRegistryListItem): number | null {
  if (!session.lastSeenAt) {
    return null;
  }
  const parsed = Date.parse(session.lastSeenAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSessionStale(
  session: SessionRegistryListItem,
  staleSessionDays: number,
): boolean {
  const staleCutoff = Date.now() - staleSessionDays * 24 * 60 * 60 * 1000;
  return getFreshnessTimestamp(session) < staleCutoff;
}

function isRecentlyClosedObservedSession(session: SessionRegistryListItem): boolean {
  if (session.originKind !== "observed" || session.copilotProcessState === "live") {
    return false;
  }
  const activityTimestamp = getActivityTimestamp(session);
  if (activityTimestamp === null) {
    return false;
  }
  return (
    Date.now() - activityTimestamp <= DEFAULT_RECENTLY_CLOSED_HOURS * 60 * 60 * 1000
  );
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

function isRecentlyEndedTrustedSession(session: SessionRegistryListItem): boolean {
  if (!hasTrustedSignal(session) || !session.trustedEndedAt) {
    return false;
  }
  const endedAt = Date.parse(session.trustedEndedAt);
  if (!Number.isFinite(endedAt)) {
    return false;
  }
  return Date.now() - endedAt <= DEFAULT_RECENTLY_CLOSED_HOURS * 60 * 60 * 1000;
}

function getObservedStatusLabel(session: SessionRegistryListItem): string | null {
  if (session.originKind !== "observed") {
    return null;
  }
  if (isHelperLikeObservedSession(session)) {
    return "helper";
  }
  if (session.copilotProcessState === "live") {
    return "open";
  }
  if (session.copilotProcessState === "stale_lock") {
    return "stale lock";
  }
  if (isRecentlyClosedObservedSession(session)) {
    return "closed";
  }
  return "historical";
}

function getTrustedStatusLabel(session: SessionRegistryListItem): string | null {
  if (!hasTrustedSignal(session)) {
    return null;
  }
  const runner = session.trustedExecutionKind === "agency" ? "agency" : "cli";
  if (isTrustedActiveSession(session)) {
    return `${runner} open`;
  }
  if (isTrustedInterruptedSession(session)) {
    return `${runner} resumable`;
  }
  if (session.trustedEndedAt) {
    return `${runner} ended`;
  }
  return `${runner} trusted`;
}

function getActivityStatusLabel(session: SessionRegistryListItem): string {
  switch (session.activityStatus) {
    case "working":
      return "working";
    case "waiting_for_input":
      return "waiting for you";
    case "interrupted":
      return "interrupted";
    case "exited":
      return "exited";
    case "unknown":
      return getTrustedStatusLabel(session) ?? getObservedStatusLabel(session) ?? "unknown";
    default:
      return "unknown";
  }
}

function activityStatusClass(status: SessionRegistryListItem["activityStatus"]): string {
  switch (status) {
    case "working":
      return "accent";
    case "waiting_for_input":
      return "green";
    case "interrupted":
      return "amber";
    case "exited":
      return "muted";
    case "unknown":
      return "muted";
    default:
      return "muted";
  }
}

function activitySignalClass(status: SessionRegistryListItem["activityStatus"]): string {
  switch (status) {
    case "working":
      return "working";
    case "waiting_for_input":
      return "waiting";
    case "interrupted":
    case "exited":
    case "unknown":
      return "inactive";
    default:
      return "inactive";
  }
}

function activityStatusHint(status: SessionRegistryListItem["activityStatus"]): string {
  switch (status) {
    case "working":
      return "agent active";
    case "waiting_for_input":
      return "assistant done";
    case "interrupted":
      return "resumable";
    case "exited":
      return "ended";
    case "unknown":
      return "activity unknown";
    default:
      return "activity unknown";
  }
}

function getActivityStatusDescription(session: SessionRegistryListItem): string {
  switch (session.activityStatus) {
    case "working":
      return "The latest Copilot event indicates the assistant turn is still in progress.";
    case "waiting_for_input":
      return "The latest Copilot event indicates the assistant turn ended and the session is waiting for input.";
    case "interrupted":
      return "The session started without a matching end signal, and Streamliner no longer sees a live Copilot process.";
    case "exited":
      return "The session has an end signal or ended lifecycle state.";
    case "unknown":
      return "Streamliner has not indexed enough activity yet to classify this session.";
    default:
      return "Streamliner has not indexed enough activity yet to classify this session.";
  }
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
  if (stored === "recency" || stored === "repo" || stored === "folder" || stored === "flat") {
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

function groupSessions(
  sessions: SessionRegistryListItem[],
  mode: GroupMode,
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
        sessions: sorted,
      },
    ];
  }

  const buckets = new Map<string, SessionRegistryListItem[]>();
  for (const session of sessions) {
    let key: string;
    if (mode === "recency") {
      key = recencyBucket(session).key;
    } else if (mode === "repo") {
      key = repoGroupKey(session);
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
    if (mode === "recency") {
      // label comes from the bucket metadata
      const sample = sorted[0];
      const info = recencyBucket(sample);
      label = info.label;
    } else if (mode === "repo") {
      const display = displayRepoLabel(key);
      label = display.label;
      code = display.code;
    } else {
      const display = displayFolderLabel(key);
      label = display.label;
      code = display.code;
    }

    groups.push({ key, label, code, latestTs, sessions: sorted });
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

interface SessionSaveOptions {
  background?: boolean;
  keepalive?: boolean;
  optimistic?: boolean;
  surfaceErrorGlobally?: boolean;
}

interface SessionsPageProps {
  registerBeforeLeave?: (handler: (() => Promise<boolean>) | null) => void;
}

export function SessionsPage({ registerBeforeLeave }: SessionsPageProps) {
  const [sessions, setSessions] = useState<SessionRegistryListItem[]>([]);
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
  const [creatingState, setCreatingState] = useState<SaveState>("idle");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipUnmountFlushRef = useRef(false);
  const saveRequestIdRef = useRef(0);
  // Frozen group order per mode. Filled lazily on first render for a mode; cleared by Resort.
  const frozenOrderRef = useRef<Partial<Record<GroupMode, string[]>>>({});
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
            setSheetOpen(false);
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
  const relevanceFilteredSessions = useMemo(
    () =>
      showAllObserved ? sessions : sessions.filter((session) => isRelevantSession(session)),
    [sessions, showAllObserved],
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
  const hiddenObservedSessionCount = sessions.length - relevanceFilteredSessions.length;
  const hiddenEndedSessionCount =
    relevanceFilteredSessions.length - endedFilteredSessions.length;
  const hiddenStaleSessionCount =
    endedFilteredSessions.length - visibleSessions.length;

  const computedGroups = useMemo(
    () => groupSessions(visibleSessions, groupMode),
    [visibleSessions, groupMode],
  );

  const orderedGroups = useMemo(() => {
    if (groupMode === "recency" || groupMode === "flat") {
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

  const draftAutosaveKey = useMemo(() => draftKey(draft), [draft]);

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
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
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
        }
        return false;
      }
    },
    [clearAutosaveTimer, creatingRef, draftRef, selectedIdRef, selectedSessionRef],
  );

  const getExistingDraftPatch = useCallback((): SessionRegistryPatch | null => {
    const currentSelectedSession = selectedSessionRef.current;
    if (creatingRef.current || !currentSelectedSession) {
      return null;
    }
    return buildPatch(currentSelectedSession, draftRef.current);
  }, [creatingRef, draftRef, selectedSessionRef]);

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
      clearAutosaveTimer();
      if (skipUnmountFlushRef.current) {
        skipUnmountFlushRef.current = false;
        return;
      }
      flushDirtyDraftOnExit();
    };
  }, [clearAutosaveTimer, flushDirtyDraftOnExit]);

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

  useEffect(() => {
    if (creating || !sheetOpen || !selectedSession || !getExistingDraftPatch()) {
      return;
    }

    clearAutosaveTimer();
    autosaveTimerRef.current = setTimeout(() => {
      void saveExistingSession();
    }, SESSION_AUTOSAVE_MS);

    return clearAutosaveTimer;
  }, [
    clearAutosaveTimer,
    creating,
    draftAutosaveKey,
    getExistingDraftPatch,
    saveExistingSession,
    selectedSession,
    sheetOpen,
  ]);

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
    setSheetTab("settings"); // only settings is actionable while creating
    setHeaderColorPaletteOpen(false);
    setSheetOpen(true);
  }, [getExistingDraftPatch, saveExistingSession]);

  const closeSheet = useCallback(async () => {
    const currentDraft = draftRef.current;
    const currentPatch = getExistingDraftPatch();
    if (currentPatch) {
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
  }, [creating, draftRef, getExistingDraftPatch, saveExistingSession]);

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

  const detailStatus = creating ? creatingState : saveState;
  const showDetailStatus = detailStatus !== "idle";
  const freezeNote =
    groupMode === "recency"
      ? "Recency buckets — order is semantic"
      : groupMode === "flat"
        ? "No grouping — rows sorted by most recent activity"
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
          disabled={groupMode === "recency" || groupMode === "flat"}
          onClick={handleResort}
          title="Re-sort groups by most recent activity"
        >
          ↻ Resort
        </button>
        <span className="sl-seg-note">{freezeNote}</span>
      </div>

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
                    const rowSessionId = getDisplaySessionId(session);
                    const rowRestartCommand = buildRestartCommand(session);
                    const activityLabel = getActivityStatusLabel(session);
                    const activityHint = activityStatusHint(session.activityStatus);
                    const signalClass = activitySignalClass(session.activityStatus);
                    const signalDetail = trustedStatus ?? observedStatus ?? session.originKind;
                    const rowDetail =
                      summary.text && summary.status !== "missing"
                        ? summary.text
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
                                className={`sl-session-row-dot ${
                                  session.lifecycleStatus === "active" ? "active" : "dim"
                                }`}
                              />
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
                              <span className="sl-session-row-id">
                                <span className="sl-session-row-id-label">id</span>
                                <code>{rowSessionId}</code>
                                <CopyButton
                                  text={rowSessionId}
                                  label={`Copy session ID ${rowSessionId}`}
                                  copiedLabel="Copied session ID"
                                  iconOnly
                                />
                              </span>
                              {rowWorktree && (
                                <span className="sl-session-row-context-chip">
                                  worktree {leafName(rowWorktree)}
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
                          <div className="sl-session-row-path" title={session.cwd}>
                            <span className="sl-session-row-path-label">folder</span>
                            <span className="sl-session-row-path-value">
                              {leafName(rowWorktree ?? session.cwd) ?? session.cwd}
                            </span>
                          </div>
                          <div
                            className={`sl-session-row-status-dock ${signalClass}`}
                            aria-label={`${activityLabel} status`}
                          >
                            <div className="sl-session-row-status-dock-head">
                              <span className={`sl-session-row-signal-label ${signalClass}`}>
                                {activityLabel}
                              </span>
                              <span className="sl-session-row-signal-detail">
                                {signalDetail}
                              </span>
                            </div>
                            <span className="sl-session-row-signal-track" aria-hidden="true">
                              <span className="sl-session-row-signal-pulse" />
                            </span>
                            <div className="sl-session-row-status-dock-foot">
                              <span>{activityHint}</span>
                              <span>{formatTimestamp(session.lastSeenAt)}</span>
                            </div>
                            <CopyButton
                              text={rowRestartCommand ?? ""}
                              label={
                                rowRestartCommand
                                  ? "Copy restart command"
                                  : "Restart unavailable; no Copilot session ID"
                              }
                              copiedLabel="Copied restart command"
                              className="compact sl-session-row-status-dock-action"
                            >
                              {rowRestartCommand ? "Copy restart" : "No restart"}
                            </CopyButton>
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
                        className={`sl-pill ${activityStatusClass(selectedSession.activityStatus)}`}
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
                              setDraft((current) => ({ ...current, color }));
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
                        setDraft((current) => ({ ...current, title: event.target.value }))
                      }
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
                <SessionOverview session={selectedSession} />
              )}

              {sheetTab === "activity" && selectedSession && !creating && (
                <SessionActivity session={selectedSession} />
              )}

              {sheetTab === "settings" && (creating || selectedSession) && (
                <SessionSettingsForm
                  draft={draft}
                  creating={creating}
                  selectedSession={selectedSession}
                  onChange={setDraft}
                  onAutosave={() => {
                    if (!creating) {
                      void saveExistingSession();
                    }
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

interface CopyableValueProps {
  value: string;
  label: string;
}

function CopyableValue({ value, label }: CopyableValueProps) {
  return (
    <span className="sl-copyable-value">
      <code>{value}</code>
      <CopyButton text={value} label={label} copiedLabel="Copied" iconOnly />
    </span>
  );
}

function SessionOverview({ session }: SessionOverviewProps) {
  const summary = getSessionSummaryDisplay(session);
  const latestDescription = getSessionLatestDescription(session, summary);
  const contextBranch = displayBranch(session);
  const contextWorktree = displayWorktree(session);
  const displaySessionId = getDisplaySessionId(session);
  const restartCommand = buildRestartCommand(session);
  return (
    <div className="sl-session-overview">
      <section className="sl-session-overview-section">
        <h3 className="sl-session-overview-heading">Restart</h3>
        <div className="sl-session-quick-actions">
          <CopyButton
            text={restartCommand ?? ""}
            label={
              restartCommand
                ? "Copy restart command"
                : "Restart unavailable; no Copilot session ID"
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
          {restartCommand ?? "No Copilot session ID recorded. Copy the registry ID instead."}
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

interface TerminalColorQuickPickerProps {
  value: string;
  onChange: (color: string) => void;
}

function TerminalColorQuickPicker({ value, onChange }: TerminalColorQuickPickerProps) {
  const normalizedColor = normalizeColor(value);
  return (
    <div className="sl-terminal-color-picker" aria-label="Terminal color quick picks">
      <div className="sl-terminal-color-grid">
        {TERMINAL_COLOR_QUICK_PICKS.map((color) => (
          <button
            key={color}
            type="button"
            className={`sl-terminal-color-btn${
              normalizedColor === color ? " selected" : ""
            }`}
            style={{ backgroundColor: color }}
            aria-label={`Use terminal color ${color}`}
            aria-pressed={normalizedColor === color}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
      <div className="sl-terminal-color-actions">
        <button
          type="button"
          className="sl-terminal-color-action"
          onClick={() => onChange("")}
        >
          Reset
        </button>
        <label className="sl-terminal-color-action custom">
          Custom
          <input
            className="sl-color-picker"
            type="color"
            aria-label="Custom session color"
            value={colorInputValue(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

interface SessionSettingsFormProps {
  draft: SessionDraft;
  creating: boolean;
  selectedSession: SessionRegistryListItem | null;
  onChange: (updater: (current: SessionDraft) => SessionDraft) => void;
  onAutosave: () => void;
}

function SessionSettingsForm({
  draft,
  creating,
  selectedSession,
  onChange,
  onAutosave,
}: SessionSettingsFormProps) {
  const lifecycleLocked = selectedSession?.lifecycleStatus === "ended";
  const setColor = (color: string) => {
    onChange((current) => ({ ...current, color }));
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
          onBlur={onAutosave}
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
          onBlur={onAutosave}
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
              onBlur={onAutosave}
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
            onBlur={onAutosave}
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
          onBlur={onAutosave}
          placeholder="paw-lite, ui, session-registry"
        />
      </label>
    </div>
  );
}
