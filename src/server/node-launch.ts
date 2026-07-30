import type { LaunchClaim, LaunchClaimStatus } from "../launch-claim-schema";
import type { LaunchClaimStore } from "../launch-claim-contract";
import type {
  SessionRegistryManagedLifecycleState,
  SessionRegistryPawLaunch,
  SessionRegistryRecord,
} from "../session-registry-schema";
import type { NodeBranchLeaseCoordinator } from "../node-launch-record-contract";
import type { WorkstreamNode } from "../workstream-schema";
import type { SessionRegistryStore } from "../session-registry-contract";
import { buildLaunchedSessionDescription } from "../session-registry-filter";
import type { SessionRegistryFileStore } from "../session-registry/file-store";
import { isManagedRuntimeActive } from "../session-registry/managed-runtime";
import {
  createLaunchClaim,
  kickoffNonceLine,
  LAUNCH_NONCE_PROMPT_LINE_PREFIX,
  markClaimFailed,
  type MarkClaimFailedOutcome,
} from "../session-registry/launch-claims";
import {
  LaunchPreparationError,
  resolvedNodeLaunchContract,
  validateExistingSharedBranchResumeState,
  validateExistingSharedBranchState,
  type PawLaunchHandoff,
} from "./launch-preparation";
import {
  buildCopilotInteractiveCommand,
  launchCopilotTerminal,
  type TerminalLaunchOptions,
  type TerminalLaunchResult,
} from "./terminal-launch";
import {
  evaluateLaunchPolicyFromGraph,
  launchPolicyDetails,
} from "./launch-policy";
import { getApiLogger } from "./logger";
import {
  DefaultManagedSdkRunner,
  type ManagedSdkRunner,
  type ManagedSdkRunnerStartResult,
} from "./managed-sdk-runner";
import { ManagedRuntimePatchCoalescer } from "./managed-runtime-patch-coalescer";

export type NodeLaunchErrorCode =
  | "launch_policy_blocked"
  | "launch_policy_unavailable"
  | "launch_mode_mismatch"
  | "shared_branch_stale"
  | "branch_lease_conflict"
  | "branch_lease_unavailable"
  | "duplicate_active_launch"
  | "launch_claim_failed"
  | "terminal_spawn_failed"
  | "managed_sdk_start_failed"
  | "managed_sdk_resume_unavailable"
  | "managed_sdk_resume_failed";

export class NodeLaunchError extends Error {
  readonly code: NodeLaunchErrorCode;
  readonly statusCode: number;
  readonly claim: LaunchClaim | null;
  readonly details?: Record<string, unknown>;

  constructor(
    code: NodeLaunchErrorCode,
    statusCode: number,
    message: string,
    claim: LaunchClaim | null = null,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "NodeLaunchError";
    this.code = code;
    this.statusCode = statusCode;
    this.claim = claim;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export interface NodeLaunchClaimSummary {
  launchClaimId: string;
  status: LaunchClaimStatus;
  launchedAt: string;
  updatedAt: string;
  bindingWindowExpiresAt: string;
  reservedRegistryId: string | null;
  boundRegistryId: string | null;
  boundCopilotSessionId: string | null;
  failureCode: LaunchClaim["failureCode"];
  failureReason: string | null;
  blocksLaunch: boolean;
  retryable: boolean;
}

export interface NodeLaunchResult {
  runtimeKind: "terminal-cli";
  launchClaim: NodeLaunchClaimSummary;
  terminal: TerminalLaunchResult;
  cwd: string;
  branch: string;
  command: {
    cliArgs: string[];
    promptNonceLine: string;
  };
}

export interface NodeManagedSdkLaunchResult {
  runtimeKind: "managed-sdk";
  launchClaim: NodeLaunchClaimSummary;
  managedSdk: {
    registryId: string;
    sdkSessionId: string | null;
    sdkWorkspacePath: string | null;
    sdkStateRoot: string | null;
    permissionProfile: "managed-autonomous";
  };
  cwd: string;
  branch: string;
  command: {
    cliArgs: string[];
    promptNonceLine: string;
  };
}

export interface NodeLaunchDeps {
  launchTerminal?: (options: TerminalLaunchOptions) => TerminalLaunchResult;
  managedSdkRunner?: ManagedSdkRunner;
  runtimePatchCoalescer?: ManagedRuntimePatchCoalescer;
  branchLeaseCoordinator?: NodeBranchLeaseCoordinator;
  now?: () => Date;
}

function isBlockingClaim(claim: LaunchClaim, now: Date): boolean {
  if (claim.status === "bound") {
    return true;
  }
  if (claim.status !== "pending") {
    return false;
  }
  const launchedAtMs = Date.parse(claim.launchedAt);
  return Number.isFinite(launchedAtMs) &&
    now.getTime() <= launchedAtMs + claim.bindingWindowMs;
}

function bindingWindowExpiresAt(claim: LaunchClaim): string {
  const launchedAtMs = Date.parse(claim.launchedAt);
  if (!Number.isFinite(launchedAtMs)) {
    return claim.launchedAt;
  }
  return new Date(launchedAtMs + claim.bindingWindowMs).toISOString();
}

export function summarizeLaunchClaim(
  claim: LaunchClaim,
  now: Date = new Date(),
): NodeLaunchClaimSummary {
  const blocksLaunch = isBlockingClaim(claim, now);
  return {
    launchClaimId: claim.launchClaimId,
    status: claim.status,
    launchedAt: claim.launchedAt,
    updatedAt: claim.updatedAt,
    bindingWindowExpiresAt: bindingWindowExpiresAt(claim),
    reservedRegistryId: claim.reservedRegistryId,
    boundRegistryId: claim.boundRegistryId,
    boundCopilotSessionId: claim.boundCopilotSessionId,
    failureCode: claim.failureCode,
    failureReason: claim.failureReason,
    blocksLaunch,
    retryable: !blocksLaunch,
  };
}

export function latestLaunchClaimForNode(
  claimStore: LaunchClaimStore,
  workstreamId: string,
  nodeId: string,
): LaunchClaim | null {
  const [latest] = claimStore.listClaims({ workstreamId, nodeId, limit: 1 });
  return latest ? claimStore.getClaim(latest.launchClaimId) : null;
}

export function findBlockingLaunchClaim(
  claimStore: LaunchClaimStore,
  workstreamId: string,
  nodeId: string,
  now: Date = new Date(),
): LaunchClaim | null {
  const entries = claimStore.listClaims({ workstreamId, nodeId });
  for (const entry of entries) {
    const claim = claimStore.getClaim(entry.launchClaimId);
    if (claim && isBlockingClaim(claim, now)) {
      return claim;
    }
  }
  return null;
}

const LAUNCH_CLAIM_PROMPT_LINE_PREFIX = "Streamliner launch claim: ";
const LAUNCH_PROMPT_TOKEN_PATTERN = /^[A-Za-z0-9._:-]+$/;

export function isLaunchPromptToken(value: string): boolean {
  return value.length > 0 &&
    value.length <= 256 &&
    LAUNCH_PROMPT_TOKEN_PATTERN.test(value);
}

function assertLaunchPromptToken(value: string, label: string): void {
  if (!isLaunchPromptToken(value)) {
    throw new Error(`${label} must be a non-empty single-line token.`);
  }
}

export function appendLaunchBindingPromptLines(
  preparedPrompt: string,
  launchNonce: string,
  launchClaimId: string,
): string {
  assertLaunchPromptToken(launchNonce, "launch nonce");
  assertLaunchPromptToken(launchClaimId, "launch claim id");
  const nonceLine = kickoffNonceLine(launchNonce);
  const claimLine = `${LAUNCH_CLAIM_PROMPT_LINE_PREFIX}${launchClaimId}`;
  const prompt = preparedPrompt
    .replace(/\r\n?/g, "\n")
    .replace(/^(- Launch nonce: )[^\n]*$/gm, `$1${launchNonce}`)
    .replace(/^(- Launch claim: )[^\n]*$/gm, `$1${launchClaimId}`)
    .split("\n")
    .filter((line) =>
      !line.startsWith(LAUNCH_NONCE_PROMPT_LINE_PREFIX) &&
      !line.startsWith(LAUNCH_CLAIM_PROMPT_LINE_PREFIX)
    )
    .join("\n")
    .trimEnd();
  const prefix = prompt.length > 0 ? `${prompt}\n\n` : "";
  return `${prefix}${nonceLine}\n${claimLine}\n`;
}

function lineageMetadataFor(handoff: PawLaunchHandoff): Record<string, unknown> {
  const terminalTitle = terminalTitleFor(handoff);
  return {
    graphPath: handoff.launchMetadata.graphPath,
    branch: handoff.branch,
    workId: handoff.launchMetadata.workId,
    workTitle: handoff.launchMetadata.workTitle,
    terminalTitle,
    terminalColor: handoff.terminal.tabColor ?? null,
    pawWorkDir: handoff.pawWorkDir,
    workflowContextPath: handoff.workflowContextPath,
    streamlinerContextPath: handoff.streamlinerContextPath,
    contextPackagePath: handoff.contextPackage.contextPackagePath,
    trackerUrl: handoff.launchMetadata.trackerUrl,
    launchMode: handoff.launchMetadata.launchMode,
    completionMode: handoff.launchMetadata.completionMode,
    targetBranch: handoff.launchMetadata.targetBranch,
    requiredStartSha: handoff.launchMetadata.requiredStartSha,
    existingPullRequest: handoff.launchMetadata.existingPullRequest,
    branchLeaseId: handoff.launchMetadata.branchLease?.leaseId ?? null,
    branchLeaseKey: handoff.launchMetadata.branchLease?.branchLeaseKey ?? null,
  };
}

function pawLaunchFor(handoff: PawLaunchHandoff): SessionRegistryPawLaunch {
  const launchMode = handoff.launchMetadata.launchMode ?? "standard-github";
  return {
    workId: handoff.launchMetadata.workId,
    workTitle: handoff.launchMetadata.workTitle,
    workflowKind: "paw-lite",
    pawWorkDir: handoff.pawWorkDir,
    workflowContextPath: handoff.workflowContextPath,
    streamlinerContextPath: handoff.streamlinerContextPath,
    launchMode,
    ...(launchMode === "existing-shared-azure-devops"
      ? {
          completionMode: handoff.launchMetadata.completionMode ?? null,
          targetBranch: handoff.launchMetadata.targetBranch ?? null,
          requiredStartSha: handoff.launchMetadata.requiredStartSha ?? null,
          existingPullRequest: handoff.launchMetadata.existingPullRequest
            ? { ...handoff.launchMetadata.existingPullRequest }
            : null,
          branchLeaseId: handoff.launchMetadata.branchLease?.leaseId ?? null,
          branchLeaseKey: handoff.launchMetadata.branchLease?.branchLeaseKey ?? null,
        }
      : {}),
  };
}

function terminalTitleFor(handoff: PawLaunchHandoff): string {
  return handoff.terminal.title?.trim() || handoff.launchMetadata.workTitle;
}

function errorLogDetails(error: unknown): Record<string, string> | string {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : String(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasWorkerOwnershipEvidence(
  session: SessionRegistryRecord | null,
): boolean {
  return Boolean(
    session?.copilotSessionId ||
    session?.runtime?.sdkSessionId ||
    session?.copilotProcessState === "live",
  );
}

async function recoverSharedBranchLeaseAfterFailedLaunch(input: {
  handoff: PawLaunchHandoff;
  failed: MarkClaimFailedOutcome | null;
  failureCode: string;
  failureReason: string;
  hadWorkerOwnershipEvidence: boolean;
  registryStore: SessionRegistryFileStore;
  deps: NodeLaunchDeps;
  logger: {
    warn: (message: string, fields?: Record<string, unknown>) => void;
    error: (message: string, fields?: Record<string, unknown>) => void;
  };
}): Promise<string | null> {
  const branchLease = input.handoff.launchMetadata.branchLease;
  if (
    !branchLease ||
    input.handoff.launchMetadata.launchMode !==
      "existing-shared-azure-devops" ||
    !input.deps.branchLeaseCoordinator ||
    !input.failed?.ok ||
    input.failed.claim?.status !== "failed"
  ) {
    return null;
  }
  if (input.hadWorkerOwnershipEvidence) {
    input.logger.warn(
      "shared branch lease left bound after failed launch because worker ownership evidence exists",
      {
        branchLeaseId: branchLease.leaseId,
        launchClaimId: input.failed.claim.launchClaimId,
        registryId: input.failed.claim.reservedRegistryId,
      },
    );
    return null;
  }
  const registryId = input.failed.claim.reservedRegistryId;
  if (registryId && input.registryStore.getSession(registryId)) {
    input.logger.warn(
      "shared branch lease left bound after failed launch because registry cleanup is incomplete",
      {
        branchLeaseId: branchLease.leaseId,
        launchClaimId: input.failed.claim.launchClaimId,
        registryId,
      },
    );
    return null;
  }
  try {
    await input.deps.branchLeaseCoordinator.recoverBranchLeaseAfterFailedLaunch({
      leaseId: branchLease.leaseId,
      branchLeaseKey: branchLease.branchLeaseKey,
      graphPath: input.handoff.launchMetadata.graphPath,
      nodeId: input.handoff.launchMetadata.nodeId,
      cwd: input.handoff.cwd,
      targetBranch: branchLease.targetBranch,
      requiredStartSha: branchLease.requiredStartSha,
      launchClaimId: input.failed.claim.launchClaimId,
      registryId,
      failureCode: input.failureCode,
      failureReason: input.failureReason,
      now: input.deps.now?.(),
    });
    return null;
  } catch (error: unknown) {
    input.logger.error("failed to recover shared branch lease after launch failure", {
      branchLeaseId: branchLease.leaseId,
      launchClaimId: input.failed.claim.launchClaimId,
      registryId,
      err: errorLogDetails(error),
    });
    return errorMessage(error);
  }
}

function lifecycleProgressMessage(state: SessionRegistryManagedLifecycleState): string {
  return `Managed SDK lifecycle changed to ${state}.`;
}

function runtimePatchCoalescerFor(
  deps: NodeLaunchDeps,
): ManagedRuntimePatchCoalescer {
  if (!deps.runtimePatchCoalescer) {
    throw new Error("Managed runtime patch coalescer dependency is required.");
  }
  return deps.runtimePatchCoalescer;
}

function isNonResumableManagedLifecycle(
  state: SessionRegistryManagedLifecycleState | null,
): boolean {
  switch (state) {
    case "canceled":
    case "cleaned_up":
    case "completed":
    case "terminal_takeover":
      return true;
    case null:
    case "preparing":
    case "starting":
    case "running":
    case "idle":
    case "waiting_for_builder":
    case "interrupt_requested":
    case "interrupted":
    case "failed":
    case "pr_ready":
    case "review_ready":
    case "cleanup_ready":
    case "cleaning_up":
      return false;
    default: {
      const _exhaustive: never = state;
      throw new Error(`unhandled managed lifecycle state: ${String(_exhaustive)}`);
    }
  }
}

function hasActiveManagedRuntime(
  registryStore: SessionRegistryStore,
  workstreamId: string,
  nodeId: string,
): boolean {
  return registryStore
    .listSessions({ includeArchived: false, workstreamId, nodeId })
    .some((session) => isManagedRuntimeActive(session.runtime));
}

function assertLaunchPolicyAllows(handoff: PawLaunchHandoff): WorkstreamNode | null {
  const policyResult = evaluateLaunchPolicyFromGraph({
    graphPath: handoff.launchMetadata.graphPath,
    nodeId: handoff.launchMetadata.nodeId,
  });
  if (policyResult.ok) {
    return policyResult.node;
  }
  if (policyResult.kind === "blocked") {
    const details = launchPolicyDetails(policyResult.violation);
    getApiLogger().withScope("launch-policy").info(
      "rejected node launch",
      details,
    );
    throw new NodeLaunchError(
      "launch_policy_blocked",
      412,
      policyResult.violation.message,
      null,
      details,
    );
  }
  const details = {
    reason: policyResult.code,
    input: policyResult.input,
    nodeId: handoff.launchMetadata.nodeId,
  };
  if (!handoff.launchMetadata.launchPolicy?.requiredTracker) {
    getApiLogger().withScope("launch-policy").warn(
      "node launch policy graph unavailable; allowing unconfigured prepared handoff",
      details,
    );
    return null;
  }
  throw new NodeLaunchError(
    "launch_policy_unavailable",
    policyResult.statusCode,
    policyResult.message,
    null,
    details,
  );
}

function assertLaunchModeAllows(
  handoff: PawLaunchHandoff,
  node: WorkstreamNode | null,
): void {
  const expected = resolvedNodeLaunchContract(node);
  const launchMode = handoff.launchMetadata.launchMode ?? "standard-github";
  if (launchMode !== expected.launchMode) {
    throw new NodeLaunchError(
      "launch_mode_mismatch",
      409,
      `Node launch mode is ${expected.launchMode}, but prepared handoff uses ${launchMode}.`,
      null,
      {
        expectedLaunchMode: expected.launchMode,
        receivedLaunchMode: launchMode,
      },
    );
  }
  if (launchMode !== "existing-shared-azure-devops") {
    if (
      handoff.launchMetadata.branchLease ||
      handoff.launchMetadata.requiredStartSha ||
      handoff.launchMetadata.existingPullRequest ||
      handoff.launchMetadata.completionMode
    ) {
      throw new NodeLaunchError(
        "launch_mode_mismatch",
        409,
        "Standard node launch handoffs cannot carry existing shared-branch metadata.",
      );
    }
    return;
  }
  const shared = expected.sharedBranch;
  const branchLease = handoff.launchMetadata.branchLease;
  if (
    !node ||
    !shared ||
    !branchLease ||
    handoff.branch !== shared.targetBranch ||
    handoff.launchMetadata.targetBranch !== shared.targetBranch ||
    handoff.launchMetadata.requiredStartSha !== shared.requiredStartSha ||
    handoff.launchMetadata.completionMode !== shared.completionMode ||
    handoff.launchMetadata.existingPullRequest?.provider !==
      shared.existingPullRequest.provider ||
    handoff.launchMetadata.existingPullRequest?.id !==
      shared.existingPullRequest.id ||
    branchLease.branchLeaseKey !== shared.branchLeaseKey
  ) {
    throw new NodeLaunchError(
      "launch_mode_mismatch",
      409,
      "Prepared shared-branch handoff does not match the selected node's durable launch contract.",
    );
  }
}

async function assertSharedBranchReady(
  handoff: PawLaunchHandoff,
  deps: NodeLaunchDeps,
): Promise<void> {
  if (handoff.launchMetadata.launchMode !== "existing-shared-azure-devops") {
    return;
  }
  const branchLease = handoff.launchMetadata.branchLease;
  const requiredStartSha = handoff.launchMetadata.requiredStartSha;
  const targetBranch = handoff.launchMetadata.targetBranch;
  if (!branchLease || !requiredStartSha || !targetBranch) {
    throw new NodeLaunchError(
      "launch_mode_mismatch",
      409,
      "Prepared shared-branch handoff is missing branch lease or start-SHA metadata.",
    );
  }
  if (!deps.branchLeaseCoordinator) {
    throw new NodeLaunchError(
      "branch_lease_unavailable",
      503,
      "Shared-branch launch requires the integrated node launch record store.",
    );
  }
  try {
    await validateExistingSharedBranchState({
      cwd: handoff.cwd,
      targetBranch,
      requiredStartSha,
    });
    await deps.branchLeaseCoordinator.assertBranchLeaseActive({
      leaseId: branchLease.leaseId,
      branchLeaseKey: branchLease.branchLeaseKey,
      graphPath: handoff.launchMetadata.graphPath,
      nodeId: handoff.launchMetadata.nodeId,
      cwd: handoff.cwd,
      targetBranch,
      requiredStartSha,
    });
  } catch (error: unknown) {
    if (error instanceof LaunchPreparationError) {
      throw new NodeLaunchError(
        "shared_branch_stale",
        error.statusCode,
        error.message,
        null,
        error.details,
      );
    }
    const leaseError = error as {
      code?: unknown;
      statusCode?: unknown;
      message?: unknown;
    };
    throw new NodeLaunchError(
      typeof leaseError.code === "string" &&
          leaseError.code.startsWith("branch_lease")
        ? (typeof leaseError.statusCode === "number" && leaseError.statusCode === 409)
          ? "branch_lease_conflict"
          : "branch_lease_unavailable"
        : "branch_lease_unavailable",
      typeof leaseError.statusCode === "number" ? leaseError.statusCode : 500,
      typeof leaseError.message === "string" ? leaseError.message : String(error),
    );
  }
}

async function reclaimSharedBranchForResume(
  handoff: PawLaunchHandoff,
  launchClaimId: string,
  registryId: string,
  deps: NodeLaunchDeps,
  now: Date,
): Promise<void> {
  if (handoff.launchMetadata.launchMode !== "existing-shared-azure-devops") {
    return;
  }
  const branchLease = handoff.launchMetadata.branchLease;
  const targetBranch = handoff.launchMetadata.targetBranch;
  const requiredStartSha = handoff.launchMetadata.requiredStartSha;
  if (!branchLease || !targetBranch || !requiredStartSha || !deps.branchLeaseCoordinator) {
    throw new NodeLaunchError(
      "branch_lease_unavailable",
      503,
      "Shared-branch session resume requires its persisted branch lease metadata.",
    );
  }
  try {
    await validateExistingSharedBranchResumeState({
      cwd: handoff.cwd,
      targetBranch,
      requiredStartSha,
    });
    await deps.branchLeaseCoordinator.reclaimBranchLeaseForSession({
      leaseId: branchLease.leaseId,
      branchLeaseKey: branchLease.branchLeaseKey,
      graphPath: handoff.launchMetadata.graphPath,
      nodeId: handoff.launchMetadata.nodeId,
      cwd: handoff.cwd,
      targetBranch,
      requiredStartSha,
      launchClaimId,
      registryId,
      now,
    });
  } catch (error: unknown) {
    if (error instanceof LaunchPreparationError) {
      throw new NodeLaunchError(
        "shared_branch_stale",
        error.statusCode,
        error.message,
        null,
        error.details,
      );
    }
    throw new NodeLaunchError(
      "branch_lease_conflict",
      409,
      errorMessage(error),
    );
  }
}

function resumePromptForManagedSdkNode(
  handoff: PawLaunchHandoff,
  claim: LaunchClaim,
): string {
  return [
    "Resume this interrupted Streamliner background session.",
    "",
    "Continue from the existing conversation history and repository state.",
    "Do not restart PAW init or redo completed work unless the repository state shows it is necessary.",
    "Proceed autonomously through the existing workflow until the node work is complete or a serious blocker appears.",
    "",
    "Streamliner resume metadata:",
    `- Project: ${handoff.launchMetadata.projectKey}`,
    `- Workstream: ${handoff.launchMetadata.workstreamId}`,
    `- Node: ${handoff.launchMetadata.nodeId}`,
    `- Work ID: ${handoff.launchMetadata.workId}`,
    `- Launch claim: ${claim.launchClaimId}`,
    `- Existing SDK session: ${claim.boundCopilotSessionId ?? "unknown"}`,
  ].join("\n");
}

async function reserveLaunchClaimForHandoff(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  handoff: PawLaunchHandoff,
  deps: NodeLaunchDeps,
  options: { recordCliArgs?: boolean } = {},
): Promise<{ claim: LaunchClaim; now: Date }> {
  // Launch claim reservation/failure cleanup intentionally still uses the
  // concrete file store because createLaunchClaim/markClaimFailed need
  // conditional row cleanup helpers that are outside SessionRegistryStore.
  if (handoff.launchMetadata.launchNonce !== null) {
    assertLaunchPromptToken(handoff.launchMetadata.launchNonce, "launch nonce");
  }
  const node = assertLaunchPolicyAllows(handoff);
  assertLaunchModeAllows(handoff, node);
  await assertSharedBranchReady(handoff, deps);
  const now = deps.now?.() ?? new Date();
  const blockingClaim = findBlockingLaunchClaim(
    claimStore,
    handoff.launchMetadata.workstreamId,
    handoff.launchMetadata.nodeId,
    now,
  );
  if (
    blockingClaim ||
    hasActiveManagedRuntime(
      registryStore,
      handoff.launchMetadata.workstreamId,
      handoff.launchMetadata.nodeId,
    )
  ) {
    throw new NodeLaunchError(
      "duplicate_active_launch",
      409,
      `Node ${handoff.launchMetadata.nodeId} already has an active launch claim or managed runtime.`,
      blockingClaim,
    );
  }

  const terminalTitle = terminalTitleFor(handoff);
  const claimOutcome = createLaunchClaim(registryStore, claimStore, {
    workstreamId: handoff.launchMetadata.workstreamId,
    nodeId: handoff.launchMetadata.nodeId,
    expectedCwd: handoff.cwd,
    expectedBranch: handoff.branch,
    expectedRepo: null,
    contextId: handoff.contextPackage.contextId,
    launchNonce: handoff.launchMetadata.launchNonce,
    reservedRowTitle: terminalTitle,
    reservedRowColor: handoff.terminal.tabColor ?? null,
    reservedRowDescription: buildLaunchedSessionDescription(
      handoff.launchMetadata.workstreamId,
      handoff.launchMetadata.nodeId,
    ),
    pawLaunch: pawLaunchFor(handoff),
    ...(options.recordCliArgs ? { cliArgs: [...handoff.cliArgs] } : {}),
    lineageMetadata: lineageMetadataFor(handoff),
  });
  if (!claimOutcome.ok) {
    throw new NodeLaunchError(
      "launch_claim_failed",
      500,
      claimOutcome.error.message,
    );
  }
  const branchLease = handoff.launchMetadata.branchLease;
  if (branchLease && deps.branchLeaseCoordinator) {
    try {
      await deps.branchLeaseCoordinator.bindBranchLeaseToLaunch({
        leaseId: branchLease.leaseId,
        branchLeaseKey: branchLease.branchLeaseKey,
        graphPath: handoff.launchMetadata.graphPath,
        nodeId: handoff.launchMetadata.nodeId,
        cwd: handoff.cwd,
        targetBranch: branchLease.targetBranch,
        requiredStartSha: branchLease.requiredStartSha,
        launchClaimId: claimOutcome.claim.launchClaimId,
        registryId: claimOutcome.claim.reservedRegistryId,
        now,
      });
    } catch (error: unknown) {
      markClaimFailed(
        registryStore,
        claimStore,
        claimOutcome.claim.launchClaimId,
        "internal-error",
        errorMessage(error),
        deps.now ? { now: deps.now } : undefined,
      );
      throw new NodeLaunchError(
        "branch_lease_conflict",
        409,
        `Failed to bind shared branch lease to launch claim: ${errorMessage(error)}`,
        claimOutcome.claim,
      );
    }
  }
  return { claim: claimOutcome.claim, now };
}

export async function launchPreparedNode(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  handoff: PawLaunchHandoff,
  deps: NodeLaunchDeps = {},
): Promise<NodeLaunchResult> {
  const { claim, now } = await reserveLaunchClaimForHandoff(
    registryStore,
    claimStore,
    handoff,
    deps,
    { recordCliArgs: true },
  );
  const terminalTitle = terminalTitleFor(handoff);
  const kickoffPrompt = appendLaunchBindingPromptLines(
    handoff.kickoffPrompt,
    claim.launchNonce,
    claim.launchClaimId,
  );
  const command = buildCopilotInteractiveCommand({
    cliArgs: handoff.cliArgs,
    kickoffPrompt,
  });
  const terminalOptions: TerminalLaunchOptions = {
    cwd: handoff.cwd,
    command,
    env: {
      ...handoff.environment,
      STREAMLINER_LAUNCH_CLAIM_ID: claim.launchClaimId,
    },
    prepareCopilotCli: true,
    preferredTerminal: handoff.terminal.preferredTerminal,
    title: terminalTitle,
    tabColor: handoff.terminal.tabColor ?? undefined,
  };

  try {
    const terminal = await launchCopilotTerminal(terminalOptions, {
      launchTerminal: deps.launchTerminal,
      cooldownMs: deps.launchTerminal ? 0 : undefined,
    });
    return {
      runtimeKind: "terminal-cli",
      launchClaim: summarizeLaunchClaim(claim, now),
      terminal,
      cwd: handoff.cwd,
      branch: handoff.branch,
      command: {
        cliArgs: [...handoff.cliArgs],
        promptNonceLine: kickoffNonceLine(claim.launchNonce),
      },
    };
  } catch (error: unknown) {
    const logger = getApiLogger().withScope("node-launch");
    const message = errorMessage(error);
    const hadWorkerOwnershipEvidence = hasWorkerOwnershipEvidence(
      claim.reservedRegistryId
        ? registryStore.getSession(claim.reservedRegistryId)
        : null,
    );
    let failedClaim: LaunchClaim | null = claim;
    let failedOutcome: MarkClaimFailedOutcome | null = null;
    let failureTransitionError: string | null = null;
    let leaseRecoveryError: string | null = null;
    try {
      const failed = markClaimFailed(
        registryStore,
        claimStore,
        claim.launchClaimId,
        "terminal-spawn-failed",
        message,
        deps.now ? { now: deps.now } : undefined,
      );
      failedOutcome = failed;
      if (failed.ok && failed.claim) {
        failedClaim = failed.claim;
      } else {
        failureTransitionError = "launch claim was not found while marking terminal spawn failure";
      }
    } catch (markError: unknown) {
      failureTransitionError = errorMessage(markError);
      logger.error("terminal spawn failure claim transition failed", {
        launchClaimId: claim.launchClaimId,
        workstreamId: claim.workstreamId,
        nodeId: claim.nodeId,
        err: errorLogDetails(markError),
      });
    }
    leaseRecoveryError = await recoverSharedBranchLeaseAfterFailedLaunch({
      handoff,
      failed: failedOutcome,
      failureCode: "terminal-spawn-failed",
      failureReason: message,
      hadWorkerOwnershipEvidence,
      registryStore,
      deps,
      logger,
    });
    logger.error("terminal spawn failed", {
      launchClaimId: claim.launchClaimId,
      workstreamId: claim.workstreamId,
      nodeId: claim.nodeId,
      failureTransition: failureTransitionError ? "failed" : "recorded",
      branchLeaseRecovery: leaseRecoveryError ? "failed" : "completed-or-not-applicable",
      err: errorLogDetails(error),
    });
    const transitionMessage = [
      failureTransitionError
        ? `also failed to mark launch claim failed: ${failureTransitionError}`
        : null,
      leaseRecoveryError
        ? `also failed to recover shared branch lease: ${leaseRecoveryError}`
        : null,
    ].filter((entry): entry is string => entry !== null);
    throw new NodeLaunchError(
      "terminal_spawn_failed",
      500,
      `Failed to launch terminal: ${message}${transitionMessage.length > 0 ? `; ${transitionMessage.join("; ")}` : ""}`,
      failedClaim,
    );
  }
}

function managedResumeTarget(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  handoff: PawLaunchHandoff,
  launchClaimId: string,
): { claim: LaunchClaim; registryId: string; session: SessionRegistryRecord; sdkSessionId: string } {
  const claim = claimStore.getClaim(launchClaimId);
  if (!claim) {
    throw new NodeLaunchError(
      "managed_sdk_resume_unavailable",
      404,
      `Launch claim ${launchClaimId} does not exist.`,
      null,
    );
  }
  if (
    claim.workstreamId !== handoff.launchMetadata.workstreamId ||
    claim.nodeId !== handoff.launchMetadata.nodeId
  ) {
    throw new NodeLaunchError(
      "managed_sdk_resume_unavailable",
      409,
      `Launch claim ${launchClaimId} is not bound to node ${handoff.launchMetadata.nodeId}.`,
      claim,
    );
  }
  if (claim.status !== "bound") {
    throw new NodeLaunchError(
      "managed_sdk_resume_unavailable",
      409,
      `Launch claim ${launchClaimId} is ${claim.status}; only bound background sessions can be resumed.`,
      claim,
    );
  }
  const registryId = claim.boundRegistryId ?? claim.reservedRegistryId;
  if (!registryId) {
    throw new NodeLaunchError(
      "managed_sdk_resume_unavailable",
      409,
      `Launch claim ${launchClaimId} does not reference a registry row.`,
      claim,
    );
  }
  const session = registryStore.getSession(registryId);
  if (!session) {
    throw new NodeLaunchError(
      "managed_sdk_resume_unavailable",
      404,
      `Bound registry row ${registryId} does not exist.`,
      claim,
    );
  }
  const runtime = session.runtime;
  if (runtime?.runtimeKind !== "managed-sdk" || runtime.runtimeOwner !== "streamliner-sdk") {
    throw new NodeLaunchError(
      "managed_sdk_resume_unavailable",
      409,
      `Registry row ${registryId} is not a Streamliner-managed background session.`,
      claim,
    );
  }
  if (isNonResumableManagedLifecycle(runtime.lifecycleState)) {
    throw new NodeLaunchError(
      "managed_sdk_resume_unavailable",
      409,
      `Managed background session is ${runtime.lifecycleState} and cannot be resumed.`,
      claim,
    );
  }
  if (session.copilotProcessState === "live") {
    throw new NodeLaunchError(
      "managed_sdk_resume_unavailable",
      409,
      "Managed background session still appears live; wait for it to settle or interrupt it before resuming.",
      claim,
    );
  }
  const sdkSessionId = runtime.sdkSessionId ?? claim.boundCopilotSessionId ?? session.copilotSessionId;
  if (!sdkSessionId) {
    throw new NodeLaunchError(
      "managed_sdk_resume_unavailable",
      409,
      `Registry row ${registryId} does not have a Copilot SDK session id to resume.`,
      claim,
    );
  }
  return { claim, registryId, session, sdkSessionId };
}

export async function launchManagedSdkNode(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  handoff: PawLaunchHandoff,
  deps: NodeLaunchDeps = {},
): Promise<NodeManagedSdkLaunchResult> {
  const { claim, now } = await reserveLaunchClaimForHandoff(
    registryStore,
    claimStore,
    handoff,
    deps,
  );
  if (!claim.reservedRegistryId) {
    throw new NodeLaunchError(
      "launch_claim_failed",
      500,
      "Managed SDK launch requires a reserved registry row.",
      claim,
    );
  }
  const registryId = claim.reservedRegistryId;
  const kickoffPrompt = appendLaunchBindingPromptLines(
    handoff.kickoffPrompt,
    claim.launchNonce,
    claim.launchClaimId,
  );
  registryStore.patchRuntimeMetadata(registryId, {
    runtimeKind: "managed-sdk",
    runtimeOwner: "streamliner-sdk",
    lifecycleState: "preparing",
    permissionProfile: "managed-autonomous",
    launchClaimId: claim.launchClaimId,
    launchNonce: claim.launchNonce,
    startedAt: now.toISOString(),
    progressEvents: [{
      type: "lifecycle",
      message: "Managed SDK launch reserved canonical registry row.",
      timestamp: now.toISOString(),
      data: {
        workstreamId: handoff.launchMetadata.workstreamId,
        nodeId: handoff.launchMetadata.nodeId,
        launchClaimId: claim.launchClaimId,
      },
    }],
  }, now);
  const runtimePatches = runtimePatchCoalescerFor(deps);
  runtimePatches.begin(registryId, "preparing");
  const runner = deps.managedSdkRunner ?? new DefaultManagedSdkRunner();
  let startResult: ManagedSdkRunnerStartResult;
  try {
    startResult = await runner.start({
      registryId,
      launchClaimId: claim.launchClaimId,
      launchNonce: claim.launchNonce,
      cwd: handoff.cwd,
      branch: handoff.branch,
      prompt: kickoffPrompt,
      cliArgs: [...handoff.cliArgs],
      environment: {
        ...handoff.environment,
        STREAMLINER_LAUNCH_CLAIM_ID: claim.launchClaimId,
        STREAMLINER_MANAGED_RUNTIME_KIND: "managed-sdk",
        STREAMLINER_MANAGED_PERMISSION_PROFILE: "managed-autonomous",
      },
      sessionStateRoot: handoff.sessionStateRoot,
      onLifecycleState: (state, message) => {
        runtimePatches.enqueue(registryId, {
          lifecycleState: state,
          progressEvents: [{
            type: "lifecycle",
            message: message || lifecycleProgressMessage(state),
          }],
        });
      },
      onProgress: (event) => {
        runtimePatches.enqueue(registryId, {
          progressEvents: [event],
        });
      },
      onEvidence: (evidence) => {
        runtimePatches.enqueue(registryId, {
          evidence: [evidence],
          progressEvents: [{
            type: "evidence",
            message: `Managed SDK evidence recorded: ${evidence.kind}.`,
          }],
        });
      },
      onStarted: (details) => {
        runtimePatches.patchNow(registryId, {
          lifecycleState: "running",
          sdkSessionId: details.sdkSessionId,
          sdkWorkspacePath: details.sdkWorkspacePath,
          sdkStateRoot: details.sdkStateRoot,
          progressEvents: [{
            type: "lifecycle",
            message: "Managed SDK session started.",
            data: {
              sdkSessionId: details.sdkSessionId,
              hasWorkspacePath: Boolean(details.sdkWorkspacePath),
            },
          }],
        });
      },
    });
  } catch (error: unknown) {
    const message = errorMessage(error);
    const logger = getApiLogger().withScope("node-launch");
    const cleanupFailures: string[] = [];
    const hadWorkerOwnershipEvidence = hasWorkerOwnershipEvidence(
      registryStore.getSession(registryId),
    );
    let failedOutcome: MarkClaimFailedOutcome | null = null;
    try {
      runtimePatches.patchNow(registryId, {
        lifecycleState: "failed",
        progressEvents: [{
          type: "error",
          message,
        }],
      });
    } catch (runtimePatchError: unknown) {
      const patchMessage = errorMessage(runtimePatchError);
      cleanupFailures.push(`record managed runtime failure: ${patchMessage}`);
      logger.error("managed SDK start failure runtime transition failed", {
        launchClaimId: claim.launchClaimId,
        workstreamId: claim.workstreamId,
        nodeId: claim.nodeId,
        registryId,
        err: errorLogDetails(runtimePatchError),
      });
    }
    try {
      const failed = markClaimFailed(
        registryStore,
        claimStore,
        claim.launchClaimId,
        "internal-error",
        message,
        deps.now ? { now: deps.now } : undefined,
      );
      failedOutcome = failed;
      if (!failed.ok) {
        cleanupFailures.push("mark launch claim failed: launch claim was not found");
      }
    } catch (claimFailureError: unknown) {
      const claimFailureMessage = errorMessage(claimFailureError);
      cleanupFailures.push(`mark launch claim failed: ${claimFailureMessage}`);
      logger.error("managed SDK start failure claim transition failed", {
        launchClaimId: claim.launchClaimId,
        workstreamId: claim.workstreamId,
        nodeId: claim.nodeId,
        registryId,
        err: errorLogDetails(claimFailureError),
      });
    }
    const leaseRecoveryError = await recoverSharedBranchLeaseAfterFailedLaunch({
      handoff,
      failed: failedOutcome,
      failureCode: "internal-error",
      failureReason: message,
      hadWorkerOwnershipEvidence,
      registryStore,
      deps,
      logger,
    });
    if (leaseRecoveryError) {
      cleanupFailures.push(`recover shared branch lease: ${leaseRecoveryError}`);
    }
    logger.error("managed SDK start failed", {
      launchClaimId: claim.launchClaimId,
      workstreamId: claim.workstreamId,
      nodeId: claim.nodeId,
      registryId,
      cleanup: cleanupFailures.length > 0 ? "failed" : "recorded",
      err: errorLogDetails(error),
    });
    const cleanupMessage = cleanupFailures.length > 0
      ? `; also failed to ${cleanupFailures.join("; failed to ")}`
      : "";
    throw new NodeLaunchError(
      "managed_sdk_start_failed",
      500,
      `Failed to start managed SDK worker: ${message}${cleanupMessage}`,
      claim,
    );
  }

  return {
    runtimeKind: "managed-sdk",
    launchClaim: summarizeLaunchClaim(claim, now),
    managedSdk: {
      registryId,
      sdkSessionId: startResult.sdkSessionId,
      sdkWorkspacePath: startResult.sdkWorkspacePath,
      sdkStateRoot: startResult.sdkStateRoot,
      permissionProfile: "managed-autonomous",
    },
    cwd: handoff.cwd,
    branch: handoff.branch,
    command: {
      cliArgs: [...handoff.cliArgs],
      promptNonceLine: kickoffNonceLine(claim.launchNonce),
    },
  };
}

export async function resumeManagedSdkNode(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  handoff: PawLaunchHandoff,
  launchClaimId: string,
  deps: NodeLaunchDeps = {},
): Promise<NodeManagedSdkLaunchResult> {
  if (handoff.launchMetadata.launchNonce !== null) {
    assertLaunchPromptToken(handoff.launchMetadata.launchNonce, "launch nonce");
  }
  const node = assertLaunchPolicyAllows(handoff);
  assertLaunchModeAllows(handoff, node);
  const now = deps.now?.() ?? new Date();
  const { claim, registryId, session, sdkSessionId } = managedResumeTarget(
    registryStore,
    claimStore,
    handoff,
    launchClaimId,
  );
  await reclaimSharedBranchForResume(
    handoff,
    claim.launchClaimId,
    registryId,
    deps,
    now,
  );
  const graphBinding = {
    workstreamId: claim.workstreamId,
    nodeId: claim.nodeId,
    launchClaimId: claim.launchClaimId,
  };
  const bindResult = registryStore.bindClaimToRow(
    registryId,
    {
      cwdAfterNormalize: session.cwd,
      branch: claim.expectedBranch,
      repo: claim.expectedRepo,
      requireGraphBindingNullOrMatching: graphBinding,
    },
    { graphBinding },
  );
  if (!bindResult.ok) {
    throw new NodeLaunchError(
      "managed_sdk_resume_unavailable",
      409,
      `Cannot restore the node binding for session resume: ${bindResult.reason}${bindResult.detail ? `: ${bindResult.detail}` : ""}`,
      claim,
    );
  }

  const runner = deps.managedSdkRunner ?? new DefaultManagedSdkRunner();
  if (!runner.resume) {
    throw new NodeLaunchError(
      "managed_sdk_resume_failed",
      500,
      "Managed SDK runner does not support resuming sessions.",
      claim,
    );
  }

  registryStore.patchRuntimeMetadata(registryId, {
    runtimeKind: "managed-sdk",
    runtimeOwner: "streamliner-sdk",
    lifecycleState: "starting",
    forceLifecycleState: true,
    permissionProfile: "managed-autonomous",
    launchClaimId: claim.launchClaimId,
    launchNonce: claim.launchNonce,
    sdkSessionId,
    progressEvents: [{
      type: "lifecycle",
      message: "Resuming managed SDK background session.",
      timestamp: now.toISOString(),
      data: {
        workstreamId: handoff.launchMetadata.workstreamId,
        nodeId: handoff.launchMetadata.nodeId,
        launchClaimId: claim.launchClaimId,
        sdkSessionId,
      },
    }],
  }, now);
  const runtimePatches = runtimePatchCoalescerFor(deps);
  runtimePatches.begin(registryId, "starting");

  const resumePrompt = resumePromptForManagedSdkNode(handoff, claim);
  let startResult: ManagedSdkRunnerStartResult;
  try {
    startResult = await runner.resume({
      registryId,
      launchClaimId: claim.launchClaimId,
      launchNonce: claim.launchNonce,
      sdkSessionId,
      cwd: handoff.cwd,
      branch: handoff.branch,
      prompt: resumePrompt,
      cliArgs: [...handoff.cliArgs],
      environment: {
        ...handoff.environment,
        STREAMLINER_LAUNCH_CLAIM_ID: claim.launchClaimId,
        STREAMLINER_MANAGED_RUNTIME_KIND: "managed-sdk",
        STREAMLINER_MANAGED_PERMISSION_PROFILE: "managed-autonomous",
      },
      sessionStateRoot: handoff.sessionStateRoot,
      onLifecycleState: (state, message) => {
        runtimePatches.enqueue(registryId, {
          lifecycleState: state,
          progressEvents: [{
            type: "lifecycle",
            message: message || lifecycleProgressMessage(state),
          }],
        });
      },
      onProgress: (event) => {
        runtimePatches.enqueue(registryId, {
          progressEvents: [event],
        });
      },
      onEvidence: (evidence) => {
        runtimePatches.enqueue(registryId, {
          evidence: [evidence],
          progressEvents: [{
            type: "evidence",
            message: `Managed SDK evidence recorded: ${evidence.kind}.`,
          }],
        });
      },
      onStarted: (details) => {
        runtimePatches.patchNow(registryId, {
          lifecycleState: "running",
          sdkSessionId: details.sdkSessionId,
          sdkWorkspacePath: details.sdkWorkspacePath,
          sdkStateRoot: details.sdkStateRoot,
          progressEvents: [{
            type: "lifecycle",
            message: "Managed SDK session resumed.",
            data: {
              sdkSessionId: details.sdkSessionId,
              hasWorkspacePath: Boolean(details.sdkWorkspacePath),
            },
          }],
        });
      },
    });
    try {
      const resumedSdkSessionId = startResult.sdkSessionId ?? sdkSessionId;
      registryStore.attachObservedSession(registryId, {
        copilotSessionId: resumedSdkSessionId,
        cwd: session.cwd,
        repo: claim.expectedRepo ?? session.repo,
        branch: claim.expectedBranch ?? session.branch,
        lastSeenAt: now.toISOString(),
        lifecycleStatus: "active",
        observedSessionKind: "interactive",
        copilotProcessState: "live",
        trustedSignalSource: "copilot-cli-hook",
        trustedStartedAt: now.toISOString(),
        trustedEndedAt: null,
        trustedLastSignalAt: now.toISOString(),
        trustedStartSource: "resume",
        trustedEndReason: null,
        trustedExecutionKind: session.trustedExecutionKind ?? "agency",
        trustedInitialPromptLength: resumePrompt.length,
      });
      registryStore.recordTrustedSessionSignal({
        event: "session.started",
        source: "copilot-cli-hook",
        sessionId: resumedSdkSessionId,
        timestamp: now.toISOString(),
        cwd: session.cwd,
        repo: claim.expectedRepo ?? session.repo,
        branch: claim.expectedBranch ?? session.branch,
        hookSource: "resume",
        executionKind: session.trustedExecutionKind ?? "agency",
        initialPromptLength: resumePrompt.length,
      });
    } catch (signalError: unknown) {
      getApiLogger().withScope("node-launch").warn("managed SDK resume signal synthesis failed", {
        launchClaimId: claim.launchClaimId,
        workstreamId: claim.workstreamId,
        nodeId: claim.nodeId,
        registryId,
        sdkSessionId: startResult.sdkSessionId ?? sdkSessionId,
        err: errorLogDetails(signalError),
      });
    }
  } catch (error: unknown) {
    const message = errorMessage(error);
    const logger = getApiLogger().withScope("node-launch");
    try {
      runtimePatches.patchNow(registryId, {
        lifecycleState: "failed",
        progressEvents: [{
          type: "error",
          message,
        }],
      });
    } catch (runtimePatchError: unknown) {
      logger.error("managed SDK resume failure runtime transition failed", {
        launchClaimId: claim.launchClaimId,
        workstreamId: claim.workstreamId,
        nodeId: claim.nodeId,
        registryId,
        err: errorLogDetails(runtimePatchError),
      });
    }
    logger.error("managed SDK resume failed", {
      launchClaimId: claim.launchClaimId,
      workstreamId: claim.workstreamId,
      nodeId: claim.nodeId,
      registryId,
      err: errorLogDetails(error),
    });
    throw new NodeLaunchError(
      "managed_sdk_resume_failed",
      500,
      `Failed to resume managed SDK worker: ${message}`,
      claim,
    );
  }

  return {
    runtimeKind: "managed-sdk",
    launchClaim: summarizeLaunchClaim(claim, now),
    managedSdk: {
      registryId,
      sdkSessionId: startResult.sdkSessionId,
      sdkWorkspacePath: startResult.sdkWorkspacePath,
      sdkStateRoot: startResult.sdkStateRoot,
      permissionProfile: "managed-autonomous",
    },
    cwd: handoff.cwd,
    branch: handoff.branch,
    command: {
      cliArgs: [...handoff.cliArgs],
      promptNonceLine: kickoffNonceLine(claim.launchNonce),
    },
  };
}
