import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { SessionRegistryListItem } from "../session-registry-contract";
import type {
  SessionRegistryRecord,
  SessionRegistryRuntimeEvidence,
} from "../session-registry-schema";

export const MANAGED_CLEANUP_BLOCKER_CODES = [
  "missing-runtime",
  "missing-graph-binding",
  "missing-worktree",
  "worktree-missing",
  "worktree-not-registered",
  "current-worktree",
  "missing-branch",
  "branch-mismatch",
  "protected-branch",
  "invalid-branch",
  "branch-shared",
  "dirty-worktree",
  "live-process",
  "missing-pr-evidence",
  "github-auth-mismatch",
  "github-network-unavailable",
  "github-repo-not-found",
  "github-verification-unavailable",
  "pr-not-merged",
  "pr-head-missing",
  "post-pr-commits",
  "git-command-failed",
  "cleanup-command-failed",
] as const;

export type ManagedCleanupBlockerCode = (typeof MANAGED_CLEANUP_BLOCKER_CODES)[number];

export interface ManagedCleanupBlocker {
  code: ManagedCleanupBlockerCode;
  message: string;
  detail?: string;
}

export interface ManagedCleanupPlan {
  worktreePath: string;
  repoRoot: string;
  branch: string;
  pr: {
    repo: string;
    number: number;
    url: string | null;
    headSha: string;
  };
}

export type ManagedCleanupValidation =
  | { ok: true; plan: ManagedCleanupPlan }
  | { ok: false; blockers: ManagedCleanupBlocker[] };

export interface ManagedCleanupExecutionResult {
  ok: boolean;
  message: string;
  removedWorktree: boolean;
  deletedBranch: boolean;
  blockers: ManagedCleanupBlocker[];
}

type Awaitable<T> = T | Promise<T>;

export interface ManagedCleanupDeps {
  cwd: string;
  existsSync: (path: string) => boolean;
  runGit: (cwd: string, args: string[]) => Awaitable<CommandResult>;
  runGh: (cwd: string, args: string[]) => Awaitable<CommandResult>;
  commandTimeoutMs?: number;
}

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
  error?: string;
}

interface GitWorktree {
  path: string;
  branch: string | null;
  detached: boolean;
}

interface PullRequestEvidence {
  repo: string | null;
  number: number;
  url: string | null;
  sha: string | null;
}

interface PullRequestFacts {
  state: string | null;
  mergedAt: string | null;
  headRefOid: string | null;
  url: string | null;
}

const PROTECTED_BRANCHES = new Set(["main", "master", "develop", "trunk"]);
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const activeCleanupLocks = new Map<string, Promise<void>>();

export function defaultManagedCleanupDeps(
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): ManagedCleanupDeps {
  return {
    cwd: process.cwd(),
    existsSync,
    commandTimeoutMs,
    runGit: (cwd, args) => runCommand("git", args, cwd, commandTimeoutMs),
    runGh: (cwd, args) => runCommand("gh", args, cwd, commandTimeoutMs),
  };
}

export async function validateManagedCleanup(
  record: SessionRegistryRecord,
  sessions: readonly SessionRegistryListItem[],
  deps: Partial<ManagedCleanupDeps> = {},
): Promise<ManagedCleanupValidation> {
  const resolved = { ...defaultManagedCleanupDeps(deps.commandTimeoutMs), ...deps };
  const blockers: ManagedCleanupBlocker[] = [];
  const runtime = record.runtime;
  if (!runtime) {
    blockers.push(blocker("missing-runtime", "Session has no managed runtime metadata."));
  }
  if (!record.graphBinding) {
    blockers.push(blocker("missing-graph-binding", "Session is not bound to a workstream graph node."));
  }

  const worktreePath = record.derivedWorktreePath ?? record.cwd;
  if (!worktreePath || worktreePath.trim().length === 0) {
    blockers.push(blocker("missing-worktree", "Session has no linked worktree path."));
  } else if (!resolved.existsSync(worktreePath)) {
    blockers.push(blocker("worktree-missing", `Linked worktree does not exist: ${worktreePath}`));
  }

  if (blockers.length > 0) {
    return { ok: false, blockers };
  }

  const targetPath = worktreePath;
  if (samePath(targetPath, resolved.cwd)) {
    blockers.push(blocker("current-worktree", "Refusing to clean up the API server's current working directory."));
  }

  if (isLiveSession(record)) {
    blockers.push(blocker("live-process", "Session still has trusted live process evidence."));
  }
  for (const session of sessions) {
    if (session.id === record.id) {
      continue;
    }
    if (
      session.lifecycleStatus !== "ended" &&
      session.lifecycleStatus !== "archived" &&
      session.derivedWorktreePath &&
      samePath(session.derivedWorktreePath, targetPath)
    ) {
      blockers.push(blocker(
        "live-process",
        `Another non-ended session still references this worktree: ${session.id}`,
      ));
    }
  }

  const repoRootResult = await git(resolved, targetPath, ["rev-parse", "--show-toplevel"]);
  if (!repoRootResult.ok) {
    blockers.push(blocker("git-command-failed", "Unable to resolve git repository root.", repoRootResult.message));
    return { ok: false, blockers };
  }
  const repoRoot = repoRootResult.stdout.trim();
  const worktreeList = await git(resolved, repoRoot, ["worktree", "list", "--porcelain"]);
  if (!worktreeList.ok) {
    blockers.push(blocker("git-command-failed", "Unable to list git worktrees.", worktreeList.message));
    return { ok: false, blockers };
  }
  const worktrees = parseWorktreeList(worktreeList.stdout);
  const worktree = findWorktree(targetPath, worktrees);
  if (!worktree) {
    blockers.push(blocker("worktree-not-registered", "Linked path is not a registered git worktree."));
  }

  const expectedBranch = record.derivedBranch ?? record.branch ?? null;
  const branchSafe = expectedBranch !== null &&
    !PROTECTED_BRANCHES.has(expectedBranch.toLowerCase()) &&
    isSafeBranchName(expectedBranch);
  if (!expectedBranch) {
    blockers.push(blocker("missing-branch", "Session has no expected branch recorded."));
  } else if (PROTECTED_BRANCHES.has(expectedBranch.toLowerCase())) {
    blockers.push(blocker("protected-branch", `Refusing to delete protected branch ${expectedBranch}.`));
  } else if (!isSafeBranchName(expectedBranch)) {
    blockers.push(blocker("invalid-branch", `Refusing to delete unsafe branch name ${expectedBranch}.`));
  }
  if (worktree?.branch && expectedBranch && worktree.branch !== expectedBranch) {
    blockers.push(blocker(
      "branch-mismatch",
      `Registered worktree branch ${worktree.branch} does not match expected branch ${expectedBranch}.`,
    ));
  }
  if (expectedBranch) {
    const shared = worktrees.find((entry) =>
      entry.branch === expectedBranch && !samePath(entry.path, targetPath)
    );
    if (shared) {
      blockers.push(blocker(
        "branch-shared",
        `Branch ${expectedBranch} is also checked out by ${shared.path}.`,
      ));
    }
  }

  const status = await git(resolved, targetPath, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  if (!status.ok) {
    blockers.push(blocker("git-command-failed", "Unable to inspect worktree status.", status.message));
  } else if (status.stdout.trim().length > 0) {
    blockers.push(blocker("dirty-worktree", "Linked worktree has uncommitted or untracked changes."));
  }

  const prEvidence = findPullRequestEvidence(record);
  let prHeadSha: string | null = null;
  let prUrl: string | null = null;
  if (!prEvidence || !prEvidence.repo || !prEvidence.number) {
    blockers.push(blocker("missing-pr-evidence", "Cleanup requires linked PR evidence."));
  } else {
    const facts = await loadPullRequestFacts(resolved, repoRoot, prEvidence);
    if (!facts.ok) {
      blockers.push(facts.blocker);
    } else if (facts.facts.state !== "MERGED" && !facts.facts.mergedAt) {
      blockers.push(blocker("pr-not-merged", `PR #${prEvidence.number} is not merged.`));
    } else {
      const headSha = facts.facts.headRefOid ?? prEvidence.sha;
      if (!headSha) {
        blockers.push(blocker("pr-head-missing", `PR #${prEvidence.number} did not report a head SHA.`));
      } else if (expectedBranch && branchSafe) {
        prHeadSha = headSha;
        prUrl = facts.facts.url ?? prEvidence.url;
        const tipSafe = await validateBranchTipAgainstPrHead(resolved, targetPath, expectedBranch, headSha);
        if (!tipSafe.ok) {
          blockers.push(tipSafe.blocker);
        }
      }
    }
  }

  if (
    blockers.length > 0 ||
    !worktree ||
    !expectedBranch ||
    !branchSafe ||
    !prEvidence ||
    !prEvidence.repo ||
    !prEvidence.number ||
    !prHeadSha
  ) {
    return { ok: false, blockers };
  }

  return {
    ok: true,
    plan: {
      worktreePath: targetPath,
      repoRoot,
      branch: expectedBranch,
      pr: {
        repo: prEvidence.repo,
        number: prEvidence.number,
        url: prUrl ?? prEvidence.url,
        headSha: prHeadSha,
      },
    },
  };
}

export async function executeManagedCleanup(
  plan: ManagedCleanupPlan,
  deps: Partial<ManagedCleanupDeps> = {},
): Promise<ManagedCleanupExecutionResult> {
  const resolved = { ...defaultManagedCleanupDeps(deps.commandTimeoutMs), ...deps };
  let removedWorktree = false;
  let deletedBranch = false;
  const removeResult = await git(resolved, plan.repoRoot, ["worktree", "remove", "--", plan.worktreePath]);
  if (!removeResult.ok) {
    const worktreeList = await git(resolved, plan.repoRoot, ["worktree", "list", "--porcelain"]);
    if (worktreeList.ok && !findWorktree(plan.worktreePath, parseWorktreeList(worktreeList.stdout))) {
      removedWorktree = true;
    } else {
      return {
        ok: false,
        message: "Failed to remove linked worktree.",
        removedWorktree,
        deletedBranch,
        blockers: [blocker("cleanup-command-failed", "Failed to remove linked worktree.", removeResult.message)],
      };
    }
  } else {
    removedWorktree = true;
  }

  const branchExists = await git(resolved, plan.repoRoot, [
    "show-ref",
    "--verify",
    "--quiet",
    "--",
    `refs/heads/${plan.branch}`,
  ], true);
  if (branchExists.status === 0) {
    const branchSafe = await validateBranchStillDeletable(resolved, plan);
    if (!branchSafe.ok) {
      return {
        ok: false,
        message: "Removed worktree, but branch deletion is no longer safe.",
        removedWorktree,
        deletedBranch,
        blockers: [branchSafe.blocker],
      };
    }
    const deleteResult = await git(resolved, plan.repoRoot, ["branch", "-D", "--", plan.branch]);
    if (!deleteResult.ok) {
      return {
        ok: false,
        message: "Removed worktree, but failed to delete local branch.",
        removedWorktree,
        deletedBranch,
        blockers: [blocker("cleanup-command-failed", "Failed to delete local branch.", deleteResult.message)],
      };
    }
    deletedBranch = true;
  }

  return {
    ok: true,
    message: `Cleaned up worktree ${plan.worktreePath} and branch ${plan.branch}.`,
    removedWorktree,
    deletedBranch,
    blockers: [],
  };
}

export async function withManagedCleanupLock<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = activeCleanupLocks.get(key) ?? Promise.resolve();
  const wait = previous.catch(() => undefined);
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolveCurrent) => {
    release = resolveCurrent;
  });
  const next = wait.then(() => current);
  activeCleanupLocks.set(key, next);
  await wait;
  try {
    return await task();
  } finally {
    release();
    if (activeCleanupLocks.get(key) === next) {
      activeCleanupLocks.delete(key);
    }
  }
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolveCommand) => {
    let child;
    try {
      child = spawn(command, args, { cwd, stdio: "pipe" });
    } catch (error: unknown) {
      resolveCommand({
        status: 1,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveCommand({
        status: 1,
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveCommand({
        status: timedOut ? 124 : code ?? 1,
        stdout,
        stderr,
        error: timedOut ? `${command} timed out after ${timeoutMs}ms.` : undefined,
      });
    });
  });
}

async function git(
  deps: ManagedCleanupDeps,
  cwd: string,
  args: string[],
  allowFailure = false,
): Promise<{ ok: true; stdout: string; status: number } | { ok: false; message: string; status: number }> {
  const result = await deps.runGit(cwd, args);
  if (result.status === 0 || allowFailure) {
    return { ok: true, stdout: result.stdout, status: result.status };
  }
  return {
    ok: false,
    message: result.error ?? (result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed.`),
    status: result.status,
  };
}

function parseWorktreeList(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: GitWorktree | null = null;
  const pushCurrent = () => {
    if (current) {
      worktrees.push(current);
      current = null;
    }
  };
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) {
      pushCurrent();
      continue;
    }
    if (line.startsWith("worktree ")) {
      pushCurrent();
      current = { path: line.slice("worktree ".length), branch: null, detached: false };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (line === "detached") {
      current.detached = true;
    }
  }
  pushCurrent();
  return worktrees;
}

function findWorktree(path: string, worktrees: readonly GitWorktree[]): GitWorktree | null {
  const target = normalizePathKey(path);
  return worktrees.find((worktree) => normalizePathKey(worktree.path) === target) ?? null;
}

function normalizePathKey(path: string): string {
  let resolved = resolve(path);
  try {
    resolved = realpathSync.native(resolved);
  } catch {
    // Missing paths are handled by validation; fall back to lexical resolution.
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return normalizePathKey(left) === normalizePathKey(right);
}

function isLiveSession(record: SessionRegistryRecord): boolean {
  return record.trustedSignalSource !== null &&
    record.trustedEndedAt === null &&
    record.copilotProcessState === "live";
}

function findPullRequestEvidence(record: SessionRegistryRecord): PullRequestEvidence | null {
  const evidence = latestByTimestamp(
    (record.runtime?.evidence ?? []).filter((entry) =>
      (entry.kind === "cleanup_ready" || entry.kind === "pr_ready") &&
      entry.number !== null
    ),
    (entry) => entry.detectedAt,
  );
  if (evidence) {
    return evidenceToPullRequestEvidence(evidence, record.repo);
  }
  const derived = latestByTimestamp(
    record.derivedGithubRefs.filter((entry) => entry.type === "pr"),
    (entry) => entry.lastSeenAt ?? entry.firstSeenAt,
  );
  if (!derived) {
    return null;
  }
  return {
    repo: derived.repo ?? record.repo,
    number: derived.number,
    url: derived.url,
    sha: null,
  };
}

function evidenceToPullRequestEvidence(
  evidence: SessionRegistryRuntimeEvidence,
  fallbackRepo: string | null,
): PullRequestEvidence {
  return {
    repo: evidence.repo ?? fallbackRepo,
    number: evidence.number ?? 0,
    url: evidence.url,
    sha: evidence.sha,
  };
}

async function loadPullRequestFacts(
  deps: ManagedCleanupDeps,
  cwd: string,
  evidence: PullRequestEvidence,
): Promise<{ ok: true; facts: PullRequestFacts } | { ok: false; blocker: ManagedCleanupBlocker }> {
  if (!evidence.repo || !evidence.number) {
    return {
      ok: false,
      blocker: blocker("missing-pr-evidence", "Cleanup requires a PR repo and number."),
    };
  }
  if (!isSafeGitHubRepo(evidence.repo)) {
    return {
      ok: false,
      blocker: blocker("missing-pr-evidence", `Cleanup requires a safe GitHub repo slug, got ${evidence.repo}.`),
    };
  }
  const result = await deps.runGh(cwd, [
    "pr",
    "view",
    String(evidence.number),
    "--repo",
    evidence.repo,
    "--json",
    "state,mergedAt,headRefOid,url",
  ]);
  if (result.status !== 0) {
    const detail = result.error ?? (result.stderr.trim() || result.stdout.trim());
    if (isGitHubAuthMismatch(detail)) {
      return {
        ok: false,
        blocker: blocker(
          "github-auth-mismatch",
          `Unable to verify merge state for ${evidence.repo}#${evidence.number} with the configured GitHub credentials.`,
          detail,
        ),
      };
    }
    if (isGitHubNetworkUnavailable(detail)) {
      return {
        ok: false,
        blocker: blocker(
          "github-network-unavailable",
          `Unable to reach GitHub while verifying ${evidence.repo}#${evidence.number}.`,
          detail,
        ),
      };
    }
    if (isGitHubRepoNotFound(detail)) {
      return {
        ok: false,
        blocker: blocker(
          "github-repo-not-found",
          `Unable to find repository ${evidence.repo} while verifying PR #${evidence.number}.`,
          detail,
        ),
      };
    }
    return {
      ok: false,
      blocker: blocker(
        "github-verification-unavailable",
        `Unable to verify merge state for ${evidence.repo}#${evidence.number}.`,
        detail,
      ),
    };
  }
  try {
    const parsed = JSON.parse(result.stdout) as Partial<PullRequestFacts>;
    return {
      ok: true,
      facts: {
        state: typeof parsed.state === "string" ? parsed.state : null,
        mergedAt: typeof parsed.mergedAt === "string" ? parsed.mergedAt : null,
        headRefOid: typeof parsed.headRefOid === "string" ? parsed.headRefOid : null,
        url: typeof parsed.url === "string" ? parsed.url : evidence.url,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      blocker: blocker(
        "github-verification-unavailable",
        `Unable to parse PR facts for ${evidence.repo}#${evidence.number}.`,
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

function isGitHubAuthMismatch(message: string): boolean {
  return /auth|not logged in|permission|resource not accessible|http 40[13]/i.test(message);
}

function isGitHubNetworkUnavailable(message: string): boolean {
  return /could not resolve host|enotfound|econnreset|etimedout|timed? out|network|tls/i.test(message);
}

function isGitHubRepoNotFound(message: string): boolean {
  return /repository not found|could not resolve to a repository|http 404|not found/i.test(message);
}

async function validateBranchTipAgainstPrHead(
  deps: ManagedCleanupDeps,
  worktreePath: string,
  branch: string,
  headSha: string,
): Promise<{ ok: true } | { ok: false; blocker: ManagedCleanupBlocker }> {
  const tip = await git(deps, worktreePath, ["rev-parse", "--verify", "--", branch]);
  if (!tip.ok) {
    return {
      ok: false,
      blocker: blocker("git-command-failed", `Unable to resolve branch ${branch}.`, tip.message),
    };
  }
  const branchTip = tip.stdout.trim();
  if (branchTip === headSha) {
    return { ok: true };
  }
  const branchTipAncestor = await git(
    deps,
    worktreePath,
    ["merge-base", "--is-ancestor", branchTip, headSha],
    true,
  );
  if (branchTipAncestor.ok && branchTipAncestor.status === 0) {
    return { ok: true };
  }
  const headAncestor = await git(
    deps,
    worktreePath,
    ["merge-base", "--is-ancestor", headSha, branchTip],
    true,
  );
  if (headAncestor.ok && headAncestor.status === 0) {
    return {
      ok: false,
      blocker: blocker(
        "post-pr-commits",
        `Branch ${branch} has commits after the merged PR head.`,
      ),
    };
  }
  return {
    ok: false,
    blocker: blocker(
      "post-pr-commits",
      `Unable to prove branch ${branch} is at or behind the merged PR head.`,
    ),
  };
}

async function validateBranchStillDeletable(
  deps: ManagedCleanupDeps,
  plan: ManagedCleanupPlan,
): Promise<{ ok: true } | { ok: false; blocker: ManagedCleanupBlocker }> {
  if (PROTECTED_BRANCHES.has(plan.branch.toLowerCase())) {
    return {
      ok: false,
      blocker: blocker("protected-branch", `Refusing to delete protected branch ${plan.branch}.`),
    };
  }
  if (!isSafeBranchName(plan.branch)) {
    return {
      ok: false,
      blocker: blocker("invalid-branch", `Refusing to delete unsafe branch name ${plan.branch}.`),
    };
  }
  const worktreeList = await git(deps, plan.repoRoot, ["worktree", "list", "--porcelain"]);
  if (!worktreeList.ok) {
    return {
      ok: false,
      blocker: blocker(
        "git-command-failed",
        "Unable to re-list git worktrees before branch deletion.",
        worktreeList.message,
      ),
    };
  }
  const shared = parseWorktreeList(worktreeList.stdout).find((entry) =>
    entry.branch === plan.branch && !samePath(entry.path, plan.worktreePath)
  );
  if (shared) {
    return {
      ok: false,
      blocker: blocker("branch-shared", `Branch ${plan.branch} is checked out by ${shared.path}.`),
    };
  }
  return await validateBranchTipAgainstPrHead(deps, plan.repoRoot, plan.branch, plan.pr.headSha);
}

function latestByTimestamp<T>(
  items: readonly T[],
  timestamp: (item: T) => string | null,
): T | undefined {
  return items
    .map((item, index) => ({
      item,
      index,
      time: Date.parse(timestamp(item) ?? ""),
    }))
    .sort((left, right) =>
      (Number.isFinite(right.time) ? right.time : 0) -
        (Number.isFinite(left.time) ? left.time : 0) ||
      right.index - left.index
    )[0]?.item;
}

function isSafeBranchName(branch: string): boolean {
  return branch.length > 0 &&
    !branch.startsWith("-") &&
    !branch.includes("..") &&
    !branch.includes("@{") &&
    !branch.includes("\\") &&
    !branch.includes("//") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".") &&
    !branch.endsWith(".lock") &&
    !hasUnsafeBranchCharacter(branch);
}

function hasUnsafeBranchCharacter(branch: string): boolean {
  const disallowed = " ~^:?*[";
  for (const character of branch) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127 || disallowed.includes(character)) {
      return true;
    }
  }
  return false;
}

function isSafeGitHubRepo(repo: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

function blocker(
  code: ManagedCleanupBlockerCode,
  message: string,
  detail?: string,
): ManagedCleanupBlocker {
  return detail && detail.length > 0 ? { code, message, detail } : { code, message };
}

export function managedCleanupSummary(plan: ManagedCleanupPlan, result: ManagedCleanupExecutionResult): string {
  if (!result.ok) {
    return result.message;
  }
  const branchMessage = result.deletedBranch
    ? `deleted local branch ${plan.branch}`
    : `local branch ${plan.branch} was already absent`;
  return `Removed worktree ${basename(plan.worktreePath)} and ${branchMessage}.`;
}
