import type { WorkstreamRegistryListEntry } from "./workstream-registry-contract";
import { parseWorkstreamDocument } from "./workstream-view-model";
import { summarizeWorkstreamDocument } from "./workstream-identity";

const STORAGE_KEY = "streamliner:browserWorkstreamFiles";
const HANDLE_DB_NAME = "streamliner-browser-workstreams";
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE = "workstreams";

interface BrowserFilePermissionDescriptor {
  mode: "read";
}

interface BrowserFileHandle {
  name: string;
  kind?: "file";
  getFile: () => Promise<File>;
  queryPermission?: (descriptor?: BrowserFilePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor?: BrowserFilePermissionDescriptor) => Promise<PermissionState>;
}

interface BrowserOpenFilePickerOptions {
  id?: string;
  multiple?: boolean;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}

interface BrowserWindowWithPicker extends Window {
  showOpenFilePicker?: (options?: BrowserOpenFilePickerOptions) => Promise<BrowserFileHandle[]>;
}

export interface BrowserWorkstreamSelection {
  fileName: string;
  content: string;
  lastModified: number;
  handle?: BrowserFileHandle;
}

interface BrowserWorkstreamRecord {
  key: string;
  source: "browser-file";
  browserFileKey: string;
  browserFileName: string;
  projectKey: string;
  workstreamId: string;
  title: string;
  summary: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  snapshotContent: string;
  snapshotLastModified: number;
}

interface BrowserHandleRecord extends BrowserWorkstreamRecord {
  handle?: BrowserFileHandle;
}

export interface BrowserWorkstreamGraphRead {
  content?: string;
  lastModified: string;
  notModified: boolean;
}

function registryKey(entry: { projectKey: string; workstreamId: string }): string {
  return `${entry.projectKey}/${entry.workstreamId}`;
}

function browserPathForKey(key: string, fileName: string): string {
  return `browser-file://${key}/${encodeURIComponent(fileName)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBrowserWorkstreamRecord(value: unknown): value is BrowserWorkstreamRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.source === "browser-file" &&
    typeof value.key === "string" &&
    typeof value.browserFileKey === "string" &&
    typeof value.browserFileName === "string" &&
    typeof value.projectKey === "string" &&
    typeof value.workstreamId === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.path === "string" &&
    typeof value.addedAt === "string" &&
    typeof value.lastOpenedAt === "string" &&
    typeof value.snapshotContent === "string" &&
    typeof value.snapshotLastModified === "number"
  );
}

function readStoredRecords(): BrowserWorkstreamRecord[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isBrowserWorkstreamRecord) : [];
  } catch {
    return [];
  }
}

function writeStoredRecords(records: BrowserWorkstreamRecord[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function toListEntry(record: BrowserWorkstreamRecord): WorkstreamRegistryListEntry {
  return {
    source: "browser-file",
    browserFileKey: record.browserFileKey,
    browserFileName: record.browserFileName,
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

function summarizeSelection(selection: BrowserWorkstreamSelection): {
  key: string;
  recordBase: Omit<
    BrowserWorkstreamRecord,
    "addedAt" | "lastOpenedAt" | "snapshotContent" | "snapshotLastModified"
  >;
} {
  const document = parseWorkstreamDocument(selection.content);
  const summary = summarizeWorkstreamDocument(document);
  const key = registryKey(summary);
  return {
    key,
    recordBase: {
      key,
      source: "browser-file",
      browserFileKey: key,
      browserFileName: selection.fileName,
      projectKey: summary.projectKey,
      workstreamId: summary.workstreamId,
      title: summary.title,
      summary: summary.summary,
      path: browserPathForKey(key, selection.fileName),
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
    request.onerror = () => reject(request.error ?? new Error("Unable to open browser file store."));
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
    request.onerror = () => reject(request.error ?? new Error("Browser file store operation failed."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Browser file store transaction failed."));
    };
  });
}

async function writeHandleRecord(record: BrowserHandleRecord): Promise<void> {
  if (!record.handle) {
    return;
  }
  try {
    await withHandleStore("readwrite", (store) => store.put(record));
  } catch {
    // A persisted handle is an enhancement; the snapshot in localStorage remains usable.
  }
}

async function readHandleRecord(key: string): Promise<BrowserHandleRecord | null> {
  try {
    const record = await withHandleStore<BrowserHandleRecord | undefined>(
      "readonly",
      (store) => store.get(key),
    );
    return record ?? null;
  } catch {
    return null;
  }
}

async function deleteHandleRecord(key: string): Promise<void> {
  try {
    await withHandleStore("readwrite", (store) => store.delete(key));
  } catch {
    // The metadata delete below is the user-visible source of truth.
  }
}

async function fileFromHandle(handle: BrowserFileHandle): Promise<File | null> {
  const permission = await handle.queryPermission?.({ mode: "read" });
  if (permission && permission !== "granted") {
    return null;
  }
  return handle.getFile();
}

function lastModifiedHeader(lastModified: number): string {
  return new Date(Math.floor(lastModified / 1000) * 1000).toUTCString();
}

function isNotModified(ifModifiedSince: string | null | undefined, lastModified: number): boolean {
  return typeof ifModifiedSince === "string" &&
    new Date(ifModifiedSince).getTime() >= Math.floor(lastModified / 1000) * 1000;
}

export async function pickBrowserWorkstreamFile(): Promise<BrowserWorkstreamSelection | null | "unsupported"> {
  const picker = (window as BrowserWindowWithPicker).showOpenFilePicker;
  if (!picker) {
    return "unsupported";
  }

  try {
    const handles = await picker({
      id: "streamliner-workstream-graph",
      multiple: false,
      types: [
        {
          description: "Workstream graph",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
    });
    const handle = handles[0];
    if (!handle) {
      return null;
    }
    const file = await handle.getFile();
    return {
      fileName: file.name || handle.name || "graph.json",
      content: await file.text(),
      lastModified: file.lastModified,
      handle,
    };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
}

export async function browserWorkstreamSelectionFromFile(
  file: File,
): Promise<BrowserWorkstreamSelection> {
  return {
    fileName: file.name || "graph.json",
    content: await file.text(),
    lastModified: file.lastModified,
  };
}

export function listBrowserWorkstreamEntries(): WorkstreamRegistryListEntry[] {
  return readStoredRecords()
    .map(toListEntry)
    .sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt));
}

export async function storeBrowserWorkstreamSelection(
  selection: BrowserWorkstreamSelection,
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
  const nextRecord: BrowserWorkstreamRecord = {
    ...recordBase,
    addedAt: current?.addedAt ?? timestamp,
    lastOpenedAt: timestamp,
    snapshotContent: selection.content,
    snapshotLastModified: selection.lastModified,
  };

  writeStoredRecords([
    nextRecord,
    ...records.filter((record) => record.key !== key),
  ]);
  await writeHandleRecord({ ...nextRecord, handle: selection.handle });
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
    throw new Error("This browser no longer has access to that selected graph file. Relink it to continue.");
  }

  const handleRecord = await readHandleRecord(key);
  const file = handleRecord?.handle ? await fileFromHandle(handleRecord.handle) : null;
  const content = file ? await file.text() : record.snapshotContent;
  const lastModified = file ? file.lastModified : record.snapshotLastModified;

  if (isNotModified(ifModifiedSince, lastModified)) {
    return {
      lastModified: lastModifiedHeader(lastModified),
      notModified: true,
    };
  }

  const document = parseWorkstreamDocument(content);
  const summary = summarizeWorkstreamDocument(document);
  const actualKey = registryKey(summary);
  if (actualKey !== key) {
    throw new Error(`Selected graph now has identity '${actualKey}', expected '${key}'.`);
  }

  const nextRecord: BrowserWorkstreamRecord = {
    ...record,
    title: summary.title,
    summary: summary.summary,
    lastOpenedAt: new Date().toISOString(),
    snapshotContent: content,
    snapshotLastModified: lastModified,
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
