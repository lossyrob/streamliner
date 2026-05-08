import type {
  NodeLaunchOperation,
  NodeLaunchRecord,
  NodeLaunchTerminalPreferences,
} from "./node-launch-record-contract";
import type {
  ManagedRuntimePermissionProfile,
} from "./managed-runtime-contract";
import {
  ManagedRuntimeUnavailableError,
  isManagedRuntimeUnavailableResponse,
} from "./managed-runtime-contract";

interface ManagedRuntimeErrorResponse {
  code?: unknown;
  error?: unknown;
}

export interface ManagedSdkLaunchRequest {
  nodeId: string;
  graphPath: string;
  launchNonce: string;
  runtimeKind: "managed-sdk";
  permissionProfile: ManagedRuntimePermissionProfile;
  configuration: {
    cwd?: string;
    workflowInstructions: string;
    cliArgs: string[];
    terminal: NodeLaunchTerminalPreferences;
  };
}

export interface ManagedSdkLaunchResponse {
  record?: NodeLaunchRecord | null;
  operation?: NodeLaunchOperation | null;
}

export class ManagedSdkLaunchError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, body: ManagedRuntimeErrorResponse | null) {
    super(typeof body?.error === "string" ? body.error : `Request failed (${status})`);
    this.name = "ManagedSdkLaunchError";
    this.status = status;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}

async function safeJson(response: Response): Promise<ManagedRuntimeErrorResponse | null> {
  try {
    return await response.json() as ManagedRuntimeErrorResponse;
  } catch {
    return null;
  }
}

export async function launchManagedSdkRuntime(
  request: ManagedSdkLaunchRequest,
): Promise<ManagedSdkLaunchResponse> {
  let response: Response;
  try {
    response = await fetch("/api/node-launches/managed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (cause) {
    throw new ManagedRuntimeUnavailableError("transport", { cause });
  }

  const body = await safeJson(response);
  const code = typeof body?.code === "string" ? body.code : undefined;
  if (isManagedRuntimeUnavailableResponse(response.status, code)) {
    throw new ManagedRuntimeUnavailableError("backend", {
      status: response.status,
      code,
    });
  }
  if (!response.ok) {
    throw new ManagedSdkLaunchError(response.status, body);
  }
  return body as ManagedSdkLaunchResponse;
}
