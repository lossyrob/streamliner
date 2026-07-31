import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NotificationStore, type NotificationDraft } from "./notification-store";

const roots: string[] = [];

function tempStorePath(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-notif-store-"));
  roots.push(root);
  return join(root, "notifications", "notifications.ndjson");
}

function draft(overrides: Partial<NotificationDraft> = {}): NotificationDraft {
  return {
    title: "t",
    body: "b",
    severity: "info",
    eventKind: "generic",
    workstreamId: null,
    projectKey: null,
    workstreamColor: null,
    workstreamShortName: null,
    nodeId: null,
    sessionId: null,
    link: null,
    source: "cli",
    ...overrides,
  };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe("NotificationStore", () => {
  it("creates the directory on first write and assigns id 1", async () => {
    const storePath = tempStorePath();
    const store = new NotificationStore({ storePath });
    const record = await store.append(draft({ title: "first" }));
    expect(record.id).toBe(1);
    expect(record.title).toBe("first");
    expect(readFileSync(storePath, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("seeds nextId from the max id in an existing file", async () => {
    const storePath = tempStorePath();
    const first = new NotificationStore({ storePath });
    await first.append(draft());
    await first.append(draft());

    const resumed = new NotificationStore({ storePath });
    const next = await resumed.append(draft());
    expect(next.id).toBe(3);
    expect(await resumed.maxId()).toBe(3);
  });

  it("assigns strictly unique monotonic ids under concurrent appends", async () => {
    const store = new NotificationStore({ storePath: tempStorePath() });
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => store.append(draft({ title: `n${i}` }))),
    );
    const ids = results.map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("listSince returns records strictly greater than afterId, oldest-first", async () => {
    const store = new NotificationStore({ storePath: tempStorePath() });
    for (let i = 0; i < 5; i += 1) {
      await store.append(draft({ title: `n${i}` }));
    }
    const since = await store.listSince(2);
    expect(since.map((r) => r.id)).toEqual([3, 4, 5]);
    // Strict boundary: afterId equal to the last id yields nothing.
    expect(await store.listSince(5)).toHaveLength(0);
  });

  it("listSince caps to the FIRST `limit` records after the cursor (forward paging)", async () => {
    const store = new NotificationStore({ storePath: tempStorePath() });
    for (let i = 0; i < 10; i += 1) {
      await store.append(draft({ title: `n${i}` }));
    }
    // Must return the contiguous window right after the cursor, not the newest.
    expect((await store.listSince(2, 3)).map((r) => r.id)).toEqual([3, 4, 5]);
  });

  it("listRecent returns newest-last and honors the limit", async () => {
    const store = new NotificationStore({ storePath: tempStorePath() });
    for (let i = 0; i < 5; i += 1) {
      await store.append(draft({ title: `n${i}` }));
    }
    const recent = await store.listRecent(2);
    expect(recent.map((r) => r.id)).toEqual([4, 5]);
  });

  it("returns an empty list when the store file does not exist", async () => {
    const store = new NotificationStore({ storePath: tempStorePath() });
    expect(await store.listRecent()).toEqual([]);
    expect(await store.maxId()).toBe(0);
  });
});
