import type { LaunchClaim, LaunchClaimStatus } from "../launch-claim-schema";
import type { LaunchClaimStore } from "../launch-claim-contract";
import type {
  SessionRegistryManagedLifecycleState,
  SessionRegistryPawLaunch,
} from "../session-registry-schema";
import { SessionRegistryFileStore } from "../session-registry/file-store";
import { isManagedRuntimeActive } from "../session-registry/managed-runtime";
import {
  createLaunchClaim,
  kickoffNonceLine,
  LAUNCH_NONCE_PROMPT_LINE_PREFIX,
  markClaimFailed,
} from "../session-registry/launch-claims";
import type { PawLaunchHandoff } from "./launch-preparation";
import {
  buildCopilotInteractiveCommand,
  launchTerminal,
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

export type NodeLaunchErrorCode =
  | "launch_policy_blocked"
  | "launch_policy_unavailable"
  | "duplicate_active_launch"
  | "launch_claim_failed"
  | "terminal_spawn_failed"
  | "managed_sdk_start_failed";

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
  };
}

function pawLaunchFor(handoff: PawLaunchHandoff): SessionRegistryPawLaunch {
  return {
    workId: handoff.launchMetadata.workId,
    workTitle: handoff.launchMetadata.workTitle,
    workflowKind: "paw-lite",
    pawWorkDir: handoff.pawWorkDir,
    workflowContextPath: handoff.workflowContextPath,
    streamlinerContextPath: handoff.streamlinerContextPath,
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

function lifecycleProgressMessage(state: SessionRegistryManagedLifecycleState): string {
  return `Managed SDK lifecycle changed to ${state}.`;
}

function hasActiveManagedRuntime(
  registryStore: SessionRegistryFileStore,
  workstreamId: string,
  nodeId: string,
): boolean {
  return registryStore
    .listSessions({ includeArchived: false, workstreamId, nodeId })
    .some((session) => isManagedRuntimeActive(session.runtime));
}

function assertLaunchPolicyAllows(handoff: PawLaunchHandoff): void {
  const policyResult = evaluateLaunchPolicyFromGraph({
    graphPath: handoff.launchMetadata.graphPath,
    nodeId: handoff.launchMetadata.nodeId,
  });
  if (policyResult.ok) {
    return;
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
    return;
  }
  throw new NodeLaunchError(
    "launch_policy_unavailable",
    policyResult.statusCode,
    policyResult.message,
    null,
    details,
  );
}

function reserveLaunchClaimForHandoff(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  handoff: PawLaunchHandoff,
  deps: NodeLaunchDeps,
): { claim: LaunchClaim; now: Date } {
  if (handoff.launchMetadata.launchNonce !== null) {
    assertLaunchPromptToken(handoff.launchMetadata.launchNonce, "launch nonce");
  }
  assertLaunchPolicyAllows(handoff);
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
    reservedRowDescription: `Graph launch for workstream ${handoff.launchMetadata.workstreamId}, node ${handoff.launchMetadata.nodeId}.`,
    pawLaunch: pawLaunchFor(handoff),
    lineageMetadata: lineageMetadataFor(handoff),
  });
  if (!claimOutcome.ok) {
    throw new NodeLaunchError(
      "launch_claim_failed",
      500,
      claimOutcome.error.message,
    );
  }
  return { claim: claimOutcome.claim, now };
}

export async function launchPreparedNode(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  handoff: PawLaunchHandoff,
  deps: NodeLaunchDeps = {},
): Promise<NodeLaunchResult> {
  const { claim, now } = reserveLaunchClaimForHandoff(
    registryStore,
    claimStore,
    handoff,
    deps,
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
    preferredTerminal: handoff.terminal.preferredTerminal,
    title: terminalTitle,
    tabColor: handoff.terminal.tabColor ?? undefined,
  };

  try {
    const terminal = (deps.launchTerminal ?? launchTerminal)(terminalOptions);
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
    let failedClaim: LaunchClaim | null = claim;
    let failureTransitionError: string | null = null;
    try {
      const failed = markClaimFailed(
        registryStore,
        claimStore,
        claim.launchClaimId,
        "terminal-spawn-failed",
        message,
        deps.now ? { now: deps.now } : undefined,
      );
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
    logger.error("terminal spawn failed", {
      launchClaimId: claim.launchClaimId,
      workstreamId: claim.workstreamId,
      nodeId: claim.nodeId,
      failureTransition: failureTransitionError ? "failed" : "recorded",
      err: errorLogDetails(error),
    });
    const transitionMessage = failureTransitionError
      ? `; also failed to mark launch claim failed: ${failureTransitionError}`
      : "";
    throw new NodeLaunchError(
      "terminal_spawn_failed",
      500,
      `Failed to launch terminal: ${message}${transitionMessage}`,
      failedClaim,
    );
  }
}

export async function launchManagedSdkNode(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  handoff: PawLaunchHandoff,
  deps: NodeLaunchDeps = {},
): Promise<NodeManagedSdkLaunchResult> {
  const { claim, now } = reserveLaunchClaimForHandoff(
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
        registryStore.patchRuntimeMetadata(registryId, {
          lifecycleState: state,
          progressEvents: [{
            type: "lifecycle",
            message: message || lifecycleProgressMessage(state),
          }],
        });
      },
      onProgress: (event) => {
        registryStore.patchRuntimeMetadata(registryId, {
          progressEvents: [event],
        });
      },
      onEvidence: (evidence) => {
        registryStore.patchRuntimeMetadata(registryId, {
          evidence: [evidence],
          progressEvents: [{
            type: "evidence",
            message: `Managed SDK evidence recorded: ${evidence.kind}.`,
          }],
        });
      },
      onStarted: (details) => {
        registryStore.patchRuntimeMetadata(registryId, {
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
    try {
      registryStore.patchRuntimeMetadata(registryId, {
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
