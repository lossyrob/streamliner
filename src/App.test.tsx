// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionRegistryListItem } from "./session-registry-contract";
import App from "./App";

function buildSession(
  overrides: Partial<SessionRegistryListItem> = {},
): SessionRegistryListItem {
  return {
    id: "manual-session-registry",
    title: "Manual session registry",
    titleSource: "user",
    description: "Build the local-first sessions surface and persistence layer.",
    lifecycleStatus: "active",
    lastSeenAt: null,
    updatedAt: "2026-04-23T12:00:00.000Z",
    color: "#5b7fff",
    cwd: "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
    repo: "lossyrob/streamliner",
    branch: "feature/manual-session-registry",
    tags: ["wave-2", "registry"],
    originKind: "manual",
    graphBinding: null,
    copilotSessionId: null,
    aiSummary: null,
    aiSummaryModel: null,
    aiSummaryUpdatedAt: null,
    aiSummaryEventsFingerprint: null,
    aiSummaryStatus: "missing",
    aiSummaryError: null,
    observedSessionKind: null,
    copilotProcessState: null,
    copilotProcessId: null,
    activityStatus: "unknown",
    activityStatusUpdatedAt: null,
    trustedSignalSource: null,
    trustedStartedAt: null,
    trustedEndedAt: null,
    trustedLastSignalAt: null,
    trustedStartSource: null,
    trustedEndReason: null,
    trustedExecutionKind: null,
    trustedInitialPromptLength: null,
    trustedLastPromptLength: null,
    derivedWorktreePath: null,
    derivedBranch: null,
    derivedGithubRefs: [],
    derivedContextUpdatedAt: null,
    derivedContextEventsOffset: 0,
    derivedContextEventsSize: 0,
    derivedContextEventsMtimeMs: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function toRegistryRecord(session: SessionRegistryListItem): Record<string, unknown> {
  const { originKind, ...record } = session;
  return {
    ...record,
    schemaVersion: 1,
    createdAt: "2026-04-23T12:00:00.000Z",
    origin: { kind: originKind },
  };
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    const url = new URL(input, "http://localhost");
    return `${url.pathname}${url.search}`;
  }
  if (input instanceof URL) {
    return `${input.pathname}${input.search}`;
  }
  const url = new URL(input.url, "http://localhost");
  return `${url.pathname}${url.search}`;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button "${label}".`);
  }
  return button;
}

function findSessionList(container: HTMLElement): HTMLElement {
  const sessionList = container.querySelector(".sl-sessions-groups");
  if (!(sessionList instanceof HTMLElement)) {
    throw new Error("Could not find the session list.");
  }
  return sessionList;
}

function findSessionRow(container: HTMLElement, title: string): HTMLButtonElement {
  const rows = [...container.querySelectorAll<HTMLButtonElement>(".sl-session-row")];
  const match = rows.find((row) =>
    row.querySelector(".sl-session-row-title")?.textContent?.trim() === title,
  );
  if (!match) {
    throw new Error(`Could not find session row with title "${title}".`);
  }
  return match;
}

async function openSessionSettings(
  container: HTMLElement,
  title: string,
): Promise<void> {
  act(() => {
    findSessionRow(container, title).click();
  });
  await settle();
  const tab = [...container.querySelectorAll<HTMLButtonElement>(".sl-sheet-tab")].find(
    (btn) => btn.textContent?.trim() === "Settings",
  );
  if (!tab) {
    throw new Error("Could not find Settings tab.");
  }
  act(() => {
    tab.click();
  });
  await settle();
}

function findSessionEditorInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll(".sl-session-editor input")].filter(
    (candidate): candidate is HTMLInputElement => candidate instanceof HTMLInputElement,
  );
}

function findNumberInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('.sl-sessions-filters input[type="number"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Could not find the stale-session number input.");
  }
  return input;
}

function findInputByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const input = container.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Could not find input with label "${label}".`);
  }
  return input;
}

function findButtonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button with label "${label}".`);
  }
  return button;
}

function setInputValue(
  input: HTMLInputElement,
  value: string,
): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!valueSetter) {
    throw new Error("Could not find HTMLInputElement value setter.");
  }
  act(() => {
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function settle(delayMs = 25): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  });
}

async function flushReact(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("App sessions route", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.pushState({}, "", "/");
    document.body.innerHTML = "";
  });

  it(
    "renders the sessions view directly and links the brand to the root view",
    async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path.startsWith("/api/sessions")) {
          return jsonResponse([buildSession()]);
        }
        if (path.startsWith("/api/graph.json")) {
          return new Response("missing graph", { status: 404 });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/?view=sessions");

      act(() => {
        root.render(<App />);
      });

      await settle();

      expect(container.textContent).toContain("Copilot CLI sessions");
      expect(container.textContent).toContain("Manual session registry");

      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL).startsWith("/api/graph.json"),
        ),
      ).toBe(false);

      const brandLink = container.querySelector(".sl-shell-brand");
      expect(brandLink).toBeInstanceOf(HTMLAnchorElement);
      expect(brandLink?.getAttribute("href")).toBe("/");

      act(() => {
        (brandLink as HTMLAnchorElement).click();
      });
      await settle();

      expect(window.location.search).toBe("");
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL).startsWith("/api/graph.json"),
        ),
      ).toBe(true);
    },
    15_000,
  );

  it(
    "prioritizes editable session identity over summary metadata",
    async () => {
      const session = buildSession({
        id: "trusted-session",
        title: "Follow Paw-Lite Process",
        originKind: "observed",
        copilotSessionId: "trusted-session",
        aiSummary:
          "This session started as follow-up work on trusted Copilot session tracking. The latest discussion is refining session cards so the editable title stays separate from a richer conversation description.",
        aiSummaryModel: "gpt-5.4-mini",
        aiSummaryUpdatedAt: "2026-04-24T22:54:16.000Z",
        aiSummaryStatus: "ready",
        trustedSignalSource: "copilot-cli-hook",
        trustedStartedAt: "2026-04-24T22:48:16.000Z",
        trustedLastSignalAt: "2026-04-24T22:48:16.000Z",
        trustedExecutionKind: "copilot_cli",
        observedSessionKind: "interactive",
        copilotProcessState: "live",
        activityStatus: "waiting_for_input",
        activityStatusUpdatedAt: "2026-04-24T22:54:16.000Z",
        derivedWorktreePath:
          "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
        derivedBranch: "feature/manual-session-registry",
        derivedGithubRefs: [
          {
            type: "pr",
            repo: "lossyrob/streamliner",
            number: 14,
            url: "https://github.com/lossyrob/streamliner/pull/14",
            firstSeenAt: "2026-04-24T22:53:00.000Z",
            lastSeenAt: "2026-04-24T22:53:00.000Z",
            source: "gh",
          },
        ],
      });
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = requestPath(input);
          if (path === "/api/sessions") {
            return jsonResponse([session]);
          }
          if (path === "/api/sessions/trusted-session" && init?.method === "PATCH") {
            const patch = JSON.parse(String(init.body)) as Partial<SessionRegistryListItem>;
            return jsonResponse(
              toRegistryRecord({
                ...session,
                ...patch,
                updatedAt: "2026-04-24T22:58:00.000Z",
              }),
            );
          }
          throw new Error(`Unexpected fetch: ${path}`);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/?view=sessions");

      act(() => {
        root.render(<App />);
      });

      await settle();

      const sessionList = findSessionList(container);
      expect(sessionList.textContent).toContain("Follow Paw-Lite Process");
      expect(sessionList.textContent).toContain("richer conversation description");
      expect(sessionList.textContent).toContain("waiting for you");
      expect(sessionList.textContent).toContain("worktree manual-session-registry");
      expect(sessionList.textContent).toContain("PR #14");
      expect(sessionList.textContent).not.toContain("gpt-5.4-mini");

      act(() => {
        findSessionRow(container, "Follow Paw-Lite Process").click();
      });
      await settle();
      expect(container.textContent).toContain("Conversation");
      expect(container.textContent).toContain("Started:");
      expect(container.textContent).toContain("Latest:");
      expect(container.textContent).toContain("Activity");
      expect(container.textContent).toContain("Activity note");
      expect(container.textContent).toContain("Derived context");
      expect(container.textContent).toContain("Active branch");
      expect(container.textContent).toContain("feature/manual-session-registry");

      setInputValue(findInputByLabel(container, "Session title"), "Terminal A session");
      act(() => {
        findButtonByLabel(container, "Show terminal color quick picks").click();
      });
      await settle();
      act(() => {
        findButtonByLabel(container, "Use terminal color #ff8c0a").click();
      });
      await settle();
      expect(
        container.querySelector('[aria-label="Terminal color quick picks"]'),
      ).toBeNull();
      act(() => {
        findButton(container, "Done").click();
      });
      await settle();

      const patchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/sessions/trusted-session" &&
          init?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          title: "Terminal A session",
          color: "#ff8c0a",
        }),
      );
    },
    15_000,
  );

  it(
    "refreshes an open sessions view when polling returns newer registry data",
    async () => {
      vi.useFakeTimers();
      let sessionsRequests = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path.startsWith("/api/sessions")) {
          sessionsRequests += 1;
          return jsonResponse([
            buildSession({
              title:
                sessionsRequests === 1
                  ? "Manual session registry"
                  : "Manual session registry (refreshed)",
              cwd:
                sessionsRequests === 1
                  ? "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry"
                  : "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry-refreshed",
              repo:
                sessionsRequests === 1
                  ? "lossyrob/streamliner"
                  : "lossyrob/streamliner-refreshed",
              branch:
                sessionsRequests === 1
                  ? "feature/manual-session-registry"
                  : "feature/manual-session-registry-refreshed",
            }),
          ]);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/?view=sessions");

      act(() => {
        root.render(<App />);
      });

      await flushReact();

      expect(container.textContent).toContain("Manual session registry");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      await flushReact();

      expect(container.textContent).toContain(
        "Manual session registry (refreshed)",
      );
      act(() => {
        findSessionRow(container, "Manual session registry (refreshed)").click();
      });
      await flushReact();
      const tab = [...container.querySelectorAll<HTMLButtonElement>(".sl-sheet-tab")].find(
        (btn) => btn.textContent?.trim() === "Settings",
      );
      if (!tab) {
        throw new Error("Could not find Settings tab.");
      }
      act(() => {
        tab.click();
      });
      await flushReact();
      const [, , , cwdInput, repoInput, branchInput] = findSessionEditorInputs(container);
      expect(cwdInput?.value).toBe(
        "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry-refreshed",
      );
      expect(repoInput?.value).toBe(
        "lossyrob/streamliner-refreshed",
      );
      expect(branchInput?.value).toBe("feature/manual-session-registry-refreshed");

      expect(sessionsRequests).toBeGreaterThanOrEqual(2);
    },
    20_000,
  );

  it(
    "blocks leaving the sessions view when a dirty draft cannot be flushed",
    async () => {
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = requestPath(input);
          if (path === "/api/sessions") {
            return jsonResponse([buildSession()]);
          }
          if (
            path === "/api/sessions/manual-session-registry" &&
            init?.method === "PATCH"
          ) {
            return jsonResponse({ error: "Session registry is locked." }, 423);
          }
          if (path.startsWith("/api/graph.json")) {
            return jsonResponse({ error: "graph should not load" }, 500);
          }
          throw new Error(`Unexpected fetch: ${path}`);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/?view=sessions");

      act(() => {
        root.render(<App />);
      });

      await settle();

      await openSessionSettings(container, "Manual session registry");
      const [titleInput] = findSessionEditorInputs(container);
      setInputValue(titleInput, "Manual session registry (dirty)");

      act(() => {
        findButton(container, "Workstream").click();
      });

      await settle(75);

      expect(container.textContent).toContain("Copilot CLI sessions");
      expect(container.textContent).toContain("Session registry is locked.");
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL).startsWith("/api/graph.json"),
        ),
      ).toBe(false);
    },
    15_000,
  );

  it(
    "hides stale sessions by default and lets the age threshold be adjusted",
    async () => {
      const now = Date.now();
      const recentSession = buildSession({
        id: "recent-session",
        title: "Recent session",
        lastSeenAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const staleSession = buildSession({
        id: "stale-session",
        title: "Stale session",
        lastSeenAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path.startsWith("/api/sessions")) {
          return jsonResponse([recentSession, staleSession]);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/?view=sessions");

      act(() => {
        root.render(<App />);
      });

      await settle();

      const sessionList = findSessionList(container);
      expect(sessionList.textContent).toContain("Recent session");
      expect(sessionList.textContent).not.toContain("Stale session");
      expect(container.textContent).toContain(
        "Hiding 1 session with no activity in the last 7 days.",
      );

      setInputValue(findNumberInput(container), "14");
      await settle();

      expect(sessionList.textContent).toContain("Stale session");
      expect(findNumberInput(container).value).toBe("14");
    },
    15_000,
  );

  it(
    "shows only relevant observed sessions by default and can reveal helper history",
    async () => {
      const now = Date.now();
      const activeObserved = buildSession({
        id: "active-observed",
        title: "Active observed",
        originKind: "observed",
        copilotSessionId: "active-observed",
        lifecycleStatus: "active",
        lastSeenAt: new Date(now - 5 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 5 * 60 * 1000).toISOString(),
        observedSessionKind: "interactive",
        copilotProcessState: "live",
        copilotProcessId: 4242,
        trustedSignalSource: "copilot-cli-hook",
        trustedStartedAt: new Date(now - 5 * 60 * 1000).toISOString(),
        trustedEndedAt: null,
        trustedLastSignalAt: new Date(now - 5 * 60 * 1000).toISOString(),
        trustedStartSource: "new",
        trustedExecutionKind: "copilot_cli",
      });
      const closedObserved = buildSession({
        id: "closed-observed",
        title: "Closed observed",
        originKind: "observed",
        copilotSessionId: "closed-observed",
        lifecycleStatus: "ended",
        lastSeenAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        observedSessionKind: "interactive",
        copilotProcessState: "none",
        trustedSignalSource: "copilot-cli-hook",
        trustedStartedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
        trustedEndedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        trustedLastSignalAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        trustedStartSource: "resume",
        trustedEndReason: "user_exit",
        trustedExecutionKind: "agency",
      });
      const interruptedObserved = buildSession({
        id: "interrupted-observed",
        title: "Interrupted observed",
        originKind: "observed",
        copilotSessionId: "interrupted-observed",
        lifecycleStatus: "active",
        lastSeenAt: new Date(now - 30 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 30 * 60 * 1000).toISOString(),
        observedSessionKind: "interactive",
        copilotProcessState: "none",
        trustedSignalSource: "copilot-cli-hook",
        trustedStartedAt: new Date(now - 30 * 60 * 1000).toISOString(),
        trustedEndedAt: null,
        trustedLastSignalAt: new Date(now - 30 * 60 * 1000).toISOString(),
        trustedStartSource: "resume",
        trustedExecutionKind: "agency",
      });
      const helperObserved = buildSession({
        id: "helper-observed",
        title:
          "Repo: lossyrob/streamliner\nBranch: feature/manual-session-registry\nExisting title: Helper observed",
        originKind: "observed",
        copilotSessionId: "helper-observed",
        lifecycleStatus: "ended",
        lastSeenAt: new Date(now - 10 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 10 * 60 * 1000).toISOString(),
        observedSessionKind: null,
        copilotProcessState: null,
      });
      const historicalObserved = buildSession({
        id: "historical-observed",
        title: "Historical observed",
        originKind: "observed",
        copilotSessionId: "historical-observed",
        lifecycleStatus: "ended",
        lastSeenAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        observedSessionKind: "interactive",
        copilotProcessState: "none",
      });

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path.startsWith("/api/sessions")) {
          return jsonResponse([
            activeObserved,
            closedObserved,
            interruptedObserved,
            helperObserved,
            historicalObserved,
          ]);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/?view=sessions");

      act(() => {
        root.render(<App />);
      });

      await settle();

      const sessionList = findSessionList(container);
      expect(sessionList.textContent).toContain("Active observed");
      expect(sessionList.textContent).toContain("Interrupted observed");
      expect(sessionList.textContent).not.toContain("Closed observed");
      expect(sessionList.textContent).not.toContain("Helper observed");
      expect(sessionList.textContent).not.toContain("Historical observed");
      expect(container.textContent).toContain(
        "Hiding 2 observed sessions without trusted Copilot CLI hook signals.",
      );
      expect(container.textContent).toContain(
        "Hiding 1 ended session. Interrupted / resumable sessions stay visible for recovery.",
      );

      act(() => {
        findButton(container, "Show ended").click();
      });
      await settle();

      expect(sessionList.textContent).toContain("Closed observed");

      act(() => {
        findButton(container, "Show all observed").click();
      });
      await settle();

      expect(sessionList.textContent).toContain("helper");
      expect(sessionList.textContent).toContain("Historical observed");
    },
    15_000,
  );
});
