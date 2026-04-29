import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionRegistryFileStore } from "./file-store";
import {
  __resetCopilotDiscoveryCacheForTests,
  discoverCopilotSessions,
  rememberIgnoredObservedCopilotSessionId,
  syncDiscoveredCopilotSessions,
} from "./copilot-session-discovery";

const createdRoots: string[] = [];

function createRootDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeWorkspaceFile(
  sessionRoot: string,
  sessionId: string,
  content: string,
  { active = false }: { active?: boolean } = {},
): void {
  const sessionDir = join(sessionRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  for (const fileName of readdirSync(sessionDir)) {
    if (/^inuse\..+\.lock$/i.test(fileName)) {
      rmSync(join(sessionDir, fileName), { force: true });
    }
  }
  writeFileSync(join(sessionDir, "workspace.yaml"), content, "utf8");
  if (active) {
    writeFileSync(join(sessionDir, `inuse.${process.pid}.lock`), "", "utf8");
  }
}

afterEach(() => {
  __resetCopilotDiscoveryCacheForTests();
  for (const rootDir of createdRoots.splice(0)) {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

describe("copilot session discovery", () => {
  it("imports workspace sessions and preserves builder-owned fields on refresh", () => {
    const registryRoot = createRootDir("streamliner-session-registry-discovery-");
    const sessionRoot = createRootDir("streamliner-copilot-session-state-");
    createdRoots.push(registryRoot, sessionRoot);

    writeWorkspaceFile(
      sessionRoot,
      "session-1",
      [
        "id: session-1",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: feature/manual-session-registry",
        "summary: Follow Paw-Lite Process",
        "updated_at: 2026-04-23T18:28:32.345Z",
      ].join("\n"),
      { active: true },
    );
    writeWorkspaceFile(
      sessionRoot,
      "session-2",
      [
        "id: session-2",
        "cwd: C:\\Users\\robemanuele\\proj\\dbagent\\dbagent",
        "repository: azure-data-database-platform/dbagent",
        "branch: main",
        "summary: |-",
        "  Edit Presentation Spec",
        "updated_at: 2026-04-23T17:55:57.508Z",
      ].join("\n"),
    );

    expect(discoverCopilotSessions(sessionRoot)).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        title: "Follow Paw-Lite Process",
        description: "lossyrob/streamliner · feature/manual-session-registry",
        lifecycleStatus: "active",
        observedSessionKind: "interactive",
        copilotProcessState: "live",
        copilotProcessId: process.pid,
      }),
      expect.objectContaining({
        sessionId: "session-2",
        title: "Edit Presentation Spec",
        description: "azure-data-database-platform/dbagent · main",
        lifecycleStatus: "ended",
        observedSessionKind: "interactive",
        copilotProcessState: "none",
        copilotProcessId: null,
      }),
    ]);

    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    expect(syncDiscoveredCopilotSessions(store, sessionRoot)).toBe(2);

    const imported = store.listSessions({ includeArchived: true });
    expect(imported).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "session-1",
          copilotSessionId: "session-1",
          title: "Follow Paw-Lite Process",
          titleSource: "auto",
          repo: "lossyrob/streamliner",
          branch: "feature/manual-session-registry",
          lifecycleStatus: "active",
          observedSessionKind: "interactive",
          copilotProcessState: "live",
          copilotProcessId: process.pid,
        }),
        expect.objectContaining({
          id: "session-2",
          copilotSessionId: "session-2",
          title: "Edit Presentation Spec",
          titleSource: "auto",
          repo: "azure-data-database-platform/dbagent",
          branch: "main",
          lifecycleStatus: "ended",
          observedSessionKind: "interactive",
          copilotProcessState: "none",
        }),
      ]),
    );

    store.patchSession("session-1", { title: "Custom session title" });
    writeWorkspaceFile(
      sessionRoot,
      "session-1",
      [
        "id: session-1",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: main",
        "summary: Follow Paw-Lite Process",
        "updated_at: 2026-04-23T19:00:00.000Z",
      ].join("\n"),
    );

    expect(syncDiscoveredCopilotSessions(store, sessionRoot)).toBe(1);
    expect(store.getSession("session-1")).toEqual(
      expect.objectContaining({
        title: "Custom session title",
        titleSource: "user",
        branch: "main",
        lastSeenAt: "2026-04-23T19:00:00.000Z",
        lifecycleStatus: "ended",
      }),
    );
  });

  it("adopts Copilot workspace titles for trusted sessions until they are renamed", () => {
    const registryRoot = createRootDir("streamliner-session-registry-discovery-");
    const sessionRoot = createRootDir("streamliner-copilot-session-state-");
    createdRoots.push(registryRoot, sessionRoot);
    const store = new SessionRegistryFileStore({ rootDir: registryRoot });

    store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "trusted-planning-session",
      timestamp: "2026-04-27T13:00:00.000Z",
      cwd: "C:\\Users\\robemanuele\\proj\\planning",
      repo: "lossyrob/planning",
      branch: "main",
      hookSource: "new",
      executionKind: "copilot_cli",
    });
    expect(store.getSession("trusted-planning-session")).toEqual(
      expect.objectContaining({
        title: "planning",
        titleSource: "auto",
      }),
    );

    writeWorkspaceFile(
      sessionRoot,
      "trusted-planning-session",
      [
        "id: trusted-planning-session",
        "cwd: C:\\Users\\robemanuele\\proj\\planning",
        "repository: lossyrob/planning",
        "branch: main",
        "summary: Plan Manual Session Titles",
        "updated_at: 2026-04-27T13:05:00.000Z",
      ].join("\n"),
      { active: true },
    );
    expect(syncDiscoveredCopilotSessions(store, sessionRoot)).toBe(1);
    expect(store.getSession("trusted-planning-session")).toEqual(
      expect.objectContaining({
        title: "Plan Manual Session Titles",
        titleSource: "auto",
      }),
    );

    store.patchSession("trusted-planning-session", { title: "My planning terminal" });
    writeWorkspaceFile(
      sessionRoot,
      "trusted-planning-session",
      [
        "id: trusted-planning-session",
        "cwd: C:\\Users\\robemanuele\\proj\\planning",
        "repository: lossyrob/planning",
        "branch: feature/title-refresh",
        "summary: Updated Copilot Workspace Title",
        "updated_at: 2026-04-27T13:10:00.000Z",
      ].join("\n"),
      { active: true },
    );

    expect(syncDiscoveredCopilotSessions(store, sessionRoot)).toBe(1);
    expect(store.getSession("trusted-planning-session")).toEqual(
      expect.objectContaining({
        title: "My planning terminal",
        titleSource: "user",
        branch: "feature/title-refresh",
      }),
    );
  });

  it("classifies summarizer helper sessions and stale locks", () => {
    const sessionRoot = createRootDir("streamliner-copilot-session-state-");
    createdRoots.push(sessionRoot);

    writeWorkspaceFile(
      sessionRoot,
      "helper-session",
      [
        "id: helper-session",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: feature/manual-session-registry",
        "summary: |-",
        "  Repo: lossyrob/streamliner",
        "  Branch: feature/manual-session-registry",
        "  Existing title: Manual session registry",
        "  ",
        "  Based on the user's recent messages below, produce the summary phrase now.",
        "  ",
        "  --- User turn 1 ---",
        "  Summarize this session.",
        "updated_at: 2026-04-23T18:28:32.345Z",
      ].join("\n"),
    );
    writeWorkspaceFile(
      sessionRoot,
      "stale-lock-session",
      [
        "id: stale-lock-session",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: feature/manual-session-registry",
        "summary: Real session",
        "updated_at: 2026-04-23T18:28:32.345Z",
      ].join("\n"),
    );
    writeWorkspaceFile(
      sessionRoot,
      "sdk-helper-session",
      [
        "id: sdk-helper-session",
        "cwd: C:\\Users\\robemanuele\\.streamliner\\state\\copilot-sdk-session-fs",
        "summary: copilot-sdk-session-fs",
        "updated_at: 2026-04-23T18:28:32.345Z",
      ].join("\n"),
    );
    writeFileSync(
      join(sessionRoot, "stale-lock-session", "inuse.999999.lock"),
      "",
      "utf8",
    );
    rememberIgnoredObservedCopilotSessionId("helper-session");

    expect(discoverCopilotSessions(sessionRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "helper-session",
          observedSessionKind: "helper",
          copilotProcessState: "none",
          lifecycleStatus: "ended",
        }),
        expect.objectContaining({
          sessionId: "sdk-helper-session",
          observedSessionKind: "helper",
          copilotProcessState: "none",
          lifecycleStatus: "ended",
        }),
        expect.objectContaining({
          sessionId: "stale-lock-session",
          observedSessionKind: "interactive",
          copilotProcessState: "stale_lock",
          copilotProcessId: null,
          lifecycleStatus: "ended",
        }),
      ]),
    );
  });

  it("prunes persisted helper-like observed sessions even after the source folders are gone", () => {
    const registryRoot = createRootDir("streamliner-session-registry-prune-");
    const sessionRoot = createRootDir("streamliner-copilot-session-state-");
    createdRoots.push(registryRoot, sessionRoot);

    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    store.upsertSession({
      id: "legacy-helper",
      title: [
        "Repo: lossyrob/streamliner",
        "Branch: feature/manual-session-registry",
        "Cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "Existing title: Manual session registry",
      ].join("\n"),
      description: "lossyrob/streamliner · feature/manual-session-registry",
      cwd: "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
      repo: "lossyrob/streamliner",
      branch: "feature/manual-session-registry",
      copilotSessionId: "legacy-helper",
      lastSeenAt: "2026-04-24T02:50:57.121Z",
      lifecycleStatus: "ended",
      origin: {
        kind: "observed",
        importedFromCopilotSessionId: "legacy-helper",
      },
    });
    store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "trusted-sdk-helper",
      timestamp: "2026-04-24T20:00:00.000Z",
      cwd: "C:\\Users\\robemanuele\\.streamliner\\state\\copilot-sdk-session-fs",
      hookSource: "new",
      executionKind: "copilot_cli",
    });

    expect(syncDiscoveredCopilotSessions(store, sessionRoot)).toBe(2);
    expect(store.getSession("legacy-helper")).toBeNull();
    expect(store.getSession("trusted-sdk-helper")).toBeNull();
  });

  it("skips importing helper sessions into the persisted observed registry", () => {
    const registryRoot = createRootDir("streamliner-session-registry-skip-helper-");
    const sessionRoot = createRootDir("streamliner-copilot-session-state-");
    createdRoots.push(registryRoot, sessionRoot);

    writeWorkspaceFile(
      sessionRoot,
      "helper-session",
      [
        "id: helper-session",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: feature/manual-session-registry",
        "summary: |-",
        "  Repo: lossyrob/streamliner",
        "  Branch: feature/manual-session-registry",
        "  Cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "  Existing title: Manual session registry",
        "  ",
        "  Based on the user's recent messages below, produce the summary phrase now.",
        "  ",
        "  --- User turn 1 ---",
        "  Summarize this session.",
        "updated_at: 2026-04-23T18:28:32.345Z",
      ].join("\n"),
    );
    writeWorkspaceFile(
      sessionRoot,
      "interactive-session",
      [
        "id: interactive-session",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: feature/manual-session-registry",
        "summary: Real interactive session",
        "updated_at: 2026-04-23T19:28:32.345Z",
      ].join("\n"),
      { active: true },
    );

    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    expect(syncDiscoveredCopilotSessions(store, sessionRoot)).toBe(1);
    expect(store.listSessions({ includeArchived: true })).toEqual([
      expect.objectContaining({
        id: "interactive-session",
        title: "Real interactive session",
        observedSessionKind: "interactive",
        copilotSessionId: "interactive-session",
      }),
    ]);
  });

  it("keeps trusted sessions resumable when discovery sees no running process and no end signal", () => {
    const registryRoot = createRootDir("streamliner-session-registry-trusted-");
    const sessionRoot = createRootDir("streamliner-copilot-session-state-");
    createdRoots.push(registryRoot, sessionRoot);

    writeWorkspaceFile(
      sessionRoot,
      "trusted-interrupted",
      [
        "id: trusted-interrupted",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: feature/manual-session-registry",
        "summary: Trusted session without end signal",
        "updated_at: 2026-04-24T20:30:00.000Z",
      ].join("\n"),
    );

    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "trusted-interrupted",
      timestamp: "2026-04-24T20:00:00.000Z",
      cwd: "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
      hookSource: "resume",
      executionKind: "agency",
    });

    expect(syncDiscoveredCopilotSessions(store, sessionRoot)).toBe(1);
    expect(store.getSession("trusted-interrupted")).toEqual(
      expect.objectContaining({
        lifecycleStatus: "active",
        copilotProcessState: "none",
        trustedStartedAt: "2026-04-24T20:00:00.000Z",
        trustedEndedAt: null,
        trustedExecutionKind: "agency",
      }),
    );
  });

  it("keeps lifecycleStatus ended after a trusted end signal even if the OS process is still observed alive", () => {
    const registryRoot = createRootDir("streamliner-session-registry-ended-live-");
    const sessionRoot = createRootDir("streamliner-copilot-session-state-");
    createdRoots.push(registryRoot, sessionRoot);

    writeWorkspaceFile(
      sessionRoot,
      "ended-but-process-alive",
      [
        "id: ended-but-process-alive",
        "cwd: C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        "repository: lossyrob/streamliner",
        "branch: feature/relaunch",
        "summary: Trusted session that ended while its process lingers",
        "updated_at: 2026-04-29T16:55:00.000Z",
      ].join("\n"),
      { active: true },
    );

    const store = new SessionRegistryFileStore({ rootDir: registryRoot });
    store.recordTrustedSessionSignal({
      event: "session.started",
      source: "copilot-cli-hook",
      sessionId: "ended-but-process-alive",
      timestamp: "2026-04-29T16:53:29.000Z",
      cwd: "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
      hookSource: "resume",
      executionKind: "copilot_cli",
    });
    store.recordTrustedSessionSignal({
      event: "session.ended",
      source: "copilot-cli-hook",
      sessionId: "ended-but-process-alive",
      timestamp: "2026-04-29T16:55:25.000Z",
      cwd: "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
      endReason: "user_exit",
      executionKind: "copilot_cli",
    });

    syncDiscoveredCopilotSessions(store, sessionRoot);

    const record = store.getSession("ended-but-process-alive");
    expect(record).toEqual(
      expect.objectContaining({
        lifecycleStatus: "ended",
        trustedEndedAt: "2026-04-29T16:55:25.000Z",
        trustedEndReason: "user_exit",
      }),
    );
  });
});
