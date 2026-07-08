import type {
  WorkstreamGithubIssueSnapshot,
  WorkstreamGithubPullRequestSnapshot,
} from "./workstream-schema";

export type GithubStatusViewTone = "accent" | "green" | "amber" | "red" | "muted";

export function githubStatusToneClass(tone: GithubStatusViewTone): string {
  switch (tone) {
    case "green":
      return "status-green";
    case "amber":
      return "status-amber";
    case "red":
      return "status-red";
    case "muted":
      return "muted";
    default:
      return "status-accent";
  }
}

export function githubStatusPillClass(tone: GithubStatusViewTone): string {
  return tone === "accent" ? "accent" : tone;
}

export function githubIssueSnapshotLabel(issue: WorkstreamGithubIssueSnapshot): string {
  if (issue.error) {
    return "issue unknown";
  }
  const state = issue.state.toLowerCase();
  return state === "closed" ? "issue closed" : state === "open" ? "issue open" : "issue unknown";
}

export function githubIssueSnapshotTone(
  issue: WorkstreamGithubIssueSnapshot,
): GithubStatusViewTone {
  if (issue.error) {
    return "amber";
  }
  const state = issue.state.toLowerCase();
  return state === "closed" ? "green" : state === "open" ? "accent" : "amber";
}

export function githubPullRequestSnapshotLabel(
  pullRequest: WorkstreamGithubPullRequestSnapshot,
): string {
  const state = pullRequest.state.toLowerCase();
  if (state === "merged") {
    return "PR merged";
  }
  if (state === "closed") {
    return "PR closed";
  }
  if (pullRequest.isDraft) {
    return "PR draft";
  }
  switch (pullRequest.validationState) {
    case "pending":
      return "PR checks pending";
    case "failing":
      return "PR checks failing";
    case "passing":
      return "PR checks passing";
    default:
      return state === "open" ? "PR open" : "PR unknown";
  }
}

export function githubPullRequestSnapshotTone(
  pullRequest: WorkstreamGithubPullRequestSnapshot,
): GithubStatusViewTone {
  const state = pullRequest.state.toLowerCase();
  if (state === "merged") {
    return "green";
  }
  if (state === "closed") {
    return "muted";
  }
  if (pullRequest.isDraft || pullRequest.validationState === "pending") {
    return "amber";
  }
  if (pullRequest.validationState === "failing") {
    return "red";
  }
  if (pullRequest.validationState === "passing") {
    return "green";
  }
  return state === "open" ? "accent" : "amber";
}
