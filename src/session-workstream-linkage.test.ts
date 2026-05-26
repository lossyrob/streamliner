import { describe, expect, it } from "vitest";

import type { SessionRegistryListItem } from "./session-registry-contract";
import {
  resolveSessionWorkstreamLinkage,
  workstreamRegistryKey,
  type WorkstreamGraphLoadState,
} from "./session-workstream-linkage";
import type { WorkstreamRegistryListEntry } from "./workstream-registry-contract";
import type { WorkstreamDocument } from "./workstream-schema";

function buildSession(
  graphBinding: SessionRegistryListItem["graphBinding"],
  overrides: Partial<Pick<SessionRegistryListItem, "description" | "originKind">> = {},
): Pick<SessionRegistryListItem, "graphBinding" | "description" | "originKind"> {
  return {
    graphBinding,
    description: "",
    originKind: "manual",
    ...overrides,
  };
}

function buildWorkstream(
  overrides: Partial<WorkstreamRegistryListEntry> = {},
): WorkstreamRegistryListEntry {
  return {
    projectKey: "streamliner",
    workstreamId: "session-launching-and-tracking",
    title: "Session launching and tracking",
    summary: "Connect launched sessions to workstream graph nodes.",
    path: "C:\\graphs\\session-launching-and-tracking\\graph.json",
    addedAt: "2026-05-01T12:00:00.000Z",
    lastOpenedAt: "2026-05-01T12:00:00.000Z",
    fileStatus: "available",
    ...overrides,
  };
}

function buildGraph(): WorkstreamDocument {
  return {
    schemaVersion: 1,
    id: "session-launching-and-tracking",
    projectKey: "streamliner",
    title: "Session launching and tracking",
    summary: "Connect launched sessions to workstream graph nodes.",
    status: "active",
    attention: "focus",
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
    repos: [
      {
        id: "streamliner",
        owner: "lossyrob",
        name: "streamliner",
        role: "primary",
      },
    ],
    designRefs: [],
    nodes: [
      {
        id: "sessions-workstream-linkage-ui",
        type: "task",
        title: "Sessions view workstream linkage",
        summary: "Show graph bindings in My Sessions.",
        status: "ready",
        attention: "focus",
        repoIds: ["streamliner"],
        dependsOn: [],
      },
    ],
    checkpoints: [],
  };
}

describe("resolveSessionWorkstreamLinkage", () => {
  it("keeps unbound sessions in the default group", () => {
    const resolution = resolveSessionWorkstreamLinkage(buildSession(null), []);

    expect(resolution.status).toBe("unbound");
    expect(resolution.group.label).toBe("Unbound / manual sessions");
    expect(resolution.workstreamRouteTarget).toBeNull();
  });

  it("resolves workstream and node labels with a node deep-link", () => {
    const workstream = buildWorkstream();
    const graphStates = new Map<string, WorkstreamGraphLoadState>([
      [workstreamRegistryKey(workstream), { status: "loaded", document: buildGraph() }],
    ]);

    const resolution = resolveSessionWorkstreamLinkage(
      buildSession({
        workstreamId: "session-launching-and-tracking",
        nodeId: "sessions-workstream-linkage-ui",
      }),
      [workstream],
      graphStates,
    );

    expect(resolution.status).toBe("resolved");
    expect(resolution.workstreamLabel).toBe("Session launching and tracking");
    expect(resolution.nodeLabel).toBe("Sessions view workstream linkage");
    expect(resolution.nodeRouteTarget).toEqual({
      projectKey: "streamliner",
      workstreamId: "session-launching-and-tracking",
      nodeId: "sessions-workstream-linkage-ui",
    });
  });

  it("falls back to launched-row description when graphBinding was pruned", () => {
    const workstream = buildWorkstream();
    const graphStates = new Map<string, WorkstreamGraphLoadState>([
      [workstreamRegistryKey(workstream), { status: "loaded", document: buildGraph() }],
    ]);

    const resolution = resolveSessionWorkstreamLinkage(
      buildSession(null, {
        originKind: "launched",
        description:
          "Graph launch for workstream session-launching-and-tracking, node sessions-workstream-linkage-ui.",
      }),
      [workstream],
      graphStates,
    );

    expect(resolution.status).toBe("resolved");
    expect(resolution.workstreamId).toBe("session-launching-and-tracking");
    expect(resolution.nodeId).toBe("sessions-workstream-linkage-ui");
    expect(resolution.nodeLabel).toBe("Sessions view workstream linkage");
  });

  it("does not route ambiguous workstream bindings", () => {
    const resolution = resolveSessionWorkstreamLinkage(
      buildSession({
        workstreamId: "shared-workstream",
        nodeId: "some-node",
      }),
      [
        buildWorkstream({ projectKey: "one", workstreamId: "shared-workstream" }),
        buildWorkstream({ projectKey: "two", workstreamId: "shared-workstream" }),
      ],
    );

    expect(resolution.status).toBe("ambiguous-workstream");
    expect(resolution.matchCount).toBe(2);
    expect(resolution.workstreamRouteTarget).toBeNull();
    expect(resolution.nodeRouteTarget).toBeNull();
  });

  it("keeps a workstream route when the graph is unloadable", () => {
    const resolution = resolveSessionWorkstreamLinkage(
      buildSession({
        workstreamId: "session-launching-and-tracking",
        nodeId: "sessions-workstream-linkage-ui",
      }),
      [buildWorkstream({ source: "browser-directory" })],
    );

    expect(resolution.status).toBe("graph-unavailable");
    expect(resolution.workstreamRouteTarget).toEqual({
      projectKey: "streamliner",
      workstreamId: "session-launching-and-tracking",
    });
    expect(resolution.nodeRouteTarget).toBeNull();
    expect(resolution.nodeLabel).toBe("sessions-workstream-linkage-ui");
  });
});
