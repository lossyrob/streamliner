#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";

interface Args {
  worktree?: string;
  branch?: string;
  dryRun: boolean;
  force: boolean;
  help: boolean;
}

interface GitWorktree {
  path: string;
  branch?: string;
  detached: boolean;
}

const PROTECTED_BRANCHES = new Set(["main", "master", "develop", "trunk"]);

function usage(): void {
  console.log(`Usage:
  npm run cleanup:worktree -- --worktree <path-or-directory-name> [--branch <branch>] [--dry-run] [--force]
  npm run cleanup:worktree:remove -- <path-or-directory-name>
  npm run cleanup:worktree:force -- <path-or-directory-name>

Examples:
  npm run cleanup:worktree -- ..\\streamliner-graph-node-session-status-indicators
  npm run cleanup:worktree:remove -- ..\\streamliner-graph-node-session-status-indicators
  npm run cleanup:worktree:force -- streamliner-graph-node-session-status-indicators

The default cleanup:worktree command is a dry run. Use cleanup:worktree:remove
to remove the registered git worktree and delete the associated local branch.
Use cleanup:worktree:force only when you intentionally want git worktree remove
--force and git branch -D.`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: true,
    force: false,
    help: false,
  };

  const positional: string[] = [];
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${arg} requires a value.`);
      }
      return argv[index];
    };

    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--worktree":
      case "--path":
        args.worktree = next();
        break;
      case "--branch":
        args.branch = next();
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--execute":
      case "--apply":
      case "--remove":
        args.dryRun = false;
        break;
      case "--force":
        args.force = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positional.push(arg);
        break;
    }
  }

  if (!args.worktree && positional.length > 0) {
    args.worktree = positional[0];
  }
  if (positional.length > 1) {
    throw new Error(`Unexpected positional arguments: ${positional.slice(1).join(" ")}`);
  }
  if (args.force) {
    args.dryRun = false;
  }

  return args;
}

function normalizePathKey(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function git(
  repoRoot: string,
  args: string[],
  options: { capture?: boolean; allowFailure?: boolean } = {},
): string {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    input: options.capture ? undefined : "n\n",
    stdio: options.capture ? "pipe" : ["pipe", "inherit", "pipe"],
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    const detail = stderr.trim() || stdout.trim();
    throw new Error(`git ${args.join(" ")} failed${detail ? `:\n${detail}` : "."}`);
  }
  return stdout.trimEnd();
}

function gitStatus(
  repoRoot: string,
  args: string[],
): number {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status ?? 1;
}

function currentRepoRoot(): string {
  return git(process.cwd(), ["rev-parse", "--show-toplevel"], { capture: true });
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
      current = {
        path: line.slice("worktree ".length),
        detached: false,
      };
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

function findWorktree(repoRoot: string, requested: string, worktrees: GitWorktree[]): GitWorktree {
  const requestedPaths = [
    resolve(requested),
    resolve(repoRoot, requested),
    resolve(repoRoot, "..", requested),
  ].map(normalizePathKey);

  const byPath = worktrees.find((worktree) =>
    requestedPaths.includes(normalizePathKey(worktree.path)),
  );
  if (byPath) {
    return byPath;
  }

  const basenameMatches = worktrees.filter(
    (worktree) => basename(worktree.path).toLowerCase() === requested.toLowerCase(),
  );
  if (basenameMatches.length === 1) {
    return basenameMatches[0];
  }
  if (basenameMatches.length > 1) {
    throw new Error(
      `Multiple worktrees match '${requested}'. Re-run with the full worktree path.`,
    );
  }

  throw new Error(
    `No registered git worktree found for '${requested}'. Run 'git worktree list' to see active worktrees.`,
  );
}

function localBranchExists(repoRoot: string, branch: string): boolean {
  return gitStatus(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]) === 0;
}

function main(): void {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }
  if (!args.worktree) {
    usage();
    throw new Error("Missing required --worktree argument.");
  }

  const repoRoot = currentRepoRoot();
  const worktrees = parseWorktreeList(
    git(repoRoot, ["worktree", "list", "--porcelain"], { capture: true }),
  );
  const target = findWorktree(repoRoot, args.worktree, worktrees);
  if (normalizePathKey(target.path) === normalizePathKey(repoRoot)) {
    throw new Error("Refusing to remove the main checkout worktree.");
  }
  if (normalizePathKey(target.path) === normalizePathKey(process.cwd())) {
    throw new Error("Refusing to remove the current working directory.");
  }

  const branch = args.branch ?? target.branch;
  if (args.branch && target.branch && args.branch !== target.branch) {
    throw new Error(
      `Requested branch '${args.branch}' does not match worktree branch '${target.branch}'.`,
    );
  }

  console.log(`Repository: ${repoRoot}`);
  console.log(`Worktree:   ${target.path}`);
  console.log(`Branch:     ${branch ?? "(none; detached or unavailable)"}`);
  console.log(`Mode:       ${args.dryRun ? "dry-run" : "execute"}${args.force ? " (force)" : ""}`);

  if (args.dryRun) {
    console.log(`Would run: git worktree remove${args.force ? " --force" : ""} "${target.path}"`);
    if (branch && !PROTECTED_BRANCHES.has(branch) && localBranchExists(repoRoot, branch)) {
      console.log(`Would run: git branch ${args.force ? "-D" : "-d"} ${branch}`);
    } else if (branch && PROTECTED_BRANCHES.has(branch)) {
      console.log(`Would skip protected branch: ${branch}`);
    } else {
      console.log("Would skip branch deletion: no local branch found.");
    }
    return;
  }

  git(repoRoot, ["worktree", "remove", ...(args.force ? ["--force"] : []), target.path]);

  if (!branch) {
    console.log("No branch associated with the removed worktree; branch deletion skipped.");
    return;
  }
  if (PROTECTED_BRANCHES.has(branch)) {
    console.log(`Protected branch '${branch}' was not deleted.`);
    return;
  }
  if (!localBranchExists(repoRoot, branch)) {
    console.log(`Local branch '${branch}' does not exist; branch deletion skipped.`);
    return;
  }

  git(repoRoot, ["branch", args.force ? "-D" : "-d", branch]);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
