import { useCallback, useEffect, useRef, useState } from "react";

import type { ManagedRuntimeActionAvailability } from "../managed-runtime-contract";

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

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const runAction = useCallback(async () => {
    if (!action.available || state === "running") {
      return;
    }
    setState("running");
    setDetail("");
    try {
      const response = await fetch(managedActionUrl(sessionId, action.action), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(managedActionBody(action.action)),
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        outcome?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error ?? `Managed action failed (${response.status})`);
      }
      setState("success");
      setDetail(body.outcome?.message ?? `${action.label} requested.`);
      await onComplete?.();
    } catch (error: unknown) {
      setState("error");
      setDetail(error instanceof Error ? error.message : String(error));
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => {
      setState("idle");
      setDetail("");
      resetTimerRef.current = null;
    }, 10_000);
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
      disabled={!action.available || state === "running"}
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
  switch (action) {
    case "interrupt":
      return `/api/sessions/${encoded}/managed/interrupt`;
    case "cancel":
      return `/api/sessions/${encoded}/managed/cancel`;
    case "terminal-takeover":
      return `/api/sessions/${encoded}/managed/takeover`;
    case "cleanup":
      return `/api/sessions/${encoded}/managed/cleanup`;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function managedActionBody(
  action: ManagedRuntimeActionAvailability["action"],
): Record<string, string> {
  if (action === "interrupt") {
    return { reason: "Builder requested managed runtime interruption." };
  }
  return {};
}
