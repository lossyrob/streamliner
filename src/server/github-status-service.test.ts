import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionRegistryFileStore } from "../session-registry/file-store";
import { createStreamlinerApiApp, type StreamlinerApiApp } from "./app";
import {
  createGithubStatusService,
  type GithubStatusFetch,
  type GithubStatusHttpResponse,
  type GithubStatusServiceOptions,
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createApi(
  fetch: GithubStatusFetch,
  githubStatusDeps: Partial<GithubStatusServiceOptions> = { authToken: null },
): StreamlinerApiApp {
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
      ...githubStatusDeps,
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
      if (url.endsWith("/issues/69/timeline?per_page=100")) {
        return githubResponse([]);
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
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await request(api.app)
      .get("/api/github/status")
      .query({ ref: "issue:lossyrob/streamliner#69" })
      .expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses a resolved auth token for GitHub requests", async () => {
    const authTokenProvider = vi.fn(async () => "gh-cli-token");
    const fetchMock = vi.fn<GithubStatusFetch>(async (url, init) => {
      expect(init?.headers?.Authorization).toBe("Bearer gh-cli-token");
      if (url.endsWith("/pulls/70")) {
        return githubResponse({
          title: "Implement live status",
          html_url: "https://github.com/lossyrob/streamliner/pull/70",
          state: "open",
          draft: false,
          merged: false,
          mergeable_state: "clean",
        });
      }
      throw new Error(`Unexpected GitHub URL: ${url}`);
    });
    const api = createApi(fetchMock, { authTokenProvider });

    await request(api.app)
      .get("/api/github/status")
      .query({ ref: "pr:lossyrob/streamliner#70" })
      .expect(200);

    expect(authTokenProvider).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("selects a configured gh auth profile for the requested repository", async () => {
    const authSettingsPath = join(createRoot(), "github-auth.json");
    writeFileSync(
      authSettingsPath,
      JSON.stringify({
        profiles: {
          personal: {
            ghConfigDir: "C:\\Users\\robemanuele\\AppData\\Roaming\\gh-pub",
            user: "lossyrob",
          },
        },
        repositories: {
          "github.com/lossyrob/streamliner": "personal",
        },
      }),
      "utf8",
    );
    const ghAuthTokenProvider = vi.fn(async () => "profile-token");
    const fetchMock = vi.fn<GithubStatusFetch>(async (url, init) => {
      expect(init?.headers?.Authorization).toBe("Bearer profile-token");
      if (url.endsWith("/pulls/70")) {
        return githubResponse({
          title: "Implement live status",
          html_url: "https://github.com/lossyrob/streamliner/pull/70",
          state: "open",
          draft: false,
          merged: false,
          mergeable_state: "clean",
        });
      }
      throw new Error(`Unexpected GitHub URL: ${url}`);
    });
    const api = createApi(fetchMock, {
      authSettingsPath,
      ghAuthTokenProvider,
    });

    await request(api.app)
      .get("/api/github/status")
      .query({ ref: "pr:lossyrob/streamliner#70" })
      .expect(200);

    expect(ghAuthTokenProvider).toHaveBeenCalledWith(
      {
        ghConfigDir: "C:\\Users\\robemanuele\\AppData\\Roaming\\gh-pub",
        user: "lossyrob",
      },
      expect.objectContaining({
        owner: "lossyrob",
        repo: "streamliner",
      }),
    );
  });

  it("includes linked PR status from issue timeline events", async () => {
    const fetchMock = vi.fn<GithubStatusFetch>(async (url) => {
      if (url.endsWith("/issues/69")) {
        return githubResponse({
          title: "Show live GitHub status",
          html_url: "https://github.com/lossyrob/streamliner/issues/69",
          state: "open",
          state_reason: null,
        });
      }
      if (url.endsWith("/issues/69/timeline?per_page=100")) {
        return githubResponse([
          {
            event: "cross-referenced",
            source: {
              issue: {
                number: 70,
                repository_url: "https://api.github.com/repos/lossyrob/streamliner",
                pull_request: {
                  url: "https://api.github.com/repos/lossyrob/streamliner/pulls/70",
                },
              },
            },
          },
        ]);
      }
      if (url.endsWith("/pulls/70")) {
        return githubResponse({
          title: "Implement live status",
          html_url: "https://github.com/lossyrob/streamliner/pull/70",
          state: "open",
          draft: false,
          merged: false,
          mergeable_state: "unstable",
        });
      }
      throw new Error(`Unexpected GitHub URL: ${url}`);
    });
    const api = createApi(fetchMock);

    const response = await request(api.app)
      .get("/api/github/status")
      .query({ ref: "issue:lossyrob/streamliner#69" })
      .expect(200);

    expect(response.body.statuses[0]).toMatchObject({
      key: "issue:lossyrob/streamliner#69",
      type: "issue",
      linkedPullRequests: [
        {
          key: "pr:lossyrob/streamliner#70",
          type: "pr",
          state: "open",
          validationState: "failing",
          validationLabel: "checks failing",
          statusLabel: "PR checks failing",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("bounds GitHub fetch concurrency and coalesces concurrent status misses", async () => {
    const refs = [69, 70, 71, 72].map((number) => ({
      type: "issue" as const,
      owner: "lossyrob",
      repo: "streamliner",
      number,
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn<GithubStatusFetch>(async (url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await wait(5);
      inFlight -= 1;

      if (url.includes("/timeline")) {
        return githubResponse([]);
      }
      const match = url.match(/\/issues\/(\d+)$/);
      if (match) {
        return githubResponse({
          title: `Issue ${match[1]}`,
          html_url: `https://github.com/lossyrob/streamliner/issues/${match[1]}`,
          state: "open",
          state_reason: null,
        });
      }
      throw new Error(`Unexpected GitHub URL: ${url}`);
    });
    const service = createGithubStatusService({
      fetch: fetchMock,
      authToken: null,
      now: () => TEST_NOW,
      fetchConcurrency: 2,
    });

    await Promise.all([
      service.getStatuses(refs),
      service.getStatuses(refs),
    ]);

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalledTimes(refs.length * 2);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.endsWith("/issues/69")),
    ).toHaveLength(1);
  });

  it("fetches linked PR statuses concurrently under the shared fetch limit", async () => {
    let pullRequestsInFlight = 0;
    let maxPullRequestsInFlight = 0;
    const fetchMock = vi.fn<GithubStatusFetch>(async (url) => {
      if (url.endsWith("/issues/69")) {
        return githubResponse({
          title: "Show live GitHub status",
          html_url: "https://github.com/lossyrob/streamliner/issues/69",
          state: "open",
          state_reason: null,
        });
      }
      if (url.endsWith("/issues/69/timeline?per_page=100")) {
        return githubResponse(
          [70, 71, 72].map((number) => ({
            event: "cross-referenced",
            source: {
              issue: {
                number,
                repository_url: "https://api.github.com/repos/lossyrob/streamliner",
                pull_request: {
                  url: `https://api.github.com/repos/lossyrob/streamliner/pulls/${number}`,
                },
              },
            },
          })),
        );
      }
      const match = url.match(/\/pulls\/(\d+)$/);
      if (match) {
        pullRequestsInFlight += 1;
        maxPullRequestsInFlight = Math.max(
          maxPullRequestsInFlight,
          pullRequestsInFlight,
        );
        await wait(5);
        pullRequestsInFlight -= 1;
        return githubResponse({
          title: `PR ${match[1]}`,
          html_url: `https://github.com/lossyrob/streamliner/pull/${match[1]}`,
          state: "open",
          draft: false,
          merged: false,
          mergeable_state: "clean",
        });
      }
      throw new Error(`Unexpected GitHub URL: ${url}`);
    });
    const service = createGithubStatusService({
      fetch: fetchMock,
      authToken: null,
      now: () => TEST_NOW,
      fetchConcurrency: 2,
    });

    const [status] = await service.getStatuses([
      {
        type: "issue",
        owner: "lossyrob",
        repo: "streamliner",
        number: 69,
      },
    ]);

    expect(status).toMatchObject({
      type: "issue",
      linkedPullRequests: [
        { key: "pr:lossyrob/streamliner#70" },
        { key: "pr:lossyrob/streamliner#71" },
        { key: "pr:lossyrob/streamliner#72" },
      ],
    });
    expect(maxPullRequestsInFlight).toBe(2);
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
