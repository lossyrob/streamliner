import type { NodeLaunchClaimState } from "../node-launch-record-contract";

export interface LaunchClaimDisplay {
  label: string;
  detail: string;
  pillClass: string;
}

function titleCaseStatus(status: string): string {
  return status
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function humanizeLaunchClaim(claim: NodeLaunchClaimState): LaunchClaimDisplay {
  if (claim.status === "pending" && claim.blocksLaunch) {
    return {
      label: "Pending - terminal launching",
      detail: "Waiting for Copilot CLI to start and bind.",
      pillClass: "status-accent",
    };
  }
  if (claim.status === "bound") {
    return {
      label: "Bound - terminal active",
      detail: "A Copilot session is bound to this launch.",
      pillClass: "status-accent",
    };
  }
  if (claim.status === "failed") {
    return {
      label: claim.retryable ? "Failed - retry available" : "Failed",
      detail: claim.failureReason ?? "Terminal launch did not complete.",
      pillClass: claim.retryable ? "status-amber" : "status-red",
    };
  }
  if (claim.retryable) {
    return {
      label: `${titleCaseStatus(claim.status)} - retry available`,
      detail: "This launch attempt is no longer blocking a retry.",
      pillClass: "status-amber",
    };
  }
  return {
    label: titleCaseStatus(claim.status),
    detail: claim.blocksLaunch
      ? "This launch attempt is still active."
      : "This launch attempt is recorded.",
    pillClass: claim.blocksLaunch ? "status-accent" : "muted",
  };
}
