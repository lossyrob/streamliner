// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NodeInspector } from "./NodeInspector";
import type { WorkstreamDocument } from "../workstream-schema";
import type { WorkstreamExternalDependencyView } from "../workstream-view-model";
import type { WorkstreamGraphLayoutResult } from "../workstream-graph";

const workstream: WorkstreamDocument = {
  schemaVersion: 1,
  id: "external-demo",
  projectKey: "streamliner",
  title: "External demo",
  summary: "External dependency inspector test.",
  status: "active",
  attention: "focus",
  createdAt: "2026-05-19T12:00:00.000Z",
  updatedAt: "2026-05-19T12:00:00.000Z",
  repos: [
    {
      id: "streamliner",
      owner: "lossyrob",
      name: "streamliner",
    },
  ],
  designRefs: [],
  nodes: [
    {
      id: "blocked-node",
      type: "task",
      title: "Blocked node",
      summary: "Blocked by an external dependency.",
      status: "ready",
      attention: "focus",
      repoIds: ["streamliner"],
      dependsOn: [],
    },
  ],
  checkpoints: [],
};

const layout: WorkstreamGraphLayoutResult = {
  nodes: [],
  externalNodes: [],
  edges: [],
  checkpointLanes: [],
  dependenciesByNode: new Map(),
  dependentsByNode: new Map(),
  ancestors: new Set(),
  descendants: new Set(),
};

const externalDependency: WorkstreamExternalDependencyView = {
  key: "blocked-node:upstream-approval",
  graphNodeId: "external:blocked-node:upstream-approval",
  nodeId: "blocked-node",
  dependency: {
    id: "upstream-approval",
    label: "External approval",
    url: "https://github.com/lossyrob/streamliner/issues/107",
    status: "pending",
  },
  label: "External approval",
  detail: "URL-only external dependency.",
  statusLabel: "pending",
  state: "manual",
  satisfied: false,
  url: "https://github.com/lossyrob/streamliner/issues/107",
};

describe("NodeInspector external dependencies", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = "";
  });

  it("shows selected external ghost details without launch controls", () => {
    act(() => {
      root.render(
        <NodeInspector
          entry={null}
          externalDependency={externalDependency}
          layout={layout}
          workstream={workstream}
          externalRouteForDependency={() => ({
            href: "https://github.com/lossyrob/streamliner/issues/107",
            onOpen: () => {},
          })}
        />,
      );
    });

    expect(container.textContent).toContain("External approval");
    expect(container.textContent).toContain("URL-only external dependency.");
    expect(container.textContent).toContain("Blocked node");
    expect(container.textContent).toContain("Open dependency URL");
    expect(container.textContent).not.toContain("Initialize PAW launch");
  });
});
