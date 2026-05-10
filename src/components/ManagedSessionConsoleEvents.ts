import {
  managedLifecycleStatusClass,
  type ManagedRuntimeProgressEvent,
  type ManagedRuntimeProjection,
} from "../managed-runtime-contract";

export interface ManagedSessionConsoleEvent {
  timestamp: string;
  phase: string;
  summary: string;
  status?: ManagedRuntimeProgressEvent["status"];
  link?: ManagedRuntimeProgressEvent["link"];
}

interface LaunchProgressEventLike {
  type: string;
  message: string;
  timestamp: string;
}

const DEFAULT_CONSOLE_EVENT_LIMIT = 24;

export function managedRuntimeConsoleEvents(
  runtime: ManagedRuntimeProjection,
  limit = DEFAULT_CONSOLE_EVENT_LIMIT,
): ManagedSessionConsoleEvent[] {
  return (runtime.progress ?? []).slice(-limit).map((event) => ({
    timestamp: event.timestamp,
    phase: event.phase,
    summary: event.summary,
    status: event.status,
    link: event.link ?? undefined,
  }));
}

export function launchProgressConsoleEvents(
  events: readonly LaunchProgressEventLike[],
  limit = DEFAULT_CONSOLE_EVENT_LIMIT,
): ManagedSessionConsoleEvent[] {
  return events.slice(-limit).map((event) => ({
    timestamp: event.timestamp,
    phase: event.type,
    summary: event.message,
    status: "info",
  }));
}

export function managedRuntimeStateTone(runtime: ManagedRuntimeProjection) {
  return managedLifecycleStatusClass(runtime.lifecycleState);
}
