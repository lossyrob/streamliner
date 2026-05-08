import {
  type GithubIssueStatusResult,
  type GithubPullRequestStatusResult,
  type GithubStatusError,
  type GithubStatusRef,
  type GithubStatusResult,
  githubStatusRefKey,
} from "../github-status";
import type { WorkstreamPullRequestValidationState } from "../workstream-schema";
import { getApiLogger, type ScopedLogger } from "./logger";

export interface GithubStatusResponseHeaders {
  get(name: string): string | null;
}

export interface GithubStatusHttpResponse {
  ok: boolean;
  status: number;
  headers: GithubStatusResponseHeaders;
  json: () => Promise<unknown>;
}

export type GithubStatusFetch = (
  url: string,
  init?: {
    headers?: Record<string, string>;
  },
) => Promise<GithubStatusHttpResponse>;

export interface GithubStatusService {
  getStatuses(refs: readonly GithubStatusRef[]): Promise<GithubStatusResult[]>;
}

export interface GithubStatusServiceOptions {
  fetch?: GithubStatusFetch;
  now?: () => Date;
  authToken?: string | null;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  rateLimitTtlMs?: number;
  logger?: ScopedLogger;
}

interface CachedGithubStatusResult {
  expiresAt: number;
  result: GithubStatusResult;
}

const DEFAULT_POSITIVE_TTL_MS = 60_000;
const DEFAULT_NEGATIVE_TTL_MS = 15_000;
const DEFAULT_RATE_LIMIT_TTL_MS = 30_000;
const GITHUB_API_BASE_URL = "https://api.github.com";

function defaultFetch(): GithubStatusFetch {
  return (url, init) => globalThis.fetch(url, init) as Promise<GithubStatusHttpResponse>;
}

function authTokenFromEnv(): string | null {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return token && token.trim().length > 0 ? token.trim() : null;
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

function githubUrl(ref: GithubStatusRef): string {
  const owner = encodeURIComponent(ref.owner);
  const repo = encodeURIComponent(ref.repo);
  const segment = ref.type === "pr" ? "pulls" : "issues";
  return `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/${segment}/${ref.number}`;
}

function htmlUrl(ref: GithubStatusRef): string {
  const segment = ref.type === "pr" ? "pull" : "issues";
  return `https://github.com/${ref.owner}/${ref.repo}/${segment}/${ref.number}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function parseRetryAfter(headers: GithubStatusResponseHeaders): number | null {
  const raw = headers.get("retry-after");
  if (!raw) {
    return null;
  }
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function isRateLimitedResponse(response: GithubStatusHttpResponse): boolean {
  if (response.status === 429) {
    return true;
  }
  return response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
}

function errorCodeForStatus(response: GithubStatusHttpResponse): GithubStatusError["code"] {
  if (isRateLimitedResponse(response)) {
    return "rate_limited";
  }
  if (response.status === 404) {
    return "not_found";
  }
  return "github_fetch_failed";
}

function errorMessageForStatus(ref: GithubStatusRef, response: GithubStatusHttpResponse): string {
  if (isRateLimitedResponse(response)) {
    return `GitHub rate limit reached while fetching ${ref.type} #${ref.number}.`;
  }
  if (response.status === 404) {
    return `GitHub ${ref.type} #${ref.number} was not found.`;
  }
  return `GitHub returned ${response.status} while fetching ${ref.type} #${ref.number}.`;
}

function errorStatus(
  ref: GithubStatusRef,
  fetchedAt: string,
  error: GithubStatusError,
): GithubStatusResult {
  const base = {
    key: githubStatusRefKey(ref),
    ref,
    title: null,
    url: htmlUrl(ref),
    fetchedAt,
    statusLabel: ref.type === "pr" ? "PR unknown" : "issue unknown",
    error,
    rateLimited: error.code === "rate_limited",
  };

  if (ref.type === "pr") {
    return {
      ...base,
      type: "pr",
      state: "unknown",
      isDraft: false,
      reviewDecision: null,
      mergeStateStatus: null,
      validationState: "not-applicable",
      validationLabel: "checks unknown",
    };
  }

  return {
    ...base,
    type: "issue",
    state: "unknown",
    stateReason: null,
  };
}

function normalizeIssueState(value: string | null): GithubIssueStatusResult["state"] {
  const normalized = value?.toLowerCase();
  return normalized === "open" || normalized === "closed" ? normalized : "unknown";
}

function normalizePullRequestState(
  state: string | null,
  merged: boolean,
): GithubPullRequestStatusResult["state"] {
  if (merged) {
    return "merged";
  }
  const normalized = state?.toLowerCase();
  return normalized === "open" || normalized === "closed" ? normalized : "unknown";
}

function validationFromMergeState(
  mergeState: string | null,
): WorkstreamPullRequestValidationState {
  switch (mergeState?.toLowerCase()) {
    case "clean":
    case "has_hooks":
      return "passing";
    case "dirty":
      return "failing";
    case "blocked":
    case "behind":
    case "draft":
    case "unstable":
    case "unknown":
      return "pending";
    default:
      return "not-applicable";
  }
}

function validationLabel(state: WorkstreamPullRequestValidationState): string {
  switch (state) {
    case "pending":
      return "checks pending";
    case "failing":
      return "checks failing";
    case "passing":
      return "checks passing";
    default:
      return "checks unavailable";
  }
}

function issueStatusLabel(state: GithubIssueStatusResult["state"]): string {
  return state === "closed" ? "issue closed" : state === "open" ? "issue open" : "issue unknown";
}

function pullRequestStatusLabel(
  state: GithubPullRequestStatusResult["state"],
  isDraft: boolean,
  validationState: WorkstreamPullRequestValidationState,
): string {
  if (state === "merged") {
    return "PR merged";
  }
  if (state === "closed") {
    return "PR closed";
  }
  if (isDraft) {
    return "PR draft";
  }
  if (validationState === "pending") {
    return "PR checks pending";
  }
  if (validationState === "failing") {
    return "PR checks failing";
  }
  if (validationState === "passing") {
    return "PR checks passing";
  }
  return state === "open" ? "PR open" : "PR unknown";
}

function normalizeIssue(
  ref: GithubStatusRef,
  payload: unknown,
  fetchedAt: string,
): GithubIssueStatusResult {
  if (!isRecord(payload)) {
    return errorStatus(ref, fetchedAt, {
      code: "invalid_response",
      message: "GitHub issue response was not an object.",
    }) as GithubIssueStatusResult;
  }

  const state = normalizeIssueState(stringField(payload, "state"));
  return {
    key: githubStatusRefKey(ref),
    ref,
    type: "issue",
    title: stringField(payload, "title"),
    url: stringField(payload, "html_url") ?? htmlUrl(ref),
    state,
    stateReason: stringField(payload, "state_reason"),
    fetchedAt,
    statusLabel: issueStatusLabel(state),
  };
}

function normalizePullRequest(
  ref: GithubStatusRef,
  payload: unknown,
  fetchedAt: string,
): GithubPullRequestStatusResult {
  if (!isRecord(payload)) {
    return errorStatus(ref, fetchedAt, {
      code: "invalid_response",
      message: "GitHub pull request response was not an object.",
    }) as GithubPullRequestStatusResult;
  }

  const mergeStateStatus = stringField(payload, "mergeable_state");
  const validationState = validationFromMergeState(mergeStateStatus);
  const isDraft = booleanField(payload, "draft");
  const state = normalizePullRequestState(
    stringField(payload, "state"),
    booleanField(payload, "merged"),
  );
  return {
    key: githubStatusRefKey(ref),
    ref,
    type: "pr",
    title: stringField(payload, "title"),
    url: stringField(payload, "html_url") ?? htmlUrl(ref),
    state,
    isDraft,
    reviewDecision: null,
    mergeStateStatus,
    validationState,
    validationLabel: validationLabel(validationState),
    fetchedAt,
    statusLabel: pullRequestStatusLabel(state, isDraft, validationState),
  };
}

export function createGithubStatusService(
  options: GithubStatusServiceOptions = {},
): GithubStatusService {
  const fetchImpl = options.fetch ?? defaultFetch();
  const now = options.now ?? (() => new Date());
  const authToken = options.authToken ?? authTokenFromEnv();
  const positiveTtlMs = options.positiveTtlMs ?? DEFAULT_POSITIVE_TTL_MS;
  const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
  const rateLimitTtlMs = options.rateLimitTtlMs ?? DEFAULT_RATE_LIMIT_TTL_MS;
  const logger = options.logger ?? getApiLogger().withScope("github-status");
  const cache = new Map<string, CachedGithubStatusResult>();

  async function fetchStatus(ref: GithubStatusRef): Promise<GithubStatusResult> {
    const fetchedAt = now().toISOString();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "streamliner-local-api",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    try {
      const response = await fetchImpl(githubUrl(ref), { headers });
      if (!response.ok) {
        const error: GithubStatusError = {
          code: errorCodeForStatus(response),
          message: errorMessageForStatus(ref, response),
          status: response.status,
          retryAfterSeconds: parseRetryAfter(response.headers),
        };
        return errorStatus(ref, fetchedAt, error);
      }

      const payload = await response.json();
      return ref.type === "pr"
        ? normalizePullRequest(ref, payload, fetchedAt)
        : normalizeIssue(ref, payload, fetchedAt);
    } catch (error) {
      return errorStatus(ref, fetchedAt, {
        code: "github_fetch_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function cacheTtl(result: GithubStatusResult): number {
    if (result.rateLimited) {
      return rateLimitTtlMs;
    }
    if (result.error) {
      return negativeTtlMs;
    }
    return positiveTtlMs;
  }

  return {
    async getStatuses(refs: readonly GithubStatusRef[]): Promise<GithubStatusResult[]> {
      const uniqueRefs = dedupeRefs(refs);
      const nowMs = now().getTime();
      let cacheHits = 0;
      const resultByKey = new Map<string, GithubStatusResult>();
      const misses: GithubStatusRef[] = [];

      for (const ref of uniqueRefs) {
        const key = githubStatusRefKey(ref);
        const cached = cache.get(key);
        if (cached && cached.expiresAt > nowMs) {
          cacheHits += 1;
          resultByKey.set(key, cached.result);
        } else {
          misses.push(ref);
        }
      }

      const fetched = await Promise.all(misses.map((ref) => fetchStatus(ref)));
      const cacheNowMs = now().getTime();
      for (const result of fetched) {
        const ttl = cacheTtl(result);
        cache.set(result.key, {
          expiresAt: cacheNowMs + ttl,
          result,
        });
        resultByKey.set(result.key, result);
      }

      const statuses = uniqueRefs
        .map((ref) => resultByKey.get(githubStatusRefKey(ref)))
        .filter((result): result is GithubStatusResult => result !== undefined);
      const errors = statuses.filter((status) => status.error).length;
      const rateLimited = statuses.filter((status) => status.rateLimited).length;
      logger.info("batch", {
        requestedRefs: refs.length,
        uniqueRefs: uniqueRefs.length,
        cacheHits,
        fetchedRefs: misses.length,
        errors,
        rateLimited,
      });
      if (errors > 0 || rateLimited > 0) {
        logger.warn("degraded", {
          errors,
          rateLimited,
        });
      }
      return statuses;
    },
  };
}
