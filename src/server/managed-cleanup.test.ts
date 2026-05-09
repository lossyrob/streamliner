import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionRegistryFileStore } from "../session-registry/file-store";
import type { SessionRegistryRecord } from "../session-registry-schema";
import {
  executeManagedCleanup,
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
      if (command === "rev-parse --verify -- feature/cleanup") {
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
  it("builds a cleanup plan only after merged PR verification", async () => {
    const root = createRootDir();
    const { store, record } = createCleanupRecord(root);

    const validation = await validateManagedCleanup(
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

  it("fails closed with a typed blocker when GitHub credentials cannot verify merge state", async () => {
    const root = createRootDir();
    const { store, record } = createCleanupRecord(root);

    const validation = await validateManagedCleanup(
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

  it("blocks cleanup when local branch has commits after the merged PR head", async () => {
    const root = createRootDir();
    const { store, record } = createCleanupRecord(root);

    const validation = await validateManagedCleanup(
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
          if (command === "rev-parse --verify -- feature/cleanup") {
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

  it("treats protected branches case-insensitively", async () => {
    const root = createRootDir();
    const { store, record } = createCleanupRecord(root);
    const mainRecord = { ...record, branch: "Main" };

    const validation = await validateManagedCleanup(
      mainRecord,
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
                "HEAD abc123",
                "branch refs/heads/Main",
                "",
              ].join("\n"),
              stderr: "",
            };
          }
          if (command === "status --porcelain=v1 --untracked-files=normal") {
            return { status: 0, stdout: "", stderr: "" };
          }
          return { status: 1, stdout: "", stderr: `Unexpected git command: ${command}` };
        },
      }),
    );

    expect(validation).toEqual({
      ok: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "protected-branch" }),
      ]),
    });
  });

  it("classifies GitHub network failures separately from auth failures", async () => {
    const root = createRootDir();
    const { store, record } = createCleanupRecord(root);

    const validation = await validateManagedCleanup(
      record,
      store.listSessions({ includeArchived: false }),
      cleanupDeps(root, {
        runGh: () => ({
          status: 1,
          stdout: "",
          stderr: "could not resolve host: api.github.com",
        }),
      }),
    );

    expect(validation).toEqual({
      ok: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "github-network-unavailable" }),
      ]),
    });
  });

  it("uses latest cleanup PR evidence by timestamp", async () => {
    const root = createRootDir();
    const { store, record } = createCleanupRecord(root);
    const updated = store.patchRuntimeMetadata(record.id, {
      evidence: [{
        kind: "cleanup_ready",
        source: "test",
        detectedAt: "2099-05-07T13:00:00.000Z",
        repo: "lossyrob/streamliner",
        number: 86,
        sha: "def456",
        url: "https://github.com/lossyrob/streamliner/pull/86",
      }],
    });

    const validation = await validateManagedCleanup(
      updated,
      store.listSessions({ includeArchived: false }),
      cleanupDeps(root, {
        runGh: () => ({
          status: 0,
          stdout: JSON.stringify({
            state: "MERGED",
            mergedAt: "2026-05-07T13:30:00Z",
            headRefOid: "def456",
            url: "https://github.com/lossyrob/streamliner/pull/86",
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
          if (command === "rev-parse --verify -- feature/cleanup") {
            return { status: 0, stdout: "def456\n", stderr: "" };
          }
          return { status: 1, stdout: "", stderr: `Unexpected git command: ${command}` };
        },
      }),
    );

    expect(validation).toEqual({
      ok: true,
      plan: expect.objectContaining({
        pr: expect.objectContaining({ number: 86, headSha: "def456" }),
      }),
    });
  });

  it("reports partial cleanup when branch deletion fails after worktree removal", async () => {
    const root = createRootDir();
    const result = await executeManagedCleanup(
      {
        worktreePath: normalizePath(root),
        repoRoot: normalizePath(root),
        branch: "feature/cleanup",
        pr: {
          repo: "lossyrob/streamliner",
          number: 75,
          url: "https://github.com/lossyrob/streamliner/pull/75",
          headSha: "abc123",
        },
      },
      {
        runGh: () => ({ status: 0, stdout: "", stderr: "" }),
        runGit: (_cwd, args) => {
          const command = args.join(" ");
          if (command === `worktree remove -- ${normalizePath(root)}`) {
            return { status: 0, stdout: "", stderr: "" };
          }
          if (command === "show-ref --verify --quiet -- refs/heads/feature/cleanup") {
            return { status: 0, stdout: "", stderr: "" };
          }
          if (command === "worktree list --porcelain") {
            return { status: 0, stdout: "", stderr: "" };
          }
          if (command === "rev-parse --verify -- feature/cleanup") {
            return { status: 0, stdout: "abc123\n", stderr: "" };
          }
          if (command === "branch -D -- feature/cleanup") {
            return { status: 1, stdout: "", stderr: "cannot delete branch" };
          }
          return { status: 1, stdout: "", stderr: `Unexpected git command: ${command}` };
        },
      },
    );

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      removedWorktree: true,
      deletedBranch: false,
      blockers: [expect.objectContaining({ code: "cleanup-command-failed" })],
    }));
  });
});
