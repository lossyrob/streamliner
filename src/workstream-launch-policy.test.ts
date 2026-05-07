import { describe, expect, it } from "vitest";

import type { WorkstreamDocument, WorkstreamNode } from "./workstream-schema";
import {
  evaluateNodeLaunchPolicy,
  isGithubIssueTracker,
} from "./workstream-launch-policy";

function node(overrides: Partial<WorkstreamNode> = {}): WorkstreamNode {
  return {
    id: "policy-node",
    type: "task",
    title: "Policy node",
    summary: "Test launch policy behavior.",
    status: "ready",
    attention: "focus",
    repoIds: ["streamliner"],
    dependsOn: [],
    ...overrides,
  };
}

function workstream(overrides: Partial<WorkstreamDocument> = {}): WorkstreamDocument {
  return {
    schemaVersion: 1,
    id: "api-test",
    projectKey: "streamliner",
    title: "API Test",
    summary: "Test workstream graph.",
    status: "active",
    attention: "focus",
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    repos: [{
      id: "streamliner",
      owner: "lossyrob",
      name: "streamliner",
    }],
    designRefs: [],
    nodes: [],
    checkpoints: [],
    ...overrides,
  };
}

describe("evaluateNodeLaunchPolicy", () => {
  it("allows any tracker shape when no launch policy is configured", () => {
    const decision = evaluateNodeLaunchPolicy(workstream(), node());

    expect(decision).toEqual({ allowed: true });
  });

  it("allows GitHub issue trackers when the policy requires them", () => {
    const decision = evaluateNodeLaunchPolicy(
      workstream({ launchPolicy: { requiredTracker: "github-issue" } }),
      node({
        tracker: {
          type: "github",
          owner: "lossyrob",
          repo: "streamliner",
          number: 47,
        },
      }),
    );

    expect(decision).toEqual({ allowed: true });
  });

  it("blocks missing and local trackers when the policy requires a GitHub issue", () => {
    const configured = workstream({
      launchPolicy: { requiredTracker: "github-issue" },
    });

    expect(evaluateNodeLaunchPolicy(configured, node())).toMatchObject({
      allowed: false,
      violation: {
        code: "github_issue_tracker_required",
        requiredTracker: "github-issue",
        nodeId: "policy-node",
      },
    });
    expect(evaluateNodeLaunchPolicy(configured, node({
      tracker: {
        type: "local",
        path: "tasks/policy-node.md",
      },
    }))).toMatchObject({
      allowed: false,
      violation: {
        code: "github_issue_tracker_required",
        requiredTracker: "github-issue",
        nodeId: "policy-node",
      },
    });
  });
});

describe("isGithubIssueTracker", () => {
  it("requires non-empty owner/repo and a positive issue number", () => {
    expect(isGithubIssueTracker({
      type: "github",
      owner: "lossyrob",
      repo: "streamliner",
      number: 47,
    })).toBe(true);
    expect(isGithubIssueTracker({
      type: "github",
      owner: " ",
      repo: "streamliner",
      number: 47,
    })).toBe(false);
    expect(isGithubIssueTracker({
      type: "github",
      owner: "lossyrob",
      repo: "streamliner",
      number: 0,
    })).toBe(false);
  });
});
