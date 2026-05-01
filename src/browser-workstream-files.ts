import type { WorkstreamRegistryListEntry } from "./workstream-registry-contract";
import { parseWorkstreamDocument } from "./workstream-view-model";
import { summarizeWorkstreamDocument } from "./workstream-identity";

const STORAGE_KEY = "streamliner:browserWorkstreamDirectories";
const HANDLE_DB_NAME = "streamliner-browser-workstreams";
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE = "workstreams";

interface BrowserPermissionDescriptor {
  mode: "read";
}

interface BrowserFileHandle {
  name: string;
  kind?: "file";
  getFile: () => Promise<File>;
}

interface BrowserDirectoryHandle {
  name: string;
  kind?: "directory";
  getFileHandle: (name: string) => Promise<BrowserFileHandle>;
  queryPermission?: (descriptor?: BrowserPermissionDescriptor) => Promise<PermissionState>;
}

interface BrowserDirectoryPickerOptions {
  id?: string;
  mode?: "read";
}

interface BrowserWindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: (options?: BrowserDirectoryPickerOptions) => Promise<BrowserDirectoryHandle>;
}

export interface BrowserWorkstreamDirectorySelection {
  directoryName: string;
  content: string;
  lastModified: number;
  directoryHandle: BrowserDirectoryHandle;
}

interface BrowserWorkstreamDirectoryRecord {
  key: string;
  source: "browser-directory";
  browserDirectoryKey: string;
  browserDirectoryName: string;
  projectKey: string;
  workstreamId: string;
  title: string;
  summary: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  graphLastModified: number;
}

interface BrowserDirectoryHandleRecord extends BrowserWorkstreamDirectoryRecord {
  directoryHandle?: BrowserDirectoryHandle;
}

export interface BrowserWorkstreamGraphRead {
  content?: string;
  lastModified: string;
  notModified: boolean;
}

function registryKey(entry: { projectKey: string; workstreamId: string }): string {
  return `${entry.projectKey}/${entry.workstreamId}`;
}

function browserPathForKey(key: string, directoryName: string): string {
  return `browser-directory://${key}/${encodeURIComponent(directoryName)}/graph.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBrowserWorkstreamDirectoryRecord(value: unknown): value is BrowserWorkstreamDirectoryRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.source === "browser-directory" &&
    typeof value.key === "string" &&
    typeof value.browserDirectoryKey === "string" &&
    typeof value.browserDirectoryName === "string" &&
    typeof value.projectKey === "string" &&
    typeof value.workstreamId === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.path === "string" &&
    typeof value.addedAt === "string" &&
    typeof value.lastOpenedAt === "string" &&
    typeof value.graphLastModified === "number"
  );
}

function readStoredRecords(): BrowserWorkstreamDirectoryRecord[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isBrowserWorkstreamDirectoryRecord) : [];
  } catch {
    return [];
  }
}

function writeStoredRecords(records: BrowserWorkstreamDirectoryRecord[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function toListEntry(record: BrowserWorkstreamDirectoryRecord): WorkstreamRegistryListEntry {
  return {
    source: "browser-directory",
    browserDirectoryKey: record.browserDirectoryKey,
    browserDirectoryName: record.browserDirectoryName,
    projectKey: record.projectKey,
    workstreamId: record.workstreamId,
    title: record.title,
    summary: record.summary,
    path: record.path,
    addedAt: record.addedAt,
    lastOpenedAt: record.lastOpenedAt,
    fileStatus: "available",
  };
}

function summarizeSelection(selection: BrowserWorkstreamDirectorySelection): {
  key: string;
  recordBase: Omit<BrowserWorkstreamDirectoryRecord, "addedAt" | "lastOpenedAt" | "graphLastModified">;
} {
  const document = parseWorkstreamDocument(selection.content);
  const summary = summarizeWorkstreamDocument(document);
  const key = registryKey(summary);
  return {
    key,
    recordBase: {
      key,
      source: "browser-directory",
      browserDirectoryKey: key,
      browserDirectoryName: selection.directoryName,
      projectKey: summary.projectKey,
      workstreamId: summary.workstreamId,
      title: summary.title,
      summary: summary.summary,
      path: browserPathForKey(key, selection.directoryName),
    },
  };
}

function openHandleDb(): Promise<IDBDatabase | null> {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(HANDLE_DB_NAME, HANDLE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open browser directory store."));
  });
}

async function withHandleStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openHandleDb();
  if (!db) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(HANDLE_STORE, mode);
    const request = operation(transaction.objectStore(HANDLE_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser directory store operation failed."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Browser directory store transaction failed."));
    };
  });
}

const sessionDirectoryHandles = new Map<string, BrowserDirectoryHandleRecord>();

async function writeHandleRecord(record: BrowserDirectoryHandleRecord): Promise<void> {
  if (!record.directoryHandle) {
    throw new Error("Expected the selected workstream directory handle to be available.");
  }
  sessionDirectoryHandles.set(record.key, record);
  const stored = await withHandleStore("readwrite", (store) => store.put(record));
  if (stored === null && "indexedDB" in window) {
    throw new Error("Unable to persist the selected workstream directory handle.");
  }
}

async function readHandleRecord(key: string): Promise<BrowserDirectoryHandleRecord | null> {
  const sessionRecord = sessionDirectoryHandles.get(key);
  if (sessionRecord) {
    return sessionRecord;
  }
  const record = await withHandleStore<BrowserDirectoryHandleRecord | undefined>(
    "readonly",
    (store) => store.get(key),
  );
  return record ?? null;
}

async function deleteHandleRecord(key: string): Promise<void> {
  sessionDirectoryHandles.delete(key);
  await withHandleStore("readwrite", (store) => store.delete(key));
}

async function graphFileFromDirectoryHandle(handle: BrowserDirectoryHandle): Promise<File> {
  const permission = await handle.queryPermission?.({ mode: "read" });
  if (permission && permission !== "granted") {
    throw new Error("Browser permission to this workstream directory was not retained. Relink it to continue.");
  }

  try {
    const graphHandle = await handle.getFileHandle("graph.json");
    return graphHandle.getFile();
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      throw new Error("Expected the selected workstream directory to contain graph.json.");
    }
    throw error;
  }
}

function lastModifiedHeader(lastModified: number): string {
  return new Date(Math.floor(lastModified / 1000) * 1000).toUTCString();
}

function isNotModified(ifModifiedSince: string | null | undefined, lastModified: number): boolean {
  return typeof ifModifiedSince === "string" &&
    new Date(ifModifiedSince).getTime() >= Math.floor(lastModified / 1000) * 1000;
}

export async function pickBrowserWorkstreamDirectory(): Promise<BrowserWorkstreamDirectorySelection | null | "unsupported"> {
  const picker = (window as BrowserWindowWithDirectoryPicker).showDirectoryPicker;
  if (!picker) {
    return "unsupported";
  }

  try {
    const directoryHandle = await picker({
      id: "streamliner-workstream-directory",
      mode: "read",
    });
    const file = await graphFileFromDirectoryHandle(directoryHandle);
    return {
      directoryName: directoryHandle.name || "workstream",
      content: await file.text(),
      lastModified: file.lastModified,
      directoryHandle,
    };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
}

export function listBrowserWorkstreamEntries(): WorkstreamRegistryListEntry[] {
  return readStoredRecords()
    .map(toListEntry)
    .sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt));
}

export async function storeBrowserWorkstreamDirectory(
  selection: BrowserWorkstreamDirectorySelection,
  expectedEntry?: { projectKey: string; workstreamId: string },
): Promise<WorkstreamRegistryListEntry> {
  const { key, recordBase } = summarizeSelection(selection);
  if (expectedEntry && key !== registryKey(expectedEntry)) {
    throw new Error(
      `Relink target has identity '${key}', expected '${registryKey(expectedEntry)}'.`,
    );
  }

  const records = readStoredRecords();
  const current = records.find((record) => record.key === key);
  const timestamp = new Date().toISOString();
  const nextRecord: BrowserWorkstreamDirectoryRecord = {
    ...recordBase,
    addedAt: current?.addedAt ?? timestamp,
    lastOpenedAt: timestamp,
    graphLastModified: selection.lastModified,
  };

  await writeHandleRecord({ ...nextRecord, directoryHandle: selection.directoryHandle });
  writeStoredRecords([
    nextRecord,
    ...records.filter((record) => record.key !== key),
  ]);
  return toListEntry(nextRecord);
}

export async function deleteBrowserWorkstreamEntry(
  entry: { projectKey: string; workstreamId: string },
): Promise<boolean> {
  const key = registryKey(entry);
  const records = readStoredRecords();
  const nextRecords = records.filter((record) => record.key !== key);
  if (nextRecords.length === records.length) {
    return false;
  }
  writeStoredRecords(nextRecords);
  await deleteHandleRecord(key);
  return true;
}

export async function readBrowserWorkstreamGraph(
  entry: WorkstreamRegistryListEntry,
  ifModifiedSince?: string | null,
): Promise<BrowserWorkstreamGraphRead> {
  const key = registryKey(entry);
  const records = readStoredRecords();
  const record = records.find((candidate) => candidate.key === key);
  if (!record) {
    throw new Error("This browser no longer has access to that selected workstream directory. Relink it to continue.");
  }

  const handleRecord = await readHandleRecord(key);
  if (!handleRecord?.directoryHandle) {
    throw new Error("This browser no longer has the workstream directory handle. Relink it to continue.");
  }

  const file = await graphFileFromDirectoryHandle(handleRecord.directoryHandle);
  const lastModified = file.lastModified;
  if (isNotModified(ifModifiedSince, lastModified)) {
    return {
      lastModified: lastModifiedHeader(lastModified),
      notModified: true,
    };
  }

  const content = await file.text();
  const document = parseWorkstreamDocument(content);
  const summary = summarizeWorkstreamDocument(document);
  const actualKey = registryKey(summary);
  if (actualKey !== key) {
    throw new Error(`Selected graph now has identity '${actualKey}', expected '${key}'.`);
  }

  const nextRecord: BrowserWorkstreamDirectoryRecord = {
    ...record,
    title: summary.title,
    summary: summary.summary,
    lastOpenedAt: new Date().toISOString(),
    graphLastModified: lastModified,
  };
  writeStoredRecords([
    nextRecord,
    ...records.filter((candidate) => candidate.key !== key),
  ]);

  return {
    content,
    lastModified: lastModifiedHeader(lastModified),
    notModified: false,
  };
}
