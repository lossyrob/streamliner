import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type {
  NodeLaunchHandoff,
  NodeLaunchOperation,
  NodeLaunchOperationError,
  NodeLaunchOperationProgressEvent,
  NodeLaunchOperationStatus,
  NodeLaunchRecord,
  NodeLaunchRecordPathStatus,
  NodeManagedSdkLaunchResponse,
  NodeTerminalLaunchResponse,
} from "../node-launch-record-contract";
import type { PawLaunchHandoff, PawLaunchProgressEvent } from "./launch-preparation";

interface NodeLaunchRecordDocument {
  version: 1;
  records: StoredNodeLaunchRecord[];
  operations: StoredNodeLaunchOperation[];
}

type StoredNodeLaunchRecord = Omit<NodeLaunchRecord, "pathStatus">;
type StoredNodeLaunchOperation = NodeLaunchOperation;

const OPERATION_EVENT_BUFFER_SIZE = 50;
const ATOMIC_REPLACE_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;
const OPERATION_STATUSES = new Set<NodeLaunchOperationStatus>([
  "launchable",
  "preparing",
  "prepared",
  "preparation_failed",
  "launching",
  "launched_pending_binding",
  "managed_starting",
  "managed_running",
  "managed_failed",
  "bound",
  "terminal_failed",
]);

interface OperationErrorInput {
  code: string;
  error: string;
  step?: string;
  input?: string;
}

type ReplaceFile = (source: string, destination: string) => Promise<void>;

interface AtomicWriteOptions {
  replaceFile?: ReplaceFile;
  retryDelaysMs?: readonly number[];
}

interface NodeErrnoException extends Error {
  code?: string;
}

function defaultRecordsPath(): string {
  const stateRoot = resolve(process.env.STREAMLINER_STATE_ROOT ?? join(homedir(), ".streamliner", "state"));
  return join(stateRoot, "node-launch-records.json");
}

function normalizeGraphPathForKey(graphPath: string): string {
  return resolve(graphPath).toLowerCase();
}

function normalizePathForComparison(path: string): string {
  return resolve(path).toLowerCase();
}

function recordId(graphPath: string, nodeId: string): string {
  const hash = createHash("sha256")
    .update(`${normalizeGraphPathForKey(graphPath)}\n${nodeId}`)
    .digest("hex")
    .slice(0, 16);
  return `${nodeId}-${hash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function nullableStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function optionalStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeStoredRecord(value: unknown): StoredNodeLaunchRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const graphPath = stringField(value, "graphPath");
  const nodeId = stringField(value, "nodeId");
  const updatedAt = stringField(value, "updatedAt");
  if (!graphPath || !nodeId || !updatedAt) {
    return null;
  }
  return {
    id: stringField(value, "id") || recordId(graphPath, nodeId),
    graphPath,
    nodeId,
    projectKey: stringField(value, "projectKey"),
    workstreamId: stringField(value, "workstreamId"),
    branch: stringField(value, "branch"),
    workId: stringField(value, "workId"),
    workTitle: stringField(value, "workTitle"),
    cwd: stringField(value, "cwd"),
    pawWorkDir: stringField(value, "pawWorkDir"),
    workflowContextPath: stringField(value, "workflowContextPath"),
    streamlinerContextPath: stringField(value, "streamlinerContextPath"),
    contextPackagePath: stringField(value, "contextPackagePath"),
    contextFilePath: stringField(value, "contextFilePath"),
    sdkSessionWorkspacePath: optionalStringField(value, "sdkSessionWorkspacePath"),
    sdkSessionStateRoot: optionalStringField(value, "sdkSessionStateRoot"),
    runtimeKind:
      value.runtimeKind === "managed-sdk" || value.runtimeKind === "terminal-cli"
        ? value.runtimeKind
        : undefined,
    launchNonce: nullableStringField(value, "launchNonce"),
    launchClaimRef: nullableStringField(value, "launchClaimRef"),
    trackerUrl: nullableStringField(value, "trackerUrl"),
    createdAt: stringField(value, "createdAt") || updatedAt,
    updatedAt,
  };
}

function normalizeProgressEvent(value: unknown): NodeLaunchOperationProgressEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = stringField(value, "type");
  const message = stringField(value, "message");
  const timestamp = stringField(value, "timestamp");
  if (!type || !message || !timestamp) {
    return null;
  }
  const event: NodeLaunchOperationProgressEvent = {
    type,
    message,
    timestamp,
  };
  if (isRecord(value.data)) {
    event.data = { ...value.data };
  }
  return event;
}

function normalizeOperationError(value: unknown): NodeLaunchOperationError | null {
  if (!isRecord(value)) {
    return null;
  }
  const code = stringField(value, "code");
  const error = stringField(value, "error");
  const timestamp = stringField(value, "timestamp");
  if (!code || !error || !timestamp) {
    return null;
  }
  const operationError: NodeLaunchOperationError = {
    code,
    error,
    timestamp,
  };
  const step = optionalStringField(value, "step");
  if (step !== undefined) {
    operationError.step = step;
  }
  const input = optionalStringField(value, "input");
  if (input !== undefined) {
    operationError.input = input;
  }
  return operationError;
}

function normalizeStoredOperation(value: unknown): StoredNodeLaunchOperation | null {
  if (!isRecord(value)) {
    return null;
  }
  const graphPath = stringField(value, "graphPath");
  const nodeId = stringField(value, "nodeId");
  const status = stringField(value, "status");
  const startedAt = stringField(value, "startedAt");
  const updatedAt = stringField(value, "updatedAt");
  if (!graphPath || !nodeId || !startedAt || !updatedAt || !OPERATION_STATUSES.has(status as NodeLaunchOperationStatus)) {
    return null;
  }
  return {
    id: stringField(value, "id") || recordId(graphPath, nodeId),
    graphPath,
    nodeId,
    status: status as NodeLaunchOperationStatus,
    preparationRunId: nullableStringField(value, "preparationRunId"),
    startedAt,
    updatedAt,
    completedAt: nullableStringField(value, "completedAt"),
    handoff: isRecord(value.handoff) ? value.handoff as unknown as NodeLaunchHandoff : null,
    terminalLaunch: isRecord(value.terminalLaunch) ? value.terminalLaunch as unknown as NodeTerminalLaunchResponse : null,
    managedLaunch: isRecord(value.managedLaunch) ? value.managedLaunch as unknown as NodeManagedSdkLaunchResponse : null,
    error: normalizeOperationError(value.error),
    progressEvents: Array.isArray(value.progressEvents)
      ? value.progressEvents
        .map(normalizeProgressEvent)
        .filter((event): event is NodeLaunchOperationProgressEvent => event !== null)
        .slice(-OPERATION_EVENT_BUFFER_SIZE)
      : [],
  };
}

function existsIfPresent(path: string | undefined): boolean | undefined {
  return path ? existsSync(path) : undefined;
}

function isNodeErrnoException(error: unknown): error is NodeErrnoException {
  return error instanceof Error;
}

function isRetryableAtomicReplaceError(error: unknown): boolean {
  if (!isNodeErrnoException(error)) {
    return false;
  }
  return error.code === "EPERM" || error.code === "EACCES" || error.code === "EBUSY";
}

export async function writeFileWithAtomicReplace(
  filePath: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  const replaceFile = options.replaceFile ?? rename;
  const retryDelaysMs = options.retryDelaysMs ?? ATOMIC_REPLACE_RETRY_DELAYS_MS;
  let replaced = false;
  try {
    await writeFile(tempPath, content, "utf8");
    for (let attempt = 0; ; attempt += 1) {
      try {
        await replaceFile(tempPath, filePath);
        replaced = true;
        return;
      } catch (error: unknown) {
        const retryDelayMs = retryDelaysMs[attempt];
        if (retryDelayMs === undefined || !isRetryableAtomicReplaceError(error)) {
          throw error;
        }
        await delay(retryDelayMs);
      }
    }
  } finally {
    if (!replaced) {
      await unlink(tempPath).catch(() => undefined);
    }
  }
}

function pathStatus(record: StoredNodeLaunchRecord): NodeLaunchRecordPathStatus {
  const status: NodeLaunchRecordPathStatus = {
    cwdExists: existsSync(record.cwd),
    pawWorkDirExists: existsSync(record.pawWorkDir),
    workflowContextExists: existsSync(record.workflowContextPath),
    streamlinerContextExists: existsSync(record.streamlinerContextPath),
    contextPackageExists: existsSync(record.contextPackagePath),
    contextFileExists: existsSync(record.contextFilePath),
  };
  const sdkSessionWorkspaceExists = existsIfPresent(record.sdkSessionWorkspacePath);
  if (sdkSessionWorkspaceExists !== undefined) {
    status.sdkSessionWorkspaceExists = sdkSessionWorkspaceExists;
  }
  const sdkSessionStateRootExists = existsIfPresent(record.sdkSessionStateRoot);
  if (sdkSessionStateRootExists !== undefined) {
    status.sdkSessionStateRootExists = sdkSessionStateRootExists;
  }
  return status;
}

function withPathStatus(record: StoredNodeLaunchRecord): NodeLaunchRecord {
  return {
    ...record,
    pathStatus: pathStatus(record),
  };
}

export class NodeLaunchRecordStore {
  private readonly recordsPath: string;
  private readonly replaceFile: ReplaceFile;
  private readonly atomicReplaceRetryDelaysMs: readonly number[];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: {
    recordsPath?: string;
    replaceFile?: ReplaceFile;
    atomicReplaceRetryDelaysMs?: readonly number[];
  } = {}) {
    this.recordsPath = options.recordsPath ?? defaultRecordsPath();
    this.replaceFile = options.replaceFile ?? rename;
    this.atomicReplaceRetryDelaysMs = options.atomicReplaceRetryDelaysMs ?? ATOMIC_REPLACE_RETRY_DELAYS_MS;
  }

  async get(graphPath: string, nodeId: string): Promise<NodeLaunchRecord | null> {
    const document = await this.readDocument();
    const key = normalizeGraphPathForKey(graphPath);
    const record = document.records.find((candidate) =>
      candidate.nodeId === nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
    );
    return record ? withPathStatus(record) : null;
  }

  async listByGraphPath(graphPath: string): Promise<NodeLaunchRecord[]> {
    const document = await this.readDocument();
    const key = normalizeGraphPathForKey(graphPath);
    return document.records
      .filter((candidate) => normalizeGraphPathForKey(candidate.graphPath) === key)
      .map(withPathStatus);
  }

  async getOperation(graphPath: string, nodeId: string): Promise<NodeLaunchOperation | null> {
    const document = await this.readDocument();
    const key = normalizeGraphPathForKey(graphPath);
    const operation = document.operations.find((candidate) =>
      candidate.nodeId === nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
    );
    return operation ? { ...operation, progressEvents: [...operation.progressEvents] } : null;
  }

  async hasWorkflowContextPath(path: string): Promise<boolean> {
    const document = await this.readDocument();
    const normalizedPath = normalizePathForComparison(path);
    return document.records.some((record) =>
      normalizePathForComparison(record.workflowContextPath) === normalizedPath
    ) || document.operations.some((operation) =>
      operation.handoff?.workflowContextPath &&
      normalizePathForComparison(operation.handoff.workflowContextPath) === normalizedPath
    );
  }

  async startPreparationOperation(input: {
    graphPath: string;
    nodeId: string;
    runId: string;
    now?: Date;
  }): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const timestamp = (input.now ?? new Date()).toISOString();
      const existing = findStoredOperation(document, input.graphPath, input.nodeId);
      const nextOperation: StoredNodeLaunchOperation = {
        id: existing?.id ?? recordId(input.graphPath, input.nodeId),
        graphPath: input.graphPath,
        nodeId: input.nodeId,
        status: "preparing",
        preparationRunId: input.runId,
        startedAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
        handoff: null,
        terminalLaunch: null,
        managedLaunch: null,
        error: null,
        progressEvents: [],
      };
      upsertStoredOperation(document, nextOperation);
      return nextOperation;
    });
  }

  async appendOperationProgress(
    graphPath: string,
    nodeId: string,
    event: PawLaunchProgressEvent,
  ): Promise<NodeLaunchOperation | null> {
    return await this.updateDocument((document) => {
      const operation = findStoredOperation(document, graphPath, nodeId);
      if (!operation) {
        return null;
      }
      operation.progressEvents.push({
        type: event.type,
        message: event.message,
        timestamp: event.timestamp,
        data: event.data ? { ...event.data } : undefined,
      });
      if (operation.progressEvents.length > OPERATION_EVENT_BUFFER_SIZE) {
        operation.progressEvents.splice(0, operation.progressEvents.length - OPERATION_EVENT_BUFFER_SIZE);
      }
      operation.updatedAt = event.timestamp;
      return operation;
    });
  }

  async markPreparationSucceeded(
    handoff: PawLaunchHandoff,
    now = new Date(),
  ): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const timestamp = now.toISOString();
      upsertStoredRecord(document, storedRecordFromHandoff(document, handoff, timestamp));
      return operationFromHandoff(document, handoff, "prepared", timestamp, {
        completedAt: timestamp,
        error: null,
        terminalLaunch: null,
        managedLaunch: null,
      });
    });
  }

  async markPreparationFailed(input: {
    graphPath: string;
    nodeId: string;
    error: OperationErrorInput;
    now?: Date;
  }): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const timestamp = (input.now ?? new Date()).toISOString();
      const existing = findStoredOperation(document, input.graphPath, input.nodeId);
      const nextOperation: StoredNodeLaunchOperation = {
        id: existing?.id ?? recordId(input.graphPath, input.nodeId),
        graphPath: input.graphPath,
        nodeId: input.nodeId,
        status: "preparation_failed",
        preparationRunId: existing?.preparationRunId ?? null,
        startedAt: existing?.startedAt ?? timestamp,
        updatedAt: timestamp,
        completedAt: timestamp,
        handoff: null,
        terminalLaunch: null,
        managedLaunch: null,
        error: operationError(input.error, timestamp),
        progressEvents: existing?.progressEvents ?? [],
      };
      upsertStoredOperation(document, nextOperation);
      return nextOperation;
    });
  }

  async markTerminalLaunching(
    handoff: PawLaunchHandoff,
    now = new Date(),
  ): Promise<NodeLaunchOperation> {
    return await this.updateOperationFromHandoff(handoff, "launching", now, {
      completedAt: null,
      error: null,
      terminalLaunch: null,
      managedLaunch: null,
    });
  }

  async markTerminalLaunched(
    handoff: PawLaunchHandoff,
    terminalLaunch: NodeTerminalLaunchResponse,
    now = new Date(),
  ): Promise<NodeLaunchOperation> {
    return await this.updateOperationFromHandoff(handoff, "launched_pending_binding", now, {
      completedAt: now.toISOString(),
      error: null,
      terminalLaunch,
      managedLaunch: null,
    });
  }

  async markManagedStarting(
    handoff: PawLaunchHandoff,
    now = new Date(),
  ): Promise<NodeLaunchOperation> {
    return await this.updateOperationFromHandoff(handoff, "managed_starting", now, {
      completedAt: null,
      error: null,
      terminalLaunch: null,
      managedLaunch: null,
    });
  }

  async markManagedRunning(
    handoff: PawLaunchHandoff,
    managedLaunch: NodeManagedSdkLaunchResponse,
    now = new Date(),
  ): Promise<NodeLaunchOperation> {
    return await this.updateOperationFromHandoff(handoff, "managed_running", now, {
      completedAt: now.toISOString(),
      error: null,
      terminalLaunch: null,
      managedLaunch,
    });
  }

  async markManagedFailed(input: {
    handoff: PawLaunchHandoff;
    error: OperationErrorInput;
    now?: Date;
  }): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const timestamp = (input.now ?? new Date()).toISOString();
      return operationFromHandoff(document, input.handoff, "managed_failed", timestamp, {
        completedAt: timestamp,
        error: operationError(input.error, timestamp),
        terminalLaunch: null,
        managedLaunch: null,
      });
    });
  }

  async markTerminalFailed(input: {
    handoff: PawLaunchHandoff;
    error: OperationErrorInput;
    now?: Date;
  }): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const graphPath = input.handoff.launchMetadata.graphPath;
      const nodeId = input.handoff.launchMetadata.nodeId;
      const existing = findStoredOperation(document, graphPath, nodeId);
      if (existing && existing.status !== "launching") {
        return existing;
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      return operationFromHandoff(document, input.handoff, "terminal_failed", timestamp, {
        completedAt: timestamp,
        error: operationError(input.error, timestamp),
        terminalLaunch: null,
        managedLaunch: null,
      });
    });
  }

  async upsertFromHandoff(handoff: PawLaunchHandoff, now = new Date()): Promise<NodeLaunchRecord> {
    return await this.updateDocument((document) => {
      const timestamp = now.toISOString();
      const nextRecord = storedRecordFromHandoff(document, handoff, timestamp);
      upsertStoredRecord(document, nextRecord);
      return withPathStatus(nextRecord);
    });
  }

  private async updateOperationFromHandoff(
    handoff: PawLaunchHandoff,
    status: NodeLaunchOperationStatus,
    now: Date,
    updates: Pick<StoredNodeLaunchOperation, "completedAt" | "error" | "terminalLaunch" | "managedLaunch">,
  ): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const timestamp = now.toISOString();
      return operationFromHandoff(document, handoff, status, timestamp, updates);
    });
  }

  private async updateDocument<T>(
    updater: (document: NodeLaunchRecordDocument) => T,
  ): Promise<T> {
    const pending = this.writeChain.then(async () => {
      const document = await this.readDocument();
      const result = updater(document);
      await this.writeDocument(document);
      return result;
    });
    this.writeChain = pending.then(
      () => undefined,
      () => undefined,
    );
    return await pending;
  }

  private async readDocument(): Promise<NodeLaunchRecordDocument> {
    if (!existsSync(this.recordsPath)) {
      return { version: 1, records: [], operations: [] };
    }
    const parsed = JSON.parse(await readFile(this.recordsPath, "utf8")) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.records)) {
      throw Object.assign(new Error("Node launch record store is malformed."), { statusCode: 500 });
    }
    return {
      version: 1,
      records: parsed.records
        .map(normalizeStoredRecord)
        .filter((record): record is StoredNodeLaunchRecord => record !== null),
      operations: Array.isArray(parsed.operations)
        ? parsed.operations
          .map(normalizeStoredOperation)
          .filter((operation): operation is StoredNodeLaunchOperation => operation !== null)
        : [],
    };
  }

  private async writeDocument(document: NodeLaunchRecordDocument): Promise<void> {
    await writeFileWithAtomicReplace(
      this.recordsPath,
      `${JSON.stringify(document, null, 2)}\n`,
      {
        replaceFile: this.replaceFile,
        retryDelaysMs: this.atomicReplaceRetryDelaysMs,
      },
    );
  }
}

function operationError(
  input: OperationErrorInput,
  timestamp: string,
): NodeLaunchOperationError {
  const error: NodeLaunchOperationError = {
    code: input.code,
    error: input.error,
    timestamp,
  };
  if (input.step !== undefined) {
    error.step = input.step;
  }
  if (input.input !== undefined) {
    error.input = input.input;
  }
  return error;
}

function toNodeLaunchHandoff(handoff: PawLaunchHandoff): NodeLaunchHandoff {
  return handoff as unknown as NodeLaunchHandoff;
}

function storedRecordFromHandoff(
  document: NodeLaunchRecordDocument,
  handoff: PawLaunchHandoff,
  timestamp: string,
): StoredNodeLaunchRecord {
  const metadata = handoff.launchMetadata;
  const graphPath = metadata.graphPath;
  const nodeId = metadata.nodeId;
  const existing = findStoredRecord(document, graphPath, nodeId);
  return {
    id: existing?.id ?? recordId(graphPath, nodeId),
    graphPath,
    nodeId,
    projectKey: metadata.projectKey,
    workstreamId: metadata.workstreamId,
    branch: handoff.branch,
    workId: metadata.workId,
    workTitle: metadata.workTitle,
    cwd: handoff.cwd,
    pawWorkDir: handoff.pawWorkDir,
    workflowContextPath: handoff.workflowContextPath,
    streamlinerContextPath: handoff.streamlinerContextPath,
    contextPackagePath: handoff.contextPackage.contextPackagePath,
    contextFilePath: handoff.contextPackage.contextFilePath,
    sdkSessionWorkspacePath: handoff.sdkSession?.workspacePath,
    sdkSessionStateRoot: handoff.sdkSession?.stateRoot,
    runtimeKind: handoff.runtimeKind ?? "terminal-cli",
    launchNonce: metadata.launchNonce,
    launchClaimRef: metadata.launchClaimRef,
    trackerUrl: metadata.trackerUrl,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function operationFromHandoff(
  document: NodeLaunchRecordDocument,
  handoff: PawLaunchHandoff,
  status: NodeLaunchOperationStatus,
  timestamp: string,
  updates: Pick<StoredNodeLaunchOperation, "completedAt" | "error" | "terminalLaunch" | "managedLaunch">,
): StoredNodeLaunchOperation {
  const graphPath = handoff.launchMetadata.graphPath;
  const nodeId = handoff.launchMetadata.nodeId;
  const existing = findStoredOperation(document, graphPath, nodeId);
  const nextOperation: StoredNodeLaunchOperation = {
    id: existing?.id ?? recordId(graphPath, nodeId),
    graphPath,
    nodeId,
    status,
    preparationRunId: existing?.preparationRunId ?? null,
    startedAt: existing?.startedAt ?? timestamp,
    updatedAt: timestamp,
    completedAt: updates.completedAt,
    handoff: toNodeLaunchHandoff(handoff),
    terminalLaunch: updates.terminalLaunch,
    managedLaunch: updates.managedLaunch,
    error: updates.error,
    progressEvents: existing?.progressEvents ?? [],
  };
  upsertStoredOperation(document, nextOperation);
  return nextOperation;
}

function findStoredRecord(
  document: NodeLaunchRecordDocument,
  graphPath: string,
  nodeId: string,
): StoredNodeLaunchRecord | null {
  const key = normalizeGraphPathForKey(graphPath);
  return document.records.find((candidate) =>
    candidate.nodeId === nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
  ) ?? null;
}

function findStoredOperation(
  document: NodeLaunchRecordDocument,
  graphPath: string,
  nodeId: string,
): StoredNodeLaunchOperation | null {
  const key = normalizeGraphPathForKey(graphPath);
  return document.operations.find((candidate) =>
    candidate.nodeId === nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
  ) ?? null;
}

function upsertStoredRecord(
  document: NodeLaunchRecordDocument,
  record: StoredNodeLaunchRecord,
): void {
  const key = normalizeGraphPathForKey(record.graphPath);
  const existingIndex = document.records.findIndex((candidate) =>
    candidate.nodeId === record.nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
  );
  if (existingIndex >= 0) {
    document.records[existingIndex] = record;
  } else {
    document.records.push(record);
  }
}

function upsertStoredOperation(
  document: NodeLaunchRecordDocument,
  operation: StoredNodeLaunchOperation,
): void {
  const key = normalizeGraphPathForKey(operation.graphPath);
  const existingIndex = document.operations.findIndex((candidate) =>
    candidate.nodeId === operation.nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
  );
  if (existingIndex >= 0) {
    document.operations[existingIndex] = operation;
  } else {
    document.operations.push(operation);
  }
}
