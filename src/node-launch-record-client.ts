import type {
  NodeLaunchRecord,
  NodeLaunchRecordListResponse,
  NodeLaunchRecordResponse,
} from "./node-launch-record-contract";

interface NodeLaunchRecordErrorResponse {
  error?: unknown;
}

async function parseNodeLaunchRecordError(response: Response): Promise<string> {
  try {
    const body = await response.json() as NodeLaunchRecordErrorResponse;
    return typeof body.error === "string" ? body.error : `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export async function loadNodeLaunchRecord(
  graphPath: string,
  nodeId: string,
): Promise<NodeLaunchRecord | null> {
  const params = new URLSearchParams({ graphPath, nodeId });
  const response = await fetch(`/api/node-launch-records?${params.toString()}`);
  if (!response.ok) {
    throw new Error(await parseNodeLaunchRecordError(response));
  }
  const body = await response.json() as NodeLaunchRecordResponse;
  return body.record ?? null;
}

export async function loadGraphNodeLaunchRecords(graphPath: string): Promise<NodeLaunchRecord[]> {
  const params = new URLSearchParams({ graphPath });
  const response = await fetch(`/api/node-launch-records?${params.toString()}`);
  if (!response.ok) {
    throw new Error(await parseNodeLaunchRecordError(response));
  }
  const body = await response.json() as NodeLaunchRecordListResponse;
  return body.records ?? [];
}
