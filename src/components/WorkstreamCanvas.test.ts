import { describe, expect, it } from "vitest";
import type { WorkstreamGraphLayoutResult } from "../workstream-graph";
import { collectViewportFocusIds } from "./WorkstreamCanvas";

function buildLayout(): WorkstreamGraphLayoutResult {
  return {
    nodes: [
      {
        id: "completed-upstream",
        x: 0,
        y: 0,
        width: 304,
        height: 168,
        highlight: "none",
        repoLabel: "example/repo",
        entry: {
          node: {
            id: "completed-upstream",
            type: "task",
            title: "Completed upstream",
            summary: "Completed upstream",
            status: "completed",
            attention: "parked",
            repoIds: ["main"],
            dependsOn: [],
          },
          operationalStatus: "completed",
          dependencyReady: true,
          completionSource: "artifact",
        },
      },
      {
        id: "current-wave",
        x: 0,
        y: 220,
        width: 304,
        height: 168,
        highlight: "none",
        repoLabel: "example/repo",
        entry: {
          node: {
            id: "current-wave",
            type: "task",
            title: "Current wave",
            summary: "Current wave",
            status: "in-progress",
            attention: "focus",
            repoIds: ["main"],
            dependsOn: ["completed-upstream"],
          },
          operationalStatus: "in-progress",
          dependencyReady: true,
          completionSource: null,
        },
      },
      {
        id: "next-wave",
        x: 0,
        y: 440,
        width: 304,
        height: 168,
        highlight: "none",
        repoLabel: "example/repo",
        entry: {
          node: {
            id: "next-wave",
            type: "task",
            title: "Next wave",
            summary: "Next wave",
            status: "planned",
            attention: "watch",
            repoIds: ["main"],
            dependsOn: ["current-wave"],
          },
          operationalStatus: "planned",
          dependencyReady: false,
          completionSource: null,
        },
      },
      {
        id: "parked-complete",
        x: 320,
        y: 0,
        width: 304,
        height: 168,
        highlight: "none",
        repoLabel: "example/repo",
        entry: {
          node: {
            id: "parked-complete",
            type: "task",
            title: "Parked complete",
            summary: "Parked complete",
            status: "completed",
            attention: "parked",
            repoIds: ["main"],
            dependsOn: [],
          },
          operationalStatus: "completed",
          dependencyReady: true,
          completionSource: "artifact",
        },
      },
    ],
    edges: [],
    dependenciesByNode: new Map([
      ["completed-upstream", []],
      ["current-wave", ["completed-upstream"]],
      ["next-wave", ["current-wave"]],
      ["parked-complete", []],
    ]),
    dependentsByNode: new Map([
      ["completed-upstream", ["current-wave"]],
      ["current-wave", ["next-wave"]],
      ["next-wave", []],
      ["parked-complete", []],
    ]),
    ancestors: new Set(["completed-upstream"]),
    descendants: new Set(["next-wave"]),
  };
}

describe("collectViewportFocusIds", () => {
  it("frames the active slice of the workstream plus its direct prerequisites", () => {
    const focusIds = collectViewportFocusIds(buildLayout(), null);

    expect(focusIds).toEqual(
      new Set(["current-wave", "next-wave", "completed-upstream"]),
    );
  });

  it("frames the selected dependency chain when a node is selected", () => {
    const focusIds = collectViewportFocusIds(buildLayout(), "current-wave");

    expect(focusIds).toEqual(
      new Set(["current-wave", "completed-upstream", "next-wave"]),
    );
  });
});
