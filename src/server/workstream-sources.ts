import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  WORKSTREAM_SOURCE_REGISTRY_SCHEMA_VERSION,
  type ArchivedWorkstreamIdentity,
  type WorkstreamConflict,
  type WorkstreamConflictCandidate,
  type WorkstreamRegistryEntry,
  type WorkstreamRegistryListEntry,
  type WorkstreamRegistrySource,
  type WorkstreamScanMessage,
  type WorkstreamSourceConfig,
  type WorkstreamSourceHealth,
  type WorkstreamSourceListEntry,
  type WorkstreamSourceRegistryDocument,
  type WorkstreamSourceType,
} from "../workstream-registry-contract";
import { summarizeWorkstreamDocument } from "../workstream-identity";
import { parseWorkstreamDocument } from "../workstream-view-model";
import { getApiLogger } from "./logger";
import { readGraphFile, statGraphFile } from "./local-files";

export const WORKSTREAM_SOURCE_REGISTRY_PATH = resolve(
  homedir(),
  ".streamliner",
  "state",
  "workstream-registry",
  "sources.json",
);

export interface WorkstreamSourceRegistryOptions {
  sourceRegistryPath?: string;
  now?: () => Date;
}

export interface WorkstreamSourceAddRequest {
  type: WorkstreamSourceType;
  path: string;
}

export interface CombinedWorkstreamList {
  workstreams: WorkstreamRegistryListEntry[];
  archivedWorkstreams: WorkstreamRegistryListEntry[];
  sources: WorkstreamSourceListEntry[];
  conflicts: WorkstreamConflict[];
}

interface Candidate extends WorkstreamRegistryListEntry {
  selected?: boolean;
}

type NodeError = Error & { code?: string };

let mutationQueue: Promise<void> = Promise.resolve();
const initiallyScannedRegistryPaths = new Set<string>();
const tempCleanupRegistryPaths = new Set<string>();
const sourceLogger = getApiLogger().withScope("workstream-sources");

function nowIso(options: WorkstreamSourceRegistryOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function sourceRegistryPath(options: WorkstreamSourceRegistryOptions): string {
  return options.sourceRegistryPath ?? WORKSTREAM_SOURCE_REGISTRY_PATH;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeError).code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function registryKey(entry: { projectKey: string; workstreamId: string }): string {
  return `${entry.projectKey}/${entry.workstreamId}`;
}

function pathKey(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sourceIdFor(type: WorkstreamSourceType, absPath: string): string {
  const hash = createHash("sha1")
    .update(`${type}\0${pathKey(absPath)}`)
    .digest("hex")
    .slice(0, 12);
  return `${type}-${hash}`;
}

function emptySourceRegistry(): WorkstreamSourceRegistryDocument {
  return {
    version: WORKSTREAM_SOURCE_REGISTRY_SCHEMA_VERSION,
    sources: [],
    archivedWorkstreams: [],
    discoveredWorkstreams: [],
  };
}

function isSourceType(value: unknown): value is WorkstreamSourceType {
  return value === "project-root" || value === "workstreams-root";
}

function isSourceConfig(value: unknown): value is WorkstreamSourceConfig {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    isSourceType(value.type) &&
    typeof value.path === "string" &&
    typeof value.addedAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isArchivedIdentity(value: unknown): value is ArchivedWorkstreamIdentity {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.projectKey === "string" &&
    typeof value.workstreamId === "string" &&
    typeof value.archivedAt === "string"
  );
}

function isDiscoveredEntry(value: unknown): value is WorkstreamRegistryEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.source === "source" &&
    typeof value.sourceId === "string" &&
    isSourceType(value.sourceType) &&
    typeof value.sourcePath === "string" &&
    typeof value.projectKey === "string" &&
    typeof value.workstreamId === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.path === "string" &&
    typeof value.addedAt === "string" &&
    typeof value.lastOpenedAt === "string"
  );
}

async function withSourceMutation<T>(operation: () => Promise<T>): Promise<T> {
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

async function readSourceRegistryFile(
  options: WorkstreamSourceRegistryOptions,
): Promise<WorkstreamSourceRegistryDocument> {
  try {
    await cleanupStaleTempFiles(options);
    const raw = await readFile(sourceRegistryPath(options), "utf-8");
    const parsed = JSON.parse(raw) as Partial<WorkstreamSourceRegistryDocument>;
    if (
      typeof parsed.version === "number" &&
      parsed.version !== WORKSTREAM_SOURCE_REGISTRY_SCHEMA_VERSION
    ) {
      sourceLogger.warn("source registry schema version mismatch", {
        path: sourceRegistryPath(options),
        actualVersion: parsed.version,
        expectedVersion: WORKSTREAM_SOURCE_REGISTRY_SCHEMA_VERSION,
      });
    }
    const rawSources = Array.isArray(parsed.sources) ? parsed.sources : [];
    const sources = rawSources.filter(isSourceConfig);
    const rawArchived = Array.isArray(parsed.archivedWorkstreams) ? parsed.archivedWorkstreams : [];
    const archivedWorkstreams = rawArchived.filter(isArchivedIdentity);
    const rawDiscovered = Array.isArray(parsed.discoveredWorkstreams) ? parsed.discoveredWorkstreams : [];
    const discoveredWorkstreams = rawDiscovered.filter(isDiscoveredEntry);
    const droppedCount =
      rawSources.length - sources.length +
      rawArchived.length - archivedWorkstreams.length +
      rawDiscovered.length - discoveredWorkstreams.length;
    if (droppedCount > 0) {
      sourceLogger.warn("dropped invalid source registry entries", {
        path: sourceRegistryPath(options),
        droppedCount,
      });
    }
    return {
      version: WORKSTREAM_SOURCE_REGISTRY_SCHEMA_VERSION,
      sources,
      archivedWorkstreams,
      discoveredWorkstreams,
    };
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return emptySourceRegistry();
    }
    throw error;
  }
}

async function cleanupStaleTempFiles(options: WorkstreamSourceRegistryOptions): Promise<void> {
  const targetPath = sourceRegistryPath(options);
  if (tempCleanupRegistryPaths.has(targetPath)) {
    return;
  }
  tempCleanupRegistryPaths.add(targetPath);
  try {
    const targetDir = dirname(targetPath);
    const targetName = basename(targetPath);
    const cutoffMs = Date.now() - 60_000;
    const entries = await readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(`${targetName}.`) || !entry.name.endsWith(".tmp")) {
        continue;
      }
      const fullPath = join(targetDir, entry.name);
      try {
        const fileInfo = await stat(fullPath);
        if (fileInfo.mtimeMs < cutoffMs) {
          await unlink(fullPath);
          sourceLogger.warn("removed stale source registry temp file", { path: fullPath });
        }
      } catch (error: unknown) {
        sourceLogger.warn("failed to inspect source registry temp file", { path: fullPath, err: error });
      }
    }
  } catch (error: unknown) {
    if (!isNotFound(error)) {
      sourceLogger.warn("failed to clean source registry temp files", {
        path: targetPath,
        err: error,
      });
    }
  }
}

async function writeSourceRegistryFile(
  registry: WorkstreamSourceRegistryDocument,
  options: WorkstreamSourceRegistryOptions,
): Promise<void> {
  const targetPath = sourceRegistryPath(options);
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(registry, null, 2), "utf-8");
    await rename(tempPath, targetPath);
  } catch (error: unknown) {
    try {
      await unlink(tempPath);
    } catch {
      // Best effort cleanup; preserve the original write/rename error.
    }
    throw error;
  }
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath, fsConstants.F_OK);
    return true;
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function ensureDirectory(absPath: string, messagePath: string = absPath): Promise<void> {
  const info = await stat(absPath);
  if (!info.isDirectory()) {
    const error = new Error(`Expected source path to be a directory: ${messagePath}`);
    (error as NodeError).code = "ENOTDIR";
    throw error;
  }
}

function sourceScanRoot(source: WorkstreamSourceConfig): string {
  return source.type === "project-root"
    ? join(source.path, ".streamliner", "workstreams")
    : source.path;
}

function scanMessage(
  code: string,
  severity: "warning" | "error",
  message: string,
  details: Partial<WorkstreamScanMessage> = {},
): WorkstreamScanMessage {
  return { code, severity, message, ...details };
}

async function listCandidateGraphPaths(source: WorkstreamSourceConfig): Promise<{
  root: string;
  graphPaths: string[];
  messages: WorkstreamScanMessage[];
  health: WorkstreamSourceHealth;
}> {
  const root = sourceScanRoot(source);
  try {
    await ensureDirectory(source.path);
  } catch (error: unknown) {
    return {
      root,
      graphPaths: [],
      health: isNotFound(error) ? "missing" : "unreadable",
      messages: [
        scanMessage(
          isNotFound(error) ? "source-missing" : "source-unreadable",
          "error",
          error instanceof Error ? error.message : String(error),
          { path: source.path, sourceId: source.id },
        ),
      ],
    };
  }

  try {
    await ensureDirectory(root);
  } catch (error: unknown) {
    return {
      root,
      graphPaths: [],
      health: isNotFound(error) ? "available" : "unreadable",
      messages: [
        scanMessage(
          isNotFound(error) ? "source-scan-root-missing" : "source-scan-root-unreadable",
          isNotFound(error) ? "warning" : "error",
          error instanceof Error ? error.message : String(error),
          { path: root, sourceId: source.id },
        ),
      ],
    };
  }

  const messages: WorkstreamScanMessage[] = [];
  const graphPaths: string[] = [];
  const children = await readdir(root, { withFileTypes: true });
  for (const child of children) {
    if (!child.isDirectory()) {
      continue;
    }
    const graphPath = join(root, child.name, "graph.json");
    if (await pathExists(graphPath)) {
      graphPaths.push(graphPath);
    } else {
      messages.push(scanMessage(
        "workstream-graph-missing",
        "warning",
        `No graph.json found in ${join(root, child.name)}.`,
        { path: graphPath, sourceId: source.id },
      ));
    }
  }
  return { root, graphPaths, health: "available", messages };
}

async function summarizeDiscoveredGraph(
  graphPath: string,
  source: WorkstreamSourceConfig,
  previous: WorkstreamRegistryEntry | undefined,
  timestamp: string,
): Promise<WorkstreamRegistryEntry> {
  const graph = await readGraphFile(graphPath);
  const summary = summarizeWorkstreamDocument(parseWorkstreamDocument(graph.content));
  return {
    source: "source",
    sourceId: source.id,
    sourceType: source.type,
    sourcePath: source.path,
    ...summary,
    path: graphPath,
    addedAt: previous?.addedAt ?? timestamp,
    lastOpenedAt: timestamp,
  };
}

function staleDiscoveredEntry(
  previous: WorkstreamRegistryEntry,
  timestamp: string,
): WorkstreamRegistryEntry {
  return {
    ...previous,
    lastOpenedAt: timestamp,
    archived: previous.archived,
    source: "source",
  };
}

async function scanSource(
  source: WorkstreamSourceConfig,
  previousEntries: WorkstreamRegistryEntry[],
  timestamp: string,
): Promise<{
  source: WorkstreamSourceConfig;
  entries: WorkstreamRegistryEntry[];
  messages: WorkstreamScanMessage[];
}> {
  const { graphPaths, health, messages } = await listCandidateGraphPaths(source);
  const previousByPath = new Map(previousEntries.map((entry) => [pathKey(entry.path), entry]));
  const seenPaths = new Set<string>();
  const entries: WorkstreamRegistryEntry[] = [];

  for (const graphPath of graphPaths.sort((left, right) => left.localeCompare(right))) {
    const normalizedPath = pathKey(graphPath);
    seenPaths.add(normalizedPath);
    try {
      entries.push(await summarizeDiscoveredGraph(
        graphPath,
        source,
        previousByPath.get(normalizedPath),
        timestamp,
      ));
    } catch (error: unknown) {
      const previous = previousByPath.get(normalizedPath);
      const code = isNotFound(error) ? "workstream-graph-missing" : "workstream-graph-invalid";
      const message = error instanceof Error ? error.message : String(error);
      messages.push(scanMessage(code, "error", message, {
        path: graphPath,
        sourceId: source.id,
        projectKey: previous?.projectKey,
        workstreamId: previous?.workstreamId,
      }));
      if (previous) {
        entries.push(staleDiscoveredEntry(
          previous,
          timestamp,
        ));
      }
    }
  }

  for (const previous of previousEntries) {
    if (!seenPaths.has(pathKey(previous.path))) {
      messages.push(scanMessage(
        "workstream-graph-missing",
        "warning",
        `Previously discovered graph is missing: ${previous.path}`,
        {
          path: previous.path,
          sourceId: source.id,
          projectKey: previous.projectKey,
          workstreamId: previous.workstreamId,
        },
      ));
      entries.push(staleDiscoveredEntry(
        previous,
        timestamp,
      ));
    }
  }

  return {
    source: {
      ...source,
      updatedAt: source.updatedAt,
      lastScanAt: timestamp,
      health,
      discoveredCount: entries.filter((entry) => !entry.archived).length,
      messages,
    },
    entries,
    messages,
  };
}

async function scanSourcesLocked(
  registry: WorkstreamSourceRegistryDocument,
  options: WorkstreamSourceRegistryOptions,
  reason: string,
): Promise<WorkstreamSourceRegistryDocument> {
  const timestamp = nowIso(options);
  const startedAt = Date.now();
  const entries: WorkstreamRegistryEntry[] = [];
  const sources: WorkstreamSourceConfig[] = [];
  sourceLogger.debug("source scan started", {
    reason,
    sourceCount: registry.sources.length,
    path: sourceRegistryPath(options),
  });

  for (const source of registry.sources) {
    const previousEntries = registry.discoveredWorkstreams.filter((entry) => entry.sourceId === source.id);
    const scan = await scanSource(source, previousEntries, timestamp);
    sources.push(scan.source);
    entries.push(...scan.entries);
    for (const message of scan.messages) {
      const fields = {
        reason,
        sourceId: source.id,
        sourceType: source.type,
        sourcePath: source.path,
        code: message.code,
        path: message.path,
        projectKey: message.projectKey,
        workstreamId: message.workstreamId,
      };
      if (message.severity === "error") {
        sourceLogger.error(message.message, fields);
      } else {
        sourceLogger.warn(message.message, fields);
      }
    }
  }

  const nextRegistry = {
    ...registry,
    sources,
    discoveredWorkstreams: entries,
  };
  await writeSourceRegistryFile(nextRegistry, options);
  initiallyScannedRegistryPaths.add(sourceRegistryPath(options));
  sourceLogger.info("source scan completed", {
    reason,
    sourceCount: sources.length,
    discoveredCount: entries.length,
    durationMs: Date.now() - startedAt,
    path: sourceRegistryPath(options),
  });
  return nextRegistry;
}

async function scanSingleSourceLocked(
  registry: WorkstreamSourceRegistryDocument,
  source: WorkstreamSourceConfig,
  options: WorkstreamSourceRegistryOptions,
  reason: string,
): Promise<WorkstreamSourceRegistryDocument> {
  const timestamp = nowIso(options);
  const startedAt = Date.now();
  sourceLogger.debug("single source scan started", {
    reason,
    sourceId: source.id,
    sourceType: source.type,
    sourcePath: source.path,
    path: sourceRegistryPath(options),
  });
  const previousEntries = registry.discoveredWorkstreams.filter((entry) => entry.sourceId === source.id);
  const scan = await scanSource(source, previousEntries, timestamp);
  for (const message of scan.messages) {
    const fields = {
      reason,
      sourceId: source.id,
      sourceType: source.type,
      sourcePath: source.path,
      code: message.code,
      path: message.path,
      projectKey: message.projectKey,
      workstreamId: message.workstreamId,
    };
    if (message.severity === "error") {
      sourceLogger.error(message.message, fields);
    } else {
      sourceLogger.warn(message.message, fields);
    }
  }
  const nextRegistry = {
    ...registry,
    sources: [
      scan.source,
      ...registry.sources.filter((candidate) => candidate.id !== source.id),
    ],
    discoveredWorkstreams: [
      ...scan.entries,
      ...registry.discoveredWorkstreams.filter((entry) => entry.sourceId !== source.id),
    ],
  };
  await writeSourceRegistryFile(nextRegistry, options);
  initiallyScannedRegistryPaths.add(sourceRegistryPath(options));
  sourceLogger.info("single source scan completed", {
    reason,
    sourceId: source.id,
    sourceType: source.type,
    sourcePath: source.path,
    discoveredCount: scan.entries.length,
    durationMs: Date.now() - startedAt,
    path: sourceRegistryPath(options),
  });
  return nextRegistry;
}

async function loadWithInitialScan(
  options: WorkstreamSourceRegistryOptions,
): Promise<WorkstreamSourceRegistryDocument> {
  const targetPath = sourceRegistryPath(options);
  if (initiallyScannedRegistryPaths.has(targetPath)) {
    return readSourceRegistryFile(options);
  }
  return withSourceMutation(async () => {
    const registry = await readSourceRegistryFile(options);
    if (initiallyScannedRegistryPaths.has(targetPath)) {
      return registry;
    }
    if (registry.sources.length === 0) {
      initiallyScannedRegistryPaths.add(targetPath);
      return registry;
    }
    return scanSourcesLocked(registry, options, "initial");
  });
}

function sourceListEntry(source: WorkstreamSourceConfig): WorkstreamSourceListEntry {
  return {
    ...source,
    health: source.health ?? "available",
    discoveredCount: source.discoveredCount ?? 0,
    messages: source.messages ?? [],
  };
}

function isArchived(
  archived: ArchivedWorkstreamIdentity[],
  entry: { projectKey: string; workstreamId: string },
): boolean {
  return archived.some(
    (candidate) =>
      candidate.projectKey === entry.projectKey &&
      candidate.workstreamId === entry.workstreamId,
  );
}

async function discoveredEntryWithStatus(
  entry: WorkstreamRegistryEntry,
): Promise<WorkstreamRegistryListEntry> {
  try {
    await statGraphFile(entry.path);
    return { ...entry, source: "source", fileStatus: "available" };
  } catch (error: unknown) {
    return {
      ...entry,
      source: "source",
      fileStatus: isNotFound(error) ? "missing" : "unreadable",
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

function candidateSort(left: Candidate, right: Candidate): number {
  const leftRank = left.source === "path" || !left.source ? 0 : 1;
  const rightRank = right.source === "path" || !right.source ? 0 : 1;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  if (left.sourceId !== right.sourceId) {
    return (left.sourceId ?? "").localeCompare(right.sourceId ?? "");
  }
  return left.path.localeCompare(right.path);
}

function conflictCandidate(entry: Candidate, selected: boolean): WorkstreamConflictCandidate {
  return {
    source: entry.source ?? "path",
    sourceId: entry.sourceId,
    sourceType: entry.sourceType,
    sourcePath: entry.sourcePath,
    path: entry.path,
    title: entry.title,
    selected,
  };
}

export async function loadWorkstreamSourceRegistry(
  options: WorkstreamSourceRegistryOptions = {},
): Promise<WorkstreamSourceRegistryDocument> {
  return readSourceRegistryFile(options);
}

export async function scanWorkstreamSources(
  options: WorkstreamSourceRegistryOptions = {},
): Promise<WorkstreamSourceRegistryDocument> {
  return withSourceMutation(async () => {
    const registry = await readSourceRegistryFile(options);
    return scanSourcesLocked(registry, options, "refresh");
  });
}

export async function addWorkstreamSource(
  request: WorkstreamSourceAddRequest,
  options: WorkstreamSourceRegistryOptions = {},
): Promise<WorkstreamSourceListEntry> {
  if (!isSourceType(request.type)) {
    const error = new Error("Expected source type to be 'project-root' or 'workstreams-root'.");
    (error as NodeError).code = "EINVAL";
    throw error;
  }
  if (typeof request.path !== "string" || request.path.trim().length === 0) {
    const error = new Error("Expected source path to be a non-empty string.");
    (error as NodeError).code = "EINVAL";
    throw error;
  }
  const absPath = resolve(request.path);
  await ensureDirectory(absPath);

  return withSourceMutation(async () => {
    const registry = await readSourceRegistryFile(options);
    const timestamp = nowIso(options);
    const id = sourceIdFor(request.type, absPath);
    const existing = registry.sources.find((source) => source.id === id);
    const source: WorkstreamSourceConfig = {
      id,
      type: request.type,
      path: absPath,
      addedAt: existing?.addedAt ?? timestamp,
      updatedAt: timestamp,
      lastScanAt: existing?.lastScanAt,
      health: existing?.health,
      discoveredCount: existing?.discoveredCount,
      messages: existing?.messages,
    };
    const nextRegistry = {
      ...registry,
      sources: [
        source,
        ...registry.sources.filter((candidate) => candidate.id !== id),
      ],
    };
    const scanned = await scanSingleSourceLocked(nextRegistry, source, options, "add-source");
    return sourceListEntry(scanned.sources.find((candidate) => candidate.id === id) ?? source);
  });
}

export async function deleteWorkstreamSource(
  sourceId: string,
  options: WorkstreamSourceRegistryOptions = {},
): Promise<boolean> {
  return withSourceMutation(async () => {
    const registry = await readSourceRegistryFile(options);
    const sources = registry.sources.filter((source) => source.id !== sourceId);
    if (sources.length === registry.sources.length) {
      return false;
    }
    await writeSourceRegistryFile({
      ...registry,
      sources,
      discoveredWorkstreams: registry.discoveredWorkstreams.filter((entry) => entry.sourceId !== sourceId),
    }, options);
    initiallyScannedRegistryPaths.add(sourceRegistryPath(options));
    return true;
  });
}

export async function archiveWorkstreamIdentity(
  projectKey: string,
  workstreamId: string,
  options: WorkstreamSourceRegistryOptions = {},
): Promise<void> {
  return withSourceMutation(async () => {
    const registry = await readSourceRegistryFile(options);
    if (isArchived(registry.archivedWorkstreams, { projectKey, workstreamId })) {
      return;
    }
    await writeSourceRegistryFile({
      ...registry,
      archivedWorkstreams: [
        { projectKey, workstreamId, archivedAt: nowIso(options) },
        ...registry.archivedWorkstreams,
      ],
    }, options);
    initiallyScannedRegistryPaths.add(sourceRegistryPath(options));
  });
}

export async function restoreWorkstreamIdentity(
  projectKey: string,
  workstreamId: string,
  options: WorkstreamSourceRegistryOptions = {},
): Promise<boolean> {
  return withSourceMutation(async () => {
    const registry = await readSourceRegistryFile(options);
    const archivedWorkstreams = registry.archivedWorkstreams.filter(
      (entry) => !(entry.projectKey === projectKey && entry.workstreamId === workstreamId),
    );
    if (archivedWorkstreams.length === registry.archivedWorkstreams.length) {
      return false;
    }
    await writeSourceRegistryFile({ ...registry, archivedWorkstreams }, options);
    initiallyScannedRegistryPaths.add(sourceRegistryPath(options));
    return true;
  });
}

export async function combineWorkstreamCandidates(
  pathEntries: WorkstreamRegistryListEntry[],
  options: WorkstreamSourceRegistryOptions = {},
): Promise<CombinedWorkstreamList> {
  const registry = await loadWithInitialScan(options);
  const discovered = await Promise.all(registry.discoveredWorkstreams.map(discoveredEntryWithStatus));
  const candidatesByKey = new Map<string, Candidate[]>();
  for (const entry of [...pathEntries.map((entry) => ({ ...entry, source: entry.source ?? "path" as WorkstreamRegistrySource })), ...discovered]) {
    const key = registryKey(entry);
    const entries = candidatesByKey.get(key) ?? [];
    entries.push(entry);
    candidatesByKey.set(key, entries);
  }

  const active: WorkstreamRegistryListEntry[] = [];
  const archived: WorkstreamRegistryListEntry[] = [];
  const conflicts: WorkstreamConflict[] = [];

  for (const [key, candidates] of candidatesByKey) {
    const sorted = [...candidates].sort(candidateSort);
    const selected = sorted[0];
    const selectedEntry = { ...selected, archived: isArchived(registry.archivedWorkstreams, selected) };
    const target = selectedEntry.archived ? archived : active;
    target.push(selectedEntry);
    if (sorted.length > 1) {
      conflicts.push({
        projectKey: selected.projectKey,
        workstreamId: selected.workstreamId,
        archived: Boolean(selectedEntry.archived),
        message: `Multiple workstream candidates found for '${key}'.`,
        candidates: sorted.map((entry) => conflictCandidate(entry, entry === selected)),
      });
    }
  }

  const sortByLastOpened = (left: WorkstreamRegistryListEntry, right: WorkstreamRegistryListEntry) =>
    Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt) || registryKey(left).localeCompare(registryKey(right));

  return {
    workstreams: active.sort(sortByLastOpened),
    archivedWorkstreams: archived.sort(sortByLastOpened),
    sources: registry.sources.map(sourceListEntry),
    conflicts,
  };
}

export async function readSourceWorkstreamGraph(
  projectKey: string,
  workstreamId: string,
  options: WorkstreamSourceRegistryOptions = {},
  ifModifiedSince?: string,
): Promise<{
  entry: WorkstreamRegistryEntry;
  content?: string;
  lastModified: string;
  mtimeMs: number;
  notModified: boolean;
}> {
  const registry = await loadWithInitialScan(options);
  const candidates = registry.discoveredWorkstreams
    .filter((entry) => entry.projectKey === projectKey && entry.workstreamId === workstreamId)
    .sort((left, right) =>
      (left.sourceId ?? "").localeCompare(right.sourceId ?? "") ||
      left.path.localeCompare(right.path)
    );
  const entry = candidates[0];
  if (!entry) {
    const error = new Error(`Workstream '${projectKey}/${workstreamId}' is not registered.`);
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
    const summary = summarizeWorkstreamDocument(parseWorkstreamDocument(graph.content));
    if (summary.projectKey !== projectKey || summary.workstreamId !== workstreamId) {
      const error = new Error(
        `Workstream graph identity changed to '${summary.projectKey}/${summary.workstreamId}'.`,
      );
      (error as NodeError).code = "ENOTREGISTERED";
      throw error;
    }
  } catch (error: unknown) {
    if (error instanceof Error && (error as NodeError).code === "ENOTREGISTERED") {
      throw error;
    }
    const invalidGraphError = new Error(error instanceof Error ? error.message : String(error));
    (invalidGraphError as NodeError).code = "EINVALIDGRAPH";
    throw invalidGraphError;
  }
  return {
    entry,
    content: graph.content,
    lastModified: graph.lastModified,
    mtimeMs: graph.mtimeMs,
    notModified: false,
  };
}
