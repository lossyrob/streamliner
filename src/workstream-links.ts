import type { WorkstreamIssue, WorkstreamTracker } from "./workstream-schema";

export function issueLabel(issue?: WorkstreamIssue): string | null {
  if (!issue) {
    return null;
  }

  return `${issue.owner}/${issue.repo}#${issue.number}`;
}

export function issueUrl(issue?: WorkstreamIssue): string | null {
  if (!issue) {
    return null;
  }

  return `https://github.com/${issue.owner}/${issue.repo}/issues/${issue.number}`;
}

export function trackerLabel(tracker?: WorkstreamTracker): string | null {
  if (!tracker) {
    return null;
  }

  if (tracker.type === "github") {
    return issueLabel(tracker);
  }

  return tracker.path;
}

export function trackerUrl(tracker?: WorkstreamTracker): string | null {
  if (!tracker || tracker.type !== "github") {
    return null;
  }

  return issueUrl(tracker);
}
