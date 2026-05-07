import { describe, expect, it } from "vitest";

import { parseWorkstreamDocument } from "./workstream-view-model";

function graph(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: "api-test",
    projectKey: "streamliner",
    title: "API Test",
    summary: "Test workstream graph.",
    status: "active",
    attention: "focus",
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    repos: [
      {
        id: "streamliner",
        owner: "lossyrob",
        name: "streamliner",
      },
    ],
    designRefs: [],
    nodes: [],
    checkpoints: [],
    ...overrides,
  });
}

describe("parseWorkstreamDocument launchPolicy", () => {
  it("preserves absent launch policy as default allow behavior", () => {
    const parsed = parseWorkstreamDocument(graph());

    expect(parsed.launchPolicy).toBeUndefined();
  });

  it("parses the GitHub issue tracker requirement", () => {
    const parsed = parseWorkstreamDocument(graph({
      launchPolicy: {
        requiredTracker: "github-issue",
      },
    }));

    expect(parsed.launchPolicy).toEqual({
      requiredTracker: "github-issue",
    });
  });

  it("rejects unknown required tracker policies", () => {
    expect(() =>
      parseWorkstreamDocument(graph({
        launchPolicy: {
          requiredTracker: "jira-issue",
        },
      }))
    ).toThrow(
      "Expected workstream.launchPolicy.requiredTracker to be one of: github-issue.",
    );
  });
});
