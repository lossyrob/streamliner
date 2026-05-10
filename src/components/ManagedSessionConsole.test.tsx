// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ManagedSessionConsole } from "./ManagedSessionConsole";
import { managedRuntimeConsoleEvents } from "./ManagedSessionConsoleEvents";

describe("ManagedSessionConsole", () => {
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

  it("renders a read-only transcript with typed waiting guidance and PR trust context", () => {
    act(() => {
      root.render(
        <ManagedSessionConsole
          title="Managed session console"
          subtitle="Sanitized activity only."
          stateLabel="waiting for builder"
          stateTone="amber"
          currentMessage="Cleanup is blocked by managed runtime guardrails."
           events={[{
             timestamp: "2026-05-05T12:03:00.000Z",
             phase: "error",
             label: "Error",
             summary: "Cleanup is blocked by managed runtime guardrails.",
             status: "error",
           }]}
          emptyMessage="No activity yet."
          waitingReason={{
            code: "cleanup_blocked",
            label: "Cleanup blocked",
            suggestedAction: "Fix the dirty worktree and retry cleanup.",
            detail: "Cleanup is blocked by managed runtime guardrails.",
            blockerCode: "dirty-worktree",
          }}
          prReady={{
            url: "https://github.com/lossyrob/streamliner/pull/85",
            repo: "lossyrob/streamliner",
            number: 85,
            branchName: "feature/managed-session-console",
            baseBranch: "main",
            branchToBaseDiffUrl:
              "https://github.com/lossyrob/streamliner/compare/main...feature%2Fmanaged-session-console",
            worktreeClean: true,
            prHeadMatchesBranch: true,
            checks: [{
              label: "PR/head-state check",
              status: "pass",
              summary: "Recorded PR head matches the branch head.",
            }],
          }}
           replay={{
             retainedEventCount: 1,
             retainedEventLimit: 50,
             truncated: false,
           }}
           live
         />,
       );
     });

    expect(container.textContent).toContain("read-only");
    expect(container.querySelector(".sl-managed-console-current em")?.textContent).toBe(
      "Cleanup is blocked by managed runtime guardrails.",
    );
    expect(container.textContent).toContain("Cleanup blocked");
    expect(container.textContent).toContain("dirty worktree");
    expect(container.textContent).toContain("PR ready trust context");
    expect(container.textContent).toContain("feature/managed-session-console");
    expect(container.textContent).toContain("PR/head-state check");
    expect(container.querySelector("[role='log']")?.getAttribute("aria-live")).toBe(
      "polite",
    );
  });

  it("renders an empty waiting row when no events are retained", () => {
    act(() => {
      root.render(
        <ManagedSessionConsole
          title="Managed session console"
          events={[]}
          emptyMessage="No retained managed runtime activity yet."
        />,
      );
    });

    expect(container.textContent).toContain("waiting");
    expect(container.textContent).toContain("No retained managed runtime activity yet.");
    expect(container.querySelector("[role='log']")?.getAttribute("aria-live")).toBe("off");
  });

  it("can hide the latest-message banner for full console views", () => {
    act(() => {
      root.render(
        <ManagedSessionConsole
          title="Managed session console"
          currentMessage="Latest status is duplicated by the transcript."
          showCurrentMessage={false}
          events={[{
            timestamp: "2026-05-05T12:03:00.000Z",
            phase: "assistant_status",
            label: "Assistant",
            summary: "Latest status is duplicated by the transcript.",
            kind: "assistant-status",
            status: "info",
          }]}
          emptyMessage="No activity yet."
        />,
      );
    });

    expect(container.querySelector(".sl-managed-console-current")).toBeNull();
    expect(container.textContent).toContain("Latest status is duplicated by the transcript.");
  });

  it("summarizes retained replay metadata without emphasizing truncation internals", () => {
    act(() => {
      root.render(
        <ManagedSessionConsole
          title="Managed session console"
          events={[]}
          emptyMessage="No activity yet."
          replay={{
            retainedEventCount: 50,
            retainedEventLimit: 50,
            truncated: true,
          }}
        />,
      );
    });

    expect(container.textContent).toContain("Latest 50 sanitized events shown");
    expect(container.textContent).toContain("older activity is outside this preview");
  });

  it("omits optional callouts when waiting, trust, replay, and footer fields are absent", () => {
    act(() => {
      root.render(
        <ManagedSessionConsole
          title="Managed session console"
          currentMessage="Background session is running."
           events={[{
             timestamp: "2026-05-05T12:03:00.000Z",
             phase: "assistant_status",
             label: "Assistant",
             summary: "Background session is running.",
             kind: "assistant-status",
             status: "info",
           }]}
          emptyMessage="No activity yet."
        />,
      );
    });

    expect(container.textContent).toContain("Background session is running.");
    expect(container.querySelector(".sl-managed-console-callout")).toBeNull();
    expect(container.querySelector(".sl-managed-console-trust-grid")).toBeNull();
    expect(container.querySelector(".sl-managed-console-replay-note")).toBeNull();
    expect(container.querySelector(".sl-managed-console-footer")).toBeNull();
  });

  it("filters noisy runtime internals and labels agent-style rows", () => {
    const events = managedRuntimeConsoleEvents({
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      permissionProfile: "managed-autonomous",
      lifecycleState: "running",
      progress: [
        {
          timestamp: "2026-05-05T12:00:00.000Z",
          phase: "mcp_status",
          summary: "MCP status updated.",
          kind: "mcp",
          status: "info",
        },
        {
          timestamp: "2026-05-05T12:01:00.000Z",
          phase: "evidence",
          summary: "Hook event observed.",
          kind: "summary",
          status: "success",
        },
        {
          timestamp: "2026-05-05T12:01:30.000Z",
          phase: "skill_status",
          summary: "Invoked iterative-ui.",
          kind: "skill",
          status: "info",
        },
        {
          timestamp: "2026-05-05T12:02:00.000Z",
          phase: "assistant_status",
          summary: "Inspecting launch records before editing.",
          kind: "assistant-status",
          status: "info",
        },
        {
          timestamp: "2026-05-05T12:03:00.000Z",
          phase: "tool_started",
          summary: "Run console tests (shell)",
          detail: "npm test -- --run src\\components\\ManagedSessionConsole.test.tsx",
          kind: "tool",
          status: "info",
        },
        {
          timestamp: "2026-05-05T12:04:00.000Z",
          phase: "tool_completed",
          summary: "Run console tests (shell)",
          detail: "npm test -- --run src\\components\\ManagedSessionConsole.test.tsx",
          kind: "tool",
          status: "success",
          count: 70,
        },
      ],
    });

    expect(events.map((event) => event.summary)).toEqual([
      "Inspecting launch records before editing.",
      "Run console tests (shell)",
    ]);
    expect(events.map((event) => event.label)).toEqual(["Assistant", "Ran"]);
    expect(events[1]?.detail).toContain("npm test");
    expect(events[1]?.count).toBe(70);
  });

  it("does not coalesce uncorrelated tool rows when detail is absent", () => {
    const events = managedRuntimeConsoleEvents({
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      permissionProfile: "managed-autonomous",
      lifecycleState: "running",
      progress: [
        {
          timestamp: "2026-05-05T12:00:00.000Z",
          phase: "tool_started",
          summary: "Run first command",
          kind: "tool",
          status: "info",
        },
        {
          timestamp: "2026-05-05T12:01:00.000Z",
          phase: "tool_completed",
          summary: "Ran second command",
          kind: "tool",
          status: "success",
        },
      ],
    });

    expect(events.map((event) => event.summary)).toEqual([
      "Run first command",
      "Ran second command",
    ]);
    expect(events.map((event) => event.label)).toEqual(["Running", "Ran"]);
  });
});
