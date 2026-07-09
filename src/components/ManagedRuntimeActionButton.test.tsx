// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManagedRuntimeActionAvailability } from "../managed-runtime-contract";
import { ManagedRuntimeActionButton } from "./ManagedRuntimeActionButton";

describe("ManagedRuntimeActionButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("surfaces unsuccessful JSON outcomes returned with a 200 response", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/sessions/session-1/managed/cancel");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({
        outcome: {
          ok: false,
          message: "Cancellation failed; runtime remains active for retry.",
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onComplete = vi.fn();
    const action: ManagedRuntimeActionAvailability = {
      action: "cancel",
      label: "Cancel",
      available: true,
    };

    act(() => {
      root.render(
        <ManagedRuntimeActionButton
          sessionId="session-1"
          action={action}
          onComplete={onComplete}
        />,
      );
    });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(button?.className).toContain("error");
    expect(button?.textContent).toBe("Cancellation failed; runtime remains active for retry.");
  });
});
