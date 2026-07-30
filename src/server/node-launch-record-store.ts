import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  isBlockingNodeLaunchOperation,
  isPendingPostPreparationTerminalLaunchOperation,
  type NodeBranchLease,
  type NodeBranchLeaseAcquireInput,
  type NodeBranchLeaseFailedLaunchRecoveryInput,
  type NodeBranchLeaseLaunchBindingInput,
  type NodeBranchLeaseOwnerInput,
  type NodeBranchLeaseReleaseInput,
  type NodeBranchLeaseTransferInput,
  type NodeBranchLeaseTransferResult,
  type NodeLaunchHandoff,
  type NodeCompanionTerminalLaunchResponse,
  type NodeLaunchOperation,
  type NodeLaunchOperationError,
  type NodeLaunchOperationProgressEvent,
  type NodeLaunchOperationStatus,
  type NodePostPreparationIntent,
  type NodeLaunchRecord,
  type NodeLaunchRecordPathStatus,
  type NodeManagedSdkLaunchResponse,
  type NodeTerminalLaunchResponse,
} from "../node-launch-record-contract";
import type { PawLaunchHandoff, PawLaunchProgressEvent } from "./launch-preparation";

interface NodeLaunchRecordDocument {
  version: 1;
  records: StoredNodeLaunchRecord[];
  operations: StoredNodeLaunchOperation[];
  branchLeases: NodeBranchLease[];
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

type OperationUpdateFields = Pick<
  StoredNodeLaunchOperation,
  "completedAt" | "error" | "terminalLaunch" | "managedLaunch"
> & Partial<Pick<
  StoredNodeLaunchOperation,
  "postPreparation" | "companionLaunch" | "companionError"
>>;

type ReplaceFile = (source: string, destination: string) => Promise<void>;

interface AtomicWriteOptions {
  replaceFile?: ReplaceFile;
  retryDelaysMs?: readonly number[];
}

const ACTIVE_LAUNCH_OPERATION_STATUSES = new Set<NodeLaunchOperationStatus>([
  "preparing",
  "launching",
  "managed_starting",
]);

function isRecoverableOrReleasableOperation(operation: NodeLaunchOperation): boolean {
  return (
    ACTIVE_LAUNCH_OPERATION_STATUSES.has(operation.status) ||
    isPendingPostPreparationTerminalLaunchOperation(operation)
  );
}

function hasOrphanedCompanionLaunch(operation: NodeLaunchOperation): boolean {
  return Boolean(
    operation.status === "launched_pending_binding" &&
    operation.postPreparation?.launchCompanion &&
    operation.terminalLaunch &&
    !operation.companionLaunch &&
    !operation.companionError
  );
}

interface NodeErrnoException extends Error {
  code?: string;
}

export class DuplicateActiveNodeLaunchOperationError extends Error {
  readonly statusCode = 409;
  readonly code = "duplicate_active_launch_operation";
  readonly operation: NodeLaunchOperation;

  constructor(operation: NodeLaunchOperation) {
    super(`Node ${operation.nodeId} already has an active launch operation.`);
    this.name = "DuplicateActiveNodeLaunchOperationError";
    this.operation = operation;
  }
}

export class NodeBranchLeaseError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly branchLease: NodeBranchLease | null;

  constructor(
    code: string,
    statusCode: number,
    message: string,
    branchLease: NodeBranchLease | null = null,
  ) {
    super(message);
    this.name = "NodeBranchLeaseError";
    this.code = code;
    this.statusCode = statusCode;
    this.branchLease = branchLease;
  }
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

function optionalBooleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeBranchLeaseKey(branchLeaseKey: string): string {
  return branchLeaseKey.trim().toLowerCase();
}

function normalizeStoredBranchLease(value: unknown): NodeBranchLease | null {
  if (!isRecord(value)) {
    return null;
  }
  const leaseId = stringField(value, "leaseId");
  const branchLeaseKey = stringField(value, "branchLeaseKey");
  const graphPath = stringField(value, "graphPath");
  const nodeId = stringField(value, "nodeId");
  const cwd = stringField(value, "cwd");
  const targetBranch = stringField(value, "targetBranch");
  const requiredStartSha = stringField(value, "requiredStartSha").toLowerCase();
  const acquiredAt = stringField(value, "acquiredAt");
  const updatedAt = stringField(value, "updatedAt");
  const status = value.status;
  const existingPullRequest = isRecord(value.existingPullRequest)
    ? {
        provider: value.existingPullRequest.provider,
        id: value.existingPullRequest.id,
      }
    : null;
  if (
    !leaseId ||
    !branchLeaseKey ||
    !graphPath ||
    !nodeId ||
    !cwd ||
    !targetBranch ||
    !/^[0-9a-f]{40}$/.test(requiredStartSha) ||
    !acquiredAt ||
    !updatedAt ||
    (status !== "active" && status !== "released" && status !== "transferred") ||
    existingPullRequest?.provider !== "azure-devops" ||
    typeof existingPullRequest.id !== "number" ||
    !Number.isInteger(existingPullRequest.id) ||
    existingPullRequest.id <= 0
  ) {
    return null;
  }
  const transferAudit = Array.isArray(value.transferAudit)
    ? value.transferAudit
      .filter(isRecord)
      .map((entry) => ({
        fromLeaseId: stringField(entry, "fromLeaseId"),
        fromGraphPath: stringField(entry, "fromGraphPath"),
        fromNodeId: stringField(entry, "fromNodeId"),
        toLeaseId: stringField(entry, "toLeaseId"),
        toGraphPath: stringField(entry, "toGraphPath"),
        toNodeId: stringField(entry, "toNodeId"),
        reviewedBy: stringField(entry, "reviewedBy"),
        reason: stringField(entry, "reason"),
        transferredAt: stringField(entry, "transferredAt"),
      }))
      .filter((entry) => Object.values(entry).every((item) => item.length > 0))
    : [];
  const failedLaunches = Array.isArray(value.failedLaunches)
    ? value.failedLaunches
      .filter(isRecord)
      .map((entry) => ({
        launchClaimId: stringField(entry, "launchClaimId"),
        registryId: nullableStringField(entry, "registryId"),
        failureCode: stringField(entry, "failureCode"),
        failureReason: stringField(entry, "failureReason"),
        failedAt: stringField(entry, "failedAt"),
      }))
      .filter((entry) =>
        entry.launchClaimId.length > 0 &&
        entry.failureCode.length > 0 &&
        entry.failureReason.length > 0 &&
        entry.failedAt.length > 0
      )
    : [];
  return {
    leaseId,
    branchLeaseKey,
    status,
    projectKey: stringField(value, "projectKey"),
    workstreamId: stringField(value, "workstreamId"),
    graphPath,
    nodeId,
    targetRepoId: stringField(value, "targetRepoId"),
    cwd,
    targetBranch,
    requiredStartSha,
    existingPullRequest: {
      provider: "azure-devops",
      id: existingPullRequest.id,
    },
    launchMode: "existing-shared-azure-devops",
    completionMode: "branch-contribution",
    launchClaimId: nullableStringField(value, "launchClaimId"),
    registryId: nullableStringField(value, "registryId"),
    acquiredAt,
    updatedAt,
    reclaimedAt: nullableStringField(value, "reclaimedAt"),
    reclaimCount: optionalNumberField(value, "reclaimCount") ?? 0,
    releasedAt: nullableStringField(value, "releasedAt"),
    releasedBy: nullableStringField(value, "releasedBy"),
    releaseReason: nullableStringField(value, "releaseReason"),
    endSha: nullableStringField(value, "endSha"),
    transferredAt: nullableStringField(value, "transferredAt"),
    transferredToLeaseId: nullableStringField(value, "transferredToLeaseId"),
    transferredFromLeaseId: nullableStringField(value, "transferredFromLeaseId"),
    transferAudit,
    failedLaunches,
  };
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
    launchMode:
      value.launchMode === "standard-github" ||
      value.launchMode === "standard-azure-devops" ||
      value.launchMode === "existing-shared-azure-devops"
        ? value.launchMode
        : undefined,
    ...(Object.prototype.hasOwnProperty.call(value, "completionMode")
      ? {
          completionMode: value.completionMode === "branch-contribution"
            ? value.completionMode
            : null,
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "targetBranch")
      ? { targetBranch: nullableStringField(value, "targetBranch") }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "requiredStartSha")
      ? { requiredStartSha: nullableStringField(value, "requiredStartSha") }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "existingPullRequest")
      ? {
          existingPullRequest:
            isRecord(value.existingPullRequest) &&
            value.existingPullRequest.provider === "azure-devops" &&
            typeof value.existingPullRequest.id === "number"
              ? {
                  provider: "azure-devops" as const,
                  id: value.existingPullRequest.id,
                }
              : null,
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "branchLease")
      ? { branchLease: normalizeStoredBranchLease(value.branchLease) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "endSha")
      ? { endSha: nullableStringField(value, "endSha") }
      : {}),
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

function normalizePostPreparationIntent(value: unknown): NodePostPreparationIntent | null {
  if (!isRecord(value)) {
    return null;
  }
  const intent: NodePostPreparationIntent = {};
  if (isRecord(value.launchTerminal)) {
    const launchTerminal: NodePostPreparationIntent["launchTerminal"] = {};
    const kickoffPrompt = nullableStringField(value.launchTerminal, "kickoffPrompt");
    const terminalTitle = nullableStringField(value.launchTerminal, "terminalTitle");
    const terminalColor = nullableStringField(value.launchTerminal, "terminalColor");
    if (kickoffPrompt !== null) {
      launchTerminal.kickoffPrompt = kickoffPrompt;
    }
    if (terminalTitle !== null) {
      launchTerminal.terminalTitle = terminalTitle;
    }
    if (terminalColor !== null) {
      launchTerminal.terminalColor = terminalColor;
    }
    intent.launchTerminal = launchTerminal;
  }
  if (isRecord(value.launchCompanion)) {
    const kickoffPrompt = stringField(value.launchCompanion, "kickoffPrompt");
    if (kickoffPrompt) {
      const usePawReviewAgent = optionalBooleanField(
        value.launchCompanion,
        "usePawReviewAgent",
      );
      intent.launchCompanion = {
        kickoffPrompt,
        ...(usePawReviewAgent !== undefined ? { usePawReviewAgent } : {}),
      };
    }
  }
  return intent.launchTerminal || intent.launchCompanion ? intent : null;
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
    postPreparation: normalizePostPreparationIntent(value.postPreparation),
    terminalLaunch: isRecord(value.terminalLaunch) ? value.terminalLaunch as unknown as NodeTerminalLaunchResponse : null,
    managedLaunch: isRecord(value.managedLaunch) ? value.managedLaunch as unknown as NodeManagedSdkLaunchResponse : null,
    companionLaunch: isRecord(value.companionLaunch) ? value.companionLaunch as unknown as NodeCompanionTerminalLaunchResponse : null,
    companionError: normalizeOperationError(value.companionError),
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

  async getBranchLease(leaseId: string): Promise<NodeBranchLease | null> {
    const document = await this.readDocument();
    const branchLease = document.branchLeases.find((candidate) => candidate.leaseId === leaseId);
    return branchLease ? structuredClone(branchLease) : null;
  }

  async listBranchLeases(input: {
    graphPath?: string;
    nodeId?: string;
    activeOnly?: boolean;
  } = {}): Promise<NodeBranchLease[]> {
    const document = await this.readDocument();
    const graphKey = input.graphPath
      ? normalizeGraphPathForKey(input.graphPath)
      : null;
    return document.branchLeases
      .filter((branchLease) =>
        (!graphKey || normalizeGraphPathForKey(branchLease.graphPath) === graphKey) &&
        (!input.nodeId || branchLease.nodeId === input.nodeId) &&
        (!input.activeOnly || branchLease.status === "active")
      )
      .map((branchLease) => structuredClone(branchLease));
  }

  async acquireBranchLease(input: NodeBranchLeaseAcquireInput): Promise<NodeBranchLease> {
    assertBranchLeaseContractInput(input);
    return await this.updateDocument((document) => {
      const timestamp = (input.now ?? new Date()).toISOString();
      const normalizedKey = normalizeBranchLeaseKey(input.branchLeaseKey);
      const active = document.branchLeases.find((candidate) =>
        candidate.status === "active" &&
        normalizeBranchLeaseKey(candidate.branchLeaseKey) === normalizedKey
      );
      if (active) {
        const sameOwner =
          normalizeGraphPathForKey(active.graphPath) === normalizeGraphPathForKey(input.graphPath) &&
          active.nodeId === input.nodeId;
        if (!sameOwner) {
          throw new NodeBranchLeaseError(
            "branch_lease_conflict",
            409,
            `Branch lease '${input.branchLeaseKey}' is held by node ${active.nodeId}.`,
            structuredClone(active),
          );
        }
        if (
          active.targetRepoId !== input.targetRepoId ||
          normalizePathForComparison(active.cwd) !== normalizePathForComparison(input.cwd) ||
          active.targetBranch !== input.targetBranch ||
          active.requiredStartSha !== input.requiredStartSha.toLowerCase() ||
          active.existingPullRequest.provider !== input.existingPullRequest.provider ||
          active.existingPullRequest.id !== input.existingPullRequest.id
        ) {
          throw new NodeBranchLeaseError(
            "branch_lease_owner_mismatch",
            409,
            `Existing branch lease '${input.branchLeaseKey}' does not match the requested shared-branch contract.`,
            structuredClone(active),
          );
        }
        if (active.launchClaimId) {
          throw new NodeBranchLeaseError(
            "branch_lease_bound_to_session",
            409,
            `Branch lease '${input.branchLeaseKey}' is already bound to launch claim ${active.launchClaimId}; resume that session or transfer the lease explicitly.`,
            structuredClone(active),
          );
        }
        active.reclaimedAt = timestamp;
        active.reclaimCount += 1;
        active.updatedAt = timestamp;
        return structuredClone(active);
      }

      const branchLease: NodeBranchLease = {
        leaseId: randomUUID(),
        branchLeaseKey: input.branchLeaseKey.trim(),
        status: "active",
        projectKey: input.projectKey,
        workstreamId: input.workstreamId,
        graphPath: input.graphPath,
        nodeId: input.nodeId,
        targetRepoId: input.targetRepoId,
        cwd: input.cwd,
        targetBranch: input.targetBranch,
        requiredStartSha: input.requiredStartSha.toLowerCase(),
        existingPullRequest: { ...input.existingPullRequest },
        launchMode: "existing-shared-azure-devops",
        completionMode: "branch-contribution",
        launchClaimId: null,
        registryId: null,
        acquiredAt: timestamp,
        updatedAt: timestamp,
        reclaimedAt: null,
        reclaimCount: 0,
        releasedAt: null,
        releasedBy: null,
        releaseReason: null,
        endSha: null,
        transferredAt: null,
        transferredToLeaseId: null,
        transferredFromLeaseId: null,
        transferAudit: [],
        failedLaunches: [],
      };
      document.branchLeases.push(branchLease);
      return structuredClone(branchLease);
    });
  }

  async assertBranchLeaseActive(input: NodeBranchLeaseOwnerInput): Promise<NodeBranchLease> {
    const document = await this.readDocument();
    const branchLease = findActiveBranchLease(document, input);
    return structuredClone(branchLease);
  }

  async bindBranchLeaseToLaunch(
    input: NodeBranchLeaseLaunchBindingInput,
  ): Promise<NodeBranchLease> {
    return await this.updateDocument((document) => {
      const branchLease = findActiveBranchLease(document, input);
      if (branchLease.launchClaimId && branchLease.launchClaimId !== input.launchClaimId) {
        throw new NodeBranchLeaseError(
          "branch_lease_claim_mismatch",
          409,
          `Branch lease ${branchLease.leaseId} is already bound to launch claim ${branchLease.launchClaimId}.`,
          structuredClone(branchLease),
        );
      }
      if (branchLease.registryId && branchLease.registryId !== input.registryId) {
        throw new NodeBranchLeaseError(
          "branch_lease_registry_mismatch",
          409,
          `Branch lease ${branchLease.leaseId} is already bound to registry row ${branchLease.registryId}.`,
          structuredClone(branchLease),
        );
      }
      branchLease.launchClaimId = input.launchClaimId;
      branchLease.registryId = input.registryId;
      branchLease.updatedAt = (input.now ?? new Date()).toISOString();
      updateStoredLaunchMetadataForLease(document, branchLease, input.launchClaimId);
      return structuredClone(branchLease);
    });
  }

  async reclaimBranchLeaseForSession(
    input: NodeBranchLeaseLaunchBindingInput,
  ): Promise<NodeBranchLease> {
    return await this.updateDocument((document) => {
      const branchLease = findActiveBranchLease(document, input);
      if (
        branchLease.launchClaimId !== input.launchClaimId ||
        branchLease.registryId !== input.registryId
      ) {
        throw new NodeBranchLeaseError(
          "branch_lease_session_mismatch",
          409,
          `Branch lease ${branchLease.leaseId} is not bound to the requested launch session.`,
          structuredClone(branchLease),
        );
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      branchLease.reclaimedAt = timestamp;
      branchLease.reclaimCount += 1;
      branchLease.updatedAt = timestamp;
      updateStoredLaunchMetadataForLease(document, branchLease, input.launchClaimId);
      return structuredClone(branchLease);
    });
  }

  async recoverBranchLeaseAfterFailedLaunch(
    input: NodeBranchLeaseFailedLaunchRecoveryInput,
  ): Promise<NodeBranchLease> {
    assertNonEmptyBranchLeaseField(input.failureCode, "failureCode");
    assertNonEmptyBranchLeaseField(input.failureReason, "failureReason");
    return await this.updateDocument((document) => {
      const branchLease = findActiveBranchLease(document, input);
      if (
        branchLease.launchClaimId !== input.launchClaimId ||
        branchLease.registryId !== input.registryId
      ) {
        throw new NodeBranchLeaseError(
          "branch_lease_session_mismatch",
          409,
          `Branch lease ${branchLease.leaseId} is not bound to the failed launch session.`,
          structuredClone(branchLease),
        );
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      branchLease.failedLaunches = [
        ...branchLease.failedLaunches,
        {
          launchClaimId: input.launchClaimId,
          registryId: input.registryId,
          failureCode: input.failureCode,
          failureReason: input.failureReason,
          failedAt: timestamp,
        },
      ];
      branchLease.launchClaimId = null;
      branchLease.registryId = null;
      branchLease.updatedAt = timestamp;
      updateStoredLaunchMetadataForLease(document, branchLease, null);
      return structuredClone(branchLease);
    });
  }

  async releaseBranchLease(input: NodeBranchLeaseReleaseInput): Promise<NodeBranchLease> {
    assertGitSha(input.acceptedEndSha, "acceptedEndSha");
    assertNonEmptyBranchLeaseField(input.acceptedBy, "acceptedBy");
    assertNonEmptyBranchLeaseField(input.reason, "reason");
    return await this.updateDocument((document) => {
      const branchLease = findBranchLeaseById(document, input.leaseId);
      assertBranchLeaseOwner(branchLease, input.graphPath, input.nodeId);
      assertBranchLeaseSessionAuthorization(
        branchLease,
        input.launchClaimId,
        input.registryId,
      );
      if (branchLease.status !== "active") {
        throw new NodeBranchLeaseError(
          "branch_lease_not_active",
          409,
          `Branch lease ${branchLease.leaseId} is ${branchLease.status}.`,
          structuredClone(branchLease),
        );
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      branchLease.status = "released";
      branchLease.releasedAt = timestamp;
      branchLease.releasedBy = input.acceptedBy;
      branchLease.releaseReason = input.reason;
      branchLease.endSha = input.acceptedEndSha.toLowerCase();
      branchLease.updatedAt = timestamp;
      updateStoredLaunchMetadataForLease(
        document,
        branchLease,
        branchLease.launchClaimId,
      );
      return structuredClone(branchLease);
    });
  }

  async transferBranchLease(
    input: NodeBranchLeaseTransferInput,
  ): Promise<NodeBranchLeaseTransferResult> {
    assertBranchLeaseContractInput(input.target);
    assertNonEmptyBranchLeaseField(input.reviewedBy, "reviewedBy");
    assertNonEmptyBranchLeaseField(input.reason, "reason");
    return await this.updateDocument((document) => {
      const branchLease = findBranchLeaseById(document, input.leaseId);
      assertBranchLeaseOwner(branchLease, input.graphPath, input.nodeId);
      assertBranchLeaseSessionAuthorization(
        branchLease,
        input.launchClaimId,
        input.registryId,
      );
      if (branchLease.status !== "active") {
        throw new NodeBranchLeaseError(
          "branch_lease_not_active",
          409,
          `Branch lease ${branchLease.leaseId} is ${branchLease.status}.`,
          structuredClone(branchLease),
        );
      }
      if (
        normalizeBranchLeaseKey(branchLease.branchLeaseKey) !==
          normalizeBranchLeaseKey(input.target.branchLeaseKey) ||
        branchLease.targetBranch !== input.target.targetBranch ||
        branchLease.targetRepoId !== input.target.targetRepoId ||
        normalizePathForComparison(branchLease.cwd) !==
          normalizePathForComparison(input.target.cwd) ||
        branchLease.existingPullRequest.provider !== input.target.existingPullRequest.provider ||
        branchLease.existingPullRequest.id !== input.target.existingPullRequest.id
      ) {
        throw new NodeBranchLeaseError(
          "branch_lease_transfer_target_mismatch",
          409,
          "Reviewed branch lease transfer must keep the same logical repository, branch, and existing pull request.",
          structuredClone(branchLease),
        );
      }

      const timestamp = (input.now ?? new Date()).toISOString();
      const nextLeaseId = randomUUID();
      const audit = {
        fromLeaseId: branchLease.leaseId,
        fromGraphPath: branchLease.graphPath,
        fromNodeId: branchLease.nodeId,
        toLeaseId: nextLeaseId,
        toGraphPath: input.target.graphPath,
        toNodeId: input.target.nodeId,
        reviewedBy: input.reviewedBy,
        reason: input.reason,
        transferredAt: timestamp,
      };
      branchLease.status = "transferred";
      branchLease.transferredAt = timestamp;
      branchLease.transferredToLeaseId = nextLeaseId;
      branchLease.updatedAt = timestamp;
      branchLease.transferAudit = [...branchLease.transferAudit, audit];

      const nextLease: NodeBranchLease = {
        leaseId: nextLeaseId,
        branchLeaseKey: input.target.branchLeaseKey.trim(),
        status: "active",
        projectKey: input.target.projectKey,
        workstreamId: input.target.workstreamId,
        graphPath: input.target.graphPath,
        nodeId: input.target.nodeId,
        targetRepoId: input.target.targetRepoId,
        cwd: input.target.cwd,
        targetBranch: input.target.targetBranch,
        requiredStartSha: input.target.requiredStartSha.toLowerCase(),
        existingPullRequest: { ...input.target.existingPullRequest },
        launchMode: "existing-shared-azure-devops",
        completionMode: "branch-contribution",
        launchClaimId: null,
        registryId: null,
        acquiredAt: timestamp,
        updatedAt: timestamp,
        reclaimedAt: null,
        reclaimCount: 0,
        releasedAt: null,
        releasedBy: null,
        releaseReason: null,
        endSha: null,
        transferredAt: null,
        transferredToLeaseId: null,
        transferredFromLeaseId: branchLease.leaseId,
        transferAudit: [...branchLease.transferAudit],
        failedLaunches: [...branchLease.failedLaunches],
      };
      document.branchLeases.push(nextLease);
      updateStoredLaunchMetadataForLease(
        document,
        branchLease,
        branchLease.launchClaimId,
      );
      return {
        previousLease: structuredClone(branchLease),
        branchLease: structuredClone(nextLease),
      };
    });
  }

  async getOperation(graphPath: string, nodeId: string): Promise<NodeLaunchOperation | null> {
    const document = await this.readDocument();
    const key = normalizeGraphPathForKey(graphPath);
    const operation = document.operations.find((candidate) =>
      candidate.nodeId === nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
    );
    return operation ? { ...operation, progressEvents: [...operation.progressEvents] } : null;
  }

  async clearNodeLaunchState(input: {
    graphPath: string;
    nodeId: string;
  }): Promise<{
    record: NodeLaunchRecord | null;
    operation: NodeLaunchOperation | null;
  }> {
    return await this.updateDocument((document) => {
      const key = normalizeGraphPathForKey(input.graphPath);
      const recordIndex = document.records.findIndex((candidate) =>
        candidate.nodeId === input.nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
      );
      const operationIndex = document.operations.findIndex((candidate) =>
        candidate.nodeId === input.nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
      );
      const [record] = recordIndex >= 0 ? document.records.splice(recordIndex, 1) : [];
      const [operation] = operationIndex >= 0 ? document.operations.splice(operationIndex, 1) : [];
      return {
        record: record ? withPathStatus(record) : null,
        operation: operation ? { ...operation, progressEvents: [...operation.progressEvents] } : null,
      };
    });
  }

  /**
   * Mark every persisted operation that is in an in-memory-controlled state
   * as recoverable. That includes active statuses (`preparing`, `launching`,
   * `managed_starting`) and prepared operations waiting for server-side
   * post-preparation launch. Intended to run once on API startup so that
   * operations whose in-memory run state was lost do not appear stuck in the
   * UI forever.
   *
   * Returns the operations that were recovered so callers can log them.
   */
  async recoverOrphanedOperations(now = new Date()): Promise<NodeLaunchOperation[]> {
    const recovered: NodeLaunchOperation[] = [];
    await this.updateDocument((document) => {
      const timestamp = now.toISOString();
      for (const operation of document.operations) {
        if (isRecoverableOrReleasableOperation(operation)) {
          operation.status = "preparation_failed";
          operation.completedAt = timestamp;
          operation.updatedAt = timestamp;
          operation.terminalLaunch = null;
          operation.managedLaunch = null;
          operation.companionLaunch = null;
          operation.companionError = null;
          operation.error = operationError(
            {
              code: "operation_orphaned",
              error:
                "Operation was in flight when the API restarted; in-memory run state was lost. Released so the node can be re-launched.",
            },
            timestamp,
          );
          recovered.push({ ...operation, progressEvents: [...operation.progressEvents] });
          continue;
        }
        if (hasOrphanedCompanionLaunch(operation)) {
          operation.updatedAt = timestamp;
          operation.companionError = operationError(
            {
              code: "companion_operation_orphaned",
              error:
                "Companion launch status was in flight when the API restarted; in-memory run state was lost.",
            },
            timestamp,
          );
          recovered.push({ ...operation, progressEvents: [...operation.progressEvents] });
        }
      }
      return undefined;
    });
    return recovered;
  }

  /**
   * Manually release a stuck active or pending post-preparation operation,
   * marking it `preparation_failed` with a user-cancellation error code so
   * the UI can unblock without a server restart. Returns null if the
   * operation is not found OR is not eligible for release.
   */
  async releaseActiveOperation(input: {
    graphPath: string;
    nodeId: string;
    reason?: string;
    now?: Date;
  }): Promise<NodeLaunchOperation | null> {
    return await this.updateDocument((document) => {
      const operation = findStoredOperation(document, input.graphPath, input.nodeId);
      if (!operation || !isRecoverableOrReleasableOperation(operation)) {
        return null;
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      operation.status = "preparation_failed";
      operation.completedAt = timestamp;
      operation.updatedAt = timestamp;
      operation.terminalLaunch = null;
      operation.managedLaunch = null;
      operation.companionLaunch = null;
      operation.companionError = null;
      operation.error = operationError(
        {
          code: "operation_released_by_user",
          error: input.reason ?? "Manually released by the user.",
        },
        timestamp,
      );
      return operation;
    });
  }

  async markLaunchedPendingBindingBound(input: {
    graphPath: string;
    nodeId: string;
    now?: Date;
  }): Promise<NodeLaunchOperation | null> {
    return await this.updateDocument((document) => {
      const operation = findStoredOperation(document, input.graphPath, input.nodeId);
      if (!operation || operation.status !== "launched_pending_binding") {
        return null;
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      operation.status = "bound";
      operation.completedAt = operation.completedAt ?? timestamp;
      operation.updatedAt = timestamp;
      operation.error = null;
      return { ...operation, progressEvents: [...operation.progressEvents] };
    });
  }

  async releaseLaunchedPendingBindingOperation(input: {
    graphPath: string;
    nodeId: string;
    reason?: string;
    now?: Date;
  }): Promise<NodeLaunchOperation | null> {
    return await this.updateDocument((document) => {
      const operation = findStoredOperation(document, input.graphPath, input.nodeId);
      if (!operation || operation.status !== "launched_pending_binding") {
        return null;
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      operation.status = "preparation_failed";
      operation.completedAt = timestamp;
      operation.updatedAt = timestamp;
      operation.terminalLaunch = null;
      operation.managedLaunch = null;
      operation.companionLaunch = null;
      operation.companionError = null;
      operation.error = operationError(
        {
          code: "operation_released_by_user",
          error: input.reason ?? "Manually released by the user.",
        },
        timestamp,
      );
      return { ...operation, progressEvents: [...operation.progressEvents] };
    });
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
    postPreparation?: NodePostPreparationIntent | null;
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
        postPreparation: input.postPreparation ?? null,
        terminalLaunch: null,
        managedLaunch: null,
        companionLaunch: null,
        companionError: null,
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
        companionLaunch: null,
        companionError: null,
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
        postPreparation: existing?.postPreparation ?? null,
        terminalLaunch: null,
        managedLaunch: null,
        companionLaunch: null,
        companionError: null,
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
    return await this.startLaunchOperationFromHandoff(handoff, "launching", now, {
      completedAt: null,
      error: null,
      terminalLaunch: null,
      managedLaunch: null,
    });
  }

  async markPostPreparationTerminalLaunching(
    handoff: PawLaunchHandoff,
    now = new Date(),
  ): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const graphPath = handoff.launchMetadata.graphPath;
      const nodeId = handoff.launchMetadata.nodeId;
      const existing = findStoredOperation(document, graphPath, nodeId);
      if (!existing?.postPreparation?.launchTerminal || existing.status !== "prepared") {
        throw new DuplicateActiveNodeLaunchOperationError(existing ?? {
          id: recordId(graphPath, nodeId),
          graphPath,
          nodeId,
          status: "launching",
          preparationRunId: null,
          startedAt: now.toISOString(),
          updatedAt: now.toISOString(),
          completedAt: null,
          handoff: null,
          postPreparation: null,
          terminalLaunch: null,
          managedLaunch: null,
          companionLaunch: null,
          companionError: null,
          error: null,
          progressEvents: [],
        });
      }
      const timestamp = now.toISOString();
      return operationFromHandoff(document, handoff, "launching", timestamp, {
        completedAt: null,
        error: null,
        terminalLaunch: null,
        managedLaunch: null,
        companionLaunch: null,
        companionError: null,
      });
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

  async markCompanionLaunched(input: {
    handoff: PawLaunchHandoff;
    companionLaunch: NodeCompanionTerminalLaunchResponse;
    now?: Date;
  }): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const graphPath = input.handoff.launchMetadata.graphPath;
      const nodeId = input.handoff.launchMetadata.nodeId;
      const operation = findStoredOperation(document, graphPath, nodeId);
      if (!operation) {
        throw Object.assign(new Error(`Node ${nodeId} does not have a launch operation.`), {
          statusCode: 404,
          code: "node_launch_operation_not_found",
        });
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      operation.updatedAt = timestamp;
      operation.companionLaunch = input.companionLaunch;
      operation.companionError = null;
      return { ...operation, progressEvents: [...operation.progressEvents] };
    });
  }

  async markCompanionFailed(input: {
    handoff: PawLaunchHandoff;
    error: OperationErrorInput;
    now?: Date;
  }): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const graphPath = input.handoff.launchMetadata.graphPath;
      const nodeId = input.handoff.launchMetadata.nodeId;
      const operation = findStoredOperation(document, graphPath, nodeId);
      if (!operation) {
        throw Object.assign(new Error(`Node ${nodeId} does not have a launch operation.`), {
          statusCode: 404,
          code: "node_launch_operation_not_found",
        });
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      operation.updatedAt = timestamp;
      operation.companionLaunch = null;
      operation.companionError = operationError(input.error, timestamp);
      return { ...operation, progressEvents: [...operation.progressEvents] };
    });
  }

  async markManagedStarting(
    handoff: PawLaunchHandoff,
    now = new Date(),
  ): Promise<NodeLaunchOperation> {
    return await this.startLaunchOperationFromHandoff(handoff, "managed_starting", now, {
      completedAt: null,
      error: null,
      terminalLaunch: null,
      managedLaunch: null,
    });
  }

  /**
   * Marks the launch operation complete once the SDK runner accepts the node.
   * The ongoing managed runtime state lives on the session registry record.
   */
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
      const graphPath = input.handoff.launchMetadata.graphPath;
      const nodeId = input.handoff.launchMetadata.nodeId;
      const existing = findStoredOperation(document, graphPath, nodeId);
      if (existing && existing.status !== "managed_starting") {
        return existing;
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      return operationFromHandoff(document, input.handoff, "managed_failed", timestamp, {
        completedAt: timestamp,
        error: operationError(input.error, timestamp),
        terminalLaunch: null,
        managedLaunch: null,
        companionLaunch: null,
        companionError: null,
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
        companionLaunch: null,
        companionError: null,
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
    updates: OperationUpdateFields,
  ): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const timestamp = now.toISOString();
      return operationFromHandoff(document, handoff, status, timestamp, updates);
    });
  }

  private async startLaunchOperationFromHandoff(
    handoff: PawLaunchHandoff,
    status: NodeLaunchOperationStatus,
    now: Date,
    updates: OperationUpdateFields,
  ): Promise<NodeLaunchOperation> {
    return await this.updateDocument((document) => {
      const graphPath = handoff.launchMetadata.graphPath;
      const nodeId = handoff.launchMetadata.nodeId;
      const existing = findStoredOperation(document, graphPath, nodeId);
      if (existing && isBlockingNodeLaunchOperation(existing)) {
        throw new DuplicateActiveNodeLaunchOperationError({
          ...existing,
          progressEvents: [...existing.progressEvents],
        });
      }
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
      return { version: 1, records: [], operations: [], branchLeases: [] };
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
      branchLeases: Array.isArray(parsed.branchLeases)
        ? parsed.branchLeases
          .map(normalizeStoredBranchLease)
          .filter((branchLease): branchLease is NodeBranchLease => branchLease !== null)
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
    launchMode: metadata.launchMode ?? "standard-github",
    completionMode: metadata.completionMode ?? null,
    targetBranch: metadata.targetBranch ?? null,
    requiredStartSha: metadata.requiredStartSha ?? null,
    existingPullRequest: metadata.existingPullRequest
      ? { ...metadata.existingPullRequest }
      : null,
    branchLease: metadata.branchLease
      ? structuredClone(metadata.branchLease)
      : null,
    endSha: existing?.endSha ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function operationFromHandoff(
  document: NodeLaunchRecordDocument,
  handoff: PawLaunchHandoff,
  status: NodeLaunchOperationStatus,
  timestamp: string,
  updates: OperationUpdateFields,
): StoredNodeLaunchOperation {
  const graphPath = handoff.launchMetadata.graphPath;
  const nodeId = handoff.launchMetadata.nodeId;
  const existing = findStoredOperation(document, graphPath, nodeId);
  const launchHandoff = structuredClone(toNodeLaunchHandoff(handoff));
  const currentRecord = findStoredRecord(document, graphPath, nodeId);
  if (
    currentRecord?.branchLease &&
    launchHandoff.launchMetadata.branchLease?.leaseId ===
      currentRecord.branchLease.leaseId
  ) {
    launchHandoff.launchMetadata.branchLease = structuredClone(
      currentRecord.branchLease,
    );
    launchHandoff.launchMetadata.launchClaimRef = currentRecord.launchClaimRef;
  }
  const nextOperation: StoredNodeLaunchOperation = {
    id: existing?.id ?? recordId(graphPath, nodeId),
    graphPath,
    nodeId,
    status,
    preparationRunId: existing?.preparationRunId ?? null,
    startedAt: existing?.startedAt ?? timestamp,
    updatedAt: timestamp,
    completedAt: updates.completedAt,
    handoff: launchHandoff,
    postPreparation: Object.prototype.hasOwnProperty.call(updates, "postPreparation")
      ? updates.postPreparation ?? null
      : existing?.postPreparation ?? null,
    terminalLaunch: updates.terminalLaunch,
    managedLaunch: updates.managedLaunch,
    companionLaunch: Object.prototype.hasOwnProperty.call(updates, "companionLaunch")
      ? updates.companionLaunch ?? null
      : existing?.companionLaunch ?? null,
    companionError: Object.prototype.hasOwnProperty.call(updates, "companionError")
      ? updates.companionError ?? null
      : existing?.companionError ?? null,
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

function findBranchLeaseById(
  document: NodeLaunchRecordDocument,
  leaseId: string,
): NodeBranchLease {
  const branchLease = document.branchLeases.find((candidate) => candidate.leaseId === leaseId);
  if (!branchLease) {
    throw new NodeBranchLeaseError(
      "branch_lease_not_found",
      404,
      `Branch lease ${leaseId} does not exist.`,
    );
  }
  return branchLease;
}

function assertNonEmptyBranchLeaseField(value: string, field: string): void {
  if (!value.trim()) {
    throw new NodeBranchLeaseError(
      "invalid_branch_lease",
      400,
      `${field} is required.`,
    );
  }
}

function assertGitSha(value: string, field: string): void {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new NodeBranchLeaseError(
      "invalid_branch_lease",
      400,
      `${field} must be a 40-character hexadecimal git SHA.`,
    );
  }
}

function assertBranchLeaseContractInput(
  input: Omit<NodeBranchLeaseAcquireInput, "now">,
): void {
  assertNonEmptyBranchLeaseField(input.branchLeaseKey, "branchLeaseKey");
  assertNonEmptyBranchLeaseField(input.projectKey, "projectKey");
  assertNonEmptyBranchLeaseField(input.workstreamId, "workstreamId");
  assertNonEmptyBranchLeaseField(input.graphPath, "graphPath");
  assertNonEmptyBranchLeaseField(input.nodeId, "nodeId");
  assertNonEmptyBranchLeaseField(input.targetRepoId, "targetRepoId");
  assertNonEmptyBranchLeaseField(input.cwd, "cwd");
  assertNonEmptyBranchLeaseField(input.targetBranch, "targetBranch");
  assertGitSha(input.requiredStartSha, "requiredStartSha");
  if (
    input.existingPullRequest.provider !== "azure-devops" ||
    !Number.isInteger(input.existingPullRequest.id) ||
    input.existingPullRequest.id <= 0
  ) {
    throw new NodeBranchLeaseError(
      "invalid_branch_lease",
      400,
      "existingPullRequest must identify a positive Azure DevOps pull request id.",
    );
  }
}

function assertBranchLeaseOwner(
  branchLease: NodeBranchLease,
  graphPath: string,
  nodeId: string,
): void {
  if (
    normalizeGraphPathForKey(branchLease.graphPath) !== normalizeGraphPathForKey(graphPath) ||
    branchLease.nodeId !== nodeId
  ) {
    throw new NodeBranchLeaseError(
      "branch_lease_owner_mismatch",
      409,
      `Branch lease ${branchLease.leaseId} is owned by node ${branchLease.nodeId}.`,
      structuredClone(branchLease),
    );
  }
}

function findActiveBranchLease(
  document: NodeLaunchRecordDocument,
  input: NodeBranchLeaseOwnerInput,
): NodeBranchLease {
  const branchLease = findBranchLeaseById(document, input.leaseId);
  assertBranchLeaseOwner(branchLease, input.graphPath, input.nodeId);
  if (branchLease.status !== "active") {
    throw new NodeBranchLeaseError(
      "branch_lease_not_active",
      409,
      `Branch lease ${branchLease.leaseId} is ${branchLease.status}.`,
      structuredClone(branchLease),
    );
  }
  if (
    normalizeBranchLeaseKey(branchLease.branchLeaseKey) !==
      normalizeBranchLeaseKey(input.branchLeaseKey) ||
    normalizePathForComparison(branchLease.cwd) !==
      normalizePathForComparison(input.cwd) ||
    branchLease.targetBranch !== input.targetBranch ||
    branchLease.requiredStartSha !== input.requiredStartSha.toLowerCase()
  ) {
    throw new NodeBranchLeaseError(
      "branch_lease_contract_mismatch",
      409,
      `Branch lease ${branchLease.leaseId} does not match the shared-branch launch contract.`,
      structuredClone(branchLease),
    );
  }
  return branchLease;
}

function assertBranchLeaseSessionAuthorization(
  branchLease: NodeBranchLease,
  launchClaimId: string | null | undefined,
  registryId: string | null | undefined,
): void {
  if (
    branchLease.launchClaimId !== null &&
    branchLease.launchClaimId !== launchClaimId
  ) {
    throw new NodeBranchLeaseError(
      "branch_lease_claim_mismatch",
      409,
      `Branch lease ${branchLease.leaseId} requires launch claim ${branchLease.launchClaimId}.`,
      structuredClone(branchLease),
    );
  }
  if (branchLease.registryId !== null && branchLease.registryId !== registryId) {
    throw new NodeBranchLeaseError(
      "branch_lease_registry_mismatch",
      409,
      `Branch lease ${branchLease.leaseId} requires registry row ${branchLease.registryId}.`,
      structuredClone(branchLease),
    );
  }
}

function updateStoredLaunchMetadataForLease(
  document: NodeLaunchRecordDocument,
  branchLease: NodeBranchLease,
  launchClaimId: string | null,
): void {
  const record = findStoredRecord(document, branchLease.graphPath, branchLease.nodeId);
  if (record) {
    record.launchClaimRef = launchClaimId;
    record.branchLease = structuredClone(branchLease);
    record.endSha = branchLease.endSha;
    record.updatedAt = branchLease.updatedAt;
  }
  const operation = findStoredOperation(
    document,
    branchLease.graphPath,
    branchLease.nodeId,
  );
  if (operation?.handoff) {
    operation.handoff.launchMetadata.launchClaimRef = launchClaimId;
    operation.handoff.launchMetadata.branchLease = structuredClone(branchLease);
    operation.updatedAt = branchLease.updatedAt;
  }
}
