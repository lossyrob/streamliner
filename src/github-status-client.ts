import { useEffect, useMemo, useState } from "react";

import {
  type GithubStatusBatchResponse,
  type GithubStatusRef,
  type GithubStatusResult,
  githubStatusRefKey,
  githubStatusUrl,
} from "./github-status";
import type {
  WorkstreamDocument,
  WorkstreamGithubPullRequestSnapshot,
  WorkstreamGithubSnapshot,
  WorkstreamTracker,
} from "./workstream-schema";

export interface GithubStatusLookupState {
  statuses: Map<string, GithubStatusResult>;
  loading: boolean;
  error: string | null;
}

const EMPTY_STATUS_LOOKUP = new Map<string, GithubStatusResult>();

function normalizeRepoParts(owner: string, repo: string): { owner: string; repo: string } | null {
  const normalizedOwner = owner.trim();
  const normalizedRepo = repo.trim();
  if (!/^[\w.-]+$/.test(normalizedOwner) || !/^[\w.-]+$/.test(normalizedRepo)) {
    return null;
  }
  return { owner: normalizedOwner, repo: normalizedRepo };
}

function trackerStatusRef(tracker?: WorkstreamTracker): GithubStatusRef | null {
  if (tracker?.type !== "github") {
    return null;
  }
  const repo = normalizeRepoParts(tracker.owner, tracker.repo);
  if (!repo) {
    return null;
  }
  return {
    type: "issue",
    owner: repo.owner,
    repo: repo.repo,
    number: tracker.number,
  };
}

function dedupeRefs(refs: readonly GithubStatusRef[]): GithubStatusRef[] {
  const seen = new Set<string>();
  const unique: GithubStatusRef[] = [];
  for (const ref of refs) {
    const key = githubStatusRefKey(ref);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function stableRefSetKey(refs: readonly GithubStatusRef[]): string {
  return dedupeRefs(refs)
    .map((ref) => githubStatusRefKey(ref))
    .sort()
    .join("|");
}

export function githubStatusRefsForWorkstream(
  workstream: WorkstreamDocument | null,
): GithubStatusRef[] {
  if (!workstream) {
    return [];
  }
  return dedupeRefs(
    workstream.nodes
      .map((node) => trackerStatusRef(node.tracker))
      .filter((ref): ref is GithubStatusRef => ref !== null),
  );
}

export function workstreamGithubSnapshotFromStatuses(
  statuses: Iterable<GithubStatusResult>,
): WorkstreamGithubSnapshot | undefined {
  const issues = Array.from(statuses)
    .filter((status) => status.type === "issue")
    .map((status) => ({
      owner: status.ref.owner,
      repo: status.ref.repo,
      number: status.ref.number,
      state: status.state,
      stateReason: status.stateReason,
      title: status.title ?? `Issue #${status.ref.number}`,
      url: status.url,
      linkedPullRequests: [] as WorkstreamGithubPullRequestSnapshot[],
      fetchedAt: status.fetchedAt,
      error: status.error?.message,
    }));
  if (issues.length === 0) {
    return undefined;
  }
  return { issues };
}

export function useGithubStatusLookup(
  refs: readonly GithubStatusRef[],
  refreshKey: string | number | null = null,
): GithubStatusLookupState {
  const refSetKey = useMemo(() => stableRefSetKey(refs), [refs]);
  const [state, setState] = useState<GithubStatusLookupState>({
    statuses: EMPTY_STATUS_LOOKUP,
    loading: false,
    error: null,
  });

  useEffect(() => {
    const uniqueRefs = dedupeRefs(refs);
    if (uniqueRefs.length === 0) {
      return;
    }

    const controller = new AbortController();

    fetch(githubStatusUrl(uniqueRefs), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load GitHub status (${response.status})`);
        }
        return (await response.json()) as GithubStatusBatchResponse;
      })
      .then((body) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          statuses: new Map(body.statuses.map((status) => [status.key, status])),
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          statuses: EMPTY_STATUS_LOOKUP,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => controller.abort();
  }, [refSetKey, refreshKey, refs]);

  if (refSetKey.length === 0) {
    return {
      statuses: EMPTY_STATUS_LOOKUP,
      loading: false,
      error: null,
    };
  }

  return state;
}

export function githubStatusForRef(
  lookup: ReadonlyMap<string, GithubStatusResult>,
  ref: GithubStatusRef | null,
): GithubStatusResult | null {
  return ref ? lookup.get(githubStatusRefKey(ref)) ?? null : null;
}
