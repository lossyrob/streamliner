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

function findSessionEditorInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll(".sl-session-editor input")].filter(
    (candidate): candidate is HTMLInputElement => candidate instanceof HTMLInputElement,
  );
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

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.pushState({}, "", "/");
    document.body.innerHTML = "";
  });

  it(
    "renders the sessions view directly without attempting to load a graph",
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

      expect(container.textContent).toContain("My Sessions");
      expect(container.textContent).toContain("Manual session registry");

      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL).startsWith("/api/graph.json"),
        ),
      ).toBe(false);
    },
    15_000,
  );

  it(
    "refreshes an open sessions view when polling returns newer registry data",
    async () => {
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

      await settle();

      expect(container.textContent).toContain("Manual session registry");

      await settle(2_100);

      expect(container.textContent).toContain(
        "Manual session registry (refreshed)",
      );
      const [, , cwdInput, repoInput, branchInput] = findSessionEditorInputs(container);
      expect(cwdInput?.value).toBe(
        "C:\\Users\\robemanuele\\proj\\streamliner\\manual-session-registry-refreshed",
      );
      expect(repoInput?.value).toBe(
        "lossyrob/streamliner-refreshed",
      );
      expect(branchInput?.value).toBe("feature/manual-session-registry-refreshed");

      expect(sessionsRequests).toBeGreaterThanOrEqual(2);
    },
    15_000,
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

      const [titleInput] = findSessionEditorInputs(container);
      setInputValue(titleInput, "Manual session registry (dirty)");

      act(() => {
        findButton(container, "Workstream").click();
      });

      await settle(75);

      expect(container.textContent).toContain("My Sessions");
      expect(container.textContent).toContain("Session registry is locked.");
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestPath(input as RequestInfo | URL).startsWith("/api/graph.json"),
        ),
      ).toBe(false);
    },
    15_000,
  );
});
