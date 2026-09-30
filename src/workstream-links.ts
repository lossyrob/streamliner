import type { WorkstreamIssue, WorkstreamTracker } from "./workstream-schema";
import { githubReferenceUrl, githubRepositorySlug } from "./github-host";

export function issueLabel(issue?: WorkstreamIssue): string | null {
  if (!issue) {
    return null;
  }

  return `${githubRepositorySlug(issue)}#${issue.number}`;
}

export function issueUrl(issue?: WorkstreamIssue): string | null {
  if (!issue) {
    return null;
  }

  return githubReferenceUrl(issue);
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
