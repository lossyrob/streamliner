import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname, normalize } from "node:path";
import { spawnSync } from "node:child_process";

import type { SessionRegistryListItem } from "../session-registry-contract";
import type { SessionRegistryGithubRef } from "../session-registry-schema";
import type { SessionRegistryDerivedStatePatch } from "./file-store";

export const SESSION_CONTEXT_INDEX_MAX_BYTES_PER_CYCLE = 1024 * 1024;
export const SESSION_CONTEXT_INDEX_MAX_OVERSIZED_RECORD_SKIP_BYTES = 16 * 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 5000;

interface SessionContextIndexOptions {
  maxBytesPerCycle?: number;
  now?: () => Date;
}

interface RawEventLine {
  timestamp?: string;
  type?: string;
  tool_start_name?: string;
  toolStartName?: string;
  name?: string;
  arguments_json?: string;
  arguments?: unknown;
  data?: unknown;
}

interface ExtractedContext {
  refs: SessionRegistryGithubRef[];
  candidatePaths: string[];
}

interface GitContext {
  worktreePath: string;
  branch: string | null;
  repo: string | null;
}

function readRange(path: string, start: number, length: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function findNextNewlineOffset(
  path: string,
  start: number,
  fileSize: number,
  maxSkipBytes: number,
): number | null {
  let cursor = start;
  let remaining = Math.min(maxSkipBytes, Math.max(0, fileSize - start));
  while (remaining > 0) {
    const chunk = readRange(path, cursor, Math.min(64 * 1024, remaining));
    if (chunk.length === 0) {
      return null;
    }
    const newlineIndex = chunk.indexOf(0x0a);
    if (newlineIndex >= 0) {
      return cursor + newlineIndex + 1;
    }
    cursor += chunk.length;
    remaining -= chunk.length;
  }
  return null;
}

function collectStringValues(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 5 || output.length > 200) {
    return output;
  }
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, output, depth + 1);
    }
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStringValues(item, output, depth + 1);
    }
  }
  return output;
}

function eventTimestamp(event: RawEventLine | null): string | null {
  return typeof event?.timestamp === "string" ? event.timestamp : null;
}

function normalizeRepo(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^[\w.-]+\/[\w.-]+$/.test(trimmed) ? trimmed : null;
}

function normalizeGithubUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function repoFromGitRemote(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\.git$/, "");
  const githubUrlMatch = trimmed.match(
    /^https?:\/\/(?:[^/@]+@)?github\.com\/([\w.-]+)\/([\w.-]+)$/i,
  );
  if (githubUrlMatch) {
    return normalizeRepo(`${githubUrlMatch[1]}/${githubUrlMatch[2]}`);
  }

  const githubSshMatch = trimmed.match(
    /^(?:ssh:\/\/)?git@github\.com(?:-[\w.-]+)?[:/]([\w.-]+)\/([\w.-]+)$/i,
  );
  if (githubSshMatch) {
    return normalizeRepo(`${githubSshMatch[1]}/${githubSshMatch[2]}`);
  }

  return null;
}

function refSource(text: string, event: RawEventLine | null): string {
  const toolName = [event?.tool_start_name, event?.toolStartName, event?.name]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (/github-mcp-server|pull_request|issue_read|github/i.test(toolName)) {
    return "github-mcp";
  }
  if (/\bgh\s+(?:pr|issue)\b/i.test(text)) {
    return "gh";
  }
  if (/github\.com/i.test(text)) {
    return "url";
  }
  return event?.type === "user.message" ? "user" : "event";
}

function pushRef(
  refs: SessionRegistryGithubRef[],
  ref: Omit<SessionRegistryGithubRef, "source"> & { source?: string },
): void {
  if (!Number.isInteger(ref.number) || ref.number < 1) {
    return;
  }
  refs.push({
    ...ref,
    source: ref.source ?? "event",
  });
}

function extractGithubRefs(
  text: string,
  event: RawEventLine | null,
  defaultRepo: string | null,
): SessionRegistryGithubRef[] {
  const refs: SessionRegistryGithubRef[] = [];
  const timestamp = eventTimestamp(event);
  const source = refSource(text, event);

  for (const match of text.matchAll(
    /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)/gi,
  )) {
    const repo = `${match[1]}/${match[2]}`;
    pushRef(refs, {
      type: match[3].toLowerCase() === "pull" ? "pr" : "issue",
      repo,
      number: Number.parseInt(match[4], 10),
      url: normalizeGithubUrl(match[0]),
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      source,
    });
  }

  for (const match of text.matchAll(/(?<![\w.-])([\w.-]+\/[\w.-]+)#(\d+)\b/g)) {
    pushRef(refs, {
      type: "unknown",
      repo: normalizeRepo(match[1]),
      number: Number.parseInt(match[2], 10),
      url: null,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      source,
    });
  }

  for (const match of text.matchAll(/\bgh\s+pr\s+(?:view|checkout|edit|close|merge)\s+(\d+)\b/gi)) {
    pushRef(refs, {
      type: "pr",
      repo: defaultRepo,
      number: Number.parseInt(match[1], 10),
      url: null,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      source: "gh",
    });
  }

  for (const match of text.matchAll(/\bgh\s+issue\s+(?:view|develop|edit|close)\s+(\d+)\b/gi)) {
    pushRef(refs, {
      type: "issue",
      repo: defaultRepo,
      number: Number.parseInt(match[1], 10),
      url: null,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      source: "gh",
    });
  }

  const looksLikePullRequestTool = /pull_request|pullNumber/i.test(text);
  if (looksLikePullRequestTool) {
    for (const match of text.matchAll(/"pullNumber"\s*:\s*(\d+)/g)) {
      const repo = repoFromJsonToolText(text) ?? defaultRepo;
      pushRef(refs, {
        type: "pr",
        repo,
        number: Number.parseInt(match[1], 10),
        url: null,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        source: "github-mcp",
      });
    }
  }

  const looksLikeIssueTool = /issue_read|issue_number/i.test(text);
  if (looksLikeIssueTool) {
    for (const match of text.matchAll(/"issue_number"\s*:\s*(\d+)/g)) {
      const repo = repoFromJsonToolText(text) ?? defaultRepo;
      pushRef(refs, {
        type: "issue",
        repo,
        number: Number.parseInt(match[1], 10),
        url: null,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        source: "github-mcp",
      });
    }
  }

  return refs;
}

function repoFromJsonToolText(text: string): string | null {
  const owner = text.match(/"owner"\s*:\s*"([^"]+)"/)?.[1];
  const repo = text.match(/"repo"\s*:\s*"([^"]+)"/)?.[1];
  return owner && repo ? normalizeRepo(`${owner}/${repo}`) : null;
}

function extractCandidatePaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(/\b[A-Za-z]:(?:\\|\/)[^"'`<>\r\n]+/g)) {
    paths.push(match[0].replace(/[),.;\]\s]+$/g, ""));
  }
  for (const match of text.matchAll(/\bgit\s+-C\s+["']?([^"'\s]+)["']?/gi)) {
    paths.push(match[1].replace(/[),.;\]\s]+$/g, ""));
  }
  return paths;
}

function extractContextFromLine(
  line: string,
  defaultRepo: string | null,
): ExtractedContext {
  let event: RawEventLine | null = null;
  const strings: string[] = [line];
  try {
    event = JSON.parse(line) as RawEventLine;
    strings.push(...collectStringValues(event));
    if (typeof event.arguments_json === "string") {
      strings.push(event.arguments_json);
    }
  } catch {
    event = null;
  }

  const text = strings.join("\n");
  return {
    refs: extractGithubRefs(text, event, defaultRepo),
    candidatePaths: extractCandidatePaths(text),
  };
}

function refKey(ref: SessionRegistryGithubRef): string {
  return `${ref.type}:${ref.repo ?? ""}:${ref.number}`;
}

function mergeRefs(
  existingRefs: readonly SessionRegistryGithubRef[],
  nextRefs: readonly SessionRegistryGithubRef[],
): SessionRegistryGithubRef[] {
  const merged = new Map<string, SessionRegistryGithubRef>();
  for (const ref of existingRefs) {
    merged.set(refKey(ref), { ...ref });
  }
  for (const ref of nextRefs) {
    const key = refKey(ref);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...ref });
      continue;
    }
    merged.set(key, {
      ...current,
      type: current.type === "unknown" ? ref.type : current.type,
      repo: current.repo ?? ref.repo,
      url: current.url ?? ref.url,
      firstSeenAt: earliestTimestamp(current.firstSeenAt, ref.firstSeenAt),
      lastSeenAt: latestTimestamp(current.lastSeenAt, ref.lastSeenAt),
      source: current.source === ref.source ? current.source : `${current.source},${ref.source}`,
    });
  }
  return [...merged.values()].sort((left, right) => {
    const leftTs = Date.parse(left.lastSeenAt ?? left.firstSeenAt ?? "");
    const rightTs = Date.parse(right.lastSeenAt ?? right.firstSeenAt ?? "");
    return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
  });
}

function earliestTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function latestTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function resolveExistingPath(candidate: string): string | null {
  let current = normalize(candidate);
  for (let attempts = 0; attempts < 4; attempts += 1) {
    if (existsSync(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

function runGit(cwd: string, args: string[]): string | null {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: GIT_COMMAND_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.status === 0) {
      const output = result.stdout.trim();
      return output.length > 0 ? output : null;
    }
    if (!result.error && !result.signal) {
      return null;
    }
  }
  return null;
}

function resolveGitBranch(gitCwd: string): string | null {
  return (
    runGit(gitCwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ??
    runGit(gitCwd, ["branch", "--show-current"]) ??
    runGit(gitCwd, ["rev-parse", "--abbrev-ref", "HEAD"])
  );
}

function resolveGitContext(candidatePaths: readonly string[]): GitContext | null {
  const seen = new Set<string>();
  for (const candidate of candidatePaths) {
    const existingPath = resolveExistingPath(candidate);
    if (!existingPath || seen.has(existingPath)) {
      continue;
    }
    seen.add(existingPath);
    const gitCwd = statSync(existingPath).isDirectory() ? existingPath : dirname(existingPath);
    const worktreePath = runGit(gitCwd, ["rev-parse", "--show-toplevel"]);
    if (!worktreePath) {
      continue;
    }
    const branch = resolveGitBranch(gitCwd);
    const repo = repoFromGitRemote(runGit(gitCwd, ["remote", "get-url", "origin"]));
    return {
      worktreePath,
      branch: branch && branch !== "HEAD" ? branch : null,
      repo,
    };
  }
  return null;
}

function patchChanged(
  session: SessionRegistryListItem,
  patch: SessionRegistryDerivedStatePatch,
): boolean {
  return (
    patch.derivedContextEventsOffset !== session.derivedContextEventsOffset ||
    patch.derivedContextEventsSize !== session.derivedContextEventsSize ||
    patch.derivedContextEventsMtimeMs !== session.derivedContextEventsMtimeMs ||
    patch.repo !== session.repo ||
    patch.branch !== session.branch ||
    patch.derivedWorktreePath !== session.derivedWorktreePath ||
    patch.derivedBranch !== session.derivedBranch ||
    JSON.stringify(patch.derivedGithubRefs ?? []) !==
      JSON.stringify(session.derivedGithubRefs)
  );
}

export function indexSessionContext(
  session: SessionRegistryListItem,
  eventsPath: string,
  options: SessionContextIndexOptions = {},
): SessionRegistryDerivedStatePatch | null {
  if (!existsSync(eventsPath)) {
    return null;
  }

  const stat = statSync(eventsPath);
  const needsGitBackfill =
    session.derivedWorktreePath !== null &&
    (session.repo === null || session.branch === null || session.derivedBranch === null);
  if (
    session.derivedContextEventsOffset === stat.size &&
    session.derivedContextEventsSize === stat.size &&
    session.derivedContextEventsMtimeMs === stat.mtimeMs &&
    !needsGitBackfill
  ) {
    return null;
  }

  const maxBytes = options.maxBytesPerCycle ?? SESSION_CONTEXT_INDEX_MAX_BYTES_PER_CYCLE;
  const startOffset =
    session.derivedContextEventsOffset > stat.size ? 0 : session.derivedContextEventsOffset;
  const bytesToRead = Math.min(maxBytes, stat.size - startOffset);
  const defaultRepo = normalizeRepo(session.repo);
  const refs: SessionRegistryGithubRef[] = [];
  const candidatePaths = [
    ...(session.derivedWorktreePath ? [session.derivedWorktreePath] : []),
    session.cwd,
  ];
  let nextOffset = startOffset;

  if (bytesToRead > 0) {
    const buffer = readRange(eventsPath, startOffset, bytesToRead);
    const atEnd = startOffset + buffer.length >= stat.size;
    let text = buffer.toString("utf8");
    if (!atEnd) {
      const lastNewline = text.lastIndexOf("\n");
      if (lastNewline < 0) {
        text = "";
        nextOffset =
          findNextNewlineOffset(
            eventsPath,
            startOffset + buffer.length,
            stat.size,
            SESSION_CONTEXT_INDEX_MAX_OVERSIZED_RECORD_SKIP_BYTES,
          ) ?? Math.min(stat.size, startOffset + buffer.length);
      } else {
        text = text.slice(0, lastNewline + 1);
        nextOffset = startOffset + Buffer.byteLength(text, "utf8");
      }
    } else {
      nextOffset = startOffset + Buffer.byteLength(text, "utf8");
    }

    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length === 0) {
        continue;
      }
      const extracted = extractContextFromLine(line, defaultRepo);
      refs.push(...extracted.refs);
      candidatePaths.push(...extracted.candidatePaths);
    }
  }

  const gitContext = resolveGitContext(candidatePaths);
  const patch: SessionRegistryDerivedStatePatch = {
    repo: gitContext?.repo ?? session.repo,
    branch: gitContext?.branch ?? session.branch,
    derivedWorktreePath: gitContext?.worktreePath ?? session.derivedWorktreePath,
    derivedBranch: gitContext?.branch ?? session.derivedBranch,
    derivedGithubRefs: mergeRefs(session.derivedGithubRefs, refs),
    derivedContextEventsOffset: nextOffset,
    derivedContextEventsSize: stat.size,
    derivedContextEventsMtimeMs: stat.mtimeMs,
  };

  if (!patchChanged(session, patch)) {
    return null;
  }

  return {
    ...patch,
    derivedContextUpdatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}
