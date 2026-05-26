import type {
  LaunchClaimFailureCode,
  LaunchClaimStatus,
} from "./launch-claim-schema";
import type { WorkstreamLaunchPolicy } from "./workstream-schema";

export type NodeLaunchPreferredTerminal = "default" | "windows-terminal" | "powershell";
export type NodeLaunchRuntimeKind = "terminal-cli" | "managed-sdk";

export interface NodeLaunchTerminalPreferences {
  launchMode: "manual";
  preferredTerminal: NodeLaunchPreferredTerminal;
  title?: string | null;
  tabColor?: string | null;
}

export interface NodePostPreparationTerminalIntent {
  kickoffPrompt?: string | null;
  terminalTitle?: string | null;
  terminalColor?: string | null;
}

export interface NodePostPreparationCompanionIntent {
  kickoffPrompt: string;
  usePawReviewAgent?: boolean;
}

export interface NodePostPreparationIntent {
  launchTerminal?: NodePostPreparationTerminalIntent;
  launchCompanion?: NodePostPreparationCompanionIntent;
}

export interface NodeLaunchMetadata {
  launchNonce: string | null;
  launchClaimRef: string | null;
  projectKey: string;
  workstreamId: string;
  nodeId: string;
  targetRepoIds: string[];
  graphPath: string;
  branch: string;
  workId: string;
  workTitle: string;
  trackerUrl: string | null;
  launchPolicy?: WorkstreamLaunchPolicy | null;
}

export interface NodeLaunchContextPackage {
  contextId: string;
  contextPackagePath: string;
  contextFilePath: string;
  metadata: Record<string, unknown>;
  unavailableInputs: unknown[];
}

export interface NodeLaunchSdkSession {
  sessionId: string;
  workspacePath?: string;
  stateRoot: string;
}

export interface NodeLaunchHandoff {
  cwd: string;
  branch: string;
  runtimeKind?: NodeLaunchRuntimeKind;
  pawWorkDir: string;
  workflowContextPath: string;
  streamlinerContextPath: string;
  kickoffPrompt: string;
  kickoffAdditionalInstructions?: string;
  cliArgs: string[];
  terminal: NodeLaunchTerminalPreferences;
  environment: Record<string, string>;
  sessionStateRoot: string;
  launchMetadata: NodeLaunchMetadata;
  contextPackage: NodeLaunchContextPackage;
  sdkSession?: NodeLaunchSdkSession;
}

export interface NodeLaunchRecordPathStatus {
  cwdExists: boolean;
  pawWorkDirExists: boolean;
  workflowContextExists: boolean;
  streamlinerContextExists: boolean;
  contextPackageExists: boolean;
  contextFileExists: boolean;
  sdkSessionWorkspaceExists?: boolean;
  sdkSessionStateRootExists?: boolean;
}

export interface NodeLaunchClaimState {
  launchClaimId: string;
  status: LaunchClaimStatus;
  launchedAt: string;
  updatedAt: string;
  bindingWindowExpiresAt: string;
  reservedRegistryId: string | null;
  boundRegistryId: string | null;
  boundCopilotSessionId: string | null;
  failureCode: LaunchClaimFailureCode | null;
  failureReason: string | null;
  blocksLaunch: boolean;
  retryable: boolean;
}

export type NodeLaunchOperationStatus =
  | "launchable"
  | "preparing"
  | "prepared"
  | "preparation_failed"
  | "launching"
  | "launched_pending_binding"
  | "managed_starting"
  /**
   * The managed SDK launch operation has successfully handed off to the
   * managed runtime. This is terminal for the launch operation and uses
   * completedAt; ongoing runtime lifecycle is tracked on session.runtime.
   */
  | "managed_running"
  | "managed_failed"
  | "bound"
  | "terminal_failed";

export function isActiveNodeLaunchOperationStatus(status: string): boolean {
  return status === "preparing" || status === "launching" || status === "managed_starting";
}

export function isPendingPostPreparationTerminalLaunchOperation(
  operation: Pick<NodeLaunchOperation, "status" | "postPreparation" | "terminalLaunch" | "error">,
): boolean {
  return operation.status === "prepared" &&
    Boolean(operation.postPreparation?.launchTerminal) &&
    !operation.terminalLaunch &&
    !operation.error;
}

export function isBlockingNodeLaunchOperation(
  operation: Pick<NodeLaunchOperation, "status" | "postPreparation" | "terminalLaunch" | "error">,
): boolean {
  return isActiveNodeLaunchOperationStatus(operation.status) ||
    isPendingPostPreparationTerminalLaunchOperation(operation);
}

export interface NodeLaunchOperationProgressEvent {
  type: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface NodeLaunchOperationError {
  code: string;
  error: string;
  step?: string;
  input?: string;
  timestamp: string;
}

export interface NodeTerminalLaunchResponse {
  launchClaim: NodeLaunchClaimState;
  terminal: {
    method: "windows-terminal" | "powershell";
    pid?: number;
  };
  cwd: string;
  branch: string;
  command: {
    cliArgs: string[];
    promptNonceLine: string;
  };
}

export interface NodeCompanionTerminalLaunchResponse {
  launchClaim?: NodeLaunchClaimState;
  terminal: {
    method: "windows-terminal" | "powershell";
    pid?: number;
  };
  cwd: string;
  command: {
    cliArgs: string[];
  };
}

export interface NodeManagedSdkLaunchResponse {
  launchClaim: NodeLaunchClaimState;
  runtimeKind: "managed-sdk";
  registryId: string;
  sdkSessionId: string | null;
  sdkWorkspacePath: string | null;
  sdkStateRoot: string | null;
  permissionProfile: "managed-autonomous";
}

export interface NodeLaunchOperation {
  id: string;
  graphPath: string;
  nodeId: string;
  status: NodeLaunchOperationStatus;
  preparationRunId: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  handoff: NodeLaunchHandoff | null;
  postPreparation?: NodePostPreparationIntent | null;
  terminalLaunch: NodeTerminalLaunchResponse | null;
  managedLaunch?: NodeManagedSdkLaunchResponse | null;
  companionLaunch?: NodeCompanionTerminalLaunchResponse | null;
  companionError?: NodeLaunchOperationError | null;
  error: NodeLaunchOperationError | null;
  progressEvents: NodeLaunchOperationProgressEvent[];
  latestClaim?: NodeLaunchClaimState | null;
}

export interface NodeLaunchRecord {
  id: string;
  graphPath: string;
  nodeId: string;
  projectKey: string;
  workstreamId: string;
  branch: string;
  workId: string;
  workTitle: string;
  cwd: string;
  pawWorkDir: string;
  workflowContextPath: string;
  streamlinerContextPath: string;
  contextPackagePath: string;
  contextFilePath: string;
  sdkSessionWorkspacePath?: string;
  sdkSessionStateRoot?: string;
  runtimeKind?: NodeLaunchRuntimeKind;
  launchNonce: string | null;
  launchClaimRef: string | null;
  trackerUrl: string | null;
  createdAt: string;
  updatedAt: string;
  pathStatus: NodeLaunchRecordPathStatus;
  latestClaim?: NodeLaunchClaimState | null;
}

export interface NodeLaunchRecordResponse {
  record: NodeLaunchRecord | null;
  operation?: NodeLaunchOperation | null;
}

export interface NodeLaunchRecordListResponse {
  records: NodeLaunchRecord[];
}

export interface NodeLaunchRecordResetResponse {
  clearedRecord: NodeLaunchRecord | null;
  clearedOperation: NodeLaunchOperation | null;
  releasedLaunchClaims: NodeLaunchClaimState[];
  detachedRegistryIds: string[];
}
