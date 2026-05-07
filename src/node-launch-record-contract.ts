import type { WorkstreamLaunchPolicy } from "./workstream-schema";

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
  status: string;
  launchedAt: string;
  updatedAt: string;
  bindingWindowExpiresAt: string;
  reservedRegistryId: string | null;
  boundRegistryId: string | null;
  boundCopilotSessionId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  blocksLaunch: boolean;
  retryable: boolean;
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
}
