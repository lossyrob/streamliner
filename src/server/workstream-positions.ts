import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  WORKSTREAM_POSITIONS_SCHEMA_VERSION,
  type WorkstreamGraphNodePosition,
  type WorkstreamPositionsDocument,
} from "../workstream-positions-contract";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function defaultStateRoot(): string {
  return resolve(process.env.STREAMLINER_STATE_ROOT ?? resolve(homedir(), ".streamliner", "state"));
}

export interface WorkstreamPositionsOptions {
  workstreamPositionsRoot?: string;
  now?: () => Date;
}

type NodeError = Error & { code?: string };

function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeError).code === "ENOENT";
}

function assertWorkstreamIdentitySegment(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    const error = new Error(`Expected ${label} to be a kebab-case id.`) as NodeError;
    error.code = "EINVAL";
    throw error;
  }
}

function positionsPath(
  projectKey: string,
  workstreamId: string,
  options: WorkstreamPositionsOptions,
): string {
  assertWorkstreamIdentitySegment(projectKey, "projectKey");
  assertWorkstreamIdentitySegment(workstreamId, "workstreamId");
  return resolve(
    options.workstreamPositionsRoot ?? defaultStateRoot(),
    projectKey,
    workstreamId,
    "positions.json",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanPositions(
  value: unknown,
  now: string,
): Record<string, WorkstreamGraphNodePosition> {
  if (!isRecord(value)) {
    return {};
  }

  const cleaned: Record<string, WorkstreamGraphNodePosition> = {};
  for (const [nodeId, rawPosition] of Object.entries(value)) {
    if (nodeId.trim().length === 0 || !isRecord(rawPosition)) {
      continue;
    }
    const { x, y, updatedAt } = rawPosition;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      continue;
    }
    cleaned[nodeId] = {
      x,
      y,
      updatedAt:
        typeof updatedAt === "string" && !Number.isNaN(Date.parse(updatedAt))
          ? updatedAt
          : now,
    };
  }
  return cleaned;
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);
}

export async function readWorkstreamPositions(
  projectKey: string,
  workstreamId: string,
  options: WorkstreamPositionsOptions = {},
): Promise<WorkstreamPositionsDocument> {
  const path = positionsPath(projectKey, workstreamId, options);
  const now = (options.now?.() ?? new Date()).toISOString();
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<WorkstreamPositionsDocument>;
    if (parsed.schemaVersion !== WORKSTREAM_POSITIONS_SCHEMA_VERSION) {
      return {
        schemaVersion: WORKSTREAM_POSITIONS_SCHEMA_VERSION,
        positions: {},
      };
    }
    return {
      schemaVersion: WORKSTREAM_POSITIONS_SCHEMA_VERSION,
      positions: cleanPositions(parsed.positions, now),
    };
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return {
        schemaVersion: WORKSTREAM_POSITIONS_SCHEMA_VERSION,
        positions: {},
      };
    }
    throw error;
  }
}

export async function writeWorkstreamPositions(
  projectKey: string,
  workstreamId: string,
  positions: unknown,
  options: WorkstreamPositionsOptions = {},
): Promise<WorkstreamPositionsDocument> {
  const now = (options.now?.() ?? new Date()).toISOString();
  const document: WorkstreamPositionsDocument = {
    schemaVersion: WORKSTREAM_POSITIONS_SCHEMA_VERSION,
    positions: cleanPositions(positions, now),
  };
  await writeJsonAtomic(positionsPath(projectKey, workstreamId, options), document);
  return document;
}
