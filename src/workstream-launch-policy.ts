import type {
  WorkstreamDocument,
  WorkstreamLaunchRequiredTracker,
  WorkstreamNode,
  WorkstreamTracker,
} from "./workstream-schema";

export const LAUNCH_POLICY_BLOCKED_CODE = "launch_policy_blocked";
export const GITHUB_ISSUE_TRACKER_REQUIRED_CODE =
  "github_issue_tracker_required";

export interface WorkstreamLaunchPolicyViolation {
  code: typeof GITHUB_ISSUE_TRACKER_REQUIRED_CODE;
  policy: "requiredTracker";
  requiredTracker: WorkstreamLaunchRequiredTracker;
  nodeId: string;
  message: string;
  remediation: string;
}

export type WorkstreamLaunchPolicyDecision =
  | { allowed: true }
  | { allowed: false; violation: WorkstreamLaunchPolicyViolation };

export function isGithubIssueTracker(
  tracker: WorkstreamTracker | undefined,
): boolean {
  return tracker?.type === "github" &&
    tracker.owner.trim().length > 0 &&
    tracker.repo.trim().length > 0 &&
    Number.isInteger(tracker.number) &&
    tracker.number > 0;
}

function githubIssueRequiredViolation(
  node: WorkstreamNode,
): WorkstreamLaunchPolicyViolation {
  return {
    code: GITHUB_ISSUE_TRACKER_REQUIRED_CODE,
    policy: "requiredTracker",
    requiredTracker: "github-issue",
    nodeId: node.id,
    message: `Node ${node.id} cannot launch because this workstream requires a GitHub issue tracker before launch. Create or promote a GitHub issue for this node, or edit graph.json launchPolicy if untracked launches are intentional.`,
    remediation:
      "Create or promote a GitHub issue for this node, or edit graph.json launchPolicy if untracked launches are intentional.",
  };
}

export function evaluateNodeLaunchPolicy(
  workstream: WorkstreamDocument,
  node: WorkstreamNode,
): WorkstreamLaunchPolicyDecision {
  const requiredTracker = workstream.launchPolicy?.requiredTracker;
  if (!requiredTracker) {
    return { allowed: true };
  }

  switch (requiredTracker) {
    case "github-issue":
      return isGithubIssueTracker(node.tracker)
        ? { allowed: true }
        : { allowed: false, violation: githubIssueRequiredViolation(node) };
  }
}

export function launchPolicyViolationDetails(
  violation: WorkstreamLaunchPolicyViolation,
): Record<string, unknown> {
  return {
    policy: violation.policy,
    requiredTracker: violation.requiredTracker,
    policyCode: violation.code,
    nodeId: violation.nodeId,
    remediation: violation.remediation,
  };
}
