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
  type WorkstreamPresentation,
} from "../workstream-schema";
import { summarizeWorkstreamDocument } from "../workstream-identity";
import { parseWorkstreamDocument } from "../workstream-view-model";

export interface WorkstreamConfigurationUpdateInput {
  presentation?: WorkstreamPresentation | null;
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

function normalizeOptionalHexColor(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badConfiguration(`${label} must be a #RRGGBB color.`);
  }
  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    throw badConfiguration(`${label} must be a #RRGGBB color.`);
  }
  return color;
}

function normalizeOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badConfiguration(`${label} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePresentation(value: unknown): WorkstreamPresentation | undefined {
  const record = optionalRecord(value, "presentation");
  if (!record) {
    return undefined;
  }
  const shortName = normalizeOptionalString(record.shortName, "presentation.shortName");
  const color = normalizeOptionalHexColor(record.color, "presentation.color");
  const presentation: WorkstreamPresentation = {
    ...(shortName ? { shortName } : {}),
    ...(color ? { color } : {}),
  };
  return Object.keys(presentation).length > 0 ? presentation : undefined;
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

function normalizeTitleTemplate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badConfiguration("launchDefaults.terminal.titleTemplate must be a string.");
  }
  const template = value.trim();
  return template.length > 0 ? template : undefined;
}

function normalizePromptProfileId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badConfiguration("launchDefaults.promptProfileId must be a kebab-case profile id.");
  }
  const profileId = value.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profileId)) {
    throw badConfiguration("launchDefaults.promptProfileId must be a kebab-case profile id.");
  }
  return profileId;
}

function normalizeReviewPromptTemplateId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badConfiguration("launchDefaults.reviewPromptTemplateId must be a kebab-case template id.");
  }
  const templateId = value.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId)) {
    throw badConfiguration("launchDefaults.reviewPromptTemplateId must be a kebab-case template id.");
  }
  return templateId;
}

function normalizeOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw badConfiguration(`${label} must be a boolean.`);
  }
  return value;
}

interface NormalizedLaunchDefaults {
  launchDefaults?: WorkstreamLaunchDefaults;
  migratedPresentationColor?: string;
}

function normalizeLaunchDefaults(value: unknown): NormalizedLaunchDefaults {
  const record = optionalRecord(value, "launchDefaults");
  if (!record) {
    return {};
  }
  const promptProfileId = normalizePromptProfileId(record.promptProfileId);
  const reviewPromptTemplateId = normalizeReviewPromptTemplateId(record.reviewPromptTemplateId);
  const launchAfterInit = normalizeOptionalBoolean(
    record.launchAfterInit,
    "launchDefaults.launchAfterInit",
  );
  const reviewCompanion = normalizeOptionalBoolean(
    record.reviewCompanion,
    "launchDefaults.reviewCompanion",
  );
  const terminalRecord = optionalRecord(record.terminal, "launchDefaults.terminal");
  const preferredTerminal = terminalRecord
    ? normalizeTerminalPreference(terminalRecord.preferredTerminal)
    : undefined;
  const titleTemplate = terminalRecord
    ? normalizeTitleTemplate(terminalRecord.titleTemplate)
    : undefined;
  const tabColor = terminalRecord
    ? normalizeOptionalHexColor(terminalRecord.tabColor, "launchDefaults.terminal.tabColor")
    : undefined;
  const terminal = {
    ...(preferredTerminal ? { preferredTerminal } : {}),
    ...(titleTemplate ? { titleTemplate } : {}),
  };
  const launchDefaults: WorkstreamLaunchDefaults = {
    ...(promptProfileId ? { promptProfileId } : {}),
    ...(Object.keys(terminal).length > 0 ? { terminal } : {}),
    ...(launchAfterInit !== undefined ? { launchAfterInit } : {}),
    ...(reviewCompanion !== undefined ? { reviewCompanion } : {}),
    ...(reviewPromptTemplateId ? { reviewPromptTemplateId } : {}),
  };
  return {
    ...(Object.keys(launchDefaults).length > 0 ? { launchDefaults } : {}),
    ...(tabColor ? { migratedPresentationColor: tabColor } : {}),
  };
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

function applyPresentation(
  record: Record<string, unknown>,
  presentation: WorkstreamPresentation | undefined,
): void {
  if (presentation) {
    record.presentation = presentation;
  } else {
    delete record.presentation;
  }
}

function mergePresentationColor(record: Record<string, unknown>, color: string | undefined): void {
  if (!color) {
    return;
  }
  const current = isRecord(record.presentation) ? record.presentation : {};
  record.presentation = {
    ...current,
    color,
  };
}

function deleteLegacyTerminalColor(record: Record<string, unknown>): void {
  if (!isRecord(record.launchDefaults)) {
    return;
  }
  const launchDefaults = record.launchDefaults;
  if (isRecord(launchDefaults.terminal)) {
    delete launchDefaults.terminal.tabColor;
    if (Object.keys(launchDefaults.terminal).length === 0) {
      delete launchDefaults.terminal;
    }
  }
  if (Object.keys(launchDefaults).length === 0) {
    delete record.launchDefaults;
  }
}

export async function updateWorkstreamConfigurationFile(input: {
  graphPath: string;
  content: string;
  projectKey: string;
  workstreamId: string;
  configuration: WorkstreamConfigurationUpdateInput;
  now?: () => Date;
}): Promise<WorkstreamConfigurationUpdateResult> {
  const configurationRecord = input.configuration as Record<string, unknown>;
  const record = assertConfigurableGraphContent(
    input.content,
    input.graphPath,
    input.projectKey,
    input.workstreamId,
  );
  const existingWorkstream = parseWorkstreamDocument(input.content);

  const presentationConfigured = hasOwn(configurationRecord, "presentation");
  if (presentationConfigured) {
    applyPresentation(record, normalizePresentation(input.configuration.presentation));
  }

  if (hasOwn(configurationRecord, "launchPolicy")) {
    const nextPolicy = normalizeLaunchPolicy(input.configuration.launchPolicy);
    if (nextPolicy) {
      record.launchPolicy = nextPolicy;
    } else {
      delete record.launchPolicy;
    }
  }

  if (hasOwn(configurationRecord, "launchDefaults")) {
    const nextDefaults = normalizeLaunchDefaults(input.configuration.launchDefaults);
    if (nextDefaults.launchDefaults) {
      record.launchDefaults = nextDefaults.launchDefaults;
    } else {
      delete record.launchDefaults;
    }
    if (!presentationConfigured) {
      mergePresentationColor(record, nextDefaults.migratedPresentationColor);
    }
  }

  if (!presentationConfigured) {
    mergePresentationColor(record, existingWorkstream.presentation?.color ?? undefined);
  }
  deleteLegacyTerminalColor(record);

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
