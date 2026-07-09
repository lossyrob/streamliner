import type { LaunchClaim, LaunchClaimStatus } from "../launch-claim-schema";
import type { LaunchClaimStore } from "../launch-claim-contract";
import type {
  SessionRegistryManagedLifecycleState,
  SessionRegistryPawLaunch,
  SessionRegistryRecord,
} from "../session-registry-schema";
import type { SessionRegistryStore } from "../session-registry-contract";
import { buildLaunchedSessionDescription } from "../session-registry-filter";
import type { SessionRegistryFileStore } from "../session-registry/file-store";
import { isManagedRuntimeActive } from "../session-registry/managed-runtime";
import {
  createLaunchClaim,
  kickoffNonceLine,
  LAUNCH_NONCE_PROMPT_LINE_PREFIX,
  markClaimFailed,
} from "../session-registry/launch-claims";
import type { PawLaunchHandoff } from "./launch-preparation";
import {
  buildCopilotInteractiveCommandForShell,
  launchCopilotTerminal,
  selectTerminalCommandShellDialect,
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

function reserveLaunchClaimForHandoff(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  handoff: PawLaunchHandoff,
  deps: NodeLaunchDeps,
  options: { recordCliArgs?: boolean } = {},
): { claim: LaunchClaim; now: Date } {
  // Launch claim reservation/failure cleanup intentionally still uses the
  // concrete file store because createLaunchClaim/markClaimFailed need
  // conditional row cleanup helpers that are outside SessionRegistryStore.
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
    { recordCliArgs: true },
  );
  const terminalTitle = terminalTitleFor(handoff);
  const kickoffPrompt = appendLaunchBindingPromptLines(
    handoff.kickoffPrompt,
    claim.launchNonce,
    claim.launchClaimId,
  );
  const command = buildCopilotInteractiveCommandForShell({
    cliArgs: handoff.cliArgs,
    kickoffPrompt,
  }, selectTerminalCommandShellDialect());
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
      pluginPreflight: deps.launchTerminal ? false : undefined,
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
  assertLaunchPolicyAllows(handoff);
  const now = deps.now?.() ?? new Date();
  const { claim, registryId, session, sdkSessionId } = managedResumeTarget(
    registryStore,
    claimStore,
    handoff,
    launchClaimId,
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
