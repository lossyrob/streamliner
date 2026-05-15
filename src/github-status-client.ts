import { useEffect, useMemo, useRef, useState } from "react";

import {
  type GithubStatusBatchResponse,
  type GithubStatusRef,
  type GithubStatusResult,
  githubStatusRefKey,
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
interface GithubStatusLookupInternalState extends GithubStatusLookupState {
  refSetKey: string;
  snapshotKey: string;
}

const EMPTY_STATUS_STATE: GithubStatusLookupInternalState = {
  statuses: EMPTY_STATUS_LOOKUP,
  loading: false,
  error: null,
  refSetKey: "",
  snapshotKey: "",
};

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

function githubStatusUrlFromStableKey(refSetKey: string): string {
  if (refSetKey.length === 0) {
    return "/api/github/status";
  }
  const params = new URLSearchParams();
  for (const ref of refSetKey.split("|")) {
    params.append("ref", ref);
  }
  return `/api/github/status?${params.toString()}`;
}

function githubStatusSnapshotKey(statuses: Iterable<GithubStatusResult>): string {
  const sortedStatuses = Array.from(statuses).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  return JSON.stringify(sortedStatuses, (key, value) =>
    key === "fetchedAt" ? undefined : value,
  );
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
      linkedPullRequests: status.linkedPullRequests.map(
        (pullRequest): WorkstreamGithubPullRequestSnapshot => ({
          owner: pullRequest.ref.owner,
          repo: pullRequest.ref.repo,
          number: pullRequest.ref.number,
          title: pullRequest.title ?? `PR #${pullRequest.ref.number}`,
          url: pullRequest.url,
          state: pullRequest.state,
          isDraft: pullRequest.isDraft,
          reviewDecision: pullRequest.reviewDecision,
          mergeStateStatus: pullRequest.mergeStateStatus,
          validationState: pullRequest.validationState,
          validationLabel: pullRequest.validationLabel,
        }),
      ),
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
  const [state, setState] =
    useState<GithubStatusLookupInternalState>(EMPTY_STATUS_STATE);
  const activeRequestRef = useRef<{
    key: string;
    requestId: number;
    controller: AbortController;
  } | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (refSetKey.length === 0) {
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
      return;
    }

    if (activeRequestRef.current?.key === refSetKey) {
      return;
    }

    activeRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    activeRequestRef.current = {
      key: refSetKey,
      requestId,
      controller,
    };

    fetch(githubStatusUrlFromStableKey(refSetKey), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load GitHub status (${response.status})`);
        }
        return (await response.json()) as GithubStatusBatchResponse;
      })
      .then((body) => {
        if (
          controller.signal.aborted ||
          activeRequestRef.current?.requestId !== requestId
        ) {
          return;
        }
        const statuses = new Map(body.statuses.map((status) => [status.key, status]));
        const nextSnapshotKey = githubStatusSnapshotKey(statuses.values());
        setState((current) => {
          if (
            current.refSetKey === refSetKey &&
            current.snapshotKey === nextSnapshotKey
          ) {
            if (current.loading === false && current.error === null) {
              return current;
            }
            return {
              statuses: current.statuses,
              loading: false,
              error: null,
              refSetKey,
              snapshotKey: current.snapshotKey,
            };
          }
          return {
            statuses,
            loading: false,
            error: null,
            refSetKey,
            snapshotKey: nextSnapshotKey,
          };
        });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          activeRequestRef.current?.requestId !== requestId
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setState((current) =>
          current.refSetKey === refSetKey &&
          current.error === message &&
          current.loading === false
            ? current
            : {
                statuses:
                  current.refSetKey === refSetKey
                    ? current.statuses
                    : EMPTY_STATUS_LOOKUP,
                loading: false,
                error: message,
                refSetKey,
                snapshotKey:
                  current.refSetKey === refSetKey ? current.snapshotKey : "",
              },
        );
      })
      .finally(() => {
        if (activeRequestRef.current?.requestId === requestId) {
          activeRequestRef.current = null;
        }
      });
  }, [refSetKey, refreshKey]);

  if (refSetKey.length === 0) {
    return EMPTY_STATUS_STATE;
  }

  if (state.refSetKey !== refSetKey) {
    return EMPTY_STATUS_STATE;
  }

  return state;
}

export function githubStatusForRef(
  lookup: ReadonlyMap<string, GithubStatusResult>,
  ref: GithubStatusRef | null,
): GithubStatusResult | null {
  return ref ? lookup.get(githubStatusRefKey(ref)) ?? null : null;
}
