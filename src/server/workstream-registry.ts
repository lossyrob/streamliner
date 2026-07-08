import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  WORKSTREAM_REGISTRY_SCHEMA_VERSION,
  type WorkstreamFileStatus,
  type WorkstreamRegistryDocument,
  type WorkstreamRegistryEntry,
  type WorkstreamRegistryListEntry,
  type WorkstreamRegistryWarning,
} from "../workstream-registry-contract";
import type { WorkstreamDocument, WorkstreamPresentation } from "../workstream-schema";
import { parseWorkstreamDocument } from "../workstream-view-model";
import { RECENTS_PATH, readGraphFile, statGraphFile } from "./local-files";

export const WORKSTREAM_REGISTRY_PATH = resolve(
  homedir(),
  ".streamliner",
  "state",
  "workstream-registry",
  "workstreams.json",
);

interface LegacyRecentEntry {
  path: string;
  title?: string;
  id?: string;
  lastOpened?: string;
}

export interface WorkstreamRegistryOptions {
  registryPath?: string;
  sourceRegistryPath?: string;
  recentsPath?: string;
  workstreamPositionsRoot?: string;
  now?: () => Date;
}

interface WorkstreamGraphSummary {
  projectKey: string;
  workstreamId: string;
  title: string;
  summary: string;
  presentation?: WorkstreamPresentation;
}

type NodeError = Error & { code?: string };

let mutationQueue: Promise<void> = Promise.resolve();

function nowIso(options: WorkstreamRegistryOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function registryPath(options: WorkstreamRegistryOptions): string {
  return options.registryPath ?? WORKSTREAM_REGISTRY_PATH;
}

function recentsPath(options: WorkstreamRegistryOptions): string {
  return options.recentsPath ?? RECENTS_PATH;
}

function registryKey(projectKey: string, workstreamId: string): string {
  return `${projectKey}/${workstreamId}`;
}

function emptyRegistry(): WorkstreamRegistryDocument {
  return {
    version: WORKSTREAM_REGISTRY_SCHEMA_VERSION,
    migrationWarnings: [],
    workstreams: [],
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeError).code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string.`);
  }
  return value;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

async function readRegistryFile(
  options: WorkstreamRegistryOptions,
): Promise<WorkstreamRegistryDocument | null> {
  try {
    const raw = await readFile(registryPath(options), "utf-8");
    const parsed = JSON.parse(raw) as Partial<WorkstreamRegistryDocument>;
    return {
      version: WORKSTREAM_REGISTRY_SCHEMA_VERSION,
      migratedFromRecentsAt: parsed.migratedFromRecentsAt,
      migrationWarnings: Array.isArray(parsed.migrationWarnings)
        ? parsed.migrationWarnings
        : [],
      workstreams: Array.isArray(parsed.workstreams)
        ? parsed.workstreams.filter(isRegistryEntry)
        : [],
    };
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function writeRegistryFile(
  registry: WorkstreamRegistryDocument,
  options: WorkstreamRegistryOptions,
): Promise<void> {
  const targetPath = registryPath(options);
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(registry, null, 2), "utf-8");
  await rename(tempPath, targetPath);
}

async function withRegistryMutation<T>(operation: () => Promise<T>): Promise<T> {
  const prior = mutationQueue;
  let release: () => void = () => {};
  mutationQueue = new Promise<void>((resolveQueue) => {
    release = resolveQueue;
  });
  await prior.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
  }
}

function isRegistryEntry(value: unknown): value is WorkstreamRegistryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Partial<Record<keyof WorkstreamRegistryEntry, unknown>>;
  return (
    typeof entry.projectKey === "string" &&
    typeof entry.workstreamId === "string" &&
    typeof entry.title === "string" &&
    typeof entry.summary === "string" &&
    typeof entry.path === "string" &&
    typeof entry.addedAt === "string" &&
    typeof entry.lastOpenedAt === "string"
  );
}

function validateRouteSegment(value: string, label: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    const error = new Error(`Expected ${label} to be a kebab-case id.`);
    (error as NodeError).code = "EINVAL";
    throw error;
  }
}

function deriveProjectKey(workstream: WorkstreamDocument): string {
  if (workstream.projectKey) {
    return workstream.projectKey;
  }
  if (workstream.repos.length === 1) {
    return workstream.repos[0].id;
  }
  const primaryRepos = workstream.repos.filter((repo) => repo.role === "primary");
  if (primaryRepos.length === 1) {
    return primaryRepos[0].id;
  }
  return workstream.id;
}

function summarizeWorkstream(workstream: WorkstreamDocument): WorkstreamGraphSummary {
  const projectKey = deriveProjectKey(workstream);
  validateRouteSegment(projectKey, "workstream projectKey");
  validateRouteSegment(workstream.id, "workstream id");
  return {
    projectKey,
    workstreamId: workstream.id,
    title: workstream.title,
    summary: workstream.summary,
    presentation: workstream.presentation,
  };
}

async function summarizeGraphFile(absPath: string): Promise<WorkstreamGraphSummary> {
  const graph = await readGraphFile(absPath);
  return summarizeWorkstream(parseWorkstreamDocument(graph.content));
}

function deriveLegacyProjectKey(record: Record<string, unknown>, workstreamId: string): string {
  const projectKey = optionalNonEmptyString(record.projectKey);
  if (projectKey) {
    return projectKey;
  }

  const repos = Array.isArray(record.repos) ? record.repos.filter(isRecord) : [];
  const repoIds = repos
    .map((repo) => optionalNonEmptyString(repo.id))
    .filter((id): id is string => Boolean(id));
  if (repoIds.length === 1) {
    return repoIds[0];
  }

  const primaryRepoIds = repos
    .filter((repo) => repo.role === "primary")
    .map((repo) => optionalNonEmptyString(repo.id))
    .filter((id): id is string => Boolean(id));
  if (primaryRepoIds.length === 1) {
    return primaryRepoIds[0];
  }

  return workstreamId;
}

function summarizeLegacyGraphContent(
  content: string,
  legacyEntry?: LegacyRecentEntry,
): WorkstreamGraphSummary {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Expected legacy workstream graph JSON to be an object.");
  }

  const workstreamId = nonEmptyString(parsed.id, "workstream.id");
  const projectKey = deriveLegacyProjectKey(parsed, workstreamId);
  validateRouteSegment(projectKey, "workstream projectKey");
  validateRouteSegment(workstreamId, "workstream id");

  const title =
    optionalNonEmptyString(parsed.title) ??
    optionalNonEmptyString(legacyEntry?.title) ??
    workstreamId;
  return {
    projectKey,
    workstreamId,
    title,
    summary: optionalNonEmptyString(parsed.summary) ?? title,
  };
}

async function summarizeLegacyGraphFile(
  absPath: string,
  legacyEntry?: LegacyRecentEntry,
): Promise<WorkstreamGraphSummary> {
  const graph = await readGraphFile(absPath);
  try {
    return summarizeWorkstream(parseWorkstreamDocument(graph.content));
  } catch {
    return summarizeLegacyGraphContent(graph.content, legacyEntry);
  }
}

async function readLegacyRecents(
  options: WorkstreamRegistryOptions,
): Promise<{ entries: LegacyRecentEntry[]; warning?: WorkstreamRegistryWarning }> {
  try {
    await access(recentsPath(options), fsConstants.F_OK);
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return { entries: [] };
    }
    return {
      entries: [],
      warning: {
        code: "legacy-recents-unreadable",
        message: error instanceof Error ? error.message : String(error),
        path: recentsPath(options),
      },
    };
  }

  try {
    const raw = await readFile(recentsPath(options), "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        entries: [],
        warning: {
          code: "legacy-recents-invalid",
          message: "Legacy recent graphs file was not an array.",
          path: recentsPath(options),
        },
      };
    }
    return {
      entries: parsed.filter((entry): entry is LegacyRecentEntry =>
        Boolean(entry) && typeof entry === "object" && typeof (entry as LegacyRecentEntry).path === "string",
      ),
    };
  } catch (error: unknown) {
    return {
      entries: [],
      warning: {
        code: "legacy-recents-invalid",
        message: error instanceof Error ? error.message : String(error),
        path: recentsPath(options),
      },
    };
  }
}

async function migrateLegacyRecents(
  registry: WorkstreamRegistryDocument,
  options: WorkstreamRegistryOptions,
): Promise<WorkstreamRegistryDocument> {
  if (registry.migratedFromRecentsAt) {
    return registry;
  }

  const migrationWarnings = [...registry.migrationWarnings];
  const { entries, warning } = await readLegacyRecents(options);
  if (warning) {
    migrationWarnings.push(warning);
  }

  const migrated = [...registry.workstreams];
  const keys = new Set(migrated.map((entry) => registryKey(entry.projectKey, entry.workstreamId)));
  const paths = new Set(migrated.map((entry) => resolve(entry.path).toLowerCase()));

  for (const entry of entries) {
    const absPath = resolve(entry.path);
    if (paths.has(absPath.toLowerCase())) {
      continue;
    }

    try {
      const summary = await summarizeLegacyGraphFile(absPath, entry);
      const key = registryKey(summary.projectKey, summary.workstreamId);
      if (keys.has(key)) {
        migrationWarnings.push({
          code: "legacy-recents-identity-conflict",
          message: `Skipped legacy recent graph because '${key}' is already registered.`,
          path: absPath,
          projectKey: summary.projectKey,
          workstreamId: summary.workstreamId,
        });
        continue;
      }

      const timestamp = entry.lastOpened && !Number.isNaN(Date.parse(entry.lastOpened))
        ? entry.lastOpened
        : nowIso(options);
      migrated.push({
        ...summary,
        path: absPath,
        addedAt: timestamp,
        lastOpenedAt: timestamp,
      });
      keys.add(key);
      paths.add(absPath.toLowerCase());
    } catch (error: unknown) {
      migrationWarnings.push({
        code: isNotFound(error) ? "legacy-recents-graph-missing" : "legacy-recents-graph-unreadable",
        message: error instanceof Error ? error.message : String(error),
        path: absPath,
      });
    }
  }

  return {
    ...registry,
    migratedFromRecentsAt: nowIso(options),
    migrationWarnings,
    workstreams: migrated,
  };
}

async function repairLegacyMigrationWarnings(
  registry: WorkstreamRegistryDocument,
  options: WorkstreamRegistryOptions,
): Promise<{
  registry: WorkstreamRegistryDocument;
  changed: boolean;
}> {
  const migrationWarnings: WorkstreamRegistryWarning[] = [];
  const workstreams = [...registry.workstreams];
  const keys = new Set(workstreams.map((entry) => registryKey(entry.projectKey, entry.workstreamId)));
  const paths = new Set(workstreams.map((entry) => resolve(entry.path).toLowerCase()));
  let changed = false;

  for (const warning of registry.migrationWarnings) {
    if (warning.code !== "legacy-recents-graph-unreadable" || !warning.path) {
      migrationWarnings.push(warning);
      continue;
    }

    const absPath = resolve(warning.path);
    if (paths.has(absPath.toLowerCase())) {
      changed = true;
      continue;
    }

    try {
      const summary = await summarizeLegacyGraphFile(absPath);
      const key = registryKey(summary.projectKey, summary.workstreamId);
      if (keys.has(key)) {
        migrationWarnings.push(warning);
        continue;
      }
      const timestamp = registry.migratedFromRecentsAt ?? nowIso(options);
      workstreams.push({
        ...summary,
        path: absPath,
        addedAt: timestamp,
        lastOpenedAt: timestamp,
      });
      keys.add(key);
      paths.add(absPath.toLowerCase());
      changed = true;
    } catch (error: unknown) {
      if (isNotFound(error)) {
        changed = true;
        continue;
      }
      migrationWarnings.push(warning);
    }
  }

  return {
    registry: changed ? { ...registry, migrationWarnings, workstreams } : registry,
    changed,
  };
}

async function readMigratedRegistry(
  options: WorkstreamRegistryOptions,
): Promise<WorkstreamRegistryDocument> {
  return withRegistryMutation(async () => {
    const existing = await readRegistryFile(options);
    const migrated = await migrateLegacyRecents(existing ?? emptyRegistry(), options);
    const { registry, changed } = await repairLegacyMigrationWarnings(migrated, options);
    if (!existing || !existing.migratedFromRecentsAt || changed) {
      await writeRegistryFile(registry, options);
    }
    return registry;
  });
}

async function fileStatusForPath(absPath: string): Promise<{
  fileStatus: WorkstreamFileStatus;
  lastError?: string;
}> {
  try {
    await stat(absPath);
    return { fileStatus: "available" };
  } catch (error: unknown) {
    return {
      fileStatus: isNotFound(error) ? "missing" : "unreadable",
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadWorkstreamRegistry(
  options: WorkstreamRegistryOptions = {},
): Promise<WorkstreamRegistryDocument> {
  return readMigratedRegistry(options);
}

export async function listRegisteredWorkstreams(
  options: WorkstreamRegistryOptions = {},
): Promise<{
  registry: WorkstreamRegistryDocument;
  workstreams: WorkstreamRegistryListEntry[];
}> {
  const registry = await loadWorkstreamRegistry(options);
  const workstreams = await Promise.all(
    registry.workstreams.map(async (entry) => ({
      ...entry,
      ...(await fileStatusForPath(entry.path)),
    })),
  );
  return { registry, workstreams };
}

export function findRegisteredWorkstream(
  registry: WorkstreamRegistryDocument,
  projectKey: string,
  workstreamId: string,
): WorkstreamRegistryEntry | undefined {
  return registry.workstreams.find(
    (entry) => entry.projectKey === projectKey && entry.workstreamId === workstreamId,
  );
}

export async function registerWorkstreamPath(
  graphPath: string,
  options: WorkstreamRegistryOptions = {},
): Promise<WorkstreamRegistryEntry> {
  return withRegistryMutation(async () => {
    const registry = await migrateLegacyRecents(await readRegistryFile(options) ?? emptyRegistry(), options);
    const absPath = resolve(graphPath);
    const summary = await summarizeGraphFile(absPath);
    const key = registryKey(summary.projectKey, summary.workstreamId);
    const existingByKey = registry.workstreams.find(
      (entry) => registryKey(entry.projectKey, entry.workstreamId) === key,
    );
    if (existingByKey && resolve(existingByKey.path).toLowerCase() !== absPath.toLowerCase()) {
      const error = new Error(`Workstream '${key}' is already registered at ${existingByKey.path}.`);
      (error as NodeError).code = "EEXIST";
      throw error;
    }

    const timestamp = nowIso(options);
    const filtered = registry.workstreams.filter(
      (entry) =>
        registryKey(entry.projectKey, entry.workstreamId) === key ||
        resolve(entry.path).toLowerCase() !== absPath.toLowerCase(),
    );
    const current = filtered.find((entry) => registryKey(entry.projectKey, entry.workstreamId) === key);
    const nextEntry: WorkstreamRegistryEntry = {
      ...summary,
      path: absPath,
      addedAt: current?.addedAt ?? timestamp,
      lastOpenedAt: timestamp,
    };
    const nextRegistry = {
      ...registry,
      migratedFromRecentsAt: registry.migratedFromRecentsAt ?? timestamp,
      workstreams: [
        nextEntry,
        ...filtered.filter((entry) => registryKey(entry.projectKey, entry.workstreamId) !== key),
      ],
    };
    await writeRegistryFile(nextRegistry, options);
    return nextEntry;
  });
}

export async function relinkRegisteredWorkstream(
  projectKey: string,
  workstreamId: string,
  graphPath: string,
  options: WorkstreamRegistryOptions = {},
): Promise<WorkstreamRegistryEntry> {
  validateRouteSegment(projectKey, "projectKey");
  validateRouteSegment(workstreamId, "workstreamId");

  return withRegistryMutation(async () => {
    const registry = await migrateLegacyRecents(await readRegistryFile(options) ?? emptyRegistry(), options);
    const existing = findRegisteredWorkstream(registry, projectKey, workstreamId);
    if (!existing) {
      const error = new Error(`Workstream '${registryKey(projectKey, workstreamId)}' is not registered.`);
      (error as NodeError).code = "ENOENT";
      throw error;
    }

    const absPath = resolve(graphPath);
    const summary = await summarizeGraphFile(absPath);
    if (summary.projectKey !== projectKey || summary.workstreamId !== workstreamId) {
      const error = new Error(
        `Relink target has identity '${registryKey(summary.projectKey, summary.workstreamId)}', expected '${registryKey(projectKey, workstreamId)}'.`,
      );
      (error as NodeError).code = "EIDMISMATCH";
      throw error;
    }

    const timestamp = nowIso(options);
    const nextEntry: WorkstreamRegistryEntry = {
      ...summary,
      path: absPath,
      addedAt: existing.addedAt,
      lastOpenedAt: timestamp,
    };
    await writeRegistryFile({
      ...registry,
      workstreams: [
        nextEntry,
        ...registry.workstreams.filter(
          (entry) =>
            !(entry.projectKey === projectKey && entry.workstreamId === workstreamId) &&
            resolve(entry.path).toLowerCase() !== absPath.toLowerCase(),
        ),
      ],
    }, options);
    return nextEntry;
  });
}

export async function touchRegisteredWorkstream(
  projectKey: string,
  workstreamId: string,
  options: WorkstreamRegistryOptions = {},
): Promise<WorkstreamRegistryEntry | undefined> {
  return withRegistryMutation(async () => {
    const registry = await migrateLegacyRecents(await readRegistryFile(options) ?? emptyRegistry(), options);
    const existing = findRegisteredWorkstream(registry, projectKey, workstreamId);
    if (!existing) {
      return undefined;
    }
    const nextEntry = { ...existing, lastOpenedAt: nowIso(options) };
    await writeRegistryFile({
      ...registry,
      workstreams: [
        nextEntry,
        ...registry.workstreams.filter(
          (entry) => !(entry.projectKey === projectKey && entry.workstreamId === workstreamId),
        ),
      ],
    }, options);
    return nextEntry;
  });
}

export async function deleteRegisteredWorkstream(
  projectKey: string,
  workstreamId: string,
  options: WorkstreamRegistryOptions = {},
): Promise<boolean> {
  validateRouteSegment(projectKey, "projectKey");
  validateRouteSegment(workstreamId, "workstreamId");

  return withRegistryMutation(async () => {
    const registry = await migrateLegacyRecents(await readRegistryFile(options) ?? emptyRegistry(), options);
    const nextWorkstreams = registry.workstreams.filter(
      (entry) => !(entry.projectKey === projectKey && entry.workstreamId === workstreamId),
    );
    if (nextWorkstreams.length === registry.workstreams.length) {
      return false;
    }
    await writeRegistryFile({ ...registry, workstreams: nextWorkstreams }, options);
    return true;
  });
}

export async function registeredEntryWithStatus(
  entry: WorkstreamRegistryEntry,
): Promise<WorkstreamRegistryListEntry> {
  return {
    ...entry,
    ...(await fileStatusForPath(entry.path)),
  };
}

export async function readRegisteredGraph(
  projectKey: string,
  workstreamId: string,
  options: WorkstreamRegistryOptions = {},
  ifModifiedSince?: string,
): Promise<{
  entry: WorkstreamRegistryEntry;
  content?: string;
  lastModified: string;
  mtimeMs: number;
  notModified: boolean;
}> {
  validateRouteSegment(projectKey, "projectKey");
  validateRouteSegment(workstreamId, "workstreamId");

  const registry = await loadWorkstreamRegistry(options);
  const entry = findRegisteredWorkstream(registry, projectKey, workstreamId);
  if (!entry) {
    const error = new Error(`Workstream '${registryKey(projectKey, workstreamId)}' is not registered.`);
    (error as NodeError).code = "ENOTREGISTERED";
    throw error;
  }

  const graphInfo = await statGraphFile(entry.path);
  if (
    ifModifiedSince &&
    new Date(ifModifiedSince).getTime() >= graphInfo.mtimeMs
  ) {
    return {
      entry,
      lastModified: graphInfo.lastModified,
      mtimeMs: graphInfo.mtimeMs,
      notModified: true,
    };
  }

  const graph = await readGraphFile(entry.path, graphInfo);
  try {
    parseWorkstreamDocument(graph.content);
  } catch (error: unknown) {
    const invalidGraphError = new Error(error instanceof Error ? error.message : String(error));
    (invalidGraphError as NodeError).code = "EINVALIDGRAPH";
    throw invalidGraphError;
  }
  await touchRegisteredWorkstream(projectKey, workstreamId, options);
  return {
    entry,
    content: graph.content,
    lastModified: graph.lastModified,
    mtimeMs: graph.mtimeMs,
    notModified: false,
  };
}
