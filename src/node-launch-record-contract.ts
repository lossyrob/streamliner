import type {
  LaunchClaimFailureCode,
  LaunchClaimStatus,
} from "./launch-claim-schema";
import type {
  WorkstreamExistingPullRequest,
  WorkstreamLaunchPolicy,
  WorkstreamNodeCompletionMode,
  WorkstreamNodeLaunchMode,
} from "./workstream-schema";

export type NodeLaunchPreferredTerminal =
  | "default"
  | "windows-terminal"
  | "powershell"
  | "mac-terminal"
  | "iterm2";
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

export type NodeBranchLeaseStatus = "active" | "released" | "transferred";

export interface NodeBranchLeaseTransferAudit {
  fromLeaseId: string;
  fromGraphPath: string;
  fromNodeId: string;
  toLeaseId: string;
  toGraphPath: string;
  toNodeId: string;
  reviewedBy: string;
  reason: string;
  transferredAt: string;
}

export interface NodeBranchLeaseFailedLaunchAudit {
  launchClaimId: string;
  registryId: string | null;
  failureCode: string;
  failureReason: string;
  failedAt: string;
}

export interface NodeBranchLease {
  leaseId: string;
  branchLeaseKey: string;
  status: NodeBranchLeaseStatus;
  projectKey: string;
  workstreamId: string;
  graphPath: string;
  nodeId: string;
  targetRepoId: string;
  cwd: string;
  targetBranch: string;
  requiredStartSha: string;
  existingPullRequest: WorkstreamExistingPullRequest;
  launchMode: "existing-shared-azure-devops";
  completionMode: "branch-contribution";
  launchClaimId: string | null;
  registryId: string | null;
  acquiredAt: string;
  updatedAt: string;
  reclaimedAt: string | null;
  reclaimCount: number;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseReason: string | null;
  endSha: string | null;
  transferredAt: string | null;
  transferredToLeaseId: string | null;
  transferredFromLeaseId: string | null;
  transferAudit: NodeBranchLeaseTransferAudit[];
  failedLaunches: NodeBranchLeaseFailedLaunchAudit[];
}

export interface NodeBranchLeaseOwnerInput {
  leaseId: string;
  branchLeaseKey: string;
  graphPath: string;
  nodeId: string;
  cwd: string;
  targetBranch: string;
  requiredStartSha: string;
}

export interface NodeBranchLeaseAcquireInput {
  branchLeaseKey: string;
  projectKey: string;
  workstreamId: string;
  graphPath: string;
  nodeId: string;
  targetRepoId: string;
  cwd: string;
  targetBranch: string;
  requiredStartSha: string;
  existingPullRequest: WorkstreamExistingPullRequest;
  now?: Date;
}

export interface NodeBranchLeaseLaunchBindingInput extends NodeBranchLeaseOwnerInput {
  launchClaimId: string;
  registryId: string | null;
  now?: Date;
}

export interface NodeBranchLeaseFailedLaunchRecoveryInput
  extends NodeBranchLeaseLaunchBindingInput {
  failureCode: string;
  failureReason: string;
}

export interface NodeBranchLeaseReleaseInput {
  leaseId: string;
  graphPath: string;
  nodeId: string;
  launchClaimId?: string | null;
  registryId?: string | null;
  acceptedEndSha: string;
  acceptedBy: string;
  reason: string;
  now?: Date;
}

export interface NodeBranchLeaseTransferInput {
  leaseId: string;
  graphPath: string;
  nodeId: string;
  launchClaimId?: string | null;
  registryId?: string | null;
  target: Omit<NodeBranchLeaseAcquireInput, "now">;
  reviewedBy: string;
  reason: string;
  now?: Date;
}

export interface NodeBranchLeaseTransferResult {
  previousLease: NodeBranchLease;
  branchLease: NodeBranchLease;
}

export interface NodeBranchLeaseCoordinator {
  acquireBranchLease(input: NodeBranchLeaseAcquireInput): Promise<NodeBranchLease>;
  assertBranchLeaseActive(input: NodeBranchLeaseOwnerInput): Promise<NodeBranchLease>;
  bindBranchLeaseToLaunch(input: NodeBranchLeaseLaunchBindingInput): Promise<NodeBranchLease>;
  reclaimBranchLeaseForSession(input: NodeBranchLeaseLaunchBindingInput): Promise<NodeBranchLease>;
  recoverBranchLeaseAfterFailedLaunch(
    input: NodeBranchLeaseFailedLaunchRecoveryInput,
  ): Promise<NodeBranchLease>;
  releaseBranchLease(input: NodeBranchLeaseReleaseInput): Promise<NodeBranchLease>;
  transferBranchLease(input: NodeBranchLeaseTransferInput): Promise<NodeBranchLeaseTransferResult>;
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
  launchMode?: WorkstreamNodeLaunchMode;
  completionMode?: WorkstreamNodeCompletionMode | null;
  targetBranch?: string | null;
  requiredStartSha?: string | null;
  existingPullRequest?: WorkstreamExistingPullRequest | null;
  branchLease?: NodeBranchLease | null;
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
    method: "windows-terminal" | "powershell" | "mac-terminal" | "iterm2";
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
    method: "windows-terminal" | "powershell" | "mac-terminal" | "iterm2";
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
  launchMode?: WorkstreamNodeLaunchMode;
  completionMode?: WorkstreamNodeCompletionMode | null;
  targetBranch?: string | null;
  requiredStartSha?: string | null;
  existingPullRequest?: WorkstreamExistingPullRequest | null;
  branchLease?: NodeBranchLease | null;
  endSha?: string | null;
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
