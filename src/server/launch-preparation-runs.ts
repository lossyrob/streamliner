import { randomUUID } from "node:crypto";

import {
  LaunchPreparationError,
  type PawLaunchHandoff,
  type PawLaunchProgressEvent,
  type PawLaunchProgressSink,
} from "./launch-preparation";
import type {
  NodeCompanionTerminalLaunchResponse,
  NodeLaunchOperation,
  NodeTerminalLaunchResponse,
} from "../node-launch-record-contract";

const RUN_EVENT_BUFFER_SIZE = 200;

export type LaunchPreparationRunStatus = "queued" | "running" | "succeeded" | "failed";

export type LaunchPreparationRunEventName =
  | "progress"
  | "terminal_launched"
  | "terminal_failed"
  | "companion_launched"
  | "companion_failed"
  | "completed"
  | "failed";

export interface LaunchPreparationRunError {
  code: string;
  error: string;
  step?: string;
  input?: string;
}

export interface LaunchPreparationRunPostPreparationError {
  code: string;
  error: string;
  details?: unknown;
  launchClaim?: unknown;
}

export type LaunchPreparationTerminalOutcome =
  | { status: "launched"; result: NodeTerminalLaunchResponse }
  | { status: "failed"; error: LaunchPreparationRunPostPreparationError }
  | { status: "skipped" };

export type LaunchPreparationCompanionOutcome =
  | { status: "launched"; result: NodeCompanionTerminalLaunchResponse }
  | { status: "failed"; error: LaunchPreparationRunPostPreparationError }
  | { status: "skipped" };

export interface LaunchPreparationPostPreparationOutcome {
  terminal?: LaunchPreparationTerminalOutcome;
  companion?: LaunchPreparationCompanionOutcome;
  operation?: NodeLaunchOperation | null;
}

export interface LaunchPreparationRunCompletion {
  result: PawLaunchHandoff;
  postPreparation?: LaunchPreparationPostPreparationOutcome;
  operation?: NodeLaunchOperation | null;
}

export interface LaunchPreparationRunEvent {
  id: number;
  name: LaunchPreparationRunEventName;
  payload: unknown;
}

export interface LaunchPreparationRunSnapshot {
  runId: string;
  status: LaunchPreparationRunStatus;
  result?: PawLaunchHandoff;
  postPreparation?: LaunchPreparationPostPreparationOutcome;
  operation?: NodeLaunchOperation | null;
  error?: LaunchPreparationRunError;
  events: LaunchPreparationRunEvent[];
}

interface LaunchPreparationRunState {
  runId: string;
  status: LaunchPreparationRunStatus;
  nextEventId: number;
  events: LaunchPreparationRunEvent[];
  listeners: Set<(event: LaunchPreparationRunEvent) => void>;
  result?: PawLaunchHandoff;
  postPreparation?: LaunchPreparationPostPreparationOutcome;
  operation?: NodeLaunchOperation | null;
  error?: LaunchPreparationRunError;
}

export type LaunchPreparationRunExecutor = (
  progress: PawLaunchProgressSink,
  publish: (name: Exclude<LaunchPreparationRunEventName, "progress" | "completed" | "failed">, payload: unknown) => void,
) => Promise<PawLaunchHandoff | LaunchPreparationRunCompletion>;

function toRunError(error: unknown): LaunchPreparationRunError {
  if (error instanceof LaunchPreparationError) {
    return {
      code: error.code,
      error: error.message,
      step: error.step,
      input: error.input,
    };
  }
  return {
    code: "launch_preparation_failed",
    error: error instanceof Error ? error.message : String(error),
  };
}

export class LaunchPreparationRunManager {
  private readonly runs = new Map<string, LaunchPreparationRunState>();

  start(
    executor: LaunchPreparationRunExecutor,
    options: { runId?: string } = {},
  ): LaunchPreparationRunSnapshot {
    const run: LaunchPreparationRunState = {
      runId: options.runId ?? randomUUID(),
      status: "queued",
      nextEventId: 1,
      events: [],
      listeners: new Set(),
    };
    this.runs.set(run.runId, run);
    void this.execute(run, executor);
    return this.snapshot(run);
  }

  get(runId: string): LaunchPreparationRunSnapshot | null {
    const run = this.runs.get(runId);
    return run ? this.snapshot(run) : null;
  }

  eventsAfter(runId: string, lastEventId: number | null): LaunchPreparationRunEvent[] | null {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }
    return lastEventId === null
      ? [...run.events]
      : run.events.filter((event) => event.id > lastEventId);
  }

  subscribe(
    runId: string,
    listener: (event: LaunchPreparationRunEvent) => void,
  ): (() => void) | null {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }
    run.listeners.add(listener);
    return () => {
      run.listeners.delete(listener);
    };
  }

  private async execute(
    run: LaunchPreparationRunState,
    executor: LaunchPreparationRunExecutor,
  ): Promise<void> {
    run.status = "running";
    try {
      const completion = normalizeCompletion(await executor(
        (event) => {
          this.publish(run, "progress", event);
        },
        (name, payload) => {
          this.publish(run, name, payload);
        },
      ));
      run.status = "succeeded";
      run.result = completion.result;
      run.postPreparation = completion.postPreparation;
      run.operation = completion.operation;
      this.publish(run, "completed", {
        status: "succeeded",
        result: completion.result,
        postPreparation: completion.postPreparation,
        operation: completion.operation,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      run.status = "failed";
      run.error = toRunError(error);
      this.publish(run, "failed", {
        status: "failed",
        error: run.error,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private publish(
    run: LaunchPreparationRunState,
    name: LaunchPreparationRunEventName,
    payload: PawLaunchProgressEvent | unknown,
  ): void {
    const event = {
      id: run.nextEventId,
      name,
      payload,
    };
    run.nextEventId += 1;
    run.events.push(event);
    if (run.events.length > RUN_EVENT_BUFFER_SIZE) {
      run.events.splice(0, run.events.length - RUN_EVENT_BUFFER_SIZE);
    }
    for (const listener of run.listeners) {
      listener(event);
    }
  }

  private snapshot(run: LaunchPreparationRunState): LaunchPreparationRunSnapshot {
    return {
      runId: run.runId,
      status: run.status,
      result: run.result,
      postPreparation: run.postPreparation,
      operation: run.operation,
      error: run.error,
      events: [...run.events],
    };
  }
}

function normalizeCompletion(
  value: PawLaunchHandoff | LaunchPreparationRunCompletion,
): LaunchPreparationRunCompletion {
  if (
    typeof value === "object" &&
    value !== null &&
    "result" in value &&
    typeof (value as { result?: unknown }).result === "object"
  ) {
    return value as LaunchPreparationRunCompletion;
  }
  return { result: value as PawLaunchHandoff };
}
