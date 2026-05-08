import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionRegistryFileStore } from "../session-registry/file-store";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";
import type {
  GithubStatusFetch,
  GithubStatusHttpResponse,
} from "./github-status-service";

const TEST_NOW = new Date("2026-05-08T12:00:00.000Z");
const roots: string[] = [];
const apps: StreamlinerApiApp[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "streamliner-github-status-"));
  roots.push(root);
  return root;
}

function headers(values: Record<string, string> = {}) {
  return {
    get(name: string): string | null {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

function githubResponse(
  body: unknown,
  status = 200,
  headerValues: Record<string, string> = {},
): GithubStatusHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(headerValues),
    json: async () => body,
  };
}

function createApi(fetch: GithubStatusFetch): StreamlinerApiApp {
  const root = createRoot();
  const api = createStreamlinerApiApp({
    store: new SessionRegistryFileStore({ rootDir: join(root, "registry") }),
    recentsPath: join(root, "recents.json"),
    workstreamRegistryPath: join(root, "workstreams.json"),
    workstreamSourceRegistryPath: join(root, "sources.json"),
    nodeLaunchRecordsPath: join(root, "node-launch-records.json"),
    githubStatusDeps: {
      fetch,
      now: () => TEST_NOW,
      authToken: null,
    },
  });
  apps.push(api);
  return api;
}

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("GitHub status API", () => {
  it("dedupes refs, normalizes issue and PR status, and caches successful results", async () => {
    const fetchMock = vi.fn<GithubStatusFetch>(async (url) => {
      if (url.endsWith("/issues/69")) {
        return githubResponse({
          title: "Show live GitHub status",
          html_url: "https://github.com/lossyrob/streamliner/issues/69",
          state: "open",
          state_reason: null,
        });
      }
      if (url.endsWith("/pulls/70")) {
        return githubResponse({
          title: "Implement live status",
          html_url: "https://github.com/lossyrob/streamliner/pull/70",
          state: "open",
          draft: true,
          merged: false,
          mergeable_state: "draft",
        });
      }
      throw new Error(`Unexpected GitHub URL: ${url}`);
    });
    const api = createApi(fetchMock);

    const response = await request(api.app)
      .get("/api/github/status")
      .query({
        ref: [
          "issue:lossyrob/streamliner#69",
          "pr:lossyrob/streamliner#70",
          "issue:lossyrob/streamliner#69",
        ],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      generatedAt: TEST_NOW.toISOString(),
      statuses: [
        {
          key: "issue:lossyrob/streamliner#69",
          type: "issue",
          state: "open",
          statusLabel: "issue open",
          title: "Show live GitHub status",
        },
        {
          key: "pr:lossyrob/streamliner#70",
          type: "pr",
          state: "open",
          isDraft: true,
          statusLabel: "PR draft",
          validationState: "pending",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await request(api.app)
      .get("/api/github/status")
      .query({ ref: "issue:lossyrob/streamliner#69" })
      .expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns per-ref degraded status for rate limits", async () => {
    const fetchMock = vi.fn<GithubStatusFetch>(async () =>
      githubResponse(
        { message: "API rate limit exceeded" },
        403,
        { "x-ratelimit-remaining": "0", "retry-after": "30" },
      )
    );
    const api = createApi(fetchMock);

    const response = await request(api.app)
      .get("/api/github/status")
      .query({ ref: "issue:lossyrob/streamliner#69" })
      .expect(200);

    expect(response.body.statuses).toEqual([
      expect.objectContaining({
        key: "issue:lossyrob/streamliner#69",
        type: "issue",
        state: "unknown",
        statusLabel: "issue unknown",
        rateLimited: true,
        error: expect.objectContaining({
          code: "rate_limited",
          status: 403,
          retryAfterSeconds: 30,
        }),
      }),
    ]);
  });

  it("rejects invalid ref query parameters", async () => {
    const api = createApi(vi.fn<GithubStatusFetch>());

    const response = await request(api.app)
      .get("/api/github/status")
      .query({ ref: "github:lossyrob/streamliner#69" })
      .expect(400);

    expect(response.body).toEqual({
      code: "invalid_github_status_ref",
      error:
        "Expected each ref query parameter to use issue:owner/repo#number or pr:owner/repo#number.",
      ref: "github:lossyrob/streamliner#69",
    });
  });
});
