import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
  "branch-shared",
  "dirty-worktree",
  "live-process",
  "missing-pr-evidence",
  "github-auth-mismatch",
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

export interface ManagedCleanupDeps {
  cwd: string;
  existsSync: (path: string) => boolean;
  runGit: (cwd: string, args: string[]) => CommandResult;
  runGh: (cwd: string, args: string[]) => CommandResult;
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

export function defaultManagedCleanupDeps(): ManagedCleanupDeps {
  return {
    cwd: process.cwd(),
    existsSync,
    runGit: (cwd, args) => runCommand("git", args, cwd),
    runGh: (cwd, args) => runCommand("gh", args, cwd),
  };
}

export function validateManagedCleanup(
  record: SessionRegistryRecord,
  sessions: readonly SessionRegistryListItem[],
  deps: Partial<ManagedCleanupDeps> = {},
): ManagedCleanupValidation {
  const resolved = { ...defaultManagedCleanupDeps(), ...deps };
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

  const repoRootResult = git(resolved, targetPath, ["rev-parse", "--show-toplevel"]);
  if (!repoRootResult.ok) {
    blockers.push(blocker("git-command-failed", "Unable to resolve git repository root.", repoRootResult.message));
    return { ok: false, blockers };
  }
  const repoRoot = repoRootResult.stdout.trim();
  const worktreeList = git(resolved, repoRoot, ["worktree", "list", "--porcelain"]);
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
  if (!expectedBranch) {
    blockers.push(blocker("missing-branch", "Session has no expected branch recorded."));
  } else if (PROTECTED_BRANCHES.has(expectedBranch)) {
    blockers.push(blocker("protected-branch", `Refusing to delete protected branch ${expectedBranch}.`));
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

  const status = git(resolved, targetPath, ["status", "--porcelain=v1", "--untracked-files=normal"]);
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
    const facts = loadPullRequestFacts(resolved, repoRoot, prEvidence);
    if (!facts.ok) {
      blockers.push(facts.blocker);
    } else if (facts.facts.state !== "MERGED" && !facts.facts.mergedAt) {
      blockers.push(blocker("pr-not-merged", `PR #${prEvidence.number} is not merged.`));
    } else {
      const headSha = facts.facts.headRefOid ?? prEvidence.sha;
      if (!headSha) {
        blockers.push(blocker("pr-head-missing", `PR #${prEvidence.number} did not report a head SHA.`));
      } else if (expectedBranch) {
        prHeadSha = headSha;
        prUrl = facts.facts.url ?? prEvidence.url;
        const branchSafe = validateBranchTipAgainstPrHead(resolved, targetPath, expectedBranch, headSha);
        if (!branchSafe.ok) {
          blockers.push(branchSafe.blocker);
        }
      }
    }
  }

  if (
    blockers.length > 0 ||
    !worktree ||
    !expectedBranch ||
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

export function executeManagedCleanup(
  plan: ManagedCleanupPlan,
  deps: Partial<ManagedCleanupDeps> = {},
): ManagedCleanupExecutionResult {
  const resolved = { ...defaultManagedCleanupDeps(), ...deps };
  let removedWorktree = false;
  let deletedBranch = false;
  const removeResult = git(resolved, plan.repoRoot, ["worktree", "remove", plan.worktreePath]);
  if (!removeResult.ok) {
    return {
      ok: false,
      message: "Failed to remove linked worktree.",
      removedWorktree,
      deletedBranch,
      blockers: [blocker("cleanup-command-failed", "Failed to remove linked worktree.", removeResult.message)],
    };
  }
  removedWorktree = true;

  const branchExists = git(resolved, plan.repoRoot, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${plan.branch}`,
  ], true);
  if (branchExists.status === 0) {
    const deleteResult = git(resolved, plan.repoRoot, ["branch", "-d", plan.branch]);
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

function runCommand(command: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    error: result.error instanceof Error ? result.error.message : undefined,
  };
}

function git(
  deps: ManagedCleanupDeps,
  cwd: string,
  args: string[],
  allowFailure = false,
): { ok: true; stdout: string; status: number } | { ok: false; message: string; status: number } {
  const result = deps.runGit(cwd, args);
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
  const resolved = resolve(path);
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
  const evidence = [...(record.runtime?.evidence ?? [])]
    .reverse()
    .find((entry) =>
      (entry.kind === "cleanup_ready" || entry.kind === "pr_ready") &&
      entry.number !== null
    );
  if (evidence) {
    return evidenceToPullRequestEvidence(evidence, record.repo);
  }
  const derived = [...record.derivedGithubRefs]
    .reverse()
    .find((entry) => entry.type === "pr");
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

function loadPullRequestFacts(
  deps: ManagedCleanupDeps,
  cwd: string,
  evidence: PullRequestEvidence,
): { ok: true; facts: PullRequestFacts } | { ok: false; blocker: ManagedCleanupBlocker } {
  if (!evidence.repo || !evidence.number) {
    return {
      ok: false,
      blocker: blocker("missing-pr-evidence", "Cleanup requires a PR repo and number."),
    };
  }
  const result = deps.runGh(cwd, [
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
  return /auth|not logged in|permission|resource not accessible|http 40[13]|could not resolve/i.test(message);
}

function validateBranchTipAgainstPrHead(
  deps: ManagedCleanupDeps,
  worktreePath: string,
  branch: string,
  headSha: string,
): { ok: true } | { ok: false; blocker: ManagedCleanupBlocker } {
  const tip = git(deps, worktreePath, ["rev-parse", branch]);
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
  const branchTipAncestor = git(deps, worktreePath, ["merge-base", "--is-ancestor", branchTip, headSha], true);
  if (branchTipAncestor.ok && branchTipAncestor.status === 0) {
    return { ok: true };
  }
  const headAncestor = git(deps, worktreePath, ["merge-base", "--is-ancestor", headSha, branchTip], true);
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
