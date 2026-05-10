import {
  managedLifecycleStatusClass,
  type ManagedRuntimeLifecycleState,
  type ManagedRuntimeProgressEvent,
  type ManagedRuntimeProjection,
} from "../managed-runtime-contract";

export interface ManagedSessionConsoleEvent {
  timestamp: string;
  phase: string;
  label: string;
  summary: string;
  kind?: ManagedRuntimeProgressEvent["kind"];
  status?: ManagedRuntimeProgressEvent["status"];
  link?: ManagedRuntimeProgressEvent["link"];
  detail?: string | null;
  count?: number | null;
  correlationId?: string | null;
}

interface LaunchProgressEventLike {
  type: string;
  message: string;
  timestamp: string;
}

const DEFAULT_CONSOLE_EVENT_LIMIT = 24;

const HIDDEN_RUNTIME_PHASES = new Set([
  "mcp_status",
  "permission_decision",
  "skill_status",
  "usage",
]);

export function managedRuntimeConsoleEvents(
  runtime: ManagedRuntimeProjection,
  limit = DEFAULT_CONSOLE_EVENT_LIMIT,
): ManagedSessionConsoleEvent[] {
  return (runtime.progress ?? [])
    .filter(isVisibleRuntimeEvent)
    .map(runtimeEventToConsoleEvent)
    .reduce<ManagedSessionConsoleEvent[]>(coalesceConsoleEvent, [])
    .slice(-limit);
}

export function launchProgressConsoleEvents(
  events: readonly LaunchProgressEventLike[],
  limit = DEFAULT_CONSOLE_EVENT_LIMIT,
): ManagedSessionConsoleEvent[] {
  return events.slice(-limit).map((event) => ({
    timestamp: event.timestamp,
    phase: event.type,
    label: "Preparing",
    summary: event.message,
    kind: "lifecycle",
    status: "info",
  }));
}

export function managedRuntimeStateTone(runtime: ManagedRuntimeProjection) {
  return managedLifecycleStatusClass(runtime.lifecycleState);
}

const TERMINAL_CONSOLE_STATES = new Set<ManagedRuntimeLifecycleState>([
  "completed",
  "cleaned_up",
  "terminal_takeover",
  "canceled",
]);

export function isManagedRuntimeConsoleLive(runtime: ManagedRuntimeProjection): boolean {
  return !TERMINAL_CONSOLE_STATES.has(runtime.lifecycleState);
}

function isVisibleRuntimeEvent(event: ManagedRuntimeProgressEvent): boolean {
  if (HIDDEN_RUNTIME_PHASES.has(event.phase)) {
    return false;
  }
  if (event.phase === "evidence" && event.summary === "Hook event observed.") {
    return false;
  }
  if (event.phase === "assistant_status" && event.summary.trim().length === 0) {
    return false;
  }
  return true;
}

function runtimeEventToConsoleEvent(
  event: ManagedRuntimeProgressEvent,
): ManagedSessionConsoleEvent {
  return {
    timestamp: event.timestamp,
    phase: event.phase,
    label: runtimeEventLabel(event),
    summary: runtimeEventSummary(event),
    kind: runtimeEventKind(event),
    status: event.status,
    link: event.link ?? undefined,
    detail: event.detail,
    count: event.count,
    correlationId: event.correlationId,
  };
}

function runtimeEventKind(
  event: ManagedRuntimeProgressEvent,
): ManagedRuntimeProgressEvent["kind"] {
  if (event.phase === "assistant_status" && event.summary === "Thinking...") {
    return "summary";
  }
  return event.kind;
}

function runtimeEventLabel(event: ManagedRuntimeProgressEvent): string {
  switch (event.phase) {
    case "assistant_status":
      return event.summary === "Thinking..." ? "Thinking" : "Assistant";
    case "tool_started":
      return "Running";
    case "tool_completed":
      return event.status === "error" ? "Failed" : "Ran";
    case "subagent_status":
      return event.status === "error"
        ? "Background agent failed"
        : event.status === "success"
          ? "Background agent finished"
          : "Background agent";
    case "skill_status":
      return "Skill";
    case "evidence":
      return "Recorded";
    case "terminal_takeover":
      return "Takeover";
    case "error":
      return "Error";
    case "lifecycle":
      return "State";
    default:
      return event.kind === "tool"
        ? "Tool"
        : event.kind === "assistant-status"
          ? "Assistant"
          : event.kind === "pull-request"
            ? "PR"
            : event.kind === "review"
              ? "Review"
              : event.kind === "cleanup"
                ? "Cleanup"
                : "Event";
  }
}

function runtimeEventSummary(event: ManagedRuntimeProgressEvent): string {
  return event.summary;
}

function coalesceConsoleEvent(
  events: ManagedSessionConsoleEvent[],
  event: ManagedSessionConsoleEvent,
): ManagedSessionConsoleEvent[] {
  const previous = events[events.length - 1];
  if (
    previous?.phase === "tool_started" &&
    event.phase === "tool_completed" &&
    ((previous.correlationId &&
      event.correlationId &&
      previous.correlationId === event.correlationId) ||
      (previous.detail && event.detail && previous.detail === event.detail))
  ) {
    events[events.length - 1] = event;
    return events;
  }
  events.push(event);
  return events;
}
