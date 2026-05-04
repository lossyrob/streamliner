import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type {
  NodeLaunchRecord,
  NodeLaunchRecordPathStatus,
} from "../node-launch-record-contract";
import type { PawLaunchHandoff } from "./launch-preparation";

interface NodeLaunchRecordDocument {
  version: 1;
  records: StoredNodeLaunchRecord[];
}

type StoredNodeLaunchRecord = Omit<NodeLaunchRecord, "pathStatus">;

function defaultRecordsPath(): string {
  const stateRoot = resolve(process.env.STREAMLINER_STATE_ROOT ?? join(homedir(), ".streamliner", "state"));
  return join(stateRoot, "node-launch-records.json");
}

function normalizeGraphPathForKey(graphPath: string): string {
  return resolve(graphPath).toLowerCase();
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
    launchNonce: nullableStringField(value, "launchNonce"),
    launchClaimRef: nullableStringField(value, "launchClaimRef"),
    trackerUrl: nullableStringField(value, "trackerUrl"),
    createdAt: stringField(value, "createdAt") || updatedAt,
    updatedAt,
  };
}

function existsIfPresent(path: string | undefined): boolean | undefined {
  return path ? existsSync(path) : undefined;
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

  constructor(options: { recordsPath?: string } = {}) {
    this.recordsPath = options.recordsPath ?? defaultRecordsPath();
  }

  async get(graphPath: string, nodeId: string): Promise<NodeLaunchRecord | null> {
    const document = await this.readDocument();
    const key = normalizeGraphPathForKey(graphPath);
    const record = document.records.find((candidate) =>
      candidate.nodeId === nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
    );
    return record ? withPathStatus(record) : null;
  }

  async upsertFromHandoff(handoff: PawLaunchHandoff, now = new Date()): Promise<NodeLaunchRecord> {
    const document = await this.readDocument();
    const metadata = handoff.launchMetadata;
    const graphPath = metadata.graphPath;
    const nodeId = metadata.nodeId;
    const key = normalizeGraphPathForKey(graphPath);
    const existingIndex = document.records.findIndex((candidate) =>
      candidate.nodeId === nodeId && normalizeGraphPathForKey(candidate.graphPath) === key
    );
    const timestamp = now.toISOString();
    const existing = existingIndex >= 0 ? document.records[existingIndex] : null;
    const nextRecord: StoredNodeLaunchRecord = {
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
      launchNonce: metadata.launchNonce,
      launchClaimRef: metadata.launchClaimRef,
      trackerUrl: metadata.trackerUrl,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    if (existingIndex >= 0) {
      document.records[existingIndex] = nextRecord;
    } else {
      document.records.push(nextRecord);
    }
    await this.writeDocument(document);
    return withPathStatus(nextRecord);
  }

  private async readDocument(): Promise<NodeLaunchRecordDocument> {
    if (!existsSync(this.recordsPath)) {
      return { version: 1, records: [] };
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
    };
  }

  private async writeDocument(document: NodeLaunchRecordDocument): Promise<void> {
    await mkdir(dirname(this.recordsPath), { recursive: true });
    const tempPath = `${this.recordsPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(tempPath, this.recordsPath);
  }
}
