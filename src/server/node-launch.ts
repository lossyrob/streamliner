import type { LaunchClaim, LaunchClaimStatus } from "../launch-claim-schema";
import type { LaunchClaimStore } from "../launch-claim-contract";
import type { SessionRegistryPawLaunch } from "../session-registry-schema";
import { SessionRegistryFileStore } from "../session-registry/file-store";
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
import { getApiLogger } from "./logger";

export type NodeLaunchErrorCode =
  | "duplicate_active_launch"
  | "launch_claim_failed"
  | "terminal_spawn_failed";

export class NodeLaunchError extends Error {
  readonly code: NodeLaunchErrorCode;
  readonly statusCode: number;
  readonly claim: LaunchClaim | null;

  constructor(
    code: NodeLaunchErrorCode,
    statusCode: number,
    message: string,
    claim: LaunchClaim | null = null,
  ) {
    super(message);
    this.name = "NodeLaunchError";
    this.code = code;
    this.statusCode = statusCode;
    this.claim = claim;
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
  launchClaim: NodeLaunchClaimSummary;
  terminal: TerminalLaunchResult;
  cwd: string;
  branch: string;
  command: {
    cliArgs: string[];
    promptNonceLine: string;
  };
}

export interface NodeLaunchDeps {
  launchTerminal?: (options: TerminalLaunchOptions) => TerminalLaunchResult;
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

export function launchPreparedNode(
  registryStore: SessionRegistryFileStore,
  claimStore: LaunchClaimStore,
  handoff: PawLaunchHandoff,
  deps: NodeLaunchDeps = {},
): NodeLaunchResult {
  if (handoff.launchMetadata.launchNonce !== null) {
    assertLaunchPromptToken(handoff.launchMetadata.launchNonce, "launch nonce");
  }
  const now = deps.now?.() ?? new Date();
  const blockingClaim = findBlockingLaunchClaim(
    claimStore,
    handoff.launchMetadata.workstreamId,
    handoff.launchMetadata.nodeId,
    now,
  );
  if (blockingClaim) {
    throw new NodeLaunchError(
      "duplicate_active_launch",
      409,
      `Node ${handoff.launchMetadata.nodeId} already has an active launch claim.`,
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

  const claim = claimOutcome.claim;
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
