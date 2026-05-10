import { useCallback, useEffect, useRef, useState } from "react";

import {
  MANAGED_RUNTIME_ACTION_ROUTE_SUFFIXES,
  type ManagedRuntimeActionAvailability,
} from "../managed-runtime-contract";

type ManagedActionState = "idle" | "running" | "success" | "error";

interface ManagedRuntimeActionButtonProps {
  sessionId: string;
  action: ManagedRuntimeActionAvailability;
  className?: string;
  onComplete?: () => void | Promise<void>;
}

export function ManagedRuntimeActionButton({
  sessionId,
  action,
  className,
  onComplete,
}: ManagedRuntimeActionButtonProps) {
  const [state, setState] = useState<ManagedActionState>("idle");
  const [detail, setDetail] = useState("");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setState("idle");
    setDetail("");
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, [action.action, action.available, sessionId]);

  const runAction = useCallback(async () => {
    if (!action.available || state === "running") {
      return;
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setState("running");
    setDetail("");
    try {
      const response = await fetch(managedActionUrl(sessionId, action.action), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(managedActionBody(action.action)),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        outcome?: { ok?: boolean; message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error ?? `Managed action failed (${response.status})`);
      }
      if (body.outcome?.ok === false) {
        throw new Error(body.outcome.message ?? `${action.label} failed.`);
      }
      if (!mountedRef.current) {
        return;
      }
      setState("success");
      setDetail(body.outcome?.message ?? `${action.label} requested.`);
      await onComplete?.();
    } catch (error: unknown) {
      if (!mountedRef.current || isAbortError(error)) {
        return;
      }
      setState("error");
      setDetail(error instanceof Error ? error.message : String(error));
      resetTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) {
          return;
        }
        setState("idle");
        setDetail("");
        resetTimerRef.current = null;
      }, 10_000);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [action, onComplete, sessionId, state]);

  const label = state === "running"
      ? `${action.label}...`
      : state === "success" || state === "error"
        ? detail
        : action.label;
  const title = !action.available
    ? action.reason ?? `${action.label} is unavailable.`
    : label;

  return (
    <button
      key={action.action}
      type="button"
      className={`sl-managed-runtime-action${state === "success" ? " success" : ""}${
        state === "error" ? " error" : ""
      }${state === "running" ? " running" : ""}${className ? ` ${className}` : ""}`}
      disabled={!action.available || state === "running" || state === "success"}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        void runAction();
      }}
    >
      {label}
    </button>
  );
}

function managedActionUrl(
  sessionId: string,
  action: ManagedRuntimeActionAvailability["action"],
): string {
  const encoded = encodeURIComponent(sessionId);
  return `/api/sessions/${encoded}/managed/${MANAGED_RUNTIME_ACTION_ROUTE_SUFFIXES[action]}`;
}

function managedActionBody(
  action: ManagedRuntimeActionAvailability["action"],
): Record<string, string> {
  switch (action) {
    case "interrupt":
      return { reason: "Builder requested managed runtime interruption." };
    case "cancel":
    case "terminal-takeover":
    case "cleanup":
      return {};
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
