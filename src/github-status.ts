import type { WorkstreamPullRequestValidationState } from "./workstream-schema";

export const GITHUB_STATUS_REF_TYPES = ["issue", "pr"] as const;
export type GithubStatusRefType = (typeof GITHUB_STATUS_REF_TYPES)[number];

export interface GithubStatusRef {
  type: GithubStatusRefType;
  owner: string;
  repo: string;
  number: number;
}

export interface GithubStatusError {
  code:
    | "github_fetch_failed"
    | "invalid_response"
    | "not_found"
    | "rate_limited";
  message: string;
  status?: number;
  retryAfterSeconds?: number | null;
}

interface GithubStatusResultBase {
  key: string;
  ref: GithubStatusRef;
  title: string | null;
  url: string;
  fetchedAt: string;
  statusLabel: string;
  error?: GithubStatusError;
  rateLimited?: boolean;
}

export interface GithubIssueStatusResult extends GithubStatusResultBase {
  type: "issue";
  state: "open" | "closed" | "unknown";
  stateReason: string | null;
  linkedPullRequests: GithubPullRequestStatusResult[];
}

export interface GithubPullRequestStatusResult extends GithubStatusResultBase {
  type: "pr";
  state: "open" | "closed" | "merged" | "unknown";
  isDraft: boolean;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  validationState: WorkstreamPullRequestValidationState;
  validationLabel: string;
}

export type GithubStatusResult =
  | GithubIssueStatusResult
  | GithubPullRequestStatusResult;

export interface GithubStatusBatchResponse {
  generatedAt: string;
  statuses: GithubStatusResult[];
}

export type GithubStatusTone = "accent" | "green" | "amber" | "red" | "muted";

const STATUS_REF_PATTERN = /^(issue|pr):([\w.-]+)\/([\w.-]+)#(\d+)$/i;

export function githubStatusRefKey(ref: GithubStatusRef): string {
  return `${ref.type}:${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();
}

export function encodeGithubStatusRef(ref: GithubStatusRef): string {
  return `${ref.type}:${ref.owner}/${ref.repo}#${ref.number}`;
}

export function parseGithubStatusRef(value: string): GithubStatusRef | null {
  const match = value.trim().match(STATUS_REF_PATTERN);
  if (!match) {
    return null;
  }

  const number = Number.parseInt(match[4], 10);
  if (!Number.isSafeInteger(number) || number <= 0) {
    return null;
  }

  return {
    type: match[1].toLowerCase() as GithubStatusRefType,
    owner: match[2],
    repo: match[3],
    number,
  };
}

export function githubStatusUrl(refs: readonly GithubStatusRef[]): string {
  const params = new URLSearchParams();
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = githubStatusRefKey(ref);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    params.append("ref", encodeGithubStatusRef(ref));
  }
  const query = params.toString();
  return query ? `/api/github/status?${query}` : "/api/github/status";
}

export function githubStatusTone(status?: GithubStatusResult | null): GithubStatusTone {
  if (!status) {
    return "muted";
  }
  if (status.rateLimited || status.error || status.state === "unknown") {
    return "amber";
  }
  if (status.type === "issue") {
    return status.state === "closed" ? "green" : "accent";
  }
  if (status.state === "merged") {
    return "green";
  }
  if (status.state === "closed") {
    return "muted";
  }
  if (status.isDraft || status.validationState === "pending") {
    return "amber";
  }
  if (status.validationState === "failing") {
    return "red";
  }
  if (status.validationState === "passing") {
    return "green";
  }
  return "accent";
}
