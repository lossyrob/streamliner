import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import type { SessionRegistryListItem, SessionRegistryObservedLinkInput } from "../session-registry-contract";
import type { SessionRegistryObservedLifecycleStatus } from "../session-registry-contract";
import { SessionRegistryFileStore } from "./file-store";

const DEFAULT_COPILOT_SESSION_STATE_ROOT = resolve(
  homedir(),
  ".copilot",
  "session-state",
);

interface DiscoveredCopilotSession {
  sessionId: string;
  title: string;
  description: string;
  cwd: string;
  repo: string | null;
  branch: string | null;
  lastSeenAt: string | null;
  lifecycleStatus: SessionRegistryObservedLifecycleStatus;
}

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

function deriveTitle(
  sessionId: string,
  summary: string | null,
  cwd: string,
  repo: string | null,
): string {
  if (summary) {
    return summary;
  }
  if (repo) {
    const repoName = repo.split("/").at(-1)?.trim();
    if (repoName) {
      return repoName;
    }
  }
  const cwdName = basename(cwd).trim();
  return cwdName.length > 0 ? cwdName : sessionId;
}

function deriveDescription(
  repo: string | null,
  branch: string | null,
  cwd: string,
): string {
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

function discoverSessionFromDirectory(
  sessionRoot: string,
  directoryName: string,
): DiscoveredCopilotSession | null {
  const directoryPath = join(sessionRoot, directoryName);
  const workspacePath = join(directoryPath, "workspace.yaml");
  if (!existsSync(workspacePath)) {
    return null;
  }

  const workspace = parseWorkspaceYaml(readFileSync(workspacePath, "utf8"));
  const sessionId = workspace.id?.trim() || directoryName;
  const cwd = workspace.cwd?.trim();
  if (!cwd) {
    return null;
  }

  const repo = workspace.repository?.trim() || null;
  const branch = workspace.branch?.trim() || null;
  const summary = normalizeSummary(workspace.summary);
  const lastSeenAt = workspace.updated_at?.trim() || statSync(workspacePath).mtime.toISOString();
  const lifecycleStatus: SessionRegistryObservedLifecycleStatus = readdirSync(directoryPath).some(
    isInUseLockFile,
  )
    ? "active"
    : "ended";

  return {
    sessionId,
    title: deriveTitle(sessionId, summary, cwd, repo),
    description: deriveDescription(repo, branch, cwd),
    cwd,
    repo,
    branch,
    lastSeenAt,
    lifecycleStatus,
  };
}

export function discoverCopilotSessions(
  sessionRoot: string = getDefaultCopilotSessionStateRoot(),
): DiscoveredCopilotSession[] {
  if (!existsSync(sessionRoot)) {
    return [];
  }

  const discovered = readdirSync(sessionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => discoverSessionFromDirectory(sessionRoot, entry.name))
    .filter((entry): entry is DiscoveredCopilotSession => entry !== null);

  discovered.sort((left, right) => {
    const leftSeen = left.lastSeenAt ? Date.parse(left.lastSeenAt) : Number.NEGATIVE_INFINITY;
    const rightSeen = right.lastSeenAt ? Date.parse(right.lastSeenAt) : Number.NEGATIVE_INFINITY;
    return rightSeen - leftSeen;
  });
  return discovered;
}

function observationMatches(
  session: SessionRegistryListItem,
  discovered: DiscoveredCopilotSession,
): boolean {
  return (
    session.cwd === discovered.cwd &&
    session.repo === discovered.repo &&
    session.branch === discovered.branch &&
    session.lastSeenAt === discovered.lastSeenAt &&
    session.lifecycleStatus === discovered.lifecycleStatus
  );
}

function isRegistryLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("locked");
}

export function syncDiscoveredCopilotSessions(
  store: SessionRegistryFileStore,
  sessionRoot: string = getDefaultCopilotSessionStateRoot(),
): number {
  const discovered = discoverCopilotSessions(sessionRoot);
  if (discovered.length === 0) {
    return 0;
  }

  const existingSessions = store.listSessions({ includeArchived: true });
  const existingByCopilotSessionId = new Map<string, SessionRegistryListItem>();
  for (const session of existingSessions) {
    if (session.copilotSessionId) {
      existingByCopilotSessionId.set(session.copilotSessionId, session);
    }
  }

  let changes = 0;
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
          cwd: observed.cwd,
          repo: observed.repo,
          branch: observed.branch,
          lastSeenAt: observed.lastSeenAt,
          ...(observed.lifecycleStatus === "ended"
            ? { lifecycleStatus: "ended" as const }
            : {}),
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
      throw error;
    }
  }

  return changes;
}
