import { describe, expect, it } from "vitest";

import { renderWorkstreamTerminalTitleTemplate } from "./workstream-launch-templates";
import type { WorkstreamNode } from "./workstream-schema";

const node: WorkstreamNode = {
  id: "tracker-required-launch-policy",
  type: "task",
  title: "Tracker-required launch policy",
  summary: "Require tracker-backed launches.",
  status: "ready",
  attention: "focus",
  repoIds: ["streamliner"],
  tracker: {
    type: "github",
    owner: "lossyrob",
    repo: "streamliner",
    number: 47,
  },
  dependsOn: [],
};

describe("renderWorkstreamTerminalTitleTemplate", () => {
  it("renders supported terminal title template values", () => {
    expect(
      renderWorkstreamTerminalTitleTemplate(
        "{githubIssue} - {nodeId} - {nodeTitle} - {workstreamShortName}",
        node,
        { title: "Session launching and tracking", presentation: { shortName: "SLT" } },
      ),
    ).toBe("#47 - tracker-required-launch-policy - Tracker-required launch policy - SLT");
  });

  it("falls back to the full workstream title for missing short names", () => {
    expect(
      renderWorkstreamTerminalTitleTemplate(
        "{workstreamShortName} - {nodeTitle}",
        node,
        { title: "Session launching and tracking" },
      ),
    ).toBe("Session launching and tracking - Tracker-required launch policy");
  });

  it("leaves unknown template values literal and returns null for empty output", () => {
    expect(renderWorkstreamTerminalTitleTemplate("{unknown}", node)).toBe("{unknown}");
    expect(renderWorkstreamTerminalTitleTemplate("{githubIssue}", {
      ...node,
      tracker: undefined,
    })).toBeNull();
  });
});
