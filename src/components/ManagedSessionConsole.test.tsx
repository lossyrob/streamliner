// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ManagedSessionConsole } from "./ManagedSessionConsole";

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
    expect(container.textContent).toContain("streamliner $");
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

  it("describes replay truncation when older retained events were dropped", () => {
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

    expect(container.textContent).toContain("Replaying 50 retained sanitized events");
    expect(container.textContent).toContain("older activity was truncated at 50 events");
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
            summary: "Background session is running.",
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
});
