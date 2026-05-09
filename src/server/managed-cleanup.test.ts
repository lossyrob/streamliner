import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionRegistryFileStore } from "../session-registry/file-store";
import type { SessionRegistryRecord } from "../session-registry-schema";
import {
  validateManagedCleanup,
  type ManagedCleanupDeps,
} from "./managed-cleanup";

const createdRoots: string[] = [];

function createRootDir(): string {
  const root = join(tmpdir(), `streamliner-managed-cleanup-${process.pid}-${createdRoots.length}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  createdRoots.push(root);
  return root;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createCleanupRecord(root: string): {
  store: SessionRegistryFileStore;
  record: SessionRegistryRecord;
} {
  const store = new SessionRegistryFileStore({ rootDir: join(root, "registry") });
  const base = store.upsertSession({
    id: "cleanup-candidate",
    title: "Cleanup candidate",
    description: "",
    cwd: normalizePath(root),
    branch: "feature/cleanup",
    origin: { kind: "launched", launchClaimId: "claim-cleanup" },
    graphBinding: {
      workstreamId: "ws-1",
      nodeId: "node-cleanup",
      launchClaimId: "claim-cleanup",
    },
  });
  store.patchRuntimeMetadata(base.id, {
    runtimeKind: "managed-sdk",
    runtimeOwner: "streamliner-sdk",
    lifecycleState: "cleanup_ready",
    permissionProfile: "managed-autonomous",
    launchClaimId: "claim-cleanup",
    launchNonce: "nonce-cleanup",
    evidence: [{
      kind: "cleanup_ready",
      source: "test",
      repo: "lossyrob/streamliner",
      number: 75,
      sha: "abc123",
      url: "https://github.com/lossyrob/streamliner/pull/75",
      summary: "PR merged.",
    }],
  });
  const record = store.getSession(base.id);
  if (!record) {
    throw new Error("Expected cleanup candidate to exist.");
  }
  return { store, record };
}

function cleanupDeps(
  root: string,
  overrides: Partial<ManagedCleanupDeps> = {},
): Partial<ManagedCleanupDeps> {
  return {
    cwd: normalizePath(join(root, "api")),
    existsSync: () => true,
    runGh: () => ({
      status: 0,
      stdout: JSON.stringify({
        state: "MERGED",
        mergedAt: "2026-05-07T12:00:00Z",
        headRefOid: "abc123",
        url: "https://github.com/lossyrob/streamliner/pull/75",
      }),
      stderr: "",
    }),
    runGit: (_cwd, args) => {
      const command = args.join(" ");
      if (command === "rev-parse --show-toplevel") {
        return { status: 0, stdout: normalizePath(root), stderr: "" };
      }
      if (command === "worktree list --porcelain") {
        return {
          status: 0,
          stdout: [
            `worktree ${normalizePath(root)}`,
            "HEAD abc123",
            "branch refs/heads/feature/cleanup",
            "",
          ].join("\n"),
          stderr: "",
        };
      }
      if (command === "status --porcelain=v1 --untracked-files=normal") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "rev-parse feature/cleanup") {
        return { status: 0, stdout: "abc123\n", stderr: "" };
      }
      if (command.startsWith("merge-base --is-ancestor ")) {
        return { status: 1, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `Unexpected git command: ${command}` };
    },
    ...overrides,
  };
}

describe("managed cleanup guardrails", () => {
  it("builds a cleanup plan only after merged PR verification", () => {
    const root = createRootDir();
    const { store, record } = createCleanupRecord(root);

    const validation = validateManagedCleanup(
      record,
      store.listSessions({ includeArchived: false }),
      cleanupDeps(root),
    );

    expect(validation).toEqual({
      ok: true,
      plan: expect.objectContaining({
        worktreePath: normalizePath(root),
        branch: "feature/cleanup",
        pr: expect.objectContaining({
          repo: "lossyrob/streamliner",
          number: 75,
          headSha: "abc123",
        }),
      }),
    });
  });

  it("fails closed with a typed blocker when GitHub credentials cannot verify merge state", () => {
    const root = createRootDir();
    const { store, record } = createCleanupRecord(root);

    const validation = validateManagedCleanup(
      record,
      store.listSessions({ includeArchived: false }),
      cleanupDeps(root, {
        runGh: () => ({
          status: 1,
          stdout: "",
          stderr: "authentication required",
        }),
      }),
    );

    expect(validation).toEqual({
      ok: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "github-auth-mismatch" }),
      ]),
    });
  });

  it("blocks cleanup when local branch has commits after the merged PR head", () => {
    const root = createRootDir();
    const { store, record } = createCleanupRecord(root);

    const validation = validateManagedCleanup(
      record,
      store.listSessions({ includeArchived: false }),
      cleanupDeps(root, {
        runGit: (_cwd, args) => {
          const command = args.join(" ");
          if (command === "rev-parse --show-toplevel") {
            return { status: 0, stdout: normalizePath(root), stderr: "" };
          }
          if (command === "worktree list --porcelain") {
            return {
              status: 0,
              stdout: [
                `worktree ${normalizePath(root)}`,
                "HEAD def456",
                "branch refs/heads/feature/cleanup",
                "",
              ].join("\n"),
              stderr: "",
            };
          }
          if (command === "status --porcelain=v1 --untracked-files=normal") {
            return { status: 0, stdout: "", stderr: "" };
          }
          if (command === "rev-parse feature/cleanup") {
            return { status: 0, stdout: "def456\n", stderr: "" };
          }
          if (command === "merge-base --is-ancestor def456 abc123") {
            return { status: 1, stdout: "", stderr: "" };
          }
          if (command === "merge-base --is-ancestor abc123 def456") {
            return { status: 0, stdout: "", stderr: "" };
          }
          return { status: 1, stdout: "", stderr: `Unexpected git command: ${command}` };
        },
      }),
    );

    expect(validation).toEqual({
      ok: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "post-pr-commits" }),
      ]),
    });
  });
});
