import { describe, expect, it } from "vitest";

import {
  buildWorkstreamViewModel,
  parseWorkstreamDocument,
  workstreamExternalDependencyKey,
} from "./workstream-view-model";

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

describe("parseWorkstreamDocument launchDefaults", () => {
  it("preserves absent launch defaults", () => {
    const parsed = parseWorkstreamDocument(graph());

    expect(parsed.launchDefaults).toBeUndefined();
  });

  it("parses terminal launch defaults", () => {
    const parsed = parseWorkstreamDocument(graph({
      launchDefaults: {
        promptProfileId: "final-pr-only",
        terminal: {
          preferredTerminal: "windows-terminal",
          titleTemplate: "{githubIssue} - {nodeTitle}",
          tabColor: "#4891C8",
        },
      },
    }));

    expect(parsed.launchDefaults).toEqual({
      promptProfileId: "final-pr-only",
      terminal: {
        preferredTerminal: "windows-terminal",
        titleTemplate: "{githubIssue} - {nodeTitle}",
        tabColor: "#4891c8",
      },
    });
  });

  it("rejects invalid terminal defaults", () => {
    expect(() =>
      parseWorkstreamDocument(graph({
        launchDefaults: {
          terminal: {
            preferredTerminal: "zsh",
            tabColor: "blue",
          },
        },
      }))
    ).toThrow(
      "Expected workstream.launchDefaults.terminal.preferredTerminal to be one of: default, windows-terminal, powershell.",
    );
  });

  it("rejects invalid prompt profile defaults", () => {
    expect(() =>
      parseWorkstreamDocument(graph({
        launchDefaults: {
          promptProfileId: "Final PR",
        },
      }))
    ).toThrow(
      "Expected workstream.launchDefaults.promptProfileId to be a kebab-case id.",
    );
  });
});

function nodeOverride(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "first-node",
    type: "task",
    title: "First node",
    summary: "First node summary.",
    status: "ready",
    attention: "focus",
    repoIds: ["streamliner"],
    dependsOn: [],
    ...extra,
  };
}

describe("parseWorkstreamDocument node status", () => {
  it("accepts the new 'retired' node status", () => {
    const parsed = parseWorkstreamDocument(
      graph({ nodes: [nodeOverride({ status: "retired" })] }),
    );
    expect(parsed.nodes[0]?.status).toBe("retired");
  });

  it("throws on unknown node statuses by default (strict mode)", () => {
    expect(() =>
      parseWorkstreamDocument(
        graph({ nodes: [nodeOverride({ status: "scrapped" })] }),
      ),
    ).toThrow(
      /Expected workstream\.nodes\[0\]\.status to be one of: planned, ready, in-progress, blocked, completed, retired\./,
    );
  });

  it("tolerates unknown node statuses when onParseWarning is provided", () => {
    const warnings: Array<{ label: string; received: string | null; fallback: string }> = [];
    const parsed = parseWorkstreamDocument(
      graph({ nodes: [nodeOverride({ status: "scrapped" })] }),
      {
        onParseWarning: (warning) => {
          warnings.push({
            label: warning.label,
            received: warning.received,
            fallback: warning.fallback,
          });
        },
      },
    );
    expect(parsed.nodes[0]?.status).toBe("blocked");
    expect(warnings).toEqual([
      {
        label: "workstream.nodes[0].status",
        received: "scrapped",
        fallback: "blocked",
      },
    ]);
  });

  it("does not emit a warning when the node status is canonical, even with onParseWarning provided", () => {
    const warnings: unknown[] = [];
    parseWorkstreamDocument(
      graph({ nodes: [nodeOverride({ status: "retired" })] }),
      { onParseWarning: (w) => warnings.push(w) },
    );
    expect(warnings).toEqual([]);
  });
});

describe("parseWorkstreamDocument external dependencies", () => {
  it("parses node-level external dependencies", () => {
    const parsed = parseWorkstreamDocument(
      graph({
        nodes: [
          nodeOverride({
            externalDependsOn: [
              {
                id: "upstream-gate",
                target: {
                  projectKey: "streamliner",
                  workstreamId: "launch-flow",
                  nodeId: "review-gate",
                },
                label: "Launch flow review",
                url: "https://github.com/lossyrob/streamliner/issues/107",
                status: "pending",
              },
            ],
          }),
        ],
      }),
    );

    expect(parsed.nodes[0]?.externalDependsOn).toEqual([
      {
        id: "upstream-gate",
        target: {
          projectKey: "streamliner",
          workstreamId: "launch-flow",
          nodeId: "review-gate",
        },
        label: "Launch flow review",
        url: "https://github.com/lossyrob/streamliner/issues/107",
        status: "pending",
      },
    ]);
  });

  it("rejects duplicate external dependency ids on the same node", () => {
    expect(() =>
      parseWorkstreamDocument(
        graph({
          nodes: [
            nodeOverride({
              externalDependsOn: [
                { id: "shared", label: "First" },
                { id: "shared", label: "Second" },
              ],
            }),
          ],
        }),
      ),
    ).toThrow("Duplicate external dependency id 'shared' on node 'first-node'");
  });

  it("rejects external dependencies from a node to itself", () => {
    expect(() =>
      parseWorkstreamDocument(
        graph({
          nodes: [
            nodeOverride({
              externalDependsOn: [
                {
                  id: "self",
                  target: {
                    projectKey: "streamliner",
                    workstreamId: "api-test",
                    nodeId: "first-node",
                  },
                },
              ],
            }),
          ],
        }),
      ),
    ).toThrow("A node cannot externally depend on itself");
  });
});

describe("buildWorkstreamViewModel retired-node semantics", () => {
  it("marks retired nodes as artifact-satisfied so downstream gating treats them as met", () => {
    // The artifact-only view-model exposes the per-node completionSource that
    // downstream gating uses ("artifact" / "github" / null). A retired node
    // must be "artifact" — that is the contract by which dependents see the
    // upstream as satisfied (transitive dependencyReady is computed in the
    // GitHub-augmented path; here we assert the source-of-truth field).
    const document = parseWorkstreamDocument(
      graph({
        nodes: [
          nodeOverride({ id: "upstream", status: "retired", title: "Upstream (retired)" }),
          nodeOverride({
            id: "downstream",
            status: "planned",
            title: "Downstream",
            dependsOn: ["upstream"],
          }),
        ],
      }),
    );
    const viewModel = buildWorkstreamViewModel(document);
    const upstream = viewModel.derivedNodes.find(
      (entry) => entry.node.id === "upstream",
    );
    expect(upstream?.completionSource).toBe("artifact");
  });

  it("preserves operationalStatus 'retired' (does not promote to 'completed')", () => {
    const document = parseWorkstreamDocument(
      graph({ nodes: [nodeOverride({ status: "retired" })] }),
    );
    const viewModel = buildWorkstreamViewModel(document);
    expect(viewModel.derivedNodes[0]?.operationalStatus).toBe("retired");
  });

  it("counts a retired node toward checkpoint completion", () => {
    const document = parseWorkstreamDocument(
      graph({
        nodes: [
          nodeOverride({ id: "n1", status: "completed" }),
          nodeOverride({ id: "n2", status: "retired" }),
        ],
        checkpoints: [
          {
            id: "cp",
            title: "Closure",
            summary: "All work in scope is satisfied (completed or retired).",
            status: "planned",
            nodeIds: ["n1", "n2"],
          },
        ],
      }),
    );
    const viewModel = buildWorkstreamViewModel(document);
    const checkpoint = viewModel.checkpoints[0];
    expect(checkpoint?.completedNodes).toBe(2);
    expect(checkpoint?.totalNodes).toBe(2);
  });

  it("excludes retired nodes from blockedOrAttention bucket", () => {
    const document = parseWorkstreamDocument(
      graph({
        nodes: [
          nodeOverride({ id: "active", status: "blocked", title: "Still blocked" }),
          nodeOverride({ id: "gone", status: "retired", title: "Out of scope" }),
        ],
      }),
    );
    const viewModel = buildWorkstreamViewModel(document);
    const ids = viewModel.blockedOrAttention.map((node) => node.id);
    expect(ids).toContain("active");
    expect(ids).not.toContain("gone");
  });
});

describe("buildWorkstreamViewModel external dependency readiness", () => {
  it("blocks a ready node while its targeted external dependency is unresolved", () => {
    const document = parseWorkstreamDocument(
      graph({
        nodes: [
          nodeOverride({
            status: "ready",
            externalDependsOn: [
              {
                id: "review-gate",
                target: {
                  projectKey: "streamliner",
                  workstreamId: "launch-flow",
                  nodeId: "review-gate",
                },
              },
            ],
          }),
        ],
      }),
    );

    const viewModel = buildWorkstreamViewModel(document);
    const entry = viewModel.derivedNodes[0];

    expect(entry?.dependencyReady).toBe(false);
    expect(entry?.operationalStatus).toBe("blocked");
    expect(entry?.externalDependencies[0]?.state).toBe("resolving");
  });

  it("allows manual satisfaction for unresolved external dependencies", () => {
    const document = parseWorkstreamDocument(
      graph({
        nodes: [
          nodeOverride({
            status: "ready",
            externalDependsOn: [
              {
                id: "url-only",
                label: "Manual handoff",
                url: "https://example.invalid/handoff",
                status: "satisfied",
              },
            ],
          }),
        ],
      }),
    );

    const viewModel = buildWorkstreamViewModel(document);
    const entry = viewModel.derivedNodes[0];

    expect(entry?.dependencyReady).toBe(true);
    expect(entry?.operationalStatus).toBe("ready");
    expect(entry?.externalDependencies[0]?.state).toBe("manual");
  });

  it("does not honor target-backed manual satisfaction while the target is still resolving", () => {
    const document = parseWorkstreamDocument(
      graph({
        nodes: [
          nodeOverride({
            status: "ready",
            externalDependsOn: [
              {
                id: "review-gate",
                target: {
                  projectKey: "streamliner",
                  workstreamId: "launch-flow",
                  nodeId: "review-gate",
                },
                status: "satisfied",
              },
            ],
          }),
        ],
      }),
    );

    const viewModel = buildWorkstreamViewModel(document);
    const entry = viewModel.derivedNodes[0];

    expect(entry?.dependencyReady).toBe(false);
    expect(entry?.operationalStatus).toBe("blocked");
    expect(entry?.externalDependencies[0]?.state).toBe("resolving");
  });

  it("uses resolved target status over a stale manual override", () => {
    const document = parseWorkstreamDocument(
      graph({
        nodes: [
          nodeOverride({
            status: "ready",
            externalDependsOn: [
              {
                id: "review-gate",
                target: {
                  projectKey: "streamliner",
                  workstreamId: "launch-flow",
                  nodeId: "review-gate",
                },
                status: "satisfied",
              },
            ],
          }),
        ],
      }),
    );
    const resolutions = new Map([
      [
        workstreamExternalDependencyKey("first-node", "review-gate"),
        {
          state: "resolved" as const,
          target: {
            kind: "node" as const,
            title: "Review gate",
            status: "blocked" as const,
            satisfied: false,
          },
        },
      ],
    ]);

    const viewModel = buildWorkstreamViewModel(
      document,
      undefined,
      new Date("2026-05-01T12:00:00.000Z"),
      { externalDependencyResolutions: resolutions },
    );
    const entry = viewModel.derivedNodes[0];

    expect(entry?.dependencyReady).toBe(false);
    expect(entry?.externalDependencies[0]?.ignoredStatus).toBe("satisfied");
    expect(entry?.externalDependencies[0]?.targetStatus).toBe("blocked");
  });
});
