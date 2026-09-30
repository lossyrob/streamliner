#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  isProcessLockStale,
  processExists,
  readLockMetadataFile,
} from "../src/session-registry/lock-liveness.ts";
import {
  getDefaultSessionRegistryRoot,
} from "../src/session-registry/file-store.ts";
import {
  getDefaultLaunchClaimRoot,
} from "../src/session-registry/launch-claim-store.ts";

interface LockTarget {
  name: string;
  path: string;
}

interface Args {
  force: boolean;
  help: boolean;
  all: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    force: false,
    help: false,
    all: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force" || arg === "-f") {
      args.force = true;
    } else if (arg === "--all" || arg === "-a") {
      args.all = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      args.help = true;
      break;
    }
  }

  return args;
}

function usage(): void {
  console.log(`Usage:
  npm run api:unlock [-- [--force] [--all]]

Options:
  --force, -f    Remove lock even if the holding process appears to be alive
  --all, -a      Clear registry.lock and launch-claims.lock in addition to api.lock
  --help, -h     Show this help message

Description:
  Inspects and clears stale advisory lock files created by Streamliner.
  By default, targets api.lock and safely removes it if the holding process is dead.`);
}

function inspectAndClearLock(target: LockTarget, force: boolean): boolean {
  if (!existsSync(target.path)) {
    console.log(`[${target.name}] No lock file found at ${target.path}`);
    return true;
  }

  const metadata = readLockMetadataFile(target.path);
  if (!metadata) {
    console.log(`[${target.name}] Corrupted/unparseable lock file found at ${target.path}. Removing...`);
    rmSync(target.path, { force: true });
    console.log(`[${target.name}] Removed corrupted lock file.`);
    return true;
  }

  const isStale = isProcessLockStale(metadata);
  const isAlive = processExists(metadata.pid);

  console.log(`[${target.name}] Lock file found at ${target.path}:`);
  console.log(`  PID: ${metadata.pid}`);
  if (metadata.acquiredAt) {
    console.log(`  Acquired at: ${metadata.acquiredAt}`);
  }
  console.log(`  Process status: ${isAlive ? "alive" : "dead"}`);
  console.log(`  Staleness verdict: ${isStale ? "stale" : "active"}`);

  if (isStale || force) {
    if (force && !isStale) {
      console.log(`  Warning: Force-clearing an active lock owned by live PID ${metadata.pid}!`);
    }
    rmSync(target.path, { force: true });
    console.log(`[${target.name}] Lock successfully removed.`);
    return true;
  }

  console.error(
    `[${target.name}] Cannot remove lock: process ${metadata.pid} is still running. Use --force to override if this is in error.`,
  );
  return false;
}

function main(): void {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const sessionRegistryRoot =
    process.env.STREAMLINER_SESSION_REGISTRY_ROOT ?? getDefaultSessionRegistryRoot();
  const launchClaimRoot =
    process.env.STREAMLINER_LAUNCH_CLAIMS_ROOT ?? getDefaultLaunchClaimRoot();

  const targets: LockTarget[] = [
    { name: "api.lock", path: join(sessionRegistryRoot, "api.lock") },
  ];

  if (args.all) {
    targets.push(
      { name: "registry.lock", path: join(sessionRegistryRoot, "registry.lock") },
      { name: "launch-claims.lock", path: join(launchClaimRoot, "launch-claims.lock") },
    );
  }

  let allSuccess = true;
  for (const target of targets) {
    const success = inspectAndClearLock(target, args.force);
    if (!success) {
      allSuccess = false;
    }
  }

  if (!allSuccess) {
    process.exit(1);
  }
}

main();
