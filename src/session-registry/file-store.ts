import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  type ObservedSessionRegistryUpsertInput,
  SESSION_REGISTRY_CHANGE_EVENT_KINDS,
  type SessionRegistryBuilderLifecycleStatus,
  type SessionRegistryChangeEvent,
  type SessionRegistryChangeListener,
  type SessionRegistryListItem,
  type SessionRegistryListOptions,
  type SessionRegistryObservedLinkInput,
  type SessionRegistryPatch,
  type SessionRegistryStore,
  type SessionRegistryUpsertInput,
} from "../session-registry-contract";
import {
  SESSION_REGISTRY_LIFECYCLE_STATUSES,
  SESSION_REGISTRY_ORIGIN_KINDS,
  SESSION_REGISTRY_SCHEMA_VERSION,
  type SessionRegistryGraphBinding,
  type SessionRegistryIndex,
  type SessionRegistryIndexEntry,
  type SessionRegistryLifecycleStatus,
  type SessionRegistryOrigin,
  type SessionRegistryOriginKind,
  type SessionRegistryRecord,
} from "../session-registry-schema";

const DEFAULT_REGISTRY_ROOT = resolve(
  homedir(),
  ".streamliner",
  "state",
  "session-registry",
);

const ENTRY_EXTENSION = ".json";
const SHARED_SLEEP_BUFFER = new SharedArrayBuffer(4);
const SHARED_SLEEP_ARRAY = new Int32Array(SHARED_SLEEP_BUFFER);
const SESSION_REGISTRY_PATCH_KEYS = [
  "title",
  "description",
  "color",
  "lifecycleStatus",
  "tags",
  "graphBinding",
] as const;
const SESSION_REGISTRY_UPSERT_BASE_KEYS = [
  "id",
  "title",
  "description",
  "color",
  "cwd",
  "repo",
  "branch",
  "tags",
  "origin",
  "lifecycleStatus",
  "graphBinding",
] as const;

type StoredSessionRegistryRecord = SessionRegistryRecord & Record<string, unknown>;
type JsonObject = Record<string, unknown>;

export interface SessionRegistryFileStoreOptions {
  rootDir?: string;
}

export function getDefaultSessionRegistryRoot(): string {
  return DEFAULT_REGISTRY_ROOT;
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(SHARED_SLEEP_ARRAY, 0, 0, milliseconds);
}

function renameWithRetries(fromPath: string, toPath: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      renameSync(fromPath, toPath);
      return;
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : "";
      if (code !== "EPERM" && code !== "EACCES") {
        throw error;
      }

      lastError = error;
      sleepSync(25 * (attempt + 1));
    }
  }

  throw lastError;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function isoNow(): string {
  return new Date().toISOString();
}

function ensureString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${fieldName} to be a non-empty string.`);
  }

  return value;
}

function ensureOptionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldName} to be a string or null.`);
  }
  return value;
}

function ensureStringField(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${fieldName} to be a string.`);
  }
  return value;
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function ensureAllowedKeys(
  value: JsonObject,
  fieldName: string,
  allowedKeys: readonly string[],
): void {
  const unexpectedKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`Unexpected ${fieldName} field(s): ${unexpectedKeys.join(", ")}.`);
  }
}

function ensureOptionalGraphBinding(
  value: unknown,
  fieldName: string,
): SessionRegistryGraphBinding | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isJsonObject(value)) {
    throw new Error(`Expected ${fieldName} to be an object or null.`);
  }

  return {
    workstreamId: ensureString(value.workstreamId, `${fieldName}.workstreamId`),
    nodeId: ensureString(value.nodeId, `${fieldName}.nodeId`),
    launchClaimId: ensureOptionalString(
      value.launchClaimId,
      `${fieldName}.launchClaimId`,
    ),
  };
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const next = tag.trim();
    if (next.length === 0 || seen.has(next)) {
      continue;
    }
    seen.add(next);
    normalized.push(next);
  }

  return normalized;
}

function ensureStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected ${fieldName} to be an array of strings.`);
  }
  return normalizeTags(value);
}

function parseStoredOrigin(value: unknown, fieldName: string): SessionRegistryOrigin {
  if (!isJsonObject(value)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }

  const kind = ensureString(value.kind, `${fieldName}.kind`) as SessionRegistryOriginKind;
  if (!SESSION_REGISTRY_ORIGIN_KINDS.includes(kind)) {
    throw new Error(`Unsupported ${fieldName}.kind "${kind}".`);
  }

  if (kind === "manual") {
    return { kind: "manual" };
  }

  if (kind === "observed") {
    return {
      kind: "observed",
      importedFromCopilotSessionId: ensureOptionalString(
        value.importedFromCopilotSessionId,
        `${fieldName}.importedFromCopilotSessionId`,
      ),
    };
  }

  return {
    kind: "launched",
    launchClaimId: ensureOptionalString(
      value.launchClaimId,
      `${fieldName}.launchClaimId`,
    ),
  };
}

function preserveValidatedOrigin(value: unknown, fieldName: string): SessionRegistryOrigin {
  const typedOrigin = parseStoredOrigin(value, fieldName);
  if (!isJsonObject(value)) {
    return typedOrigin;
  }

  return {
    ...(value as JsonObject),
    ...typedOrigin,
  } as SessionRegistryOrigin;
}

function parseInputOrigin(value: unknown, fieldName: string): SessionRegistryOrigin {
  if (!isJsonObject(value)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }

  const kind = ensureString(value.kind, `${fieldName}.kind`) as SessionRegistryOriginKind;
  if (!SESSION_REGISTRY_ORIGIN_KINDS.includes(kind)) {
    throw new Error(`Unsupported ${fieldName}.kind "${kind}".`);
  }

  if (kind === "manual") {
    ensureAllowedKeys(value, fieldName, ["kind"]);
    return { kind: "manual" };
  }

  if (kind === "observed") {
    ensureAllowedKeys(value, fieldName, ["kind", "importedFromCopilotSessionId"]);
    return {
      kind: "observed",
      ...(hasOwn(value, "importedFromCopilotSessionId")
        ? {
            importedFromCopilotSessionId: ensureOptionalString(
              value.importedFromCopilotSessionId,
              `${fieldName}.importedFromCopilotSessionId`,
            ),
          }
        : {}),
    };
  }

  ensureAllowedKeys(value, fieldName, ["kind", "launchClaimId"]);
  return {
    kind: "launched",
    ...(hasOwn(value, "launchClaimId")
      ? {
          launchClaimId: ensureOptionalString(
            value.launchClaimId,
            `${fieldName}.launchClaimId`,
          ),
        }
      : {}),
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLifecycleStatus(value: string): value is SessionRegistryLifecycleStatus {
  return SESSION_REGISTRY_LIFECYCLE_STATUSES.includes(value as SessionRegistryLifecycleStatus);
}

function isObservedUpsertInput(
  input: SessionRegistryUpsertInput,
): input is ObservedSessionRegistryUpsertInput {
  return input.origin.kind === "observed";
}

function parseBuilderLifecycleStatus(
  value: unknown,
  fieldName: string,
): SessionRegistryBuilderLifecycleStatus {
  const lifecycle = ensureString(value, fieldName);
  if (lifecycle !== "active" && lifecycle !== "paused" && lifecycle !== "archived") {
    throw new Error(
      `Builder-managed ${fieldName} must be active, paused, or archived, received ${lifecycle}.`,
    );
  }
  return lifecycle;
}

function parseObservedLifecycleStatus(
  value: unknown,
  fieldName: string,
): Extract<SessionRegistryLifecycleStatus, "active" | "ended"> {
  const lifecycle = ensureString(value, fieldName);
  if (lifecycle !== "active" && lifecycle !== "ended") {
    throw new Error(
      `Observed ${fieldName} must be active or ended, received ${lifecycle}.`,
    );
  }
  return lifecycle;
}

function parseCreateLifecycleStatus(
  value: unknown,
  fieldName: string,
): Extract<SessionRegistryLifecycleStatus, "active" | "paused"> {
  const lifecycle = ensureString(value, fieldName);
  if (lifecycle !== "active" && lifecycle !== "paused") {
    throw new Error(
      `Manual or launched ${fieldName} must be active or paused, received ${lifecycle}.`,
    );
  }
  return lifecycle;
}

export function parseSessionRegistryPatch(value: unknown): SessionRegistryPatch {
  if (!isJsonObject(value)) {
    throw new Error("Expected patch to be a JSON object.");
  }
  ensureAllowedKeys(value, "patch", SESSION_REGISTRY_PATCH_KEYS);

  const patch: SessionRegistryPatch = {};
  if (hasOwn(value, "title")) {
    patch.title = ensureString(value.title, "patch.title");
  }
  if (hasOwn(value, "description")) {
    patch.description = ensureStringField(value.description, "patch.description");
  }
  if (hasOwn(value, "color")) {
    patch.color = ensureOptionalString(value.color, "patch.color");
  }
  if (hasOwn(value, "lifecycleStatus")) {
    patch.lifecycleStatus = parseBuilderLifecycleStatus(
      value.lifecycleStatus,
      "patch.lifecycleStatus",
    );
  }
  if (hasOwn(value, "tags")) {
    patch.tags = ensureStringArray(value.tags, "patch.tags");
  }
  if (hasOwn(value, "graphBinding")) {
    patch.graphBinding = ensureOptionalGraphBinding(
      value.graphBinding,
      "patch.graphBinding",
    );
  }
  return patch;
}

export function parseSessionRegistryUpsertInput(value: unknown): SessionRegistryUpsertInput {
  if (!isJsonObject(value)) {
    throw new Error("Expected input to be a JSON object.");
  }

  const origin = parseInputOrigin(value.origin, "input.origin");
  const common = {
    ...(hasOwn(value, "id") ? { id: ensureString(value.id, "input.id") } : {}),
    title: ensureString(value.title, "input.title"),
    ...(hasOwn(value, "description")
      ? { description: ensureStringField(value.description, "input.description") }
      : {}),
    ...(hasOwn(value, "color")
      ? { color: ensureOptionalString(value.color, "input.color") }
      : {}),
    cwd: ensureString(value.cwd, "input.cwd"),
    ...(hasOwn(value, "repo")
      ? { repo: ensureOptionalString(value.repo, "input.repo") }
      : {}),
    ...(hasOwn(value, "branch")
      ? { branch: ensureOptionalString(value.branch, "input.branch") }
      : {}),
    ...(hasOwn(value, "tags")
      ? { tags: ensureStringArray(value.tags, "input.tags") }
      : {}),
    ...(hasOwn(value, "graphBinding")
      ? {
          graphBinding: ensureOptionalGraphBinding(
            value.graphBinding,
            "input.graphBinding",
          ),
        }
      : {}),
  };

  if (origin.kind === "observed") {
    ensureAllowedKeys(value, "input", [
      ...SESSION_REGISTRY_UPSERT_BASE_KEYS,
      "copilotSessionId",
      "lastSeenAt",
    ]);
    return {
      ...common,
      origin,
      copilotSessionId: ensureString(value.copilotSessionId, "input.copilotSessionId"),
      ...(hasOwn(value, "lastSeenAt")
        ? { lastSeenAt: ensureOptionalString(value.lastSeenAt, "input.lastSeenAt") }
        : {}),
      ...(hasOwn(value, "lifecycleStatus")
        ? {
            lifecycleStatus: parseObservedLifecycleStatus(
              value.lifecycleStatus,
              "input.lifecycleStatus",
            ),
          }
        : {}),
    };
  }

  ensureAllowedKeys(value, "input", SESSION_REGISTRY_UPSERT_BASE_KEYS);
  if (origin.kind === "manual") {
    return {
      ...common,
      origin,
      ...(hasOwn(value, "lifecycleStatus")
        ? {
            lifecycleStatus: parseCreateLifecycleStatus(
              value.lifecycleStatus,
              "input.lifecycleStatus",
            ),
          }
        : {}),
    };
  }

  return {
    ...common,
    origin,
    ...(hasOwn(value, "lifecycleStatus")
      ? {
          lifecycleStatus: parseCreateLifecycleStatus(
            value.lifecycleStatus,
            "input.lifecycleStatus",
          ),
        }
      : {}),
  };
}

function validateStoredRecord(
  rawRecord: unknown,
  filePath: string,
): StoredSessionRegistryRecord {
  if (!isJsonObject(rawRecord)) {
    throw new Error(`Expected ${filePath} to contain an object.`);
  }

  if (rawRecord.schemaVersion !== SESSION_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion in ${filePath}: ${String(rawRecord.schemaVersion)}`,
    );
  }

  const id = ensureString(rawRecord.id, `${filePath}.id`);
  const expectedFileName = `${id}${ENTRY_EXTENSION}`;
  if (basename(filePath) !== expectedFileName) {
    throw new Error(
      `Entry filename ${basename(filePath)} does not match record id ${id}.`,
    );
  }

  const lifecycleStatus = ensureString(
    rawRecord.lifecycleStatus,
    `${filePath}.lifecycleStatus`,
  );
  if (!isLifecycleStatus(lifecycleStatus)) {
    throw new Error(`Unsupported lifecycleStatus "${lifecycleStatus}" in ${filePath}.`);
  }

  const tagsValue = rawRecord.tags;
  if (!Array.isArray(tagsValue) || tagsValue.some((tag) => typeof tag !== "string")) {
    throw new Error(`Expected ${filePath}.tags to be an array of strings.`);
  }

  const origin = preserveValidatedOrigin(rawRecord.origin, `${filePath}.origin`);
  const copilotSessionId = ensureOptionalString(
    rawRecord.copilotSessionId,
    `${filePath}.copilotSessionId`,
  );
  if (origin.kind === "observed" && !copilotSessionId) {
    throw new Error(`Observed record ${filePath} is missing copilotSessionId.`);
  }

  const storedRecord: StoredSessionRegistryRecord = {
    ...rawRecord,
    schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
    id,
    title: ensureString(rawRecord.title, `${filePath}.title`),
    description:
      typeof rawRecord.description === "string" ? rawRecord.description : "",
    color: ensureOptionalString(rawRecord.color, `${filePath}.color`),
    cwd: ensureString(rawRecord.cwd, `${filePath}.cwd`),
    repo: ensureOptionalString(rawRecord.repo, `${filePath}.repo`),
    branch: ensureOptionalString(rawRecord.branch, `${filePath}.branch`),
    copilotSessionId,
    lifecycleStatus,
    lastSeenAt: ensureOptionalString(rawRecord.lastSeenAt, `${filePath}.lastSeenAt`),
    createdAt: ensureString(rawRecord.createdAt, `${filePath}.createdAt`),
    updatedAt: ensureString(rawRecord.updatedAt, `${filePath}.updatedAt`),
    tags: normalizeTags(tagsValue),
    origin,
    graphBinding: (() => {
      const typedGraphBinding = ensureOptionalGraphBinding(
        rawRecord.graphBinding,
        `${filePath}.graphBinding`,
      );
      if (!typedGraphBinding || !isJsonObject(rawRecord.graphBinding)) {
        return typedGraphBinding;
      }

      return {
        ...(rawRecord.graphBinding as JsonObject),
        ...typedGraphBinding,
      } as SessionRegistryGraphBinding;
    })(),
  };

  return storedRecord;
}

function validateIndexEntry(
  rawEntry: unknown,
  fieldName: string,
): SessionRegistryIndexEntry {
  if (!isJsonObject(rawEntry)) {
    throw new Error(`Expected ${fieldName} to be an object.`);
  }

  const lifecycleStatus = ensureString(rawEntry.lifecycleStatus, `${fieldName}.lifecycleStatus`);
  if (!isLifecycleStatus(lifecycleStatus)) {
    throw new Error(`Unsupported ${fieldName}.lifecycleStatus "${lifecycleStatus}".`);
  }

  const originKind = ensureString(rawEntry.originKind, `${fieldName}.originKind`) as SessionRegistryOriginKind;
  if (!SESSION_REGISTRY_ORIGIN_KINDS.includes(originKind)) {
    throw new Error(`Unsupported ${fieldName}.originKind "${originKind}".`);
  }

  return {
    id: ensureString(rawEntry.id, `${fieldName}.id`),
    title: ensureString(rawEntry.title, `${fieldName}.title`),
    description: ensureStringField(rawEntry.description, `${fieldName}.description`),
    lifecycleStatus,
    lastSeenAt: ensureOptionalString(rawEntry.lastSeenAt, `${fieldName}.lastSeenAt`),
    updatedAt: ensureString(rawEntry.updatedAt, `${fieldName}.updatedAt`),
    color: ensureOptionalString(rawEntry.color, `${fieldName}.color`),
    cwd: ensureString(rawEntry.cwd, `${fieldName}.cwd`),
    repo: ensureOptionalString(rawEntry.repo, `${fieldName}.repo`),
    branch: ensureOptionalString(rawEntry.branch, `${fieldName}.branch`),
    copilotSessionId: ensureOptionalString(
      rawEntry.copilotSessionId,
      `${fieldName}.copilotSessionId`,
    ),
    tags: ensureStringArray(rawEntry.tags, `${fieldName}.tags`),
    originKind,
    graphBinding: ensureOptionalGraphBinding(rawEntry.graphBinding, `${fieldName}.graphBinding`),
  };
}

function validateIndex(rawIndex: unknown, filePath: string): SessionRegistryIndex {
  if (!isJsonObject(rawIndex)) {
    throw new Error(`Expected ${filePath} to contain an object.`);
  }
  if (rawIndex.schemaVersion !== SESSION_REGISTRY_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion in ${filePath}: ${String(rawIndex.schemaVersion)}`,
    );
  }
  if (!Array.isArray(rawIndex.entries)) {
    throw new Error(`Expected ${filePath}.entries to be an array.`);
  }

  return {
    schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
    updatedAt: ensureString(rawIndex.updatedAt, `${filePath}.updatedAt`),
    entries: rawIndex.entries.map((entry, index) =>
      validateIndexEntry(entry, `${filePath}.entries[${index}]`),
    ),
  };
}

function computeIndexEntriesSignature(entries: readonly SessionRegistryIndexEntry[]): string {
  return JSON.stringify(entries);
}

function buildIndex(records: Iterable<StoredSessionRegistryRecord>): SessionRegistryIndex {
  const entries = [...records].map<SessionRegistryIndexEntry>((record) => ({
    id: record.id,
    title: record.title,
    description: record.description,
    lifecycleStatus: record.lifecycleStatus,
    lastSeenAt: record.lastSeenAt,
    updatedAt: record.updatedAt,
    color: record.color,
    cwd: record.cwd,
    repo: record.repo,
    branch: record.branch,
    copilotSessionId: record.copilotSessionId,
    tags: cloneValue(record.tags),
    originKind: record.origin.kind,
    graphBinding: record.graphBinding ? cloneValue(record.graphBinding) : null,
  }));
  entries.sort(compareByFreshness);

  return {
    schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
    updatedAt: isoNow(),
    entries,
  };
}

function compareByFreshness(
  left: Pick<SessionRegistryListItem, "lastSeenAt" | "updatedAt">,
  right: Pick<SessionRegistryListItem, "lastSeenAt" | "updatedAt">,
): number {
  const leftSeen = left.lastSeenAt ? Date.parse(left.lastSeenAt) : Number.NEGATIVE_INFINITY;
  const rightSeen = right.lastSeenAt ? Date.parse(right.lastSeenAt) : Number.NEGATIVE_INFINITY;
  if (leftSeen !== rightSeen) {
    return rightSeen - leftSeen;
  }

  const leftUpdated = Date.parse(left.updatedAt);
  const rightUpdated = Date.parse(right.updatedAt);
  return rightUpdated - leftUpdated;
}

function matchesText(
  record: Pick<SessionRegistryIndexEntry, "title" | "description" | "tags">,
  text: string,
): boolean {
  const haystacks = [record.title, record.description, ...record.tags];
  return haystacks.some((value) => value.toLowerCase().includes(text));
}

function mergeStoredRecord(
  existingRecord: StoredSessionRegistryRecord | undefined,
  nextRecord: SessionRegistryRecord,
): StoredSessionRegistryRecord {
  const nextOrigin = existingRecord?.origin && isJsonObject(existingRecord.origin)
    ? { ...(existingRecord.origin as JsonObject), ...nextRecord.origin }
    : nextRecord.origin;

  const nextGraphBinding =
    existingRecord?.graphBinding && isJsonObject(existingRecord.graphBinding) && nextRecord.graphBinding
      ? {
          ...(existingRecord.graphBinding as JsonObject),
          ...nextRecord.graphBinding,
        }
      : nextRecord.graphBinding;

  return {
    ...(existingRecord ?? {}),
    ...nextRecord,
    origin: nextOrigin,
    graphBinding: nextGraphBinding,
  };
}

function writeJsonFile(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  renameWithRetries(tempPath, path);
}

function optionalNullableFilterApplied<T>(
  options: SessionRegistryListOptions,
  key: "repo",
  currentValue: T,
): boolean {
  return Object.prototype.hasOwnProperty.call(options, key) && currentValue !== options[key];
}

export class SessionRegistryFileStore implements SessionRegistryStore {
  private readonly entriesDir: string;
  private readonly quarantineDir: string;
  private readonly indexPath: string;
  private readonly lockPath: string;
  private readonly listeners = new Set<SessionRegistryChangeListener>();

  private records = new Map<string, StoredSessionRegistryRecord>();
  private index: SessionRegistryIndex = buildIndex([]);
  private lastSignature = "";
  private loaded = false;

  constructor(options?: SessionRegistryFileStoreOptions) {
    const resolvedRoot = resolve(options?.rootDir ?? DEFAULT_REGISTRY_ROOT);
    this.entriesDir = join(resolvedRoot, "entries");
    this.quarantineDir = join(resolvedRoot, "quarantine");
    this.indexPath = join(resolvedRoot, "index.json");
    this.lockPath = join(resolvedRoot, "registry.lock");
  }

  listSessions(options: SessionRegistryListOptions = {}): SessionRegistryListItem[] {
    this.refreshFromDisk();

    const text = options.text?.trim().toLowerCase();
    const items = this.index.entries
      .filter((entry) => options.includeArchived || entry.lifecycleStatus !== "archived")
      .filter((entry) => (text ? matchesText(entry, text) : true))
      .filter((entry) =>
        optionalNullableFilterApplied(options, "repo", entry.repo) ? false : true,
      )
      .filter((entry) =>
        options.workstreamId
          ? entry.graphBinding?.workstreamId === options.workstreamId
          : true,
      )
      .filter((entry) =>
        options.nodeId ? entry.graphBinding?.nodeId === options.nodeId : true,
      );

    return items.map((item) => cloneValue(item));
  }

  getSession(id: string): SessionRegistryRecord | null {
    this.refreshFromDisk();
    const record = this.records.get(id);
    return record ? cloneValue(record) : null;
  }

  upsertSession(input: SessionRegistryUpsertInput): SessionRegistryRecord {
    const validatedInput = parseSessionRegistryUpsertInput(input);
    const nextDescription = validatedInput.description ?? "";
    const nextColor = validatedInput.color ?? null;
    const nextRepo = validatedInput.repo ?? null;
    const nextBranch = validatedInput.branch ?? null;
    const nextTags = normalizeTags(validatedInput.tags);
    const nextGraphBinding = validatedInput.graphBinding ?? null;

    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      let targetId = validatedInput.id ?? randomUUID();
      let latestRecord = records.get(targetId);
      let nextCopilotSessionId = latestRecord?.copilotSessionId ?? null;
      let nextLastSeenAt = latestRecord?.lastSeenAt ?? null;

      if (isObservedUpsertInput(validatedInput)) {
        targetId =
          validatedInput.id ??
          this.findRecordIdByCopilotSessionId(records, validatedInput.copilotSessionId) ??
          targetId;
        latestRecord = records.get(targetId);
        nextCopilotSessionId = validatedInput.copilotSessionId;
        nextLastSeenAt =
          Object.prototype.hasOwnProperty.call(validatedInput, "lastSeenAt")
            ? validatedInput.lastSeenAt ?? null
            : latestRecord?.lastSeenAt ?? null;
      }

      const nextLifecycle = this.resolveUpsertLifecycle(latestRecord, validatedInput);
      const nextRecord: SessionRegistryRecord = {
        schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
        id: targetId,
        title: validatedInput.title,
        description: nextDescription,
        color: nextColor,
        cwd: validatedInput.cwd,
        repo: nextRepo,
        branch: nextBranch,
        copilotSessionId: nextCopilotSessionId,
        lifecycleStatus: nextLifecycle,
        lastSeenAt: nextLastSeenAt,
        createdAt: latestRecord?.createdAt ?? isoNow(),
        updatedAt: isoNow(),
        tags: nextTags,
        origin: cloneValue(validatedInput.origin),
        graphBinding: nextGraphBinding,
      };

      const storedRecord = mergeStoredRecord(latestRecord, nextRecord);
      records.set(targetId, storedRecord);
      const nextIndex = buildIndex(records.values());
      this.persistEntry(storedRecord);
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[0],
        registryId: targetId,
        snapshot: cloneValue(storedRecord),
      });
      return cloneValue(storedRecord);
    });
  }

  attachObservedSession(
    id: string,
    observation: SessionRegistryObservedLinkInput,
  ): SessionRegistryRecord {
    const copilotSessionId = ensureString(
      observation.copilotSessionId,
      "observation.copilotSessionId",
    );
    const cwd = ensureString(observation.cwd, "observation.cwd");
    const repo = Object.prototype.hasOwnProperty.call(observation, "repo")
      ? ensureOptionalString(observation.repo, "observation.repo")
      : undefined;
    const branch = Object.prototype.hasOwnProperty.call(observation, "branch")
      ? ensureOptionalString(observation.branch, "observation.branch")
      : undefined;
    const lastSeenAt = Object.prototype.hasOwnProperty.call(observation, "lastSeenAt")
      ? ensureOptionalString(observation.lastSeenAt, "observation.lastSeenAt")
      : undefined;

    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      const existingRecord = records.get(id);
      if (!existingRecord) {
        throw new Error(`Session ${id} does not exist.`);
      }
      if (existingRecord.lifecycleStatus === "archived") {
        throw new Error(`Archived session ${id} cannot be reattached by observation.`);
      }

      const nextLifecycle =
        observation.lifecycleStatus === "ended"
          ? "ended"
          : existingRecord.lifecycleStatus;

      const nextRecord: SessionRegistryRecord = {
        ...cloneValue(existingRecord),
        cwd,
        repo: repo !== undefined ? repo : existingRecord.repo,
        branch: branch !== undefined ? branch : existingRecord.branch,
        copilotSessionId,
        lastSeenAt:
          lastSeenAt !== undefined ? lastSeenAt : existingRecord.lastSeenAt,
        lifecycleStatus: nextLifecycle,
        updatedAt: isoNow(),
      };

      const storedRecord = mergeStoredRecord(existingRecord, nextRecord);
      records.set(id, storedRecord);
      const nextIndex = buildIndex(records.values());
      this.persistEntry(storedRecord);
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[0],
        registryId: id,
        snapshot: cloneValue(storedRecord),
      });
      return cloneValue(storedRecord);
    });
  }

  patchSession(id: string, patch: SessionRegistryPatch): SessionRegistryRecord {
    const validatedPatch = parseSessionRegistryPatch(patch);
    return this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      const existingRecord = records.get(id);
      if (!existingRecord) {
        throw new Error(`Session ${id} does not exist.`);
      }

      const nextLifecycle =
        validatedPatch.lifecycleStatus ?? existingRecord.lifecycleStatus;
      if (nextLifecycle === "ended") {
        throw new Error("Builder patches may not force lifecycleStatus to ended.");
      }

      const nextRecord: SessionRegistryRecord = {
        ...cloneValue(existingRecord),
        title: validatedPatch.title ?? existingRecord.title,
        description: validatedPatch.description ?? existingRecord.description,
        color:
          validatedPatch.color !== undefined ? validatedPatch.color : existingRecord.color,
        lifecycleStatus: nextLifecycle as SessionRegistryBuilderLifecycleStatus,
        tags:
          validatedPatch.tags !== undefined
            ? normalizeTags(validatedPatch.tags)
            : cloneValue(existingRecord.tags),
        graphBinding:
          validatedPatch.graphBinding !== undefined
            ? validatedPatch.graphBinding
            : existingRecord.graphBinding,
        updatedAt: isoNow(),
      };

      const storedRecord = mergeStoredRecord(existingRecord, nextRecord);
      records.set(id, storedRecord);
      const nextIndex = buildIndex(records.values());
      this.persistEntry(storedRecord);
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[0],
        registryId: id,
        snapshot: cloneValue(storedRecord),
      });
      return cloneValue(storedRecord);
    });
  }

  archiveSession(id: string): SessionRegistryRecord {
    return this.patchSession(id, { lifecycleStatus: "archived" });
  }

  deleteSession(id: string): void {
    this.withWriteLock(() => {
      const records = this.loadEntriesFromDisk();
      if (!records.has(id)) {
        throw new Error(`Session ${id} does not exist.`);
      }

      records.delete(id);
      const nextIndex = buildIndex(records.values());
      const entryPath = join(this.entriesDir, `${id}${ENTRY_EXTENSION}`);
      rmSync(entryPath, { force: true });
      this.persistIndex(records, nextIndex);
      this.commitSnapshot(records, nextIndex);
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[1],
        registryId: id,
      });
    });
  }

  subscribe(listener: SessionRegistryChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ensureDirectories(): void {
    mkdirSync(this.entriesDir, { recursive: true });
    mkdirSync(this.quarantineDir, { recursive: true });
  }

  private refreshFromDisk(): void {
    const records = this.loadEntriesFromDisk();
    const index = this.loadOrRebuildIndex(records);
    const nextSignature = this.computeSignature(records);

    if (!this.loaded) {
      this.commitSnapshot(records, index);
      return;
    }

    const didChange = nextSignature !== this.lastSignature;
    this.commitSnapshot(records, index);
    if (didChange) {
      this.emitChange({
        kind: SESSION_REGISTRY_CHANGE_EVENT_KINDS[2],
        registryIds: [...records.keys()].sort(),
      });
    }
  }

  private computeSignature(records: Map<string, StoredSessionRegistryRecord>): string {
    const entries = [...records.entries()].sort(([leftId], [rightId]) =>
      leftId.localeCompare(rightId),
    );
    return JSON.stringify(entries);
  }

  private commitSnapshot(
    records: Map<string, StoredSessionRegistryRecord>,
    index: SessionRegistryIndex,
  ): void {
    this.records = records;
    this.index = index;
    this.lastSignature = this.computeSignature(records);
    this.loaded = true;
  }

  private loadEntriesFromDisk(): Map<string, StoredSessionRegistryRecord> {
    this.ensureDirectories();

    const records = new Map<string, StoredSessionRegistryRecord>();
    for (const fileName of readdirSync(this.entriesDir)) {
      if (!fileName.endsWith(ENTRY_EXTENSION)) {
        continue;
      }

      const entryPath = join(this.entriesDir, fileName);
      try {
        const parsed = JSON.parse(readFileSync(entryPath, "utf8")) as unknown;
        const record = validateStoredRecord(parsed, entryPath);
        if (records.has(record.id)) {
          throw new Error(`Duplicate registry id ${record.id} detected.`);
        }
        records.set(record.id, record);
      } catch {
        this.quarantineEntry(entryPath);
        continue;
      }
    }

    return records;
  }

  private loadOrRebuildIndex(
    records: Map<string, StoredSessionRegistryRecord>,
  ): SessionRegistryIndex {
    const rebuiltIndex = buildIndex(records.values());

    try {
      const rawIndex = JSON.parse(readFileSync(this.indexPath, "utf8")) as unknown;
      const parsedIndex = validateIndex(rawIndex, this.indexPath);
      if (
        computeIndexEntriesSignature(parsedIndex.entries) ===
        computeIndexEntriesSignature(rebuiltIndex.entries)
      ) {
        return parsedIndex;
      }
    } catch {
      // Rebuild below from authoritative entries.
    }

    this.persistIndex(records, rebuiltIndex);
    return rebuiltIndex;
  }

  private quarantineEntry(entryPath: string): void {
    this.ensureDirectories();
    const quarantinePath = join(
      this.quarantineDir,
      `${Date.now()}-${basename(entryPath)}`,
    );
    renameWithRetries(entryPath, quarantinePath);
  }

  private persistEntry(record: StoredSessionRegistryRecord): void {
    writeJsonFile(join(this.entriesDir, `${record.id}${ENTRY_EXTENSION}`), record);
  }

  private persistIndex(
    records: Map<string, StoredSessionRegistryRecord>,
    index: SessionRegistryIndex = buildIndex(records.values()),
  ): void {
    writeJsonFile(this.indexPath, index);
  }

  private withWriteLock<T>(operation: () => T): T {
    this.ensureDirectories();
    const lockFd = this.acquireLock();
    try {
      return operation();
    } finally {
      this.releaseLock(lockFd);
    }
  }

  private acquireLock(): number {
    let fd: number;
    try {
      fd = openSync(this.lockPath, "wx");
    } catch (error: unknown) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : "";
      if (code === "EEXIST") {
        throw new Error(`Session registry is locked at ${this.lockPath}.`);
      }
      throw error;
    }
    try {
      writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          acquiredAt: isoNow(),
        }),
        "utf8",
      );
    } catch (error: unknown) {
      try {
        closeSync(fd);
      } catch {
        // Best effort cleanup; the original error is more important.
      }
      try {
        unlinkSync(this.lockPath);
      } catch {
        // Best effort cleanup; the original error is more important.
      }
      throw error;
    }
    return fd;
  }

  private releaseLock(lockFd: number): void {
    try {
      closeSync(lockFd);
    } finally {
      rmSync(this.lockPath, { force: true });
    }
  }

  private findRecordIdByCopilotSessionId(
    records: Map<string, StoredSessionRegistryRecord>,
    copilotSessionId: string,
  ): string | undefined {
    for (const record of records.values()) {
      if (record.copilotSessionId === copilotSessionId) {
        return record.id;
      }
    }

    return undefined;
  }

  private resolveUpsertLifecycle(
    existingRecord: StoredSessionRegistryRecord | undefined,
    input: SessionRegistryUpsertInput,
  ): SessionRegistryLifecycleStatus {
    if (input.origin.kind === "observed") {
      const nextLifecycle = input.lifecycleStatus ?? existingRecord?.lifecycleStatus ?? "active";
      if (nextLifecycle !== "active" && nextLifecycle !== "ended") {
        throw new Error(
          `Observed rows may only use active or ended lifecycle statuses, received ${nextLifecycle}.`,
        );
      }
      return nextLifecycle;
    }

    const existingLifecycle =
      existingRecord?.lifecycleStatus === "active" ||
      existingRecord?.lifecycleStatus === "paused"
        ? existingRecord.lifecycleStatus
        : "active";
    const nextLifecycle = input.lifecycleStatus ?? existingLifecycle;
    if (nextLifecycle !== "active" && nextLifecycle !== "paused") {
      throw new Error(
        `Manual or launched rows may only be created in active or paused status, received ${nextLifecycle}.`,
      );
    }
    return nextLifecycle;
  }

  private emitChange(event: SessionRegistryChangeEvent): void {
    for (const listener of this.listeners) {
      listener(cloneValue(event));
    }
  }
}
