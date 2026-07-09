import { describe, expect, it } from "vitest";

import {
  buildLaunchedSessionDescription,
  sessionRegistryEffectiveGraphBinding,
  sessionRegistryRecordMatchesOptions,
} from "./session-registry-filter";

describe("sessionRegistryEffectiveGraphBinding", () => {
  it("round-trips launched session descriptions into fallback graph bindings", () => {
    const description = buildLaunchedSessionDescription(
      "session-launching-and-tracking",
      "launch-claim-binding",
    );

    expect(
      sessionRegistryEffectiveGraphBinding({
        graphBinding: null,
        description,
        originKind: "launched",
      }),
    ).toEqual({
      workstreamId: "session-launching-and-tracking",
      nodeId: "launch-claim-binding",
      launchClaimId: null,
    });
  });

  it("preserves launchClaimId from launched origins", () => {
    expect(
      sessionRegistryEffectiveGraphBinding({
        graphBinding: null,
        description: buildLaunchedSessionDescription("workstream", "node"),
        origin: { kind: "launched", launchClaimId: "claim-1" },
      }),
    ).toEqual({
      workstreamId: "workstream",
      nodeId: "node",
      launchClaimId: "claim-1",
    });
  });

  it("uses fallback graph bindings for workstream and node filtering", () => {
    const record = {
      title: "Worker",
      description: buildLaunchedSessionDescription("workstream", "node"),
      aiSummary: null,
      cwd: "C:\\repo",
      repo: "owner/repo",
      branch: "feature/node",
      derivedBranch: null,
      derivedWorktreePath: null,
      derivedGithubRefs: [],
      originKind: "launched" as const,
      pawLaunch: null,
      pawWorkflow: null,
      tags: [],
      copilotSessionId: "copilot-session",
      graphBinding: null,
      lifecycleStatus: "active" as const,
    };

    expect(
      sessionRegistryRecordMatchesOptions(record, {
        workstreamId: "workstream",
        nodeId: "node",
      }),
    ).toBe(true);
    expect(
      sessionRegistryRecordMatchesOptions(record, {
        workstreamId: "other",
      }),
    ).toBe(false);
  });

  it("matches workstream-only graph bindings for workstream filters but not node filters", () => {
    const record = {
      title: "Orchestrator",
      description: "",
      aiSummary: null,
      cwd: "C:\\repo",
      repo: "owner/repo",
      branch: "main",
      derivedBranch: null,
      derivedWorktreePath: null,
      derivedGithubRefs: [],
      originKind: "manual" as const,
      pawLaunch: null,
      pawWorkflow: null,
      tags: [],
      copilotSessionId: "copilot-session",
      graphBinding: { workstreamId: "workstream", nodeId: null },
      lifecycleStatus: "active" as const,
    };

    expect(sessionRegistryRecordMatchesOptions(record, { workstreamId: "workstream" })).toBe(true);
    expect(
      sessionRegistryRecordMatchesOptions(record, {
        workstreamId: "workstream",
        nodeId: "node",
      }),
    ).toBe(false);
  });

  it("does not derive graph bindings from matching manual-session descriptions", () => {
    expect(
      sessionRegistryEffectiveGraphBinding({
        graphBinding: null,
        description: buildLaunchedSessionDescription("workstream", "node"),
        originKind: "manual",
      }),
    ).toBeNull();
  });

  it("does not derive graph bindings from non-matching launched descriptions", () => {
    expect(
      sessionRegistryEffectiveGraphBinding({
        graphBinding: null,
        description: "PAW Review companion for workstream workstream, node node.",
        originKind: "launched",
      }),
    ).toBeNull();
  });
});
