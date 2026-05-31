import { describe, expect, it } from "vitest";

import type { WorkstreamRegistryEntry } from "../workstream-registry-contract";
import { enrichNotification } from "./notification-enrichment";

function entry(overrides: Partial<WorkstreamRegistryEntry>): WorkstreamRegistryEntry {
  return {
    projectKey: "proj",
    workstreamId: "ws-a",
    title: "Workstream A",
    summary: "",
    path: "/tmp/ws-a",
    addedAt: "2024-01-01T00:00:00.000Z",
    lastOpenedAt: "2024-01-01T00:00:00.000Z",
    presentation: { shortName: "WSA", color: "#6754d7" },
    ...overrides,
  };
}

const base = "http://127.0.0.1:5173";

describe("enrichNotification", () => {
  it("resolves color, short name, project, and composed link by workstreamId", () => {
    const { draft, warnings } = enrichNotification(
      { title: "t", body: "b", workstreamId: "ws-a", nodeId: "n1" },
      { workstreams: [entry({})], dashboardBaseUrl: base },
    );
    expect(warnings).toEqual([]);
    expect(draft.projectKey).toBe("proj");
    expect(draft.workstreamColor).toBe("6754d7");
    expect(draft.workstreamShortName).toBe("WSA");
    expect(draft.link).toBe(`${base}/workstreams/proj/ws-a/nodes/n1`);
  });

  it("composes a link without a node segment when nodeId is absent", () => {
    const { draft } = enrichNotification(
      { title: "t", body: "b", workstreamId: "ws-a" },
      { workstreams: [entry({})], dashboardBaseUrl: base },
    );
    expect(draft.link).toBe(`${base}/workstreams/proj/ws-a`);
  });

  it("resolves by presentation.shortName fallback", () => {
    const { draft } = enrichNotification(
      { title: "t", body: "b", workstreamId: "WSA" },
      { workstreams: [entry({})], dashboardBaseUrl: base },
    );
    expect(draft.projectKey).toBe("proj");
    expect(draft.workstreamShortName).toBe("WSA");
  });

  it("does not guess on an ambiguous unqualified id and warns", () => {
    const workstreams = [
      entry({ projectKey: "p1", workstreamId: "dup" }),
      entry({ projectKey: "p2", workstreamId: "dup" }),
    ];
    const { draft, warnings } = enrichNotification(
      { title: "t", body: "b", workstreamId: "dup" },
      { workstreams, dashboardBaseUrl: base },
    );
    expect(draft.projectKey).toBeNull();
    expect(draft.workstreamColor).toBeNull();
    expect(draft.link).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("projectKey");
  });

  it("uses projectKey to disambiguate", () => {
    const workstreams = [
      entry({ projectKey: "p1", workstreamId: "dup", presentation: { shortName: "P1", color: "#111111" } }),
      entry({ projectKey: "p2", workstreamId: "dup", presentation: { shortName: "P2", color: "#222222" } }),
    ];
    const { draft, warnings } = enrichNotification(
      { title: "t", body: "b", workstreamId: "dup", projectKey: "p2" },
      { workstreams, dashboardBaseUrl: base },
    );
    expect(warnings).toEqual([]);
    expect(draft.workstreamShortName).toBe("P2");
    expect(draft.workstreamColor).toBe("222222");
  });

  it("passes an explicit link through and defaults severity/eventKind", () => {
    const { draft } = enrichNotification(
      { title: "t", body: "b", link: "https://example.com/x" },
      { workstreams: [], dashboardBaseUrl: base },
    );
    expect(draft.link).toBe("https://example.com/x");
    expect(draft.severity).toBe("info");
    expect(draft.eventKind).toBe("generic");
    expect(draft.source).toBe("cli");
  });

  it("leaves enrichment null on a registry miss without throwing", () => {
    const { draft, warnings } = enrichNotification(
      { title: "t", body: "b", workstreamId: "unknown" },
      { workstreams: [entry({})], dashboardBaseUrl: base },
    );
    expect(draft.projectKey).toBeNull();
    expect(draft.link).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("passes through eventKind and severity when provided", () => {
    const { draft } = enrichNotification(
      { title: "t", body: "b", eventKind: "pr-approved", severity: "warn" },
      { workstreams: [], dashboardBaseUrl: base },
    );
    expect(draft.eventKind).toBe("pr-approved");
    expect(draft.severity).toBe("warn");
  });
});
