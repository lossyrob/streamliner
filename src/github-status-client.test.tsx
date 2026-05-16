// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GithubIssueStatusResult,
  GithubStatusBatchResponse,
  GithubStatusRef,
} from "./github-status";
import {
  type GithubStatusLookupState,
  useGithubStatusLookup,
} from "./github-status-client";

const ISSUE_REF: GithubStatusRef = {
  type: "issue",
  owner: "lossyrob",
  repo: "streamliner",
  number: 69,
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 1_000) {
    await act(async () => {
      await wait(0);
    });
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function issueStatus(
  state: GithubIssueStatusResult["state"],
  fetchedAt: string,
): GithubIssueStatusResult {
  return {
    key: "issue:lossyrob/streamliner#69",
    ref: ISSUE_REF,
    type: "issue",
    title: "Show live GitHub status",
    url: "https://github.com/lossyrob/streamliner/issues/69",
    state,
    stateReason: null,
    linkedPullRequests: [],
    fetchedAt,
    statusLabel: state === "closed" ? "issue closed" : "issue open",
  };
}

function batchResponse(status: GithubIssueStatusResult): GithubStatusBatchResponse {
  return {
    generatedAt: status.fetchedAt,
    statuses: [status],
  };
}

function response(body: GithubStatusBatchResponse): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

interface HarnessProps {
  refs: GithubStatusRef[];
  refreshKey: number;
  onState: (state: GithubStatusLookupState) => void;
}

function Harness({ refs, refreshKey, onState }: HarnessProps) {
  const state = useGithubStatusLookup(refs, refreshKey);
  useEffect(() => {
    onState(state);
  }, [onState, state]);
  return null;
}

describe("useGithubStatusLookup", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestState: GithubStatusLookupState | null;
  let onState: (state: GithubStatusLookupState) => void;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latestState = null;
    onState = (state) => {
      latestState = state;
    };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(
    refs: GithubStatusRef[],
    refreshKey: number,
  ): Promise<void> {
    await act(async () => {
      root.render(
        <Harness refs={refs} refreshKey={refreshKey} onState={onState} />,
      );
    });
  }

  it("does not refetch when callers recreate the same semantic ref set", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response(batchResponse(issueStatus("open", "2026-05-08T12:00:00.000Z"))),
    );
    vi.stubGlobal("fetch", fetchMock);

    await render([ISSUE_REF], 0);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(latestState?.statuses.size).toBe(1);
    });

    await render([{ ...ISSUE_REF }], 0);
    await act(async () => {
      await wait(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the status map when refreshes only change fetchedAt", async () => {
    const bodies = [
      batchResponse(issueStatus("open", "2026-05-08T12:00:00.000Z")),
      batchResponse(issueStatus("open", "2026-05-08T12:01:00.000Z")),
    ];
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const body = bodies.shift();
      if (!body) {
        throw new Error("Unexpected extra GitHub status request");
      }
      return response(body);
    });
    vi.stubGlobal("fetch", fetchMock);

    await render([ISSUE_REF], 0);
    await waitFor(() => {
      expect(latestState?.statuses.size).toBe(1);
    });
    const firstMap = latestState?.statuses;

    await render([ISSUE_REF], 1);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(latestState?.statuses).toBe(firstMap);
  });

  it("replaces the status map when status content changes", async () => {
    const bodies = [
      batchResponse(issueStatus("open", "2026-05-08T12:00:00.000Z")),
      batchResponse(issueStatus("closed", "2026-05-08T12:01:00.000Z")),
    ];
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const body = bodies.shift();
      if (!body) {
        throw new Error("Unexpected extra GitHub status request");
      }
      return response(body);
    });
    vi.stubGlobal("fetch", fetchMock);

    await render([ISSUE_REF], 0);
    await waitFor(() => {
      expect(latestState?.statuses.size).toBe(1);
    });
    const firstMap = latestState?.statuses;

    await render([ISSUE_REF], 1);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(latestState?.statuses.get("issue:lossyrob/streamliner#69")?.state).toBe(
        "closed",
      );
    });

    expect(latestState?.statuses).not.toBe(firstMap);
  });
});
