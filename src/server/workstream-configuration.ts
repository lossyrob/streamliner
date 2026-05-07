import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  WORKSTREAM_LAUNCH_REQUIRED_TRACKERS,
  WORKSTREAM_LAUNCH_TERMINAL_PREFERENCES,
  type WorkstreamDocument,
  type WorkstreamLaunchDefaults,
  type WorkstreamLaunchPolicy,
  type WorkstreamLaunchRequiredTracker,
  type WorkstreamLaunchTerminalPreference,
} from "../workstream-schema";
import { summarizeWorkstreamDocument } from "../workstream-identity";
import { parseWorkstreamDocument } from "../workstream-view-model";

export interface WorkstreamConfigurationUpdateInput {
  launchPolicy?: WorkstreamLaunchPolicy | null;
  launchDefaults?: WorkstreamLaunchDefaults | null;
}

export interface WorkstreamConfigurationUpdateResult {
  workstream: WorkstreamDocument;
  lastModified: string;
}

type NodeError = Error & { code?: string };

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function badConfiguration(message: string): NodeError {
  const error = new Error(message) as NodeError;
  error.code = "EINVALIDCONFIG";
  return error;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw badConfiguration(`${label} must be an object.`);
  }
  return value;
}

function normalizeLaunchPolicy(value: unknown): WorkstreamLaunchPolicy | undefined {
  const record = optionalRecord(value, "launchPolicy");
  if (!record) {
    return undefined;
  }
  const requiredTracker = record.requiredTracker;
  if (requiredTracker === undefined || requiredTracker === null || requiredTracker === "") {
    return undefined;
  }
  if (
    typeof requiredTracker !== "string" ||
    !WORKSTREAM_LAUNCH_REQUIRED_TRACKERS.includes(requiredTracker as WorkstreamLaunchRequiredTracker)
  ) {
    throw badConfiguration(
      `launchPolicy.requiredTracker must be one of: ${WORKSTREAM_LAUNCH_REQUIRED_TRACKERS.join(", ")}.`,
    );
  }
  return { requiredTracker: requiredTracker as WorkstreamLaunchRequiredTracker };
}

function normalizeOptionalHexColor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badConfiguration("launchDefaults.terminal.tabColor must be a #RRGGBB color.");
  }
  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    throw badConfiguration("launchDefaults.terminal.tabColor must be a #RRGGBB color.");
  }
  return color;
}

function normalizeTerminalPreference(value: unknown): WorkstreamLaunchTerminalPreference | undefined {
  if (value === undefined || value === null || value === "" || value === "default") {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    !WORKSTREAM_LAUNCH_TERMINAL_PREFERENCES.includes(value as WorkstreamLaunchTerminalPreference)
  ) {
    throw badConfiguration(
      `launchDefaults.terminal.preferredTerminal must be one of: ${WORKSTREAM_LAUNCH_TERMINAL_PREFERENCES.join(", ")}.`,
    );
  }
  return value as WorkstreamLaunchTerminalPreference;
}

function normalizeLaunchDefaults(value: unknown): WorkstreamLaunchDefaults | undefined {
  const record = optionalRecord(value, "launchDefaults");
  if (!record) {
    return undefined;
  }
  const terminalRecord = optionalRecord(record.terminal, "launchDefaults.terminal");
  if (!terminalRecord) {
    return undefined;
  }
  const preferredTerminal = normalizeTerminalPreference(terminalRecord.preferredTerminal);
  const tabColor = normalizeOptionalHexColor(terminalRecord.tabColor);
  const terminal = {
    ...(preferredTerminal ? { preferredTerminal } : {}),
    ...(tabColor ? { tabColor } : {}),
  };
  return Object.keys(terminal).length > 0 ? { terminal } : undefined;
}

function assertConfigurableGraphContent(
  content: string,
  graphPath: string,
  projectKey: string,
  workstreamId: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    const invalidGraphError = new Error(error instanceof Error ? error.message : String(error)) as NodeError;
    invalidGraphError.code = "EINVALIDGRAPH";
    throw invalidGraphError;
  }
  if (!isRecord(parsed)) {
    const invalidGraphError = new Error(`${graphPath} must contain a JSON object.`) as NodeError;
    invalidGraphError.code = "EINVALIDGRAPH";
    throw invalidGraphError;
  }
  const workstream = parseWorkstreamDocument(content);
  const summary = summarizeWorkstreamDocument(workstream);
  if (summary.projectKey !== projectKey || summary.workstreamId !== workstreamId) {
    const error = new Error(
      `Workstream graph identity changed to '${summary.projectKey}/${summary.workstreamId}'.`,
    ) as NodeError;
    error.code = "EIDMISMATCH";
    throw error;
  }
  return parsed;
}

async function atomicWriteJson(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf-8");
  await rename(tempPath, path);
}

export async function updateWorkstreamConfigurationFile(input: {
  graphPath: string;
  content: string;
  projectKey: string;
  workstreamId: string;
  configuration: WorkstreamConfigurationUpdateInput;
  now?: () => Date;
}): Promise<WorkstreamConfigurationUpdateResult> {
  const record = assertConfigurableGraphContent(
    input.content,
    input.graphPath,
    input.projectKey,
    input.workstreamId,
  );

  if (hasOwn(input.configuration as Record<string, unknown>, "launchPolicy")) {
    const nextPolicy = normalizeLaunchPolicy(input.configuration.launchPolicy);
    if (nextPolicy) {
      record.launchPolicy = nextPolicy;
    } else {
      delete record.launchPolicy;
    }
  }

  if (hasOwn(input.configuration as Record<string, unknown>, "launchDefaults")) {
    const nextDefaults = normalizeLaunchDefaults(input.configuration.launchDefaults);
    if (nextDefaults) {
      record.launchDefaults = nextDefaults;
    } else {
      delete record.launchDefaults;
    }
  }

  record.updatedAt = (input.now?.() ?? new Date()).toISOString();
  const nextContent = `${JSON.stringify(record, null, 2)}\n`;
  const workstream = parseWorkstreamDocument(nextContent);
  const summary = summarizeWorkstreamDocument(workstream);
  if (summary.projectKey !== input.projectKey || summary.workstreamId !== input.workstreamId) {
    const error = new Error(
      `Workstream graph identity changed to '${summary.projectKey}/${summary.workstreamId}'.`,
    ) as NodeError;
    error.code = "EIDMISMATCH";
    throw error;
  }

  await atomicWriteJson(input.graphPath, nextContent);
  const info = await stat(input.graphPath);
  return {
    workstream,
    lastModified: info.mtime.toUTCString(),
  };
}
