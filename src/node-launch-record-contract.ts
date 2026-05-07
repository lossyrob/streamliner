export type NodeLaunchPreferredTerminal = "default" | "windows-terminal" | "powershell";

export interface NodeLaunchTerminalPreferences {
  launchMode: "manual";
  preferredTerminal: NodeLaunchPreferredTerminal;
  title?: string | null;
  tabColor?: string | null;
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

import type {
  LaunchClaimFailureCode,
  LaunchClaimStatus,
} from "./launch-claim-schema";

export interface NodeLaunchHandoff {
  cwd: string;
  branch: string;
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
  | "bound"
  | "terminal_failed";

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
  terminalLaunch: NodeTerminalLaunchResponse | null;
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
