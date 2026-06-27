import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { basenameCrossOs } from "../cross-os-path";
import type { SessionRegistryListItem, SessionRegistryObservedLinkInput } from "../session-registry-contract";
import type { SessionRegistryObservedLifecycleStatus } from "../session-registry-contract";
import type {
  SessionRegistryCopilotProcessState,
  SessionRegistryObservedSessionKind,
} from "../session-registry-schema";
import {
  isCopilotCliSubagentSessionId,
  isCopilotHelperSessionIdentity,
} from "./copilot-helper-sessions";
import { isCopilotSdkSessionFsPath } from "./copilot-sdk-session-paths";
import { SessionRegistryFileStore } from "./file-store";

const DEFAULT_COPILOT_SESSION_STATE_ROOT = resolve(
  homedir(),
  ".copilot",
  "session-state",
);

export interface DiscoveredCopilotSession {
  sessionId: string;
  title: string;
  description: string;
  cwd: string;
  repo: string | null;
  branch: string | null;
  lastSeenAt: string | null;
  lifecycleStatus: SessionRegistryObservedLifecycleStatus;
  observedSessionKind: SessionRegistryObservedSessionKind;
  copilotProcessState: SessionRegistryCopilotProcessState;
  copilotProcessId: number | null;
}

export interface CopilotSessionDiscoveryBatch {
  sessions: DiscoveredCopilotSession[];
  nextStartIndex: number;
  totalDirectories: number;
}

interface CopilotProcessObservation {
  state: SessionRegistryCopilotProcessState;
  processId: number | null;
  signature: string;
}

const SUMMARIZER_PROMPT_MARKER =
  "Based on the user's recent messages below, produce the summary phrase now.";

const ignoredObservedCopilotSessionIds = new Set<string>();

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function getDefaultCopilotSessionStateRoot(): string {
  return resolve(
    process.env.STREAMLINER_COPILOT_SESSION_STATE_ROOT ??
      DEFAULT_COPILOT_SESSION_STATE_ROOT,
  );
}

export function parseWorkspaceYaml(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  let blockKey: string | null = null;
  let blockIndent = 0;
  let blockLines: string[] = [];

  const flushBlock = () => {
    if (!blockKey) {
      return;
    }
    parsed[blockKey] = blockLines.join("\n").trim();
    blockKey = null;
    blockIndent = 0;
    blockLines = [];
  };

  for (const line of lines) {
    if (blockKey) {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (line.trim().length === 0) {
        blockLines.push("");
        continue;
      }
      if (indent > blockIndent) {
        blockLines.push(line.slice(blockIndent + 1));
        continue;
      }
      flushBlock();
    }

    const match = line.match(/^(\w[\w_]*?):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (value === "|" || value === "|-" || value === ">" || value === ">-") {
      blockKey = key;
      blockIndent = line.match(/^\s*/)?.[0].length ?? 0;
      blockLines = [];
      continue;
    }
    parsed[key] = stripQuotes(value);
  }

  flushBlock();
  return parsed;
}

function normalizeSummary(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "|" || trimmed === "|-" || trimmed === ">" || trimmed === ">-") {
    return null;
  }
  return trimmed;
}

function normalizeSessionName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "|" || trimmed === "|-" || trimmed === ">" || trimmed === ">-") {
    return null;
  }
  return trimmed;
}

function deriveTitle(
  sessionId: string,
  name: string | null,
  summary: string | null,
  cwd: string,
  repo: string | null,
  observedSessionKind: SessionRegistryObservedSessionKind,
): string {
  if (name && observedSessionKind !== "helper") {
    return name;
  }
  if (summary && observedSessionKind !== "helper") {
    return summary;
  }
  if (repo) {
    const repoName = repo.split("/").at(-1)?.trim();
    if (repoName) {
      return observedSessionKind === "helper" ? `${repoName} helper session` : repoName;
    }
  }
  const cwdName = basenameCrossOs(cwd).trim();
  if (cwdName.length > 0) {
    return observedSessionKind === "helper" ? `${cwdName} helper session` : cwdName;
  }
  return observedSessionKind === "helper" ? "AI helper session" : sessionId;
}

function deriveDescription(
  repo: string | null,
  branch: string | null,
  cwd: string,
  observedSessionKind: SessionRegistryObservedSessionKind,
): string {
  if (observedSessionKind === "helper") {
    const repoBranch =
      repo && branch ? `${repo} · ${branch}` : repo ? repo : branch ? branch : cwd;
    return `AI summary helper · ${repoBranch}`;
  }
  if (repo && branch) {
    return `${repo} · ${branch}`;
  }
  if (repo) {
    return repo;
  }
  return cwd;
}

function isInUseLockFile(fileName: string): boolean {
  return /^inuse\..+\.lock$/i.test(fileName);
}

interface DiscoveryCacheEntry {
  workspaceMtimeMs: number;
  lockSignature: string;
  processSignature: string;
  ignoredBySessionId: boolean;
  session: DiscoveredCopilotSession;
}

// Per-directory cache keyed by absolute directory path. Entries are reused when
// the workspace.yaml mtime and in-use lock-file signature are unchanged, which
// keeps scans cheap even when ~/.copilot/session-state contains thousands of
// historical sessions.
const discoveryCache = new Map<string, DiscoveryCacheEntry>();

export function __resetCopilotDiscoveryCacheForTests(): void {
  discoveryCache.clear();
  ignoredObservedCopilotSessionIds.clear();
  lastSyncAtMs = 0;
}

export function rememberIgnoredObservedCopilotSessionId(sessionId: string): void {
  const trimmed = sessionId.trim();
  if (trimmed.length > 0) {
    ignoredObservedCopilotSessionIds.add(trimmed);
  }
}

function computeLockSignature(directoryEntries: string[]): string {
  return directoryEntries.filter(isInUseLockFile).sort().join("|");
}

function extractLockPids(directoryEntries: string[]): number[] {
  const pids: number[] = [];
  for (const entry of directoryEntries) {
    const match = entry.match(/^inuse\.(\d+)\.lock$/i);
    if (!match) {
      continue;
    }
    const pid = Number.parseInt(match[1], 10);
    if (Number.isInteger(pid) && pid > 0) {
      pids.push(pid);
    }
  }
  return [...new Set(pids)].sort((left, right) => left - right);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

function observeCopilotProcess(directoryEntries: string[]): CopilotProcessObservation {
  const lockPids = extractLockPids(directoryEntries);
  const livePids = lockPids.filter(processExists);
  if (livePids.length > 0) {
    return {
      state: "live",
      processId: livePids[0],
      signature: `live:${livePids.join(",")}`,
    };
  }
  if (lockPids.length > 0) {
    return {
      state: "stale_lock",
      processId: null,
      signature: `stale:${lockPids.join(",")}`,
    };
  }
  return {
    state: "none",
    processId: null,
    signature: "none",
  };
}

function isSummarizerPromptSummary(summary: string | null): boolean {
  if (!summary) {
    return false;
  }
  return (
    summary.includes(SUMMARIZER_PROMPT_MARKER) &&
    summary.includes("--- User turn") &&
    summary.includes("Repo:")
  );
}

function looksLikeSummarizerPromptTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.startsWith("Repo:") &&
    trimmed.includes("Cwd:") &&
    trimmed.includes("Existing title:")
  );
}

function classifyObservedSessionKind(
  sessionId: string,
  summary: string | null,
  cwd: string,
): SessionRegistryObservedSessionKind {
  if (
    ignoredObservedCopilotSessionIds.has(sessionId) ||
    isCopilotCliSubagentSessionId(sessionId) ||
    isCopilotSdkSessionFsPath(cwd) ||
    isSummarizerPromptSummary(summary)
  ) {
    return "helper";
  }
  return "interactive";
}

function isHelperLikeObservedRegistrySession(
  session: SessionRegistryListItem,
): boolean {
  return (
    session.originKind === "observed" &&
    (session.observedSessionKind === "helper" ||
      isCopilotHelperSessionIdentity({
        sessionId: session.copilotSessionId ?? session.id,
        cwd: session.cwd,
      }) ||
      looksLikeSummarizerPromptTitle(session.title) ||
      session.description.startsWith("AI summary helper ·"))
  );
}

function discoverSessionFromDirectory(
  sessionRoot: string,
  directoryName: string,
): DiscoveredCopilotSession | null {
  const directoryPath = join(sessionRoot, directoryName);
  const workspacePath = join(directoryPath, "workspace.yaml");
  if (!existsSync(workspacePath)) {
    return null;
  }

  const workspaceStat = statSync(workspacePath);
  const directoryEntries = readdirSync(directoryPath);
  const lockSignature = computeLockSignature(directoryEntries);
  const processObservation = observeCopilotProcess(directoryEntries);
  const ignoredBySessionId = ignoredObservedCopilotSessionIds.has(directoryName);
  const cached = discoveryCache.get(directoryPath);
  if (
    cached &&
    cached.workspaceMtimeMs === workspaceStat.mtimeMs &&
    cached.lockSignature === lockSignature &&
    cached.processSignature === processObservation.signature &&
    cached.ignoredBySessionId === ignoredBySessionId
  ) {
    return cached.session;
  }

  const workspace = parseWorkspaceYaml(readFileSync(workspacePath, "utf8"));
  const sessionId = workspace.id?.trim() || directoryName;
  const cwd = workspace.cwd?.trim();
  if (!cwd) {
    return null;
  }

  const repo = workspace.repository?.trim() || null;
  const branch = workspace.branch?.trim() || null;
  const name = normalizeSessionName(workspace.name);
  const summary = normalizeSummary(workspace.summary);
  const observedSessionKind = classifyObservedSessionKind(sessionId, summary, cwd);
  const lastSeenAt = workspace.updated_at?.trim() || workspaceStat.mtime.toISOString();
  const lifecycleStatus: SessionRegistryObservedLifecycleStatus =
    processObservation.state === "live" ? "active" : "ended";

  const session: DiscoveredCopilotSession = {
    sessionId,
    title: deriveTitle(sessionId, name, summary, cwd, repo, observedSessionKind),
    description: deriveDescription(repo, branch, cwd, observedSessionKind),
    cwd,
    repo,
    branch,
    lastSeenAt,
    lifecycleStatus,
    observedSessionKind,
    copilotProcessState: processObservation.state,
    copilotProcessId: processObservation.processId,
  };

  discoveryCache.set(directoryPath, {
    workspaceMtimeMs: workspaceStat.mtimeMs,
    lockSignature,
    processSignature: processObservation.signature,
    ignoredBySessionId,
    session,
  });

  return session;
}

export function discoverCopilotSessions(
  sessionRoot: string = getDefaultCopilotSessionStateRoot(),
): DiscoveredCopilotSession[] {
  if (!existsSync(sessionRoot)) {
    discoveryCache.clear();
    return [];
  }

  const entries = readdirSync(sessionRoot, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  );
  const visitedDirectories = new Set<string>();
  const discovered: DiscoveredCopilotSession[] = [];
  for (const entry of entries) {
    visitedDirectories.add(join(sessionRoot, entry.name));
    const session = discoverSessionFromDirectory(sessionRoot, entry.name);
    if (session) {
      discovered.push(session);
    }
  }

  // Evict cache entries for directories that no longer exist under sessionRoot.
  for (const cachedPath of [...discoveryCache.keys()]) {
    if (!visitedDirectories.has(cachedPath)) {
      discoveryCache.delete(cachedPath);
    }
  }

  discovered.sort((left, right) => {
    const leftSeen = left.lastSeenAt ? Date.parse(left.lastSeenAt) : Number.NEGATIVE_INFINITY;
    const rightSeen = right.lastSeenAt ? Date.parse(right.lastSeenAt) : Number.NEGATIVE_INFINITY;
    return rightSeen - leftSeen;
  });
  return discovered;
}

export function discoverCopilotSessionsBatch(
  sessionRoot: string = getDefaultCopilotSessionStateRoot(),
  options: {
    startIndex?: number;
    maxDirectories?: number;
  } = {},
): CopilotSessionDiscoveryBatch {
  if (!existsSync(sessionRoot)) {
    discoveryCache.clear();
    return { sessions: [], nextStartIndex: 0, totalDirectories: 0 };
  }

  const entries = readdirSync(sessionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const totalDirectories = entries.length;
  if (totalDirectories === 0) {
    return { sessions: [], nextStartIndex: 0, totalDirectories };
  }

  const maxDirectories = Math.max(
    1,
    Math.min(options.maxDirectories ?? totalDirectories, totalDirectories),
  );
  const startIndex = Math.max(0, options.startIndex ?? 0) % totalDirectories;
  const sessions: DiscoveredCopilotSession[] = [];

  for (let offset = 0; offset < maxDirectories; offset += 1) {
    const entry = entries[(startIndex + offset) % totalDirectories];
    const session = discoverSessionFromDirectory(sessionRoot, entry.name);
    if (session) {
      sessions.push(session);
    }
  }

  sessions.sort((left, right) => {
    const leftSeen = left.lastSeenAt ? Date.parse(left.lastSeenAt) : Number.NEGATIVE_INFINITY;
    const rightSeen = right.lastSeenAt ? Date.parse(right.lastSeenAt) : Number.NEGATIVE_INFINITY;
    return rightSeen - leftSeen;
  });

  return {
    sessions,
    nextStartIndex: (startIndex + maxDirectories) % totalDirectories,
    totalDirectories,
  };
}

function observationMatches(
  session: SessionRegistryListItem,
  discovered: DiscoveredCopilotSession,
): boolean {
  const lifecycleStatus = getObservedLifecycleForRegistry(session, discovered);
  const titleMatches =
    session.titleSource !== "auto" || session.title === discovered.title;
  return (
    titleMatches &&
    session.cwd === discovered.cwd &&
    session.repo === discovered.repo &&
    session.branch === discovered.branch &&
    session.lastSeenAt === discovered.lastSeenAt &&
    session.lifecycleStatus === lifecycleStatus &&
    session.observedSessionKind === discovered.observedSessionKind &&
    session.copilotProcessState === discovered.copilotProcessState &&
    session.copilotProcessId === discovered.copilotProcessId
  );
}

function getObservedLifecycleForRegistry(
  session: SessionRegistryListItem,
  discovered: DiscoveredCopilotSession,
): SessionRegistryObservedLifecycleStatus {
  // A trusted session.ended signal is the source of truth: even if the OS
  // process is still detected as running, the user-facing session has ended
  // (e.g. the user typed /exit). Surfacing "active" in that window would
  // contradict the trustedEndedAt signal already in the registry.
  if (session.trustedEndedAt) {
    return "ended";
  }
  if (
    session.trustedStartedAt &&
    !session.trustedEndedAt &&
    discovered.copilotProcessState !== "live"
  ) {
    return "active";
  }
  return discovered.lifecycleStatus;
}

function isRegistryLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("locked");
}

function isRegistryNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("does not exist");
}

export function syncDiscoveredCopilotSessions(
  store: SessionRegistryFileStore,
  sessionRoot: string = getDefaultCopilotSessionStateRoot(),
  precomputed?: ReadonlyArray<DiscoveredCopilotSession>,
): number {
  const existingSessions = store.listSessions({ includeArchived: true });
  const existingByCopilotSessionId = new Map<string, SessionRegistryListItem>();
  let changes = 0;
  for (const session of existingSessions) {
    if (isHelperLikeObservedRegistrySession(session)) {
      try {
        store.deleteSession(session.id);
        changes += 1;
      } catch (error: unknown) {
        if (isRegistryLockedError(error)) {
          return changes;
        }
        if (isRegistryNotFoundError(error)) {
          continue;
        }
        throw error;
      }
      continue;
    }
    if (session.copilotSessionId) {
      existingByCopilotSessionId.set(session.copilotSessionId, session);
    }
  }

  const discovered = (precomputed ?? discoverCopilotSessions(sessionRoot)).filter(
    (session) => session.observedSessionKind !== "helper",
  );
  if (discovered.length === 0) {
    return changes;
  }

  for (const observed of discovered) {
    const existing = existingByCopilotSessionId.get(observed.sessionId);
    try {
      if (existing) {
        if (
          existing.lifecycleStatus === "archived" ||
          observationMatches(existing, observed)
        ) {
          continue;
        }

        const link: SessionRegistryObservedLinkInput = {
          copilotSessionId: observed.sessionId,
          title: observed.title,
          cwd: observed.cwd,
          repo: observed.repo,
          branch: observed.branch,
          lastSeenAt: observed.lastSeenAt,
          lifecycleStatus: getObservedLifecycleForRegistry(existing, observed),
          observedSessionKind: observed.observedSessionKind,
          copilotProcessState: observed.copilotProcessState,
          copilotProcessId: observed.copilotProcessId,
        };
        store.attachObservedSession(existing.id, link);
        changes += 1;
        continue;
      }

      store.upsertSession({
        id: observed.sessionId,
        title: observed.title,
        description: observed.description,
        cwd: observed.cwd,
        repo: observed.repo,
        branch: observed.branch,
        copilotSessionId: observed.sessionId,
        lastSeenAt: observed.lastSeenAt,
        lifecycleStatus: observed.lifecycleStatus,
        observedSessionKind: observed.observedSessionKind,
        copilotProcessState: observed.copilotProcessState,
        copilotProcessId: observed.copilotProcessId,
        origin: {
          kind: "observed",
          importedFromCopilotSessionId: observed.sessionId,
        },
      });
      changes += 1;
    } catch (error: unknown) {
      if (isRegistryLockedError(error)) {
        return changes;
      }
      if (isRegistryNotFoundError(error)) {
        continue;
      }
      throw error;
    }
  }

  return changes;
}

// Module-level debounce timestamp used by maybeSyncDiscoveredCopilotSessions.
let lastSyncAtMs = 0;

export const COPILOT_SYNC_DEBOUNCE_MS = 5000;

// Returns true if a sync ran. Callers can pass { force: true } to bypass the
// debounce (e.g., on explicit user refresh actions in the future).
export function maybeSyncDiscoveredCopilotSessions(
  store: SessionRegistryFileStore,
  options: {
    sessionRoot?: string;
    debounceMs?: number;
    force?: boolean;
    now?: () => number;
  } = {},
): boolean {
  const now = options.now ?? (() => Date.now());
  const debounceMs = options.debounceMs ?? COPILOT_SYNC_DEBOUNCE_MS;
  const nowMs = now();
  if (!options.force && nowMs - lastSyncAtMs < debounceMs) {
    return false;
  }
  lastSyncAtMs = nowMs;
  syncDiscoveredCopilotSessions(store, options.sessionRoot);
  return true;
}
