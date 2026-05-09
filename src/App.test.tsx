// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionRegistryListItem } from "./session-registry-contract";
import { DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE } from "./session-registry-schema";
import App from "./App";
import { storeBrowserWorkstreamDirectory } from "./browser-workstream-files";
import { handleInAppLinkClick } from "./dashboard-routing";

const DEFAULT_TEST_SESSION_TIMESTAMP = new Date().toISOString();

function buildSession(
  overrides: Partial<SessionRegistryListItem> = {},
): SessionRegistryListItem {
  return {
    id: "manual-session-registry",
    version: 0,
    title: "Manual session registry",
    titleSource: "user",
    description: "Build the local-first sessions surface and persistence layer.",
    lifecycleStatus: "active",
    lastSeenAt: null,
    updatedAt: DEFAULT_TEST_SESSION_TIMESTAMP,
    color: "#5b7fff",
    cwd: "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry",
    repo: "lossyrob/streamliner",
    branch: "feature/manual-session-registry",
    tags: ["wave-2", "registry"],
    originKind: "manual",
    graphBinding: null,
    pawLaunch: null,
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
    activityEvidence: DEFAULT_SESSION_REGISTRY_ACTIVITY_EVIDENCE,
    pawWorkflow: null,
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

function buildWorkstreamGraph(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
        role: "primary",
      },
    ],
    designRefs: [],
    nodes: [],
    checkpoints: [],
    ...overrides,
  };
}

function buildTrackedWorkstream(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectKey: "streamliner",
    workstreamId: "api-test",
    title: "API Test",
    summary: "Test workstream graph.",
    path: "C:\\graphs\\api-test\\graph.json",
    addedAt: "2026-05-01T12:00:00.000Z",
    lastOpenedAt: "2026-05-01T12:00:00.000Z",
    fileStatus: "available",
    ...overrides,
  };
}

function buildLaunchGraph(
  status = "ready",
  overrides: {
    graph?: Record<string, unknown>;
    node?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return buildWorkstreamGraph({
    ...overrides.graph,
    nodes: [
      {
        id: "launch-prompt-profiles",
        type: "task",
        title: "Launch prompt profiles",
        summary: "Configure the PAW launch prompt defaults.",
        status,
        attention: "focus",
        repoIds: ["streamliner"],
        tracker: {
          type: "github",
          owner: "lossyrob",
          repo: "streamliner",
          number: 33,
        },
        dependsOn: [],
        ...overrides.node,
      },
    ],
    checkpoints: [
      {
        id: "launch",
        title: "Launch",
        summary: "Launch preparation.",
        status: "planned",
        nodeIds: ["launch-prompt-profiles"],
      },
    ],
  });
}

function buildConcurrentLaunchGraph(): Record<string, unknown> {
  return buildWorkstreamGraph({
    nodes: [
      {
        id: "launch-prompt-profiles",
        type: "task",
        title: "Launch prompt profiles",
        summary: "Configure the PAW launch prompt defaults.",
        status: "ready",
        attention: "focus",
        repoIds: ["streamliner"],
        tracker: {
          type: "github",
          owner: "lossyrob",
          repo: "streamliner",
          number: 33,
        },
        dependsOn: [],
      },
      {
        id: "runtime-overlay-ui",
        type: "task",
        title: "Runtime overlay UI",
        summary: "Show runtime launch overlays.",
        status: "ready",
        attention: "watch",
        repoIds: ["streamliner"],
        tracker: {
          type: "github",
          owner: "lossyrob",
          repo: "streamliner",
          number: 52,
        },
        dependsOn: [],
      },
    ],
    checkpoints: [
      {
        id: "launch",
        title: "Launch",
        summary: "Launch preparation.",
        status: "planned",
        nodeIds: ["launch-prompt-profiles", "runtime-overlay-ui"],
      },
    ],
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function emptyNodeLaunchRecordResponse(): Response {
  return jsonResponse({ record: null, records: [] });
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

function findLink(container: HTMLElement, label: string): HTMLAnchorElement {
  const link = [...container.querySelectorAll("a")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(link instanceof HTMLAnchorElement)) {
    throw new Error(`Could not find link "${label}".`);
  }
  return link;
}

function findWorkstreamCard(container: HTMLElement, title: string): HTMLAnchorElement {
  const button = [...container.querySelectorAll<HTMLAnchorElement>(".sl-workstream-card-main")].find(
    (candidate) => candidate.textContent?.includes(title),
  );
  if (!(button instanceof HTMLAnchorElement)) {
    throw new Error(`Could not find workstream card "${title}".`);
  }
  return button;
}

function runInAppLinkClick(overrides: Partial<{
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}> = {}) {
  const preventDefault = vi.fn();
  const action = vi.fn();
  const event = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    preventDefault,
    ...overrides,
  } as unknown as Parameters<typeof handleInAppLinkClick>[0];
  handleInAppLinkClick(event, action);
  return { action, preventDefault };
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

function findTextareaByLabel(container: HTMLElement, label: string): HTMLTextAreaElement {
  const textarea = container.querySelector(`textarea[aria-label="${label}"]`);
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error(`Could not find textarea with label "${label}".`);
  }
  return textarea;
}

function findSelectByLabel(container: HTMLElement, label: string): HTMLSelectElement {
  const select = container.querySelector(`select[aria-label="${label}"]`);
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Could not find select with label "${label}".`);
  }
  return select;
}

function findCanvasNode(container: HTMLElement, title: string): HTMLElement {
  const titleElement = [...container.querySelectorAll<HTMLElement>(".sl-node-title")].find(
    (candidate) => candidate.textContent?.trim() === title,
  );
  const nodeElement = titleElement?.closest(".react-flow__node") ?? titleElement?.closest(".sl-node");
  if (!(nodeElement instanceof HTMLElement)) {
    throw new Error(`Could not find canvas node "${title}".`);
  }
  return nodeElement;
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

function setTextareaValue(
  textarea: HTMLTextAreaElement,
  value: string,
): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!valueSetter) {
    throw new Error("Could not find HTMLTextAreaElement value setter.");
  }
  act(() => {
    valueSetter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function setSelectValue(
  select: HTMLSelectElement,
  value: string,
): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  if (!valueSetter) {
    throw new Error("Could not find HTMLSelectElement value setter.");
  }
  act(() => {
    valueSetter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
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

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly withCredentials = false;
  readyState = 0;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    MockEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = 2;
  }

  emit(type: string, data: unknown = {}): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
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
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );

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
    "renders sessions directly and links the brand to the landing page",
    async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path.startsWith("/api/sessions")) {
          return jsonResponse([buildSession()]);
        }
        if (path === "/api/workstreams") {
          return jsonResponse({ version: 1, migrationWarnings: [], workstreams: [] });
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
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
      expect(window.location.pathname).toBe("/sessions");
      expect(window.location.search).toBe("");

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

      expect(container.textContent).toContain("Keep parallel work visible.");
      expect(container.textContent).toContain("Workstreams");
      expect(container.textContent).toContain("Sessions");
      expect(container.textContent).not.toContain("Launch prompt profiles");
      expect(container.textContent).not.toContain("My Sessions");
      expect(window.location.search).toBe("");
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL).startsWith("/api/graph.json"),
        ),
      ).toBe(false);

      act(() => {
        findLink(container, "Workstreams").click();
      });
      await settle();

      expect(window.location.pathname).toBe("/workstreams");
      expect(container.textContent).toContain("Tracked workstreams");

      const sessionsLink = findLink(container, "Sessions");
      expect(sessionsLink.getAttribute("href")).toBe("/sessions");
      const settingsLink = container.querySelector<HTMLAnchorElement>('a[aria-label="Streamliner settings"]');
      expect(settingsLink).toBeInstanceOf(HTMLAnchorElement);
      expect(settingsLink?.getAttribute("href")).toBe("/settings/profiles");

      act(() => {
        settingsLink?.click();
      });
      await settle(100);

      expect(window.location.pathname).toBe("/settings/profiles");
      expect(container.querySelector(".sl-settings-sidebar-head")?.textContent?.trim()).toBe("Settings");
      expect(container.querySelector(".sl-profiles-header")?.textContent).toContain("PAW profiles");
      expect(container.querySelector(".sl-profiles-header")?.textContent).not.toContain("Launch prompt profiles");
      expect(container.textContent).toContain("No launch prompt profiles yet");
    },
    15_000,
  );

  it(
    "manages PAW launch prompt profiles from settings",
    async () => {
      const copyText = vi.fn(async () => {});
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: copyText },
      });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      let profiles = [{
        id: "final-pr-only",
        name: "Final PR only",
        instructions: "Use saved final PR only workflow text.",
        updatedAt: "2026-05-03T18:00:00.000Z",
      }];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({ version: 1, migrationWarnings: [], workstreams: [] });
        }
        if (path === "/api/paw-launch-prompt-profiles" && (!init?.method || init.method === "GET")) {
          expect(init?.cache).toBe("no-store");
          return jsonResponse({ profiles });
        }
        if (path === "/api/paw-launch-prompt-profiles" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { name: string; instructions: string };
          const profile = {
            id: body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
            name: body.name,
            instructions: body.instructions,
            updatedAt: "2026-05-03T18:01:00.000Z",
          };
          profiles = [...profiles, profile];
          return jsonResponse({ profile }, 201);
        }
        if (path === "/api/paw-launch-prompt-profiles/final-pr-only-copy" && init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { name: string; instructions: string };
          const profile = {
            id: "final-pr-only-copy",
            name: body.name,
            instructions: body.instructions,
            updatedAt: "2026-05-03T18:02:00.000Z",
          };
          profiles = profiles.map((candidate) =>
            candidate.id === profile.id ? profile : candidate
          );
          return jsonResponse({ profile });
        }
        if (path === "/api/paw-launch-prompt-profiles/final-pr-only-copy" && init?.method === "DELETE") {
          profiles = profiles.filter((profile) => profile.id !== "final-pr-only-copy");
          return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/settings/profiles");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      expect(container.querySelector(".sl-settings-sidebar-head")?.textContent?.trim()).toBe("Settings");
      expect(container.querySelector(".sl-profiles-header")?.textContent).toContain("PAW profiles");
      expect(container.querySelector(".sl-profiles-header")?.textContent).not.toContain("Launch prompt profiles");
      act(() => {
        findButtonByLabel(container, "Select profile Final PR only").click();
      });
      await settle();
      expect(findTextareaByLabel(container, "Profile instructions").value).toBe(
        "Use saved final PR only workflow text.",
      );

      setTextareaValue(
        findTextareaByLabel(container, "Profile instructions"),
        "Unsaved draft profile edits.",
      );
      act(() => {
        findButton(container, "Refresh").click();
      });
      await settle(100);
      expect(findTextareaByLabel(container, "Profile instructions").value).toBe(
        "Unsaved draft profile edits.",
      );

      act(() => {
        findButton(container, "Copy instructions").click();
      });
      await settle();
      expect(copyText).toHaveBeenCalledWith("Use saved final PR only workflow text.");

      act(() => {
        findButton(container, "Duplicate profile").click();
      });
      await settle(100);
      expect(findInputByLabel(container, "Profile name").value).toBe("Final PR only copy");

      setInputValue(findInputByLabel(container, "Profile name"), "Final PR only updated");
      setTextareaValue(
        findTextareaByLabel(container, "Profile instructions"),
        "Updated standalone profile text.",
      );
      act(() => {
        findButton(container, "Save changes").click();
      });
      await settle(100);
      expect(container.textContent).toContain('Updated "Final PR only updated".');

      act(() => {
        findButton(container, "Delete profile").click();
      });
      await settle(100);
      expect(window.confirm).toHaveBeenCalledWith(
        'Delete "Final PR only updated"? Workstreams configured to use this profile will fall back to custom launch instructions.',
      );
      expect(container.textContent).toContain('Deleted "Final PR only updated".');
      expect(container.textContent).not.toContain("final-pr-only-copy");
    },
    15_000,
  );

  it("renders managed runtime state in My Sessions rows and details", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      if (path === "/api/sessions/managed-session/managed/takeover") {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          outcome: { message: "Terminal takeover opened visible Copilot CLI." },
        });
      }
      if (path.startsWith("/api/sessions")) {
        return jsonResponse([
          buildSession({
            id: "managed-session",
            title: "Managed worker",
            originKind: "launched",
            runtime: {
              runtimeKind: "managed-sdk",
              runtimeOwner: "streamliner-sdk",
              lifecycleState: "review_ready",
              permissionProfile: "managed-autonomous",
              launchClaimId: "claim-managed",
              launchNonce: "nonce-managed",
              sdkSessionId: "sdk-session-123",
              sdkWorkspacePath: "C:\\state\\sdk-session-123",
              sdkStateRoot: "C:\\state\\sdk-session-123\\state",
              startedAt: "2026-05-05T11:58:00.000Z",
              lastStateChangedAt: "2026-05-05T12:00:00.000Z",
              progressEvents: [
                {
                  id: "progress-review",
                  sequence: 1,
                  timestamp: "2026-05-05T11:59:00.000Z",
                  type: "evidence",
                  message: "Prepared final review handoff.",
                },
              ],
              evidence: [{
                id: "evidence-review",
                kind: "review_ready",
                source: "test",
                detectedAt: "2026-05-05T12:00:00.000Z",
                url: null,
                repo: null,
                number: null,
                sha: null,
                summary: "Review is ready for builder handoff.",
              }],
            },
          }),
        ]);
      }
      if (path === "/api/workstreams") {
        return jsonResponse({ version: 1, migrationWarnings: [], workstreams: [] });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/sessions");

    act(() => {
      root.render(<App />);
    });
    await settle();

    expect(container.textContent).toContain("background session");
    expect(container.textContent).toContain("review ready");
    act(() => {
      findSessionRow(container, "Managed worker").click();
    });
    await settle();

    expect(container.textContent).toContain("Background session");
    expect(container.textContent).toContain("managed autonomous");
    expect(container.textContent).toContain("sdk-session-123");
    expect(container.textContent).toContain("Terminal takeover");
    expect(container.textContent).toContain("Cleanup");
    expect(findButton(container, "Terminal takeover").disabled).toBe(false);
    expect(findButton(container, "Cleanup").disabled).toBe(true);

    act(() => {
      findButton(container, "Terminal takeover").click();
    });
    await settle();

    expect(fetchMock.mock.calls.some(([input, init]) =>
      requestPath(input as RequestInfo | URL) === "/api/sessions/managed-session/managed/takeover" &&
      init?.method === "POST"
    )).toBe(true);
    expect(container.textContent).toContain("Terminal takeover opened visible Copilot CLI.");
  });

  it("shows a loading state while the workstreams registry is still fetching", async () => {
    let resolveRegistry!: (response: Response) => void;
    const registryPromise = new Promise<Response>((resolve) => {
      resolveRegistry = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/workstreams") {
        return registryPromise;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/workstreams");

    act(() => {
      root.render(<App />);
    });
    await flushReact();

    expect(container.textContent).toContain("Loading workstreams…");
    expect(container.textContent).not.toContain("No tracked workstreams yet");

    resolveRegistry(jsonResponse({ version: 1, migrationWarnings: [], workstreams: [] }));
    await settle();

    expect(container.textContent).not.toContain("Loading workstreams…");
    expect(container.textContent).toContain("No tracked workstreams yet");
  });

  it(
    "shows bound session workstream context and opens the selected node route",
    async () => {
      const graph = buildWorkstreamGraph({
        id: "session-launching-and-tracking",
        title: "Session launching and tracking",
        summary: "Connect launched sessions to graph nodes.",
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
        checkpoints: [
          {
            id: "tracking-visible",
            title: "Tracking visible",
            summary: "Make launch bindings visible.",
            status: "planned",
            nodeIds: ["sessions-workstream-linkage-ui"],
          },
        ],
      });
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path.startsWith("/api/sessions")) {
          return jsonResponse([
            buildSession({
              id: "bound-session",
              title: "Graph-launched worker",
              originKind: "launched",
              graphBinding: {
                workstreamId: "session-launching-and-tracking",
                nodeId: "sessions-workstream-linkage-ui",
              },
            }),
          ]);
        }
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [
              buildTrackedWorkstream({
                workstreamId: "session-launching-and-tracking",
                title: "Session launching and tracking",
                summary: "Connect launched sessions to graph nodes.",
                path: "C:\\graphs\\session-launching-and-tracking\\graph.json",
              }),
            ],
          });
        }
        if (path === "/api/workstreams/streamliner/session-launching-and-tracking/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({
            profiles: [{
              id: "final-pr-only",
              name: "Final PR only",
              instructions: "Use final PR only workflow.",
              updatedAt: "2026-05-03T18:00:00.000Z",
            }],
          });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/sessions");

      act(() => {
        root.render(<App />);
      });

      await settle(500);

      expect(container.textContent).toContain("Graph-launched worker");
      expect(container.textContent).toContain("Session launching and tracking");
      expect(container.textContent).toContain("Sessions view workstream linkage");

      act(() => {
        findButton(container, "Workstream").click();
      });
      await settle();
      const groupTitle = container.querySelector(".sl-session-group-title");
      expect(groupTitle?.textContent).toContain("Session launching and tracking");
      expect(groupTitle?.textContent).toContain("streamliner/session-launching-and-tracking");

      const nodeLink = [...container.querySelectorAll<HTMLAnchorElement>("a.sl-session-row-context-chip")].find(
        (candidate) => candidate.textContent?.includes("Sessions view workstream linkage"),
      );
      expect(nodeLink).toBeInstanceOf(HTMLAnchorElement);

      act(() => {
        nodeLink?.click();
      });
      await settle(200);

      expect(window.location.pathname).toBe(
        "/workstreams/streamliner/session-launching-and-tracking/nodes/sessions-workstream-linkage-ui",
      );
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL).startsWith(
            "/api/node-launch-records?",
          ),
        ),
      ).toBe(true);
    },
    15_000,
  );

  it(
    "renders bound session status on graph nodes and links to scoped Sessions",
    async () => {
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      const graph = buildWorkstreamGraph({
        id: "session-launching-and-tracking",
        title: "Session launching and tracking",
        summary: "Connect launched sessions to graph nodes.",
        nodes: [
          {
            id: "graph-node-session-status-ui",
            type: "task",
            title: "Graph node session status UI",
            summary: "Render bound session status directly on graph nodes.",
            status: "ready",
            attention: "focus",
            repoIds: ["streamliner"],
            dependsOn: [],
          },
          {
            id: "quiet-graph-task",
            type: "task",
            title: "Quiet graph task",
            summary: "Render normal graph card content.",
            status: "ready",
            attention: "watch",
            repoIds: ["streamliner"],
            dependsOn: [],
          },
        ],
        checkpoints: [
          {
            id: "tracking-visible",
            title: "Tracking visible",
            summary: "Make launch bindings visible.",
            status: "planned",
            nodeIds: ["graph-node-session-status-ui", "quiet-graph-task"],
          },
        ],
      });
      const boundSessions = [
        buildSession({
          id: "working-bound-session",
          title: "Working graph worker",
          originKind: "launched",
          activityStatus: "working",
          graphBinding: {
            workstreamId: "session-launching-and-tracking",
            nodeId: "graph-node-session-status-ui",
          },
        }),
        buildSession({
          id: "waiting-bound-session",
          title: "Waiting graph worker",
          originKind: "launched",
          activityStatus: "waiting_for_input",
          graphBinding: {
            workstreamId: "session-launching-and-tracking",
            nodeId: "graph-node-session-status-ui",
          },
        }),
        buildSession({
          id: "manual-bound-session",
          title: "Manual bound session",
          originKind: "manual",
          activityStatus: "waiting_for_input",
          graphBinding: {
            workstreamId: "session-launching-and-tracking",
            nodeId: "graph-node-session-status-ui",
          },
        }),
        buildSession({
          id: "unbound-session",
          title: "Unbound session",
          originKind: "launched",
          activityStatus: "waiting_for_input",
          graphBinding: null,
        }),
      ];
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [
              buildTrackedWorkstream({
                workstreamId: "session-launching-and-tracking",
                title: "Session launching and tracking",
                summary: "Connect launched sessions to graph nodes.",
                path: "C:\\graphs\\session-launching-and-tracking\\graph.json",
              }),
            ],
          });
        }
        if (path === "/api/workstreams/streamliner/session-launching-and-tracking/graph") {
          return jsonResponse(graph);
        }
        if (path === "/api/sessions?workstreamId=session-launching-and-tracking") {
          return jsonResponse(boundSessions);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (
          path ===
          "/api/sessions?workstreamId=session-launching-and-tracking&nodeId=graph-node-session-status-ui"
        ) {
          return jsonResponse(boundSessions);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner/session-launching-and-tracking");

      act(() => {
        root.render(<App />);
      });

      await settle(200);

      const graphNode = findCanvasNode(container, "Graph node session status UI");
      expect(graphNode.textContent).toContain("waiting for you");
      expect(graphNode.textContent).toContain("2 sessions");
      expect(graphNode.textContent).not.toContain("Manual bound session");
      const graphSessionSource = MockEventSource.instances.find(
        (source) =>
          source.url ===
          "/api/sessions/events?workstreamId=session-launching-and-tracking",
      );
      expect(graphSessionSource).toBeDefined();
      const initialSessionRequests = fetchMock.mock.calls.filter(
        ([input]) =>
          requestPath(input as RequestInfo | URL) ===
          "/api/sessions?workstreamId=session-launching-and-tracking",
      ).length;
      act(() => {
        graphSessionSource?.emit("snapshot", { sessions: [boundSessions[0]] });
      });
      await flushReact();
      expect(graphNode.textContent).toContain("1 session");
      expect(
        fetchMock.mock.calls.filter(
          ([input]) =>
            requestPath(input as RequestInfo | URL) ===
            "/api/sessions?workstreamId=session-launching-and-tracking",
        ),
      ).toHaveLength(initialSessionRequests);
      const quietNode = findCanvasNode(container, "Quiet graph task");
      expect(quietNode.textContent).not.toContain("No bound sessions");
      expect(quietNode.textContent).not.toContain("Loading sessions");
      expect(quietNode.textContent).not.toContain("Session status unavailable");
      expect(quietNode.textContent).not.toContain("View in Sessions");

      const sessionsLink = [...graphNode.querySelectorAll<HTMLAnchorElement>("a")].find(
        (candidate) => candidate.textContent?.trim() === "View in Sessions",
      );
      expect(sessionsLink).toBeInstanceOf(HTMLAnchorElement);

      act(() => {
        sessionsLink?.click();
      });
      await settle(200);

      expect(window.location.pathname).toBe("/sessions");
      expect(window.location.search).toBe(
        "?workstreamId=session-launching-and-tracking&nodeId=graph-node-session-status-ui",
      );
      expect(container.textContent).toContain("Showing graph-bound sessions");
      expect(container.textContent).toContain("graph-node-session-status-ui");
      expect(container.textContent).toContain("Waiting graph worker");
      expect(container.textContent).toContain("Hiding 1 manual session");
      expect(container.textContent).not.toContain("Manual bound session");
    },
    15_000,
  );

  it(
    "shows PAW workflow enrichment without changing the activity label",
    async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path.startsWith("/api/sessions")) {
          return jsonResponse([
            buildSession({
              id: "paw-session",
              title: "PAW Artifact Status Observation",
              originKind: "launched",
              activityStatus: "waiting_for_input",
              activityStatusUpdatedAt: "2026-05-05T13:06:00.000Z",
              pawWorkflow: {
                status: "recognized",
                stage: "implementation",
                workflowKind: "paw-lite",
                workId: "paw-artifact-status-observation",
                workTitle: "PAW Artifact Status Observation",
                workDir: "C:\\repo\\.paw\\work\\paw-artifact-status-observation",
                artifacts: [
                  {
                    path: "Plan.md",
                    kind: "planning",
                    stage: "planning",
                    mtimeMs: 1_778_002_000_000,
                  },
                  {
                    path: "implementation/phase-1.md",
                    kind: "implementation",
                    stage: "implementation",
                    mtimeMs: 1_778_003_000_000,
                  },
                ],
                artifactCount: 2,
                latestArtifactPath: "implementation/phase-1.md",
                latestArtifactMtimeMs: 1_778_003_000_000,
                scannedAt: "2026-05-05T13:05:00.000Z",
                diagnostics: [],
              },
            }),
            buildSession({
              id: "ordinary-session",
              title: "Create Interview Packet For Silvia Vallet",
              originKind: "observed",
              trustedSignalSource: "copilot-cli-hook",
              trustedStartedAt: "2026-05-05T13:00:00.000Z",
              trustedLastSignalAt: "2026-05-05T13:00:00.000Z",
              pawWorkflow: {
                status: "recognized",
                stage: "planning",
                workflowKind: "paw-lite",
                workId: "interview-packet",
                workTitle: "Interview Packet",
                workDir: "C:\\repo\\.paw\\work\\interview-packet",
                artifacts: [],
                artifactCount: 0,
                latestArtifactPath: null,
                latestArtifactMtimeMs: null,
                scannedAt: "2026-05-05T13:05:00.000Z",
                diagnostics: [],
              },
            }),
          ]);
        }
        if (path === "/api/workstreams") {
          return jsonResponse({ version: 1, migrationWarnings: [], workstreams: [] });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/sessions");

      act(() => {
        root.render(<App />);
      });
      await settle();

      const row = findSessionRow(container, "PAW Artifact Status Observation");
      expect(row.textContent).toContain("waiting for you");
      expect(row.textContent).toContain("🐾 PAW implementation");
      const ordinaryRow = findSessionRow(container, "Create Interview Packet For Silvia Vallet");
      expect(ordinaryRow.textContent).not.toContain("PAW planning");

      act(() => {
        row.click();
      });
      await settle();

      expect(container.textContent).toContain("PAW workflow");
      expect(container.textContent).toContain("paw-artifact-status-observation");
      expect(container.textContent).toContain("implementation/phase-1.md");
      expect(container.textContent).toContain(
        "The latest Copilot event indicates the assistant turn ended",
      );
    },
    15_000,
  );

  it(
    "renders runtime overlay from graph-wide launch records and PAW session evidence",
    async () => {
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      const graph = buildLaunchGraph();
      const launchRecord = {
        id: "launch-prompt-profiles-record",
        graphPath: "C:\\graphs\\api-test\\graph.json",
        projectKey: "streamliner",
        workstreamId: "api-test",
        nodeId: "launch-prompt-profiles",
        workId: "launch-prompt-profiles",
        workTitle: "Launch prompt profiles",
        branch: "feature/launch-prompt-profiles",
        cwd: "C:\\graphs\\api-test",
        pawWorkDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
        workflowContextPath:
          "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
        streamlinerContextPath:
          "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
        contextPackagePath: "C:\\state\\launch-contexts\\ctx",
        contextFilePath: "C:\\state\\launch-contexts\\ctx\\context.md",
        launchNonce: "nonce-1",
        launchClaimRef: "claim-1",
        trackerUrl: "https://github.com/lossyrob/streamliner/issues/33",
        createdAt: "2026-05-03T18:00:00.000Z",
        updatedAt: "2026-05-03T18:01:00.000Z",
        pathStatus: {
          cwdExists: true,
          pawWorkDirExists: true,
          workflowContextExists: true,
          streamlinerContextExists: true,
          contextPackageExists: true,
          contextFileExists: true,
        },
        latestClaim: {
          launchClaimId: "claim-1",
          status: "pending",
          launchedAt: "2026-05-03T18:00:00.000Z",
          updatedAt: "2026-05-03T18:01:00.000Z",
          bindingWindowExpiresAt: "2026-05-03T18:05:00.000Z",
          reservedRegistryId: "registry-1",
          boundRegistryId: "registry-1",
          boundCopilotSessionId: "copilot-1",
          failureCode: null,
          failureReason: null,
          blocksLaunch: true,
          retryable: false,
        },
      };
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path === "/api/sessions?workstreamId=api-test") {
          return jsonResponse([
            buildSession({
              id: "paw-overlay-session",
              title: "PAW overlay worker",
              originKind: "launched",
              activityStatus: "working",
              graphBinding: {
                workstreamId: "api-test",
                nodeId: "launch-prompt-profiles",
              },
              pawLaunch: {
                workId: "launch-prompt-profiles",
                workTitle: "Launch prompt profiles",
                workflowKind: "paw-lite",
                pawWorkDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
                workflowContextPath:
                  "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
                streamlinerContextPath:
                  "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
              },
              pawWorkflow: {
                status: "recognized",
                stage: "implementation",
                workflowKind: "paw-lite",
                workId: "launch-prompt-profiles",
                workTitle: "Launch prompt profiles",
                workDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
                artifacts: [],
                artifactCount: 1,
                latestArtifactPath: "Plan.md",
                latestArtifactMtimeMs: 1_778_003_000_000,
                scannedAt: "2026-05-05T13:05:00.000Z",
                diagnostics: [],
              },
            }),
          ]);
        }
        if (path.startsWith("/api/node-launch-records?") && path.includes("nodeId=")) {
          return jsonResponse({ record: launchRecord, operation: null });
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return jsonResponse({ records: [launchRecord] });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState(
        {},
        "",
        "/workstreams/streamliner/api-test/nodes/launch-prompt-profiles",
      );

      act(() => {
        root.render(<App />);
      });
      await settle(300);

      const graphNode = findCanvasNode(container, "Launch prompt profiles");
      expect(graphNode.textContent).toContain("runtime active");
      expect(graphNode.textContent).toContain("PAW implementation");
      expect(container.textContent).toContain("RUNTIME DETAILS");
      expect(container.textContent).not.toContain("Runtime overlay");
      expect(container.textContent).toContain("PAW overlay worker (working)");
      expect(container.textContent).toContain("pending blocking launch");
      expect(container.textContent).toContain(
        "GitHub tracker linked; live issue/PR snapshot not loaded.",
      );
      expect(container.textContent).not.toContain("tracker snapshot missing");
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const path = requestPath(input as RequestInfo | URL);
          return path.startsWith("/api/node-launch-records?") && !path.includes("nodeId=");
        }),
      ).toBe(true);
    },
    15_000,
  );

  it("keeps plain route clicks in-app and leaves modified clicks to the browser", () => {
    const plainClick = runInAppLinkClick();
    expect(plainClick.preventDefault).toHaveBeenCalledOnce();
    expect(plainClick.action).toHaveBeenCalledOnce();

    const ctrlClick = runInAppLinkClick({ ctrlKey: true });
    expect(ctrlClick.preventDefault).not.toHaveBeenCalled();
    expect(ctrlClick.action).not.toHaveBeenCalled();

    const middleClick = runInAppLinkClick({ button: 1 });
    expect(middleClick.preventDefault).not.toHaveBeenCalled();
    expect(middleClick.action).not.toHaveBeenCalled();
  });

  it(
    "loads a workstream from a sticky path route and clears the legacy last-graph key",
    async () => {
      window.localStorage.setItem("streamliner:lastGraphPath", "C:\\old\\graph.json");
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [
              { code: "legacy-recents-identity-conflict", message: "Skipped duplicate legacy graph." },
            ],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(buildWorkstreamGraph());
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });

      await settle(100);

      expect(container.textContent).toContain("API Test");
      expect(container.textContent).toContain("Skipped duplicate legacy graph.");
      expect(window.location.pathname).toBe("/workstreams/streamliner/api-test");
      expect(window.localStorage.getItem("streamliner:lastGraphPath")).toBeNull();
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL) === "/api/workstreams/streamliner/api-test/graph",
        ),
      ).toBe(true);
    },
    15_000,
  );

  it(
    "opens and cancels the PAW launch dialog without preparing a launch",
    async () => {
      const graph = buildLaunchGraph();
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      expect(container.textContent).toContain("PAW launch");
      expect(findTextareaByLabel(container, "Launch instructions").value).toContain("final-pr-only");

      act(() => {
        findButton(container, "Cancel").click();
      });
      await settle();

      expect(container.querySelector('textarea[aria-label="Launch instructions"]')).toBeNull();
      expect([...container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Run PAW init",
      )).toBe(false);
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL) === "/api/launch-preparations",
        ),
      ).toBe(false);
    },
    15_000,
  );

  it(
    "loads PAW prompt profiles while selected launch-state lookup is still pending",
    async () => {
      const graph = buildLaunchGraph();
      let resolveSelectedLaunchRecord!: (response: Response) => void;
      const selectedLaunchRecordPromise = new Promise<Response>((resolve) => {
        resolveSelectedLaunchRecord = resolve;
      });
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return Promise.resolve(jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          }));
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return Promise.resolve(jsonResponse(graph));
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return Promise.resolve(
            path.includes("nodeId=")
              ? selectedLaunchRecordPromise
              : emptyNodeLaunchRecordResponse(),
          );
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return Promise.resolve(jsonResponse({
            profiles: [{
              id: "final-pr-only",
              name: "Final PR only",
              instructions: "Use saved final PR only workflow text.",
              updatedAt: "2026-05-03T18:00:00.000Z",
            }],
          }));
        }
        return Promise.reject(new Error(`Unexpected fetch: ${path}`));
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle(100);

      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL) === "/api/paw-launch-prompt-profiles"
        ),
      ).toBe(true);
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL).startsWith("/api/node-launch-records?") &&
          requestPath(input as RequestInfo | URL).includes("nodeId=launch-prompt-profiles")
        ),
      ).toBe(true);
      expect(container.textContent).toContain("Loading launch details");

      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle(100);

      const profileSelect = findSelectByLabel(container, "Load profile");
      expect([...profileSelect.options].map((option) => option.textContent)).toContain("Final PR only");

      act(() => {
        resolveSelectedLaunchRecord(emptyNodeLaunchRecordResponse());
      });
      await settle(100);
    },
    15_000,
  );

  it(
    "keeps a newly saved PAW prompt profile visible when the initial profile load resolves later",
    async () => {
      const graph = buildLaunchGraph();
      let resolveProfileList!: (response: Response) => void;
      const profileListPromise = new Promise<Response>((resolve) => {
        resolveProfileList = resolve;
      });
      const savedProfile = {
        id: "final-pr-only",
        name: "Final PR only",
        instructions: "Use saved profile immediately.",
        updatedAt: "2026-05-03T18:01:00.000Z",
      };
      const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return Promise.resolve(jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          }));
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return Promise.resolve(jsonResponse(graph));
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return Promise.resolve(emptyNodeLaunchRecordResponse());
        }
        if (path === "/api/paw-launch-prompt-profiles" && (!init?.method || init.method === "GET")) {
          expect(init?.cache).toBe("no-store");
          return profileListPromise;
        }
        if (path === "/api/paw-launch-prompt-profiles" && init?.method === "POST") {
          return Promise.resolve(jsonResponse({ profile: savedProfile }, 201));
        }
        return Promise.reject(new Error(`Unexpected fetch: ${path}`));
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      setInputValue(findInputByLabel(container, "Save name"), "Final PR only");
      setTextareaValue(
        findTextareaByLabel(container, "Launch instructions"),
        savedProfile.instructions,
      );
      act(() => {
        findButton(container, "Save as new profile").click();
      });
      await settle(100);

      let profileSelect = findSelectByLabel(container, "Load profile");
      expect(profileSelect.value).toBe("final-pr-only");
      expect([...profileSelect.options].map((option) => option.textContent)).toContain("Final PR only");
      expect(container.textContent).toContain('Saved "Final PR only".');

      act(() => {
        resolveProfileList(jsonResponse({ profiles: [] }));
      });
      await settle(100);

      profileSelect = findSelectByLabel(container, "Load profile");
      expect(profileSelect.value).toBe("final-pr-only");
      expect([...profileSelect.options].map((option) => option.textContent)).toContain("Final PR only");
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL) === "/api/launch-preparations/runs",
        ),
      ).toBe(false);
    },
    15_000,
  );

  it(
    "preselects the configured workstream launch prompt profile and falls back when it is missing",
    async () => {
      const graph = buildLaunchGraph("ready", {
        graph: {
          launchDefaults: {
            promptProfileId: "final-pr-only",
          },
        },
      });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (path === "/api/paw-launch-prompt-profiles" && (!init?.method || init.method === "GET")) {
          return jsonResponse({
            profiles: [{
              id: "final-pr-only",
              name: "Final PR only",
              instructions: "Use configured default profile text.",
              updatedAt: "2026-05-03T18:00:00.000Z",
            }],
          });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle(100);

      expect(findSelectByLabel(container, "Load profile").value).toBe("final-pr-only");
      expect(findTextareaByLabel(container, "Launch instructions").value).toBe(
        "Use configured default profile text.",
      );

      const fallbackGraph = buildLaunchGraph("ready", {
        graph: {
          launchDefaults: {
            promptProfileId: "missing-profile",
          },
        },
      });
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(fallbackGraph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (path === "/api/paw-launch-prompt-profiles" && (!init?.method || init.method === "GET")) {
          return jsonResponse({ profiles: [] });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });

      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      root = createRoot(container);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");
      act(() => {
        root.render(<App />);
      });
      await settle(100);
      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle(100);

      expect(findSelectByLabel(container, "Load profile").value).toBe("");
      expect(findTextareaByLabel(container, "Launch instructions").value).toContain(
        "Use PAW with a local final-pr-only review policy.",
      );
    },
    15_000,
  );

  it(
    "creates a new PAW prompt profile when the selected profile is saved under a new name",
    async () => {
      const graph = buildLaunchGraph();
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (path === "/api/paw-launch-prompt-profiles" && (!init?.method || init.method === "GET")) {
          expect(init?.cache).toBe("no-store");
          return jsonResponse({
            profiles: [{
              id: "final-pr-only",
              name: "Final PR only",
              instructions: "Use saved final PR only workflow text.",
              updatedAt: "2026-05-03T18:00:00.000Z",
            }],
          });
        }
        if (path === "/api/paw-launch-prompt-profiles" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { name: string; instructions: string };
          return jsonResponse({
            profile: {
              id: "final-pr-copy",
              name: body.name,
              instructions: body.instructions,
              updatedAt: "2026-05-03T18:01:00.000Z",
            },
          }, 201);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      setSelectValue(findSelectByLabel(container, "Load profile"), "final-pr-only");
      await settle();
      setInputValue(findInputByLabel(container, "Save name"), "Final PR copy");
      setTextareaValue(
        findTextareaByLabel(container, "Launch instructions"),
        "Use copied final PR workflow text.",
      );
      expect(container.textContent).toContain(
        'Saving creates a new profile and leaves "Final PR only" unchanged.',
      );
      act(() => {
        findButton(container, "Save as new profile").click();
      });
      await settle(100);

      const saveCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/paw-launch-prompt-profiles" &&
          init?.method === "POST",
      );
      expect(saveCall).toBeDefined();
      expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
        name: "Final PR copy",
        instructions: "Use copied final PR workflow text.",
      });
      expect(findSelectByLabel(container, "Load profile").value).toBe("final-pr-copy");
      expect(container.textContent).toContain('Saved "Final PR copy".');
    },
    15_000,
  );

  it(
    "runs PAW init with launch instructions and explicit empty CLI args",
    async () => {
      const graph = buildLaunchGraph();
      let savedWorkflowContext = "# WorkflowContext\nAdditional Inputs: streamliner-context=streamliner/context.md\n";
      let nodeLaunchRecord: Record<string, unknown> | null = null;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return path.includes("nodeId=")
            ? jsonResponse({ record: nodeLaunchRecord })
            : jsonResponse({ records: nodeLaunchRecord ? [nodeLaunchRecord] : [] });
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({
            profiles: [{
              id: "final-pr-only",
              name: "Final PR only",
              instructions: "Use saved final PR only workflow text.",
              updatedAt: "2026-05-03T18:00:00.000Z",
            }],
          });
        }
        if (path === "/api/paw-launch-prompt-profiles/final-pr-only" && init?.method === "PUT") {
          return jsonResponse({
            profile: {
              id: "final-pr-only",
              name: "Final PR only",
              instructions: JSON.parse(String(init.body)).instructions,
              updatedAt: "2026-05-03T18:01:00.000Z",
            },
          });
        }
        if (path === "/api/launch-preparations/runs" && init?.method === "POST") {
          return jsonResponse({ runId: "run-1", status: "queued" }, 202);
        }
        if (path.startsWith("/api/paw-workflow-context?") && (!init || init.method === "GET")) {
          return jsonResponse({
            path: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
            content: savedWorkflowContext,
            updatedAt: "2026-05-03T18:02:00.000Z",
          });
        }
        if (path === "/api/paw-workflow-context" && init?.method === "PUT") {
          savedWorkflowContext = JSON.parse(String(init.body)).content;
          return jsonResponse({
            path: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
            content: savedWorkflowContext,
            updatedAt: "2026-05-03T18:03:00.000Z",
          });
        }
        if (path === "/api/node-launches" && init?.method === "POST") {
          return jsonResponse({
            launchClaim: {
              launchClaimId: "claim-1",
              status: "pending",
              launchedAt: "2026-05-03T18:04:00.000Z",
              updatedAt: "2026-05-03T18:04:00.000Z",
              bindingWindowExpiresAt: "2026-05-03T18:09:00.000Z",
              reservedRegistryId: "reserved-1",
              boundRegistryId: null,
              boundCopilotSessionId: null,
              failureCode: null,
              failureReason: null,
              blocksLaunch: true,
              retryable: false,
            },
            terminal: {
              method: "powershell",
              pid: 777,
            },
            cwd: "C:\\graphs\\api-test",
            branch: "feature/launch-prompt-profiles",
            command: {
              cliArgs: [],
              promptNonceLine: "Streamliner launch nonce: nonce",
            },
          }, 201);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      setSelectValue(findSelectByLabel(container, "Load profile"), "final-pr-only");
      await settle();
      expect(findTextareaByLabel(container, "Launch instructions").value).toBe(
        "Use saved final PR only workflow text.",
      );
      setInputValue(findInputByLabel(container, "Copilot CLI args"), "");
      setInputValue(findInputByLabel(container, "Terminal tab title"), "Launch profile worker");
      act(() => {
        findButtonByLabel(container, "Use terminal color #ff8c0a").click();
      });
      await settle();
      setTextareaValue(
        findTextareaByLabel(container, "Launch instructions"),
        "Prefer the final PR review path.",
      );
      act(() => {
        findButton(container, "Update profile").click();
      });
      await settle(100);
      act(() => {
        findButton(container, "Run PAW init").click();
      });
      await settle(100);

      expect(container.textContent).toContain("Running PAW init...");
      expect(container.textContent).not.toContain("PAW init is already running for this node");
      const launchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/launch-preparations/runs" &&
          init?.method === "POST",
      );
      expect(launchCall).toBeDefined();
      expect(JSON.parse(String(launchCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          nodeId: "launch-prompt-profiles",
          graphPath: "C:\\graphs\\api-test\\graph.json",
          configuration: expect.objectContaining({
            runtimeKind: "terminal-cli",
            workflowInstructions: "Prefer the final PR review path.",
            cliArgs: [],
            terminal: expect.objectContaining({
              launchMode: "manual",
              title: "Launch profile worker",
              tabColor: "#ff8c0a",
            }),
          }),
        }),
      );
      expect(JSON.parse(String(launchCall?.[1]?.body)).configuration).not.toHaveProperty("cwd");
      expect(MockEventSource.instances.at(-1)?.url).toBe("/api/launch-preparations/runs/run-1/events");
      act(() => {
        MockEventSource.instances.at(-1)?.emit("progress", {
          type: "agent.message",
          message: "Creating WorkflowContext.md",
          timestamp: "2026-05-03T18:02:00.000Z",
          data: {
            workspacePath: "C:\\streamliner-state\\copilot-sdk\\run-1\\session-state\\sdk",
          },
        });
      });
      await settle();
      expect(container.textContent).toContain("Creating WorkflowContext.md");
      act(() => {
        nodeLaunchRecord = {
          id: "launch-prompt-profiles-record",
          graphPath: "C:\\graphs\\api-test\\graph.json",
          nodeId: "launch-prompt-profiles",
          projectKey: "streamliner",
          workstreamId: "api-test",
          branch: "feature/launch-prompt-profiles",
          workId: "launch-prompt-profiles",
          workTitle: "Launch prompt profiles",
          cwd: "C:\\graphs\\api-test",
          pawWorkDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
          workflowContextPath: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
          streamlinerContextPath: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
          contextPackagePath: "C:\\streamliner-state\\launch-contexts\\ctx",
          contextFilePath: "C:\\streamliner-state\\launch-contexts\\ctx\\context.md",
          launchNonce: "nonce",
          launchClaimRef: null,
          trackerUrl: "https://github.com/lossyrob/streamliner/issues/33",
          createdAt: "2026-05-03T18:02:10.000Z",
          updatedAt: "2026-05-03T18:02:10.000Z",
          pathStatus: {
            cwdExists: true,
            pawWorkDirExists: true,
            workflowContextExists: true,
            streamlinerContextExists: true,
            contextPackageExists: true,
            contextFileExists: true,
          },
        };
        MockEventSource.instances.at(-1)?.emit("completed", {
          status: "succeeded",
          result: {
            cwd: "C:\\graphs\\api-test",
            branch: "feature/launch-prompt-profiles",
            pawWorkDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
            workflowContextPath:
              "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
            streamlinerContextPath:
              "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
            cliArgs: [],
            terminal: {
              launchMode: "manual",
              preferredTerminal: "powershell",
            },
            environment: {
              STREAMLINER_LOG_LEVEL: "debug",
            },
            sessionStateRoot: "C:\\streamliner-state",
            kickoffPrompt: "Start PAW launch prompt profiles.",
            launchMetadata: {
              launchNonce: "nonce",
              launchClaimRef: null,
              projectKey: "streamliner",
              workstreamId: "api-test",
              nodeId: "launch-prompt-profiles",
              targetRepoIds: ["streamliner"],
              graphPath: "C:\\graphs\\api-test\\graph.json",
              branch: "feature/launch-prompt-profiles",
              workId: "launch-prompt-profiles",
              workTitle: "Launch prompt profiles",
              trackerUrl: "https://github.com/lossyrob/streamliner/issues/33",
              launchPolicy: null,
            },
            contextPackage: {
              contextId: "ctx",
              contextPackagePath: "C:\\streamliner-state\\launch-contexts\\ctx",
              contextFilePath: "C:\\streamliner-state\\launch-contexts\\ctx\\context.md",
              metadata: {},
              unavailableInputs: [],
            },
          },
          timestamp: "2026-05-03T18:02:10.000Z",
        });
      });
      await settle(100);
      expect(container.textContent).toContain("Prepared handoff");
      expect(container.textContent).toContain("C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles");
      expect(container.textContent).toContain("CLI args");
      expect(container.textContent).toContain("none");
      expect(container.textContent).toContain("Review WorkflowContext.md");
      expect(container.textContent).toContain("Review kickoff prompt");
      expect(container.textContent).toContain("LATEST PAW LAUNCH");
      expect(container.textContent).toContain("feature/launch-prompt-profiles");
      expect(container.textContent).toContain("WorkflowContext.md");
      expect(findTextareaByLabel(container, "Kickoff prompt").value).toBe(
        "Start PAW launch prompt profiles.",
      );
      setTextareaValue(
        findTextareaByLabel(container, "Kickoff prompt"),
        "Edited PAW launch kickoff prompt.",
      );
      setTextareaValue(
        findTextareaByLabel(container, "WorkflowContext content"),
        `${savedWorkflowContext}\n## Manual edits\nReview before terminal launch.\n`,
      );
      act(() => {
        findButton(container, "Save WorkflowContext").click();
      });
      await settle(100);
      expect(savedWorkflowContext).toContain("Review before terminal launch.");
      act(() => {
        findButton(container, "Launch terminal").click();
      });
      await settle(100);
      const terminalLaunchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/node-launches" &&
          init?.method === "POST",
      );
      expect(terminalLaunchCall).toBeDefined();
      expect(JSON.parse(String(terminalLaunchCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          handoff: expect.objectContaining({
            cwd: "C:\\graphs\\api-test",
            kickoffPrompt: "Edited PAW launch kickoff prompt.",
            environment: { STREAMLINER_LOG_LEVEL: "debug" },
            terminal: expect.objectContaining({
              title: "Launch profile worker",
              tabColor: "#ff8c0a",
            }),
          }),
        }),
      );
      expect(container.textContent).toContain("Started with powershell");
      expect(container.textContent).toContain("Pending - terminal launching");
      expect(container.textContent).not.toContain("claim-1");
    },
    15_000,
  );

  it(
    "launches a background session through the prepared managed SDK handoff",
    async () => {
      const graph = buildLaunchGraph();
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        if (path === "/api/launch-preparations/runs" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            configuration: { workflowInstructions: string; runtimeKind?: string };
          };
          expect(body.configuration.runtimeKind).toBe("managed-sdk");
          expect(body.configuration.workflowInstructions).toContain("Use PAW");
          return jsonResponse({ runId: "run-managed", status: "running" }, 202);
        }
        if (path === "/api/node-launches" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            handoff: { runtimeKind?: string; launchMetadata: { nodeId: string } };
          };
          expect(body.handoff.runtimeKind).toBe("managed-sdk");
          expect(body.handoff.launchMetadata.nodeId).toBe("launch-prompt-profiles");
          return jsonResponse({
            runtimeKind: "managed-sdk",
            launchClaim: {
              launchClaimId: "claim-managed",
              status: "pending",
              launchedAt: "2026-05-05T12:00:00.000Z",
              updatedAt: "2026-05-05T12:00:00.000Z",
              bindingWindowExpiresAt: "2026-05-05T12:10:00.000Z",
              reservedRegistryId: "registry-managed",
              boundRegistryId: null,
              boundCopilotSessionId: null,
              failureCode: null,
              failureReason: null,
              blocksLaunch: true,
              retryable: false,
            },
            managedSdk: {
              registryId: "registry-managed",
              sdkSessionId: "sdk-managed",
              sdkWorkspacePath: "C:\\state\\sdk-managed\\workspace.yaml",
              sdkStateRoot: "C:\\state\\sdk-managed",
              permissionProfile: "managed-autonomous",
            },
          }, 201);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      MockEventSource.instances = [];
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      const managedRadio = container.querySelector<HTMLInputElement>(
        'input[name="paw-runtime-kind"][value="managed-sdk"]',
      );
      expect(managedRadio).toBeInstanceOf(HTMLInputElement);
      act(() => {
        managedRadio?.click();
      });
      await settle();
      act(() => {
        findButton(container, "Start background session").click();
      });
      await settle(100);

      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            requestPath(input as RequestInfo | URL) === "/api/launch-preparations/runs",
        ),
      ).toBe(true);
      expect(
        fetchMock.mock.calls.some(
          ([input]) => requestPath(input as RequestInfo | URL) === "/api/node-launches",
        ),
      ).toBe(false);
      act(() => {
        MockEventSource.instances.at(-1)?.emit("completed", {
          status: "succeeded",
          result: {
            cwd: "C:\\graphs\\api-test",
            branch: "feature/launch-prompt-profiles",
            runtimeKind: "managed-sdk",
            pawWorkDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
            workflowContextPath:
              "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
            streamlinerContextPath:
              "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
            cliArgs: [],
            terminal: {
              launchMode: "manual",
              preferredTerminal: "powershell",
            },
            environment: {},
            sessionStateRoot: "C:\\streamliner-state",
            kickoffPrompt: "Start PAW launch prompt profiles.",
            launchMetadata: {
              launchNonce: "nonce",
              launchClaimRef: null,
              projectKey: "streamliner",
              workstreamId: "api-test",
              nodeId: "launch-prompt-profiles",
              targetRepoIds: ["streamliner"],
              graphPath: "C:\\graphs\\api-test\\graph.json",
              branch: "feature/launch-prompt-profiles",
              workId: "launch-prompt-profiles",
              workTitle: "Launch prompt profiles",
              trackerUrl: "https://github.com/lossyrob/streamliner/issues/33",
              launchPolicy: null,
            },
            contextPackage: {
              contextId: "ctx",
              contextPackagePath: "C:\\streamliner-state\\launch-contexts\\ctx",
              contextFilePath: "C:\\streamliner-state\\launch-contexts\\ctx\\context.md",
              metadata: {},
              unavailableInputs: [],
            },
          },
          timestamp: "2026-05-05T12:00:00.000Z",
        });
      });
      await settle(100);
      expect(
        fetchMock.mock.calls.filter(
          ([input]) => requestPath(input as RequestInfo | URL) === "/api/node-launches",
        ),
      ).toHaveLength(1);
      expect(container.textContent).toContain("Started with managed-autonomous.");
      expect(container.textContent).not.toContain("Review kickoff prompt");
      expect(findButton(container, "Background session started").disabled).toBe(true);
    },
    15_000,
  );

  it(
    "binds a successful managed SDK launch and blocks duplicate submissions",
    async () => {
      const graph = buildLaunchGraph();
      const managedRecord = {
        id: "managed-launch-record",
        graphPath: "C:\\graphs\\api-test\\graph.json",
        nodeId: "launch-prompt-profiles",
        projectKey: "streamliner",
        workstreamId: "api-test",
        branch: "feature/launch-prompt-profiles",
        workId: "launch-prompt-profiles",
        workTitle: "Launch prompt profiles",
        cwd: "C:\\graphs\\api-test",
        pawWorkDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
        workflowContextPath:
          "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
        streamlinerContextPath:
          "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
        contextPackagePath: "C:\\state\\launch-contexts\\ctx",
        contextFilePath: "C:\\state\\launch-contexts\\ctx\\context.md",
        runtimeKind: "managed-sdk",
        launchNonce: "nonce-managed",
        launchClaimRef: "claim-managed",
        trackerUrl: "https://github.com/lossyrob/streamliner/issues/33",
        createdAt: "2026-05-05T12:00:00.000Z",
        updatedAt: "2026-05-05T12:00:00.000Z",
        pathStatus: {
          cwdExists: true,
          pawWorkDirExists: true,
          workflowContextExists: true,
          streamlinerContextExists: true,
          contextPackageExists: true,
          contextFileExists: true,
        },
      };
      let resolveManagedLaunch!: (response: Response) => void;
      const managedLaunchPromise = new Promise<Response>((resolve) => {
        resolveManagedLaunch = resolve;
      });
      const launchClaim = {
        launchClaimId: "claim-managed",
        status: "pending",
        launchedAt: "2026-05-05T12:00:00.000Z",
        updatedAt: "2026-05-05T12:00:01.000Z",
        bindingWindowExpiresAt: "2026-05-05T12:10:00.000Z",
        reservedRegistryId: "registry-managed",
        boundRegistryId: null,
        boundCopilotSessionId: null,
        failureCode: null,
        failureReason: null,
        blocksLaunch: true,
        retryable: false,
      };
      const managedLaunch = {
        launchClaim,
        runtimeKind: "managed-sdk",
        registryId: "registry-managed",
        sdkSessionId: "sdk-session-123",
        sdkWorkspacePath: "C:\\state\\sdk-session-123\\workspace.yaml",
        sdkStateRoot: "C:\\state\\sdk-session-123",
        permissionProfile: "managed-autonomous",
      };
      let currentLaunchState: unknown = { record: null, operation: null };
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return jsonResponse(currentLaunchState);
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        if (path === "/api/launch-preparations/runs" && init?.method === "POST") {
          return jsonResponse({ runId: "run-managed-bind", status: "running" }, 202);
        }
        if (path === "/api/node-launches" && init?.method === "POST") {
          return managedLaunchPromise;
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      MockEventSource.instances = [];
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();
      act(() => {
        container.querySelector<HTMLInputElement>(
          'input[name="paw-runtime-kind"][value="managed-sdk"]',
        )?.click();
      });
      await settle();

      const submitButton = findButton(container, "Start background session");
      act(() => {
        submitButton.click();
        submitButton.click();
      });
      await settle();

      expect(
        fetchMock.mock.calls.filter(
          ([input]) => requestPath(input as RequestInfo | URL) === "/api/launch-preparations/runs",
        ),
      ).toHaveLength(1);
      expect(container.textContent).toContain("Starting background session...");

      act(() => {
        MockEventSource.instances.at(-1)?.emit("completed", {
          status: "succeeded",
          result: {
            cwd: "C:\\graphs\\api-test",
            branch: "feature/launch-prompt-profiles",
            runtimeKind: "managed-sdk",
            pawWorkDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
            workflowContextPath:
              "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
            streamlinerContextPath:
              "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
            cliArgs: [],
            terminal: {
              launchMode: "manual",
              preferredTerminal: "powershell",
            },
            environment: {},
            sessionStateRoot: "C:\\streamliner-state",
            kickoffPrompt: "Start PAW launch prompt profiles.",
            launchMetadata: {
              launchNonce: "nonce-managed",
              launchClaimRef: "claim-managed",
              projectKey: "streamliner",
              workstreamId: "api-test",
              nodeId: "launch-prompt-profiles",
              targetRepoIds: ["streamliner"],
              graphPath: "C:\\graphs\\api-test\\graph.json",
              branch: "feature/launch-prompt-profiles",
              workId: "launch-prompt-profiles",
              workTitle: "Launch prompt profiles",
              trackerUrl: "https://github.com/lossyrob/streamliner/issues/33",
              launchPolicy: null,
            },
            contextPackage: {
              contextId: "ctx",
              contextPackagePath: "C:\\state\\launch-contexts\\ctx",
              contextFilePath: "C:\\state\\launch-contexts\\ctx\\context.md",
              metadata: {},
              unavailableInputs: [],
            },
          },
          timestamp: "2026-05-05T12:00:00.000Z",
        });
      });
      await settle();

      act(() => {
        currentLaunchState = {
          record: managedRecord,
          operation: {
            id: "managed-launch-record",
            graphPath: managedRecord.graphPath,
            nodeId: managedRecord.nodeId,
            status: "managed_running",
            preparationRunId: null,
            startedAt: "2026-05-05T12:00:00.000Z",
            updatedAt: "2026-05-05T12:00:01.000Z",
            completedAt: "2026-05-05T12:00:01.000Z",
            handoff: null,
            terminalLaunch: null,
            managedLaunch,
            error: null,
            progressEvents: [],
            latestClaim: launchClaim,
          },
        };
        resolveManagedLaunch(jsonResponse({
          runtimeKind: "managed-sdk",
          launchClaim,
          managedSdk: {
            registryId: "registry-managed",
            sdkSessionId: "sdk-session-123",
            sdkWorkspacePath: "C:\\state\\sdk-session-123\\workspace.yaml",
            sdkStateRoot: "C:\\state\\sdk-session-123",
            permissionProfile: "managed-autonomous",
          },
        }, 201));
      });
      await settle(100);

      expect(container.textContent).toContain("A background session is already active for this node.");
      const disabledSubmit = findButton(container, "Background session started");
      expect(disabledSubmit.disabled).toBe(true);
      act(() => {
        disabledSubmit.click();
      });
      await settle();
      expect(
        fetchMock.mock.calls.filter(
          ([input]) => requestPath(input as RequestInfo | URL) === "/api/node-launches",
        ),
      ).toHaveLength(1);
    },
    15_000,
  );

  it(
    "starts a prepared managed SDK handoff without routing it through terminal launch UI",
    async () => {
      const graph = buildLaunchGraph();
      const launchClaim = {
        launchClaimId: "claim-managed-prepared",
        status: "pending",
        launchedAt: "2026-05-05T12:00:00.000Z",
        updatedAt: "2026-05-05T12:00:00.000Z",
        bindingWindowExpiresAt: "2026-05-05T12:10:00.000Z",
        reservedRegistryId: "registry-managed-prepared",
        boundRegistryId: null,
        boundCopilotSessionId: null,
        failureCode: null,
        failureReason: null,
        blocksLaunch: true,
        retryable: false,
      };
      const releasedLaunchClaim = {
        ...launchClaim,
        status: "failed",
        updatedAt: "2026-05-05T12:00:02.000Z",
        failureCode: "user-cancelled",
        failureReason: "Released.",
        blocksLaunch: false,
        retryable: true,
      };
      const managedLaunch = {
        launchClaim,
        runtimeKind: "managed-sdk",
        registryId: "registry-managed-prepared",
        sdkSessionId: "sdk-managed-prepared",
        sdkWorkspacePath: "C:\\state\\sdk-managed-prepared\\workspace.yaml",
        sdkStateRoot: "C:\\state\\sdk-managed-prepared",
        permissionProfile: "managed-autonomous",
      };
      const preparedHandoff = {
        cwd: "C:\\graphs\\api-test",
        branch: "feature/launch-prompt-profiles",
        runtimeKind: "managed-sdk",
        pawWorkDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
        workflowContextPath:
          "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
        streamlinerContextPath:
          "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
        cliArgs: [],
        terminal: {
          launchMode: "manual",
          preferredTerminal: "powershell",
        },
        environment: {},
        sessionStateRoot: "C:\\streamliner-state",
        kickoffPrompt: "Start PAW launch prompt profiles.",
        launchMetadata: {
          launchNonce: "nonce-managed-prepared",
          launchClaimRef: "claim-managed-prepared",
          projectKey: "streamliner",
          workstreamId: "api-test",
          nodeId: "launch-prompt-profiles",
          targetRepoIds: ["streamliner"],
          graphPath: "C:\\graphs\\api-test\\graph.json",
          branch: "feature/launch-prompt-profiles",
          workId: "launch-prompt-profiles",
          workTitle: "Launch prompt profiles",
          trackerUrl: "https://github.com/lossyrob/streamliner/issues/33",
          launchPolicy: null,
        },
        contextPackage: {
          contextId: "ctx",
          contextPackagePath: "C:\\streamliner-state\\launch-contexts\\ctx",
          contextFilePath: "C:\\streamliner-state\\launch-contexts\\ctx\\context.md",
          metadata: {},
          unavailableInputs: [],
        },
      };
      let currentLaunchState: unknown = {
        record: null,
        operation: {
          id: "managed-prepared-operation",
          graphPath: "C:\\graphs\\api-test\\graph.json",
          nodeId: "launch-prompt-profiles",
          status: "prepared",
          preparationRunId: null,
          startedAt: "2026-05-05T12:00:00.000Z",
          updatedAt: "2026-05-05T12:00:00.000Z",
          completedAt: "2026-05-05T12:00:00.000Z",
          handoff: preparedHandoff,
          terminalLaunch: null,
          managedLaunch: null,
          error: null,
          progressEvents: [],
          latestClaim: null,
        },
      };
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          if (path.includes("nodeId=")) {
            return jsonResponse(currentLaunchState);
          }
          return jsonResponse({ records: [] });
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        if (
          path === "/api/node-launch-records/launch-claims/claim-managed-prepared/release" &&
          init?.method === "POST"
        ) {
          currentLaunchState = {
            record: null,
            operation: {
              id: "managed-prepared-operation",
              graphPath: "C:\\graphs\\api-test\\graph.json",
              nodeId: "launch-prompt-profiles",
              status: "managed_running",
              preparationRunId: null,
              startedAt: "2026-05-05T12:00:00.000Z",
              updatedAt: "2026-05-05T12:00:02.000Z",
              completedAt: "2026-05-05T12:00:01.000Z",
              handoff: preparedHandoff,
              terminalLaunch: null,
              managedLaunch,
              error: null,
              progressEvents: [],
              latestClaim: releasedLaunchClaim,
            },
          };
          return jsonResponse({
            launchClaim: releasedLaunchClaim,
            detachedRegistryIds: ["registry-managed-prepared"],
          });
        }
        if (path === "/api/node-launches" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            handoff: { runtimeKind?: string; launchMetadata: { nodeId: string } };
          };
          expect(body.handoff.runtimeKind).toBe("managed-sdk");
          expect(body.handoff.launchMetadata.nodeId).toBe("launch-prompt-profiles");
          currentLaunchState = {
            record: null,
            operation: {
              id: "managed-prepared-operation",
              graphPath: "C:\\graphs\\api-test\\graph.json",
              nodeId: "launch-prompt-profiles",
              status: "managed_running",
              preparationRunId: null,
              startedAt: "2026-05-05T12:00:00.000Z",
              updatedAt: "2026-05-05T12:00:01.000Z",
              completedAt: "2026-05-05T12:00:01.000Z",
              handoff: preparedHandoff,
              terminalLaunch: null,
              managedLaunch,
              error: null,
              progressEvents: [],
              latestClaim: launchClaim,
            },
          };
          return jsonResponse({
            runtimeKind: "managed-sdk",
            launchClaim,
            managedSdk: {
              registryId: managedLaunch.registryId,
              sdkSessionId: managedLaunch.sdkSessionId,
              sdkWorkspacePath: managedLaunch.sdkWorkspacePath,
              sdkStateRoot: managedLaunch.sdkStateRoot,
              permissionProfile: managedLaunch.permissionProfile,
            },
          }, 201);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle(100);
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      expect(container.textContent).toContain("Prepared background session");
      expect(container.textContent).not.toContain("Review kickoff prompt");
      expect(() => findButton(container, "Launch terminal")).toThrow(
        'Could not find button "Launch terminal".',
      );

      act(() => {
        findButton(container, "Start background session").click();
      });
      await settle(100);

      expect(
        fetchMock.mock.calls.filter(
          ([input]) => requestPath(input as RequestInfo | URL).startsWith("/api/launch-preparations/runs"),
        ),
      ).toHaveLength(0);
      expect(
        fetchMock.mock.calls.filter(
          ([input]) => requestPath(input as RequestInfo | URL) === "/api/node-launches",
        ),
      ).toHaveLength(1);
      expect(container.textContent).toContain("Started with managed-autonomous.");
      expect(findButton(container, "Background session started").disabled).toBe(true);

      await act(async () => {
        findButton(container, "Release stuck launch").click();
      });
      await settle(100);

      expect(container.textContent).toContain("Released the launch claim and detached the linked session.");
      expect(container.textContent).toContain("Failed - retry available");
      expect(container.textContent).toContain("Ready to start this prepared handoff again.");
      expect(findButton(container, "Start background session").disabled).toBe(false);
    },
    15_000,
  );

  it(
    "offers to resume an interrupted background session bound to a node",
    async () => {
      const graph = buildLaunchGraph();
      const launchClaim = {
        launchClaimId: "claim-interrupted-managed",
        status: "bound",
        launchedAt: "2026-05-05T12:00:00.000Z",
        updatedAt: "2026-05-05T12:00:00.000Z",
        bindingWindowExpiresAt: "2026-05-05T12:10:00.000Z",
        reservedRegistryId: "registry-interrupted-managed",
        boundRegistryId: "registry-interrupted-managed",
        boundCopilotSessionId: "sdk-interrupted-managed",
        failureCode: null,
        failureReason: null,
        blocksLaunch: true,
        retryable: false,
      };
      const preparedHandoff = {
        cwd: "C:\\graphs\\api-test",
        branch: "feature/launch-prompt-profiles",
        runtimeKind: "managed-sdk",
        pawWorkDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
        workflowContextPath:
          "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
        streamlinerContextPath:
          "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
        cliArgs: [],
        terminal: {
          launchMode: "manual",
          preferredTerminal: "powershell",
        },
        environment: {},
        sessionStateRoot: "C:\\streamliner-state",
        kickoffPrompt: "Start PAW launch prompt profiles.",
        launchMetadata: {
          launchNonce: "nonce-interrupted-managed",
          launchClaimRef: "claim-interrupted-managed",
          projectKey: "streamliner",
          workstreamId: "api-test",
          nodeId: "launch-prompt-profiles",
          targetRepoIds: ["streamliner"],
          graphPath: "C:\\graphs\\api-test\\graph.json",
          branch: "feature/launch-prompt-profiles",
          workId: "launch-prompt-profiles",
          workTitle: "Launch prompt profiles",
          trackerUrl: "https://github.com/lossyrob/streamliner/issues/33",
          launchPolicy: null,
        },
        contextPackage: {
          contextId: "ctx",
          contextPackagePath: "C:\\streamliner-state\\launch-contexts\\ctx",
          contextFilePath: "C:\\streamliner-state\\launch-contexts\\ctx\\context.md",
          metadata: {},
          unavailableInputs: [],
        },
      };
      const managedLaunch = {
        launchClaim,
        runtimeKind: "managed-sdk",
        registryId: "registry-interrupted-managed",
        sdkSessionId: "sdk-interrupted-managed",
        sdkWorkspacePath: "C:\\state\\sdk-interrupted-managed\\workspace.yaml",
        sdkStateRoot: "C:\\state\\sdk-interrupted-managed",
        permissionProfile: "managed-autonomous",
      };
      let currentLaunchState: unknown = {
        record: null,
        operation: {
          id: "interrupted-managed-operation",
          graphPath: "C:\\graphs\\api-test\\graph.json",
          nodeId: "launch-prompt-profiles",
          status: "managed_running",
          preparationRunId: null,
          startedAt: "2026-05-05T12:00:00.000Z",
          updatedAt: "2026-05-05T12:00:00.000Z",
          completedAt: "2026-05-05T12:00:01.000Z",
          handoff: preparedHandoff,
          terminalLaunch: null,
          managedLaunch,
          error: null,
          progressEvents: [],
          latestClaim: launchClaim,
        },
      };
      const interruptedSession = buildSession({
        id: "registry-interrupted-managed",
        title: "Interrupted background worker",
        originKind: "launched",
        graphBinding: {
          workstreamId: "api-test",
          nodeId: "launch-prompt-profiles",
          launchClaimId: "claim-interrupted-managed",
        },
        runtime: {
          runtimeKind: "managed-sdk",
          runtimeOwner: "streamliner-sdk",
          lifecycleState: "interrupted",
          permissionProfile: "managed-autonomous",
          launchClaimId: "claim-interrupted-managed",
          launchNonce: "nonce-interrupted-managed",
          sdkSessionId: "sdk-interrupted-managed",
          sdkWorkspacePath: "C:\\state\\sdk-interrupted-managed\\workspace.yaml",
          sdkStateRoot: "C:\\state\\sdk-interrupted-managed",
          startedAt: "2026-05-05T12:00:00.000Z",
          lastStateChangedAt: "2026-05-05T12:03:00.000Z",
          progressEvents: [],
          evidence: [],
        },
        copilotSessionId: "sdk-interrupted-managed",
        activityStatus: "interrupted",
        copilotProcessState: "none",
        trustedSignalSource: "copilot-cli-hook",
        trustedStartedAt: "2026-05-05T12:00:00.000Z",
        trustedEndedAt: null,
      });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path === "/api/sessions?workstreamId=api-test") {
          return jsonResponse([interruptedSession]);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return jsonResponse(currentLaunchState);
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        if (path === "/api/paw-workflow-context?path=C%3A%5Cgraphs%5Capi-test%5C.paw%5Cwork%5Claunch-prompt-profiles%5CWorkflowContext.md") {
          return jsonResponse({
            path: preparedHandoff.workflowContextPath,
            content: "# WorkflowContext\n",
            updatedAt: "2026-05-05T12:00:00.000Z",
          });
        }
        if (path === "/api/node-launches/managed-resumes" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            launchClaimId: string;
            handoff: { runtimeKind?: string; launchMetadata: { nodeId: string } };
          };
          expect(body.launchClaimId).toBe("claim-interrupted-managed");
          expect(body.handoff.runtimeKind).toBe("managed-sdk");
          expect(body.handoff.launchMetadata.nodeId).toBe("launch-prompt-profiles");
          currentLaunchState = {
            record: null,
            operation: {
              ...(currentLaunchState as { operation: Record<string, unknown> }).operation,
              status: "managed_running",
              managedLaunch,
              latestClaim: launchClaim,
              error: null,
            },
          };
          return jsonResponse({
            runtimeKind: "managed-sdk",
            launchClaim,
            managedSdk: {
              registryId: managedLaunch.registryId,
              sdkSessionId: managedLaunch.sdkSessionId,
              sdkWorkspacePath: managedLaunch.sdkWorkspacePath,
              sdkStateRoot: managedLaunch.sdkStateRoot,
              permissionProfile: managedLaunch.permissionProfile,
            },
          }, 201);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle(100);
      act(() => {
        findButton(container, "Open PAW launch").click();
      });
      await settle(100);

      const resumeButton = findButton(container, "Resume background session");
      expect(resumeButton.disabled).toBe(false);
      act(() => {
        resumeButton.click();
      });
      await settle(100);

      expect(container.textContent).toContain("Resume requested for the background session.");
      expect(
        fetchMock.mock.calls.filter(
          ([input]) => requestPath(input as RequestInfo | URL) === "/api/node-launches/managed-resumes",
        ),
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(
          ([input]) => requestPath(input as RequestInfo | URL) === "/api/node-launches",
        ),
      ).toHaveLength(0);
    },
    15_000,
  );

  it(
    "launches the terminal automatically when launch after init is checked",
    async () => {
      const graph = buildLaunchGraph();
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        if (path === "/api/launch-preparations/runs" && init?.method === "POST") {
          return jsonResponse({ runId: "run-auto", status: "queued" }, 202);
        }
        if (path.startsWith("/api/paw-workflow-context?") && (!init || init.method === "GET")) {
          return jsonResponse({
            path: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
            content: "# WorkflowContext\n",
            updatedAt: "2026-05-03T18:02:00.000Z",
          });
        }
        if (path === "/api/node-launches" && init?.method === "POST") {
          return jsonResponse({
            launchClaim: {
              launchClaimId: "claim-auto",
              status: "pending",
              launchedAt: "2026-05-03T18:04:00.000Z",
              updatedAt: "2026-05-03T18:04:00.000Z",
              bindingWindowExpiresAt: "2026-05-03T18:09:00.000Z",
              reservedRegistryId: "reserved-auto",
              boundRegistryId: null,
              boundCopilotSessionId: null,
              failureCode: null,
              failureReason: null,
              blocksLaunch: true,
              retryable: false,
            },
            terminal: {
              method: "powershell",
              pid: 778,
            },
            cwd: "C:\\graphs\\api-test",
            branch: "feature/launch-prompt-profiles",
            command: {
              cliArgs: ["--yolo"],
              promptNonceLine: "Streamliner launch nonce: nonce",
            },
          }, 201);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      setInputValue(findInputByLabel(container, "Terminal tab title"), "Auto launch worker");
      act(() => {
        findButtonByLabel(container, "Use terminal color #4891c8").click();
      });
      await settle();
      act(() => {
        findInputByLabel(container, "Launch after init").click();
      });
      await settle();
      const launchAfterInitInput = findInputByLabel(container, "Launch after init");
      expect(launchAfterInitInput.checked).toBe(true);
      act(() => {
        container.querySelector<HTMLInputElement>(
          'input[name="paw-runtime-kind"][value="managed-sdk"]',
        )?.click();
      });
      await settle();
      expect(findInputByLabel(container, "Launch after init").checked).toBe(false);
      act(() => {
        container.querySelector<HTMLInputElement>(
          'input[name="paw-runtime-kind"][value="terminal-cli"]',
        )?.click();
      });
      await settle();
      expect(findInputByLabel(container, "Launch after init").checked).toBe(true);
      expect(findButton(container, "Run PAW init and launch")).toBeDefined();
      act(() => {
        findButton(container, "Run PAW init and launch").click();
      });
      await settle(100);

      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            requestPath(input as RequestInfo | URL) === "/api/node-launches" &&
            init?.method === "POST",
        ),
      ).toBe(false);
      act(() => {
        MockEventSource.instances.at(-1)?.emit("completed", {
          status: "succeeded",
          result: {
            cwd: "C:\\graphs\\api-test",
            branch: "feature/launch-prompt-profiles",
            pawWorkDir: "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles",
            workflowContextPath:
              "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
            streamlinerContextPath:
              "C:\\graphs\\api-test\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
            cliArgs: ["--yolo"],
            terminal: {
              launchMode: "manual",
              preferredTerminal: "powershell",
              title: "Auto launch worker",
              tabColor: "#4891c8",
            },
            environment: {
              STREAMLINER_LOG_LEVEL: "debug",
            },
            sessionStateRoot: "C:\\streamliner-state",
            kickoffPrompt: "Start automatic PAW worker.",
            launchMetadata: {
              launchNonce: "nonce",
              launchClaimRef: null,
              projectKey: "streamliner",
              workstreamId: "api-test",
              nodeId: "launch-prompt-profiles",
              targetRepoIds: ["streamliner"],
              graphPath: "C:\\graphs\\api-test\\graph.json",
              branch: "feature/launch-prompt-profiles",
              workId: "launch-prompt-profiles",
              workTitle: "Launch prompt profiles",
              trackerUrl: "https://github.com/lossyrob/streamliner/issues/33",
              launchPolicy: null,
            },
            contextPackage: {
              contextId: "ctx",
              contextPackagePath: "C:\\streamliner-state\\launch-contexts\\ctx",
              contextFilePath: "C:\\streamliner-state\\launch-contexts\\ctx\\context.md",
              metadata: {},
              unavailableInputs: [],
            },
          },
          timestamp: "2026-05-03T18:02:10.000Z",
        });
      });
      await settle(150);

      const terminalLaunchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/node-launches" &&
          init?.method === "POST",
      );
      expect(terminalLaunchCall).toBeDefined();
      expect(JSON.parse(String(terminalLaunchCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          handoff: expect.objectContaining({
            kickoffPrompt: "Start automatic PAW worker.",
            terminal: expect.objectContaining({
              title: "Auto launch worker",
              tabColor: "#4891c8",
            }),
          }),
        }),
      );
      expect(container.textContent).toContain("Started with powershell");
    },
    15_000,
  );

  it(
    "keeps preparation progress keyed per node when the dialog closes and another node starts",
    async () => {
      const graph = buildConcurrentLaunchGraph();
      const graphPath = "C:\\graphs\\api-test\\graph.json";
      const operationByNode = new Map<string, Record<string, unknown>>();
      const preparingOperation = (nodeId: string, runId: string, message?: string) => ({
        id: `${nodeId}-operation`,
        graphPath,
        nodeId,
        status: "preparing",
        preparationRunId: runId,
        startedAt: "2026-05-03T18:00:00.000Z",
        updatedAt: "2026-05-03T18:00:00.000Z",
        completedAt: null,
        handoff: null,
        terminalLaunch: null,
        error: null,
        progressEvents: message
          ? [{
            type: "agent.message",
            message,
            timestamp: "2026-05-03T18:00:01.000Z",
          }]
          : [],
      });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          const params = new URL(path, "http://localhost").searchParams;
          return jsonResponse({
            record: null,
            operation: operationByNode.get(params.get("nodeId") ?? "") ?? null,
          });
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        if (path === "/api/launch-preparations/runs" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { nodeId: string };
          const runId = body.nodeId === "runtime-overlay-ui" ? "run-b" : "run-a";
          const operation = preparingOperation(body.nodeId, runId);
          operationByNode.set(body.nodeId, operation);
          return jsonResponse({ runId, status: "queued", operation }, 202);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();
      act(() => {
        findButton(container, "Run PAW init").click();
      });
      await settle(100);
      const sourceA = MockEventSource.instances.find((source) => source.url.includes("run-a"));
      act(() => {
        sourceA?.emit("progress", {
          type: "agent.message",
          message: "Preparing node A.",
          timestamp: "2026-05-03T18:00:01.000Z",
        });
      });
      await settle();
      expect(container.textContent).toContain("Preparing node A.");

      act(() => {
        findButton(container, "Close").click();
      });
      await settle();
      expect(container.querySelector('textarea[aria-label="Launch instructions"]')).toBeNull();

      act(() => {
        findCanvasNode(container, "Runtime overlay UI").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();
      act(() => {
        findButton(container, "Run PAW init").click();
      });
      await settle(100);
      const sourceB = MockEventSource.instances.find((source) => source.url.includes("run-b"));
      act(() => {
        sourceA?.emit("progress", {
          type: "agent.message",
          message: "Node A continues in background.",
          timestamp: "2026-05-03T18:00:02.000Z",
        });
        sourceB?.emit("progress", {
          type: "agent.message",
          message: "Preparing node B.",
          timestamp: "2026-05-03T18:00:03.000Z",
        });
      });
      operationByNode.set(
        "launch-prompt-profiles",
        preparingOperation("launch-prompt-profiles", "run-a", "Node A continues in background."),
      );
      await settle();

      expect(container.textContent).not.toContain("Node A continues in background.");
      expect(
        fetchMock.mock.calls.filter(([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/launch-preparations/runs" &&
          init?.method === "POST"
        ).map(([, init]) => JSON.parse(String(init?.body)).nodeId),
      ).toEqual(["launch-prompt-profiles", "runtime-overlay-ui"]);

      act(() => {
        findButton(container, "Close").click();
      });
      await settle();
      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Open PAW launch").click();
      });
      await settle();

      expect(container.textContent).toContain("Node A continues in background.");
      expect(container.textContent).not.toContain("Preparing node B.");
    },
    15_000,
  );

  it(
    "reattaches an open preparing launch dialog to its run event stream",
    async () => {
      const graph = buildLaunchGraph();
      const graphPath = "C:\\graphs\\api-test\\graph.json";
      const preparingOperation = {
        id: "launch-prompt-profiles-operation",
        graphPath,
        nodeId: "launch-prompt-profiles",
        status: "preparing",
        preparationRunId: "run-reattach",
        startedAt: "2026-05-03T18:00:00.000Z",
        updatedAt: "2026-05-03T18:00:00.000Z",
        completedAt: null,
        handoff: null,
        terminalLaunch: null,
        error: null,
        progressEvents: [{
          type: "agent.message",
          message: "Snapshot progress before reopen.",
          timestamp: "2026-05-03T18:00:01.000Z",
        }],
      };
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return jsonResponse({ record: null, operation: preparingOperation });
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Open PAW launch").click();
      });
      await settle();

      expect(container.textContent).toContain("Snapshot progress before reopen.");
      const source = MockEventSource.instances.find((candidate) => candidate.url.includes("run-reattach"));
      expect(source?.url).toBe("/api/launch-preparations/runs/run-reattach/events");

      act(() => {
        source?.emit("progress", {
          type: "agent.message",
          message: "Initial SDK status replayed from start.",
          timestamp: "2026-05-03T18:00:00.500Z",
        });
        source?.emit("progress", {
          type: "agent.message",
          message: "Snapshot progress before reopen.",
          timestamp: "2026-05-03T18:00:01.000Z",
        });
        source?.emit("progress", {
          type: "agent.message",
          message: "Live progress after reattach.",
          timestamp: "2026-05-03T18:00:02.000Z",
        });
      });
      await settle();

      expect(container.textContent).toContain("Initial SDK status replayed from start.");
      expect((container.textContent?.match(/Snapshot progress before reopen\./g) ?? [])).toHaveLength(1);
      expect(container.textContent).toContain("Live progress after reattach.");
    },
    15_000,
  );

  it(
    "keeps launch defaults tied to the open dialog target when selection changes",
    async () => {
      const graph = buildWorkstreamGraph({
        repos: [
          {
            id: "streamliner",
            owner: "lossyrob",
            name: "streamliner",
            role: "primary",
          },
          {
            id: "dbagent",
            owner: "lossyrob",
            name: "dbagent",
            role: "secondary",
          },
        ],
        nodes: [
          {
            id: "launch-prompt-profiles",
            type: "task",
            title: "Launch prompt profiles",
            summary: "Configure the PAW launch prompt defaults.",
            status: "ready",
            attention: "focus",
            repoIds: ["streamliner"],
            tracker: {
              type: "github",
              owner: "lossyrob",
              repo: "streamliner",
              number: 33,
            },
            dependsOn: [],
          },
          {
            id: "runtime-overlay-ui",
            type: "task",
            title: "Runtime overlay UI",
            summary: "Show runtime launch overlays.",
            status: "ready",
            attention: "watch",
            repoIds: ["dbagent"],
            tracker: {
              type: "github",
              owner: "lossyrob",
              repo: "streamliner",
              number: 52,
            },
            dependsOn: [],
          },
        ],
        checkpoints: [
          {
            id: "launch",
            title: "Launch",
            summary: "Launch preparation.",
            status: "planned",
            nodeIds: ["launch-prompt-profiles", "runtime-overlay-ui"],
          },
        ],
      });
      const customCwd = "C:\\Users\\robemanuele\\proj\\streamliner\\custom-launch-cwd";
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        if (path === "/api/launch-preparations/runs" && init?.method === "POST") {
          return jsonResponse({ runId: "run-dialog-target", status: "queued" }, 202);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();
      setInputValue(findInputByLabel(container, "Working directory"), customCwd);
      await settle();

      act(() => {
        findCanvasNode(container, "Runtime overlay UI").click();
      });
      await settle();
      act(() => {
        findButton(container, "Run PAW init").click();
      });
      await settle(100);

      const launchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/launch-preparations/runs" &&
          init?.method === "POST",
      );
      expect(JSON.parse(String(launchCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          nodeId: "launch-prompt-profiles",
          configuration: expect.objectContaining({
            cwd: customCwd,
          }),
        }),
      );
      expect(JSON.parse(window.localStorage.getItem("streamliner:pawLaunchCwdByRepo") ?? "{}")).toEqual({
        "lossyrob/streamliner": customCwd,
      });
    },
    15_000,
  );

  it(
    "requires launch instructions before running PAW init",
    async () => {
      const graph = buildLaunchGraph();
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      setTextareaValue(findTextareaByLabel(container, "Launch instructions"), "");
      await settle();

      expect(container.textContent).toContain(
        "Launch instructions are required so paw-init can derive the workflow setup and worker prompt.",
      );
      expect(findButton(container, "Run PAW init").disabled).toBe(true);
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL) === "/api/launch-preparations",
        ),
      ).toBe(false);
    },
    15_000,
  );

  it(
    "sends and repopulates sticky PAW launch cwd overrides per repo",
    async () => {
      const graph = buildLaunchGraph();
      const customCwd = "C:\\Users\\robemanuele\\proj\\dbagent\\dbagent-local-scenario-iteration-loop";
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        if (path === "/api/launch-preparations/runs" && init?.method === "POST") {
          return jsonResponse({ runId: "run-sticky-cwd", status: "queued" }, 202);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      expect(findInputByLabel(container, "Working directory").value).toBe("");
      setInputValue(findInputByLabel(container, "Working directory"), customCwd);
      await settle();
      act(() => {
        findButton(container, "Run PAW init").click();
      });
      await settle(100);

      const launchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/launch-preparations/runs" &&
          init?.method === "POST",
      );
      expect(JSON.parse(String(launchCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          configuration: expect.objectContaining({
            cwd: customCwd,
          }),
        }),
      );
      expect(JSON.parse(window.localStorage.getItem("streamliner:pawLaunchCwdByRepo") ?? "{}")).toEqual({
        "lossyrob/streamliner": customCwd,
      });

      act(() => {
        MockEventSource.instances.at(-1)?.emit("failed", {
          status: "failed",
          error: { code: "paw_init_failed", error: "Stopped after cwd persistence check." },
          timestamp: "2026-05-04T19:47:00.000Z",
        });
      });
      await settle(100);

      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.innerHTML = "";
      root = createRoot(container);
      act(() => {
        root.render(<App />);
      });
      await settle(100);
      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      expect(findInputByLabel(container, "Working directory").value).toBe(customCwd);
    },
    15_000,
  );

  it(
    "keeps the launch dialog reopenable and shows the GitHub issue when a launch claim exists",
    async () => {
      const graph = buildLaunchGraph();
      let claimBlocksLaunch = true;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          const record = {
            projectKey: "streamliner",
            workstreamId: "api-test",
            nodeId: "launch-prompt-profiles",
            workId: "launch-prompt-profiles",
            branch: "feature/launch-prompt-profiles",
            cwd: "C:\\streamliner\\launch-prompt-profiles",
            pawWorkDir: "C:\\streamliner\\launch-prompt-profiles\\.paw\\work\\launch-prompt-profiles",
            workflowContextPath:
              "C:\\streamliner\\launch-prompt-profiles\\.paw\\work\\launch-prompt-profiles\\WorkflowContext.md",
            streamlinerContextPath:
              "C:\\streamliner\\launch-prompt-profiles\\.paw\\work\\launch-prompt-profiles\\streamliner\\context.md",
            updatedAt: "2026-05-03T18:00:00.000Z",
            pathStatus: {
              cwdExists: true,
              pawWorkDirExists: true,
              workflowContextExists: true,
              streamlinerContextExists: true,
            },
            latestClaim: {
              launchClaimId: "claim-1",
              status: claimBlocksLaunch ? "pending" : "failed",
              launchedAt: "2026-05-03T18:00:00.000Z",
              updatedAt: "2026-05-03T18:00:00.000Z",
              bindingWindowExpiresAt: "2026-05-03T18:05:00.000Z",
              reservedRegistryId: "registry-1",
              boundRegistryId: "registry-1",
              boundCopilotSessionId: "copilot-1",
              failureCode: claimBlocksLaunch ? null : "user-cancelled",
              failureReason: claimBlocksLaunch ? null : "Released.",
              blocksLaunch: claimBlocksLaunch,
              retryable: !claimBlocksLaunch,
            },
          };
          return path.includes("nodeId=")
            ? jsonResponse({ record })
            : jsonResponse({ records: [record] });
        }
        if (path === "/api/node-launch-records/launch-claims/claim-1/release" && init?.method === "POST") {
          claimBlocksLaunch = false;
          return jsonResponse({
            launchClaim: {
              launchClaimId: "claim-1",
              status: "failed",
              launchedAt: "2026-05-03T18:00:00.000Z",
              updatedAt: "2026-05-03T18:01:00.000Z",
              bindingWindowExpiresAt: "2026-05-03T18:05:00.000Z",
              reservedRegistryId: "registry-1",
              boundRegistryId: "registry-1",
              boundCopilotSessionId: "copilot-1",
              failureCode: "user-cancelled",
              failureReason: "Released.",
              blocksLaunch: false,
              retryable: true,
            },
            detachedRegistryIds: ["registry-1"],
          });
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();

      const launchButton = findButton(container, "Open PAW launch");
      expect(launchButton.disabled).toBe(false);

      act(() => {
        launchButton.click();
      });
      await settle();

      expect(container.textContent).toContain("GitHub Issue");
      const issueLink = findLink(container, "lossyrob/streamliner#33");
      expect(issueLink.href).toBe("https://github.com/lossyrob/streamliner/issues/33");
      expect(container.textContent).toContain("already active for this node");
      expect(findButton(container, "Run PAW init").disabled).toBe(true);

      await act(async () => {
        findButton(container, "Release stuck launch").click();
      });
      await settle(100);

      expect(container.textContent).toContain("Released the launch claim and detached the linked session.");
      expect(findButton(container, "Run PAW init").disabled).toBe(false);
      expect(
        fetchMock.mock.calls.some(([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/node-launch-records/launch-claims/claim-1/release" &&
          init?.method === "POST"
        ),
      ).toBe(true);
    },
    15_000,
  );

  it(
    "surfaces PAW init errors",
    async () => {
      const graph = buildLaunchGraph();
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (path === "/api/paw-launch-prompt-profiles") {
          return jsonResponse({ profiles: [] });
        }
        if (path === "/api/launch-preparations/runs" && init?.method === "POST") {
          return jsonResponse({ runId: "run-failed", status: "queued" }, 202);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();
      act(() => {
        findButton(container, "Run PAW init").click();
      });
      await settle();
      act(() => {
        MockEventSource.instances.at(-1)?.emit("progress", {
          type: "session.started",
          message: "Copilot SDK launch session ready.",
          timestamp: "2026-05-03T18:02:59.000Z",
          data: {
            workspacePath: "C:\\streamliner-state\\copilot-sdk\\run-failed\\session-state\\sdk",
            sdkStateRoot: "C:\\streamliner-state\\copilot-sdk\\run-failed",
          },
        });
      });
      await settle();
      act(() => {
        MockEventSource.instances.at(-1)?.emit("failed", {
          status: "failed",
          error: { code: "paw_init_failed", error: "PAW init failed." },
          timestamp: "2026-05-03T18:03:00.000Z",
        });
      });
      await settle(100);

      expect(container.textContent).toContain("PAW init failed.");
      expect(container.textContent).toContain("Debug session files");
      expect(container.textContent).toContain("SDK workspace");
      expect(container.textContent).toContain("C:\\streamliner-state\\copilot-sdk\\run-failed\\session-state\\sdk");
      expect(container.textContent).toContain("SDK state root");
      expect(container.textContent).toContain("C:\\streamliner-state\\copilot-sdk\\run-failed");
      expect(container.textContent).not.toContain("Prepared handoff");
    },
    15_000,
  );

  it(
    "disables launch preparation for non-ready and browser-only graph sources",
    async () => {
      const nonReadyGraph = buildLaunchGraph("in-progress");
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(nonReadyGraph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();

      expect(findButton(container, "Initialize PAW launch").disabled).toBe(true);
      expect(container.textContent).toContain("Only ready nodes can be launched.");

      await act(async () => {
        root.unmount();
        await Promise.resolve();
      });
      container.innerHTML = "";
      root = createRoot(container);

      const browserGraph = buildLaunchGraph();
      const browserContent = JSON.stringify(browserGraph);
      await storeBrowserWorkstreamDirectory({
        directoryName: "Browser graph",
        content: browserContent,
        lastModified: 1_777_777_777_000,
        directoryHandle: {
          name: "Browser graph",
          kind: "directory",
          queryPermission: async () => "granted" as PermissionState,
          getFileHandle: async () => ({
            name: "graph.json",
            kind: "file",
            getFile: async () =>
              new File([browserContent], "graph.json", {
                lastModified: 1_777_777_777_000,
              }),
          }),
        },
      } as Parameters<typeof storeBrowserWorkstreamDirectory>[0]);
      const browserFetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({ version: 1, migrationWarnings: [], workstreams: [] });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", browserFetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();

      expect(findButton(container, "Initialize PAW launch").disabled).toBe(true);
      expect(container.textContent).toContain(
        "Browser-only or missing graph sources cannot be prepared by the backend.",
      );
    },
    15_000,
  );

  it(
    "disables launch preparation when workstream policy requires a GitHub issue",
    async () => {
      const graph = buildLaunchGraph("ready", {
        graph: {
          launchPolicy: { requiredTracker: "github-issue" },
        },
        node: {
          tracker: undefined,
        },
      });
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();

      expect(findButton(container, "Initialize PAW launch").disabled).toBe(true);
      expect(container.textContent).toContain(
        "requires a GitHub issue tracker before launch",
      );
      expect(container.textContent).toContain(
        "edit graph.json launchPolicy if untracked launches are intentional",
      );
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL) === "/api/launch-preparations/runs"
        ),
      ).toBe(false);
    },
    15_000,
  );

  it(
    "edits workstream configuration and applies terminal defaults to PAW launch",
    async () => {
      let graph = buildLaunchGraph("ready", {
        graph: {
          launchDefaults: {
            promptProfileId: "final-pr-only",
          },
        },
      });
      let savedConfiguration: Record<string, unknown> | null = null;
      let resolveProfileList!: (response: Response) => void;
      const profileListPromise = new Promise<Response>((resolve) => {
        resolveProfileList = resolve;
      });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: [buildTrackedWorkstream()],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        if (path === "/api/workstreams/streamliner/api-test/configuration") {
          savedConfiguration = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          graph = {
            ...graph,
            launchPolicy: savedConfiguration.launchPolicy ?? undefined,
            launchDefaults: savedConfiguration.launchDefaults ?? undefined,
            updatedAt: "2026-05-07T18:10:33.000Z",
          };
          return jsonResponse({ workstream: graph });
        }
        if (path.startsWith("/api/node-launch-records?")) {
          return emptyNodeLaunchRecordResponse();
        }
        if (path === "/api/paw-launch-prompt-profiles" && (!init?.method || init.method === "GET")) {
          expect(init?.cache).toBe("no-store");
          return profileListPromise;
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      act(() => {
        findButton(container, "Configure…").click();
      });
      await settle(100);
      expect(container.textContent).not.toContain("Missing profile: final-pr-only");
      expect(container.textContent).toContain("Loading profile: final-pr-only");
      act(() => {
        resolveProfileList(jsonResponse({
          profiles: [{
            id: "final-pr-only",
            name: "Final PR only",
            instructions: "Use final PR only workflow.",
            updatedAt: "2026-05-03T18:00:00.000Z",
          }],
        }));
      });
      await settle(100);
      setSelectValue(findSelectByLabel(container, "Required tracker"), "github-issue");
      expect(findSelectByLabel(container, "Default load profile").value).toBe("final-pr-only");
      setSelectValue(findSelectByLabel(container, "Preferred terminal"), "windows-terminal");
      setInputValue(
        findInputByLabel(container, "Terminal tab title template"),
        "{githubIssue} - {nodeTitle}",
      );
      act(() => {
        findButtonByLabel(container, "Use terminal color #ff8c0a").click();
      });
      await settle();
      act(() => {
        findButton(container, "Save configuration").click();
      });
      await settle(100);

      expect(savedConfiguration).toEqual({
        launchPolicy: { requiredTracker: "github-issue" },
        launchDefaults: {
          promptProfileId: "final-pr-only",
          terminal: {
            preferredTerminal: "windows-terminal",
            titleTemplate: "{githubIssue} - {nodeTitle}",
            tabColor: "#ff8c0a",
          },
        },
      });
      expect(container.textContent).not.toContain("Save durable launch policy");

      act(() => {
        findCanvasNode(container, "Launch prompt profiles").click();
      });
      await settle();
      act(() => {
        findButton(container, "Initialize PAW launch").click();
      });
      await settle();

      expect(findSelectByLabel(container, "Preferred terminal").value).toBe("windows-terminal");
      expect(findInputByLabel(container, "Terminal tab title").value).toBe(
        "#33 - Launch prompt profiles",
      );
      expect(container.textContent).toContain("Selected #ff8c0a");
    },
    15_000,
  );

  it(
    "adds a workstream source and refreshes graph content from disk",
    async () => {
      let graph = buildWorkstreamGraph();
      let sourceAdded = false;
      const trackedSourceWorkstream = buildTrackedWorkstream({
        source: "source",
        sourceId: "workstreams-root-test",
        sourceType: "workstreams-root",
        sourcePath: "C:\\sources",
        path: "C:\\sources\\api-test\\graph.json",
      });
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: sourceAdded ? [trackedSourceWorkstream] : [],
            sources: sourceAdded
              ? [{
                id: "workstreams-root-test",
                type: "workstreams-root",
                path: "C:\\sources",
                addedAt: "2026-05-01T12:00:00.000Z",
                updatedAt: "2026-05-01T12:00:00.000Z",
                health: "available",
                discoveredCount: 1,
                messages: [],
              }]
              : [],
            conflicts: [],
            archivedWorkstreams: [],
          });
        }
        if (path === "/api/workstream-sources") {
          sourceAdded = true;
          return jsonResponse({
            workstreams: [trackedSourceWorkstream],
            sources: [{
              id: "workstreams-root-test",
              type: "workstreams-root",
              path: "C:\\sources",
              addedAt: "2026-05-01T12:00:00.000Z",
              updatedAt: "2026-05-01T12:00:00.000Z",
              health: "available",
              discoveredCount: 1,
              messages: [],
            }],
            conflicts: [],
            archivedWorkstreams: [],
          }, 201);
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse(graph);
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams");

      act(() => {
        root.render(<App />);
      });
      await settle();

      const input = container.querySelector(".sl-source-input");
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Could not find source path input.");
      }
      setInputValue(input, "C:\\sources");
      act(() => {
        findButton(container, "Add source").click();
      });
      await settle(100);

      expect(container.textContent).toContain("API Test");
      expect(container.textContent).toContain("C:\\sources");

      const workstreamCard = findWorkstreamCard(container, "API Test");
      expect(workstreamCard.getAttribute("href")).toBe("/workstreams/streamliner/api-test");

      act(() => {
        workstreamCard.click();
      });
      await settle(100);
      expect(window.location.pathname).toBe("/workstreams/streamliner/api-test");

      graph = buildWorkstreamGraph({ title: "API Test Updated" });
      await settle(2_200);
      expect(container.textContent).toContain("API Test Updated");
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL) === "/api/pick-file",
        ),
      ).toBe(false);
    },
    15_000,
  );

  it(
    "soft-fails missing graph files and can archive the active workstream",
    async () => {
      const trackedWorkstream = buildTrackedWorkstream({ fileStatus: "missing" });
      let archived = false;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({
            version: 1,
            migrationWarnings: [],
            workstreams: archived ? [] : [trackedWorkstream],
            archivedWorkstreams: archived ? [{ ...trackedWorkstream, archived: true }] : [],
            sources: [],
            conflicts: [],
          });
        }
        if (path === "/api/workstreams/streamliner/api-test/graph") {
          return jsonResponse({ code: "workstream_file_missing", error: "Graph file is missing." }, 404);
        }
        if (path === "/api/workstreams/streamliner/api-test/archive") {
          archived = true;
          return jsonResponse({
            workstreams: [],
            archivedWorkstreams: [{ ...trackedWorkstream, archived: true }],
            sources: [],
            conflicts: [],
          });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner/api-test");

      act(() => {
        root.render(<App />);
      });
      await settle(100);

      expect(container.textContent).toContain("Workstream unavailable");
      expect(container.textContent).toContain("Graph file is missing.");

      act(() => {
        findButton(container, "Archive workstream").click();
      });
      await settle(100);

      expect(container.textContent).toContain("Archived workstreams");
      expect(window.location.pathname).toBe("/workstreams");
    },
    15_000,
  );

  it(
    "shows malformed workstream paths on the tracked workstreams home",
    async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path === "/api/workstreams") {
          return jsonResponse({ version: 1, migrationWarnings: [], workstreams: [] });
        }
        throw new Error(`Unexpected fetch: ${path}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.pushState({}, "", "/workstreams/streamliner");

      act(() => {
        root.render(<App />);
      });
      await settle();

      expect(container.textContent).toContain("That workstream URL is incomplete.");
      expect(container.textContent).toContain("Tracked workstreams");
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
      expect(sessionList.textContent).toContain("folder manual-session-registry");
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
          expectedVersion: session.version,
          title: "Terminal A session",
          color: "#ff8c0a",
        }),
      );
    },
    15_000,
  );

  it(
    "refreshes the session list when the live event stream reports a change",
    async () => {
      vi.useFakeTimers();
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

      let sessionsRequests = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const path = requestPath(input);
        if (path.startsWith("/api/sessions")) {
          sessionsRequests += 1;
          return jsonResponse([
            buildSession({
              title: sessionsRequests === 1 ? "Initial session" : "Live refreshed session",
              version: sessionsRequests === 1 ? 0 : 1,
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
      expect(container.textContent).toContain("Initial session");
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0]?.url).toBe("/api/sessions/events");

      act(() => {
        MockEventSource.instances[0]?.emit("session.upserted");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      await flushReact();

      expect(container.textContent).toContain("Live refreshed session");
      expect(sessionsRequests).toBeGreaterThanOrEqual(2);
    },
    15_000,
  );

  it(
    "sends expectedVersion and surfaces stale edit conflicts",
    async () => {
      const session = buildSession({
        id: "conflicted-session",
        version: 3,
        title: "Editable session",
      });
      const latest = buildSession({
        ...session,
        version: 4,
        title: "Edited elsewhere",
        updatedAt: DEFAULT_TEST_SESSION_TIMESTAMP,
      });
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = requestPath(input);
          if (path === "/api/sessions") {
            return jsonResponse([session]);
          }
          if (path === "/api/sessions/conflicted-session" && init?.method === "PATCH") {
            return jsonResponse(
              {
                error: "Session changed elsewhere.",
                latest: toRegistryRecord(latest),
                conflictingFields: ["title"],
              },
              409,
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
      await openSessionSettings(container, "Editable session");
      setInputValue(findInputByLabel(container, "Session title"), "Local edit");

      act(() => {
        findButton(container, "Done").click();
      });
      await settle(75);

      const patchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/sessions/conflicted-session" &&
          init?.method === "PATCH",
      );
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual(
        expect.objectContaining({
          expectedVersion: 3,
          title: "Local edit",
        }),
      );
      expect(container.textContent).toContain("Session changed elsewhere.");
      expect(container.textContent).toContain("title");
      expect(container.textContent).toContain("Edited elsewhere");
    },
    15_000,
  );

  it(
    "waits for explicit commit before saving session setting drafts",
    async () => {
      vi.useFakeTimers();
      const session = buildSession({
        id: "explicit-save-session",
        version: 7,
        title: "Explicit save session",
      });
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = requestPath(input);
          if (path === "/api/sessions") {
            return jsonResponse([session]);
          }
          if (path === "/api/sessions/explicit-save-session" && init?.method === "PATCH") {
            const patch = JSON.parse(String(init.body)) as Partial<SessionRegistryListItem>;
            return jsonResponse(
              toRegistryRecord({
                ...session,
                ...patch,
                version: session.version + 1,
                updatedAt: "2026-04-23T12:05:00.000Z",
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

      await flushReact();
      act(() => {
        findSessionRow(container, "Explicit save session").click();
      });
      await flushReact();
      const settingsTab = [...container.querySelectorAll<HTMLButtonElement>(".sl-sheet-tab")].find(
        (btn) => btn.textContent?.trim() === "Settings",
      );
      if (!settingsTab) {
        throw new Error("Could not find Settings tab.");
      }
      act(() => {
        settingsTab.click();
      });
      await flushReact();

      const [titleInput] = findSessionEditorInputs(container);
      if (!titleInput) {
        throw new Error("Could not find Settings title input.");
      }
      setInputValue(titleInput, "Explicit save draft");
      act(() => {
        titleInput.blur();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      await flushReact();

      const patchCallsBeforeCommit = fetchMock.mock.calls.filter(
        ([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/sessions/explicit-save-session" &&
          init?.method === "PATCH",
      );
      expect(patchCallsBeforeCommit).toHaveLength(0);

      act(() => {
        titleInput.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await flushReact();
      await flushReact();

      const patchCallsAfterCommit = fetchMock.mock.calls.filter(
        ([input, init]) =>
          requestPath(input as RequestInfo | URL) === "/api/sessions/explicit-save-session" &&
          init?.method === "PATCH",
      );
      expect(patchCallsAfterCommit).toHaveLength(1);
      expect(JSON.parse(String(patchCallsAfterCommit[0]?.[1]?.body))).toEqual(
        expect.objectContaining({
          expectedVersion: 7,
          title: "Explicit save draft",
        }),
      );
    },
    15_000,
  );

  it(
    "does not treat observation-only refreshes as stale builder conflicts",
    async () => {
      vi.useFakeTimers();
      MockEventSource.instances = [];
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      let sessionsRequests = 0;
      const initial = buildSession({
        id: "active-session",
        title: "Active session",
        version: 0,
        lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
        activityStatus: "waiting_for_input",
      });
      const observedRefresh = buildSession({
        ...initial,
        lastSeenAt: new Date(Date.now()).toISOString(),
        activityStatus: "working",
      });
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = requestPath(input);
          if (path === "/api/sessions") {
            sessionsRequests += 1;
            return jsonResponse([
              sessionsRequests === 1 ? initial : observedRefresh,
            ]);
          }
          if (path === "/api/sessions/active-session" && init?.method === "PATCH") {
            const patch = JSON.parse(String(init.body)) as Partial<SessionRegistryListItem>;
            return jsonResponse(
              toRegistryRecord({
                ...observedRefresh,
                ...patch,
                version: 1,
                updatedAt: "2026-05-01T12:02:00.000Z",
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

      await flushReact();
      act(() => {
        findSessionRow(container, "Active session").click();
      });
      await flushReact();
      const settingsTab = [...container.querySelectorAll<HTMLButtonElement>(".sl-sheet-tab")].find(
        (btn) => btn.textContent?.trim() === "Settings",
      );
      if (!settingsTab) {
        throw new Error("Could not find Settings tab.");
      }
      act(() => {
        settingsTab.click();
      });
      await flushReact();
      setInputValue(findInputByLabel(container, "Session title"), "Active session local edit");

      act(() => {
        MockEventSource.instances[0]?.emit("session.upserted");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      await flushReact();

      expect(container.textContent).not.toContain("changed elsewhere");
      expect(container.textContent).toContain("working");
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
        findLink(container, "Workstreams").click();
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
