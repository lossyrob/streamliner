import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  type GithubIssueStatusResult,
  type GithubPullRequestStatusResult,
  type GithubStatusError,
  type GithubStatusRef,
  type GithubStatusResult,
  githubStatusRefKey,
} from "../github-status";
import type { WorkstreamPullRequestValidationState } from "../workstream-schema";
import {
  type GithubAuthProfile,
  readGithubAuthSettings,
  resolveGithubAuthProfile,
} from "./github-auth-settings";
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

export type GithubStatusAuthTokenProvider = (
  ref: GithubStatusRef,
) => Promise<string | null> | string | null;

export type GithubStatusGhAuthTokenProvider = (
  profile: GithubAuthProfile,
  ref: GithubStatusRef,
) => Promise<string | null> | string | null;

export interface GithubStatusService {
  getStatuses(refs: readonly GithubStatusRef[]): Promise<GithubStatusResult[]>;
}

export interface GithubStatusServiceOptions {
  fetch?: GithubStatusFetch;
  now?: () => Date;
  authToken?: string | null;
  authTokenProvider?: GithubStatusAuthTokenProvider;
  authSettingsPath?: string;
  ghAuthTokenProvider?: GithubStatusGhAuthTokenProvider;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  rateLimitTtlMs?: number;
  fetchConcurrency?: number;
  maxCacheEntries?: number;
  maxAuthTokenCacheEntries?: number;
  logger?: ScopedLogger;
}

interface CachedGithubStatusResult {
  expiresAt: number;
  result: GithubStatusResult;
}

const DEFAULT_POSITIVE_TTL_MS = 60_000;
const DEFAULT_NEGATIVE_TTL_MS = 15_000;
const DEFAULT_RATE_LIMIT_TTL_MS = 30_000;
const DEFAULT_FETCH_CONCURRENCY = 6;
const DEFAULT_MAX_CACHE_ENTRIES = 1_000;
const DEFAULT_MAX_AUTH_TOKEN_CACHE_ENTRIES = 256;
const GITHUB_API_BASE_URL = "https://api.github.com";
const GH_AUTH_TOKEN_TIMEOUT_MS = 2_000;
const execFileAsync = promisify(execFile);

function defaultFetch(): GithubStatusFetch {
  return (url, init) => globalThis.fetch(url, init) as Promise<GithubStatusHttpResponse>;
}

function positiveIntegerOption(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function createConcurrencyLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function runNext(): void {
    const next = queue.shift();
    if (next) {
      next();
    }
  }

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      runNext();
    }
  };
}

function enforceMapSizeLimit<K, V>(map: Map<K, V>, maxEntries: number): void {
  while (map.size > maxEntries) {
    const first = map.keys().next();
    if (first.done) {
      return;
    }
    map.delete(first.value);
  }
}

function normalizeAuthToken(token: string | null | undefined): string | null {
  const normalized = token?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function authTokenFromEnv(): string | null {
  return normalizeAuthToken(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN);
}

async function authTokenFromGhCli(
  profile: GithubAuthProfile,
  logger: ScopedLogger,
): Promise<string | null> {
  const hostname = profile.hostname ?? "github.com";
  const args = ["auth", "token", "--hostname", hostname];
  if (profile.user) {
    args.push("--user", profile.user);
  }
  const env = profile.ghConfigDir
    ? { ...process.env, GH_CONFIG_DIR: profile.ghConfigDir }
    : process.env;
  try {
    const { stdout } = await execFileAsync("gh", args, {
      env,
      timeout: GH_AUTH_TOKEN_TIMEOUT_MS,
      windowsHide: true,
    });
    const token = normalizeAuthToken(stdout);
    if (token) {
      logger.debug("using-gh-cli-auth", {
        hostname,
        user: profile.user ?? null,
        ghConfigDir: profile.ghConfigDir ? "configured" : "default",
      });
    }
    return token;
  } catch (error) {
    logger.debug("gh-cli-auth-unavailable", { err: error });
    return null;
  }
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
    linkedPullRequests: [],
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
    case "unstable":
      return "failing";
    case "blocked":
    case "behind":
    case "draft":
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
  linkedPullRequests: GithubPullRequestStatusResult[] = [],
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
    linkedPullRequests,
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

function timelineUrl(ref: GithubStatusRef): string {
  const owner = encodeURIComponent(ref.owner);
  const repo = encodeURIComponent(ref.repo);
  return `${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/issues/${ref.number}/timeline?per_page=100`;
}

function repoFromRepositoryUrl(value: unknown): { owner: string; repo: string } | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/\/repos\/([^/]+)\/([^/]+)$/i);
  return match
    ? {
        owner: decodeURIComponent(match[1]),
        repo: decodeURIComponent(match[2]),
      }
    : null;
}

function linkedPullRequestRefsFromTimeline(
  ref: GithubStatusRef,
  payload: unknown,
): GithubStatusRef[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const refs: GithubStatusRef[] = [];
  const seen = new Set<string>();
  for (const event of payload) {
    if (!isRecord(event)) {
      continue;
    }
    const source = event.source;
    if (!isRecord(source)) {
      continue;
    }
    const issue = source.issue;
    if (!isRecord(issue) || !isRecord(issue.pull_request)) {
      continue;
    }
    const number = issue.number;
    if (
      typeof number !== "number" ||
      !Number.isSafeInteger(number) ||
      number <= 0
    ) {
      continue;
    }
    const repo = repoFromRepositoryUrl(issue.repository_url) ?? {
      owner: ref.owner,
      repo: ref.repo,
    };
    const linkedRef: GithubStatusRef = {
      type: "pr",
      owner: repo.owner,
      repo: repo.repo,
      number,
    };
    const key = githubStatusRefKey(linkedRef);
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(linkedRef);
    }
  }
  return refs;
}

export function createGithubStatusService(
  options: GithubStatusServiceOptions = {},
): GithubStatusService {
  const fetchImpl = options.fetch ?? defaultFetch();
  const now = options.now ?? (() => new Date());
  const positiveTtlMs = options.positiveTtlMs ?? DEFAULT_POSITIVE_TTL_MS;
  const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
  const rateLimitTtlMs = options.rateLimitTtlMs ?? DEFAULT_RATE_LIMIT_TTL_MS;
  const fetchConcurrency = positiveIntegerOption(
    options.fetchConcurrency,
    DEFAULT_FETCH_CONCURRENCY,
  );
  const maxCacheEntries = positiveIntegerOption(
    options.maxCacheEntries,
    DEFAULT_MAX_CACHE_ENTRIES,
  );
  const maxAuthTokenCacheEntries = positiveIntegerOption(
    options.maxAuthTokenCacheEntries,
    DEFAULT_MAX_AUTH_TOKEN_CACHE_ENTRIES,
  );
  const logger = options.logger ?? getApiLogger().withScope("github-status");
  const limitGithubFetch = createConcurrencyLimiter(fetchConcurrency);
  const fetchGithub: GithubStatusFetch = (url, init) =>
    limitGithubFetch(() => fetchImpl(url, init));
  const cache = new Map<string, CachedGithubStatusResult>();
  const inFlightStatuses = new Map<string, Promise<GithubStatusResult>>();
  let authSettingsPromise: ReturnType<typeof readGithubAuthSettings> | null = null;
  const ghAuthTokenProvider: GithubStatusGhAuthTokenProvider =
    options.ghAuthTokenProvider ??
    ((profile) => authTokenFromGhCli(profile, logger));
  const authTokenProvider: GithubStatusAuthTokenProvider =
    options.authTokenProvider ??
    (async (ref) => {
      const envToken = authTokenFromEnv();
      if (envToken) {
        return envToken;
      }
      authSettingsPromise ??= readGithubAuthSettings(options.authSettingsPath).catch(
        (error: unknown) => {
          logger.warn("github-auth-settings-unavailable", { err: error });
          return { profiles: {}, repositories: {} };
        },
      );
      const settings = await authSettingsPromise;
      const profile = resolveGithubAuthProfile(ref, settings) ?? {};
      return ghAuthTokenProvider(profile, ref);
    });
  const authTokenPromises = new Map<string, Promise<string | null>>();

  async function getAuthToken(ref: GithubStatusRef): Promise<string | null> {
    if (options.authToken === null) {
      return null;
    }
    const explicitToken = normalizeAuthToken(options.authToken);
    if (explicitToken) {
      return explicitToken;
    }
    const cacheKey = `${ref.owner}/${ref.repo}`.toLowerCase();
    const cached = authTokenPromises.get(cacheKey);
    if (cached) {
      authTokenPromises.delete(cacheKey);
      authTokenPromises.set(cacheKey, cached);
      return cached;
    }
    const next = Promise.resolve()
      .then(() => authTokenProvider(ref))
      .then(normalizeAuthToken);
    const cachedNext = next.catch((error: unknown) => {
        if (authTokenPromises.get(cacheKey) === cachedNext) {
          authTokenPromises.delete(cacheKey);
        }
        logger.debug("github-auth-provider-failed", {
          ref: githubStatusRefKey(ref),
          err: error,
        });
        return null;
      });
    authTokenPromises.set(cacheKey, cachedNext);
    enforceMapSizeLimit(authTokenPromises, maxAuthTokenCacheEntries);
    return cachedNext;
  }

  async function fetchStatus(ref: GithubStatusRef): Promise<GithubStatusResult> {
    const fetchedAt = now().toISOString();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "streamliner-local-api",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const authToken = await getAuthToken(ref);
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    try {
      const response = await fetchGithub(githubUrl(ref), { headers });
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
      if (ref.type === "pr") {
        return normalizePullRequest(ref, payload, fetchedAt);
      }

      let linkedPullRequests: GithubPullRequestStatusResult[] = [];
      try {
        const timelineResponse = await fetchGithub(timelineUrl(ref), { headers });
        if (timelineResponse.ok) {
          const linkedRefs = linkedPullRequestRefsFromTimeline(
            ref,
            await timelineResponse.json(),
          );
          linkedPullRequests = await Promise.all(linkedRefs.map(async (linkedRef) => {
            try {
              const pullRequestResponse = await fetchGithub(githubUrl(linkedRef), {
                headers,
              });
              if (!pullRequestResponse.ok) {
                return errorStatus(linkedRef, fetchedAt, {
                  code: errorCodeForStatus(pullRequestResponse),
                  message: errorMessageForStatus(linkedRef, pullRequestResponse),
                  status: pullRequestResponse.status,
                  retryAfterSeconds: parseRetryAfter(pullRequestResponse.headers),
                }) as GithubPullRequestStatusResult;
              }
              return normalizePullRequest(
                linkedRef,
                await pullRequestResponse.json(),
                fetchedAt,
              );
            } catch (error) {
              return errorStatus(linkedRef, fetchedAt, {
                code: "github_fetch_failed",
                message: error instanceof Error ? error.message : String(error),
              }) as GithubPullRequestStatusResult;
            }
          }));
        } else {
          logger.warn("linked-pr-discovery-degraded", {
            ref: githubStatusRefKey(ref),
            status: timelineResponse.status,
          });
        }
      } catch (error) {
        logger.warn("linked-pr-discovery-failed", {
          ref: githubStatusRefKey(ref),
          err: error,
        });
      }
      return normalizeIssue(ref, payload, fetchedAt, linkedPullRequests);
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

  function pruneExpiredCacheEntries(nowMs: number): void {
    for (const [key, cached] of cache) {
      if (cached.expiresAt <= nowMs) {
        cache.delete(key);
      }
    }
  }

  function fetchMissingStatus(ref: GithubStatusRef): Promise<GithubStatusResult> {
    const key = githubStatusRefKey(ref);
    const inFlight = inFlightStatuses.get(key);
    if (inFlight) {
      return inFlight;
    }
    const next = fetchStatus(ref).finally(() => {
      if (inFlightStatuses.get(key) === next) {
        inFlightStatuses.delete(key);
      }
    });
    inFlightStatuses.set(key, next);
    return next;
  }

  return {
    async getStatuses(refs: readonly GithubStatusRef[]): Promise<GithubStatusResult[]> {
      const uniqueRefs = dedupeRefs(refs);
      const nowMs = now().getTime();
      let cacheHits = 0;
      const resultByKey = new Map<string, GithubStatusResult>();
      const misses: GithubStatusRef[] = [];

      pruneExpiredCacheEntries(nowMs);
      for (const ref of uniqueRefs) {
        const key = githubStatusRefKey(ref);
        const cached = cache.get(key);
        if (cached) {
          cacheHits += 1;
          cache.delete(key);
          cache.set(key, cached);
          resultByKey.set(key, cached.result);
        } else {
          misses.push(ref);
        }
      }

      const fetched = await Promise.all(misses.map((ref) => fetchMissingStatus(ref)));
      const cacheNowMs = now().getTime();
      for (const result of fetched) {
        const ttl = cacheTtl(result);
        cache.set(result.key, {
          expiresAt: cacheNowMs + ttl,
          result,
        });
        resultByKey.set(result.key, result);
      }
      enforceMapSizeLimit(cache, maxCacheEntries);

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
