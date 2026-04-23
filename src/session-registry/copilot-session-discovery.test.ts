import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionRegistryFileStore } from "./file-store";
import {
  discoverCopilotSessions,
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
    writeFileSync(join(sessionDir, "inuse.12345.lock"), "", "utf8");
  }
}

afterEach(() => {
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
      }),
      expect.objectContaining({
        sessionId: "session-2",
        title: "Edit Presentation Spec",
        description: "azure-data-database-platform/dbagent · main",
        lifecycleStatus: "ended",
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
          repo: "lossyrob/streamliner",
          branch: "feature/manual-session-registry",
          lifecycleStatus: "active",
        }),
        expect.objectContaining({
          id: "session-2",
          copilotSessionId: "session-2",
          title: "Edit Presentation Spec",
          repo: "azure-data-database-platform/dbagent",
          branch: "main",
          lifecycleStatus: "ended",
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
        branch: "main",
        lastSeenAt: "2026-04-23T19:00:00.000Z",
        lifecycleStatus: "ended",
      }),
    );
  });
});
