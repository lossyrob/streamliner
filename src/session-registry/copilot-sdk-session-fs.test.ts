import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupResidualDefaultCopilotSessionState,
  createCopilotSdkSessionFsHandle,
  getCopilotSdkSessionFsConfig,
} from "./copilot-sdk-session-fs";

const createdHandles: Array<ReturnType<typeof createCopilotSdkSessionFsHandle>> = [];

afterEach(async () => {
  for (const handle of createdHandles.splice(0)) {
    await handle.cleanup();
  }
});

describe("copilot sdk session fs", () => {
  it("stores session-state files outside ~/.copilot/session-state", async () => {
    const handle = createCopilotSdkSessionFsHandle("test-session");
    createdHandles.push(handle);
    const config = getCopilotSdkSessionFsConfig();
    const eventsPath = `${config.sessionStatePath}\\events.jsonl`;

    await handle.provider.writeFile(eventsPath, "hello");

    expect(await handle.provider.readFile(eventsPath)).toBe("hello");
    expect(handle.rootDir).toContain("copilot-sdk-session-fs");
    expect(handle.rootDir).not.toContain(".copilot\\session-state");
  });

  it("supports stat, directory listing, rename, and cleanup", async () => {
    const handle = createCopilotSdkSessionFsHandle("test-session-ops");
    createdHandles.push(handle);
    const config = getCopilotSdkSessionFsConfig();
    const stateDir = config.sessionStatePath;
    const firstPath = `${stateDir}\\workspace.yaml`;
    const renamedPath = `${stateDir}\\workspace-renamed.yaml`;

    await handle.provider.writeFile(firstPath, "id: test-session-ops");

    expect(await handle.provider.exists(firstPath)).toBe(true);
    expect(await handle.provider.readdir(stateDir)).toEqual(["workspace.yaml"]);
    expect(await handle.provider.readdirWithTypes(stateDir)).toEqual([
      { name: "workspace.yaml", type: "file" },
    ]);

    const fileInfo = await handle.provider.stat(firstPath);
    expect(fileInfo.isFile).toBe(true);
    expect(fileInfo.isDirectory).toBe(false);
    expect(fileInfo.size).toBeGreaterThan(0);

    await handle.provider.rename(firstPath, renamedPath);
    expect(await handle.provider.exists(firstPath)).toBe(false);
    expect(await handle.provider.exists(renamedPath)).toBe(true);

    const rootDir = handle.rootDir;
    expect(existsSync(rootDir)).toBe(true);
    await handle.cleanup();
    expect(existsSync(rootDir)).toBe(false);

    createdHandles.splice(createdHandles.indexOf(handle), 1);
  });

  it("removes the SDK helper's default copilot session-state stub", async () => {
    const sessionId = "test-sdk-helper-stub";
    const defaultDir = resolve(homedir(), ".copilot", "session-state", sessionId);
    mkdirSync(defaultDir, { recursive: true });

    expect(existsSync(defaultDir)).toBe(true);
    await cleanupResidualDefaultCopilotSessionState(sessionId);
    expect(existsSync(defaultDir)).toBe(false);
  });
});
