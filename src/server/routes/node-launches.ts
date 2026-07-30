import { Router } from "express";

import type { LaunchClaimStore } from "../../launch-claim-contract";
import type { LaunchContextPackage } from "../launch-context";
import {
  type PawLaunchHandoff,
  type PawLaunchMetadata,
  type PawLaunchTerminalPreferences,
} from "../launch-preparation";
import {
  isLaunchPromptToken,
  launchManagedSdkNode,
  launchPreparedNode,
  NodeLaunchError,
  resumeManagedSdkNode,
  summarizeLaunchClaim,
  type NodeLaunchDeps,
} from "../node-launch";
import type { NodeLaunchRecordStore } from "../node-launch-record-store";
import {
  isBlockingNodeLaunchOperation,
  type NodeBranchLease,
  type NodeTerminalLaunchResponse,
} from "../../node-launch-record-contract";
import { SessionRegistryFileStore } from "../../session-registry/file-store";
import {
  WORKSTREAM_LAUNCH_REQUIRED_TRACKERS,
  WORKSTREAM_NODE_LAUNCH_MODES,
  type WorkstreamLaunchPolicy,
  type WorkstreamLaunchRequiredTracker,
  type WorkstreamNodeLaunchMode,
} from "../../workstream-schema";
import { isLoopbackAddress } from "../config";
import { getApiLogger } from "../logger";

interface ParsedBody {
  handoff: PawLaunchHandoff;
}

interface ParsedResumeBody extends ParsedBody {
  launchClaimId: string;
}

function hasNonLoopbackForwardedFor(value: string | string[] | undefined): boolean {
  if (!value) {
    return false;
  }
  const values = Array.isArray(value) ? value : value.split(",");
  return values.some((entry) => !isLoopbackAddress(entry.trim()));
}

function isNonLoopbackRequest(req: {
  socket: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  return (
    !isLoopbackAddress(req.socket.remoteAddress) ||
    hasNonLoopbackForwardedFor(req.headers["x-forwarded-for"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function badRequest(message: string, input: string): Error {
  return Object.assign(new Error(message), {
    statusCode: 400,
    code: "invalid_node_launch_handoff",
    input,
  });
}

function stringField(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${label} must be a non-empty string.`, label);
  }
  return value;
}

function optionalStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function nullableStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function optionalTrimmedStringField(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw badRequest(`${label} must be a string.`, label);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalHexColorField(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw badRequest(`${label} must be a #RRGGBB color.`, label);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^#[0-9a-f]{6}$/i.test(trimmed)) {
    throw badRequest(`${label} must be a #RRGGBB color.`, label);
  }
  return trimmed.toLowerCase();
}

function nullableLaunchPromptTokenField(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = nullableStringField(record, key);
  if (value !== null && !isLaunchPromptToken(value)) {
    throw badRequest(`${label} must be a non-empty single-line token.`, label);
  }
  return value;
}

function stringArrayField(record: Record<string, unknown>, key: string, label: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw badRequest(`${label} must be an array of strings.`, label);
  }
  return [...value];
}

function stringRecordField(record: Record<string, unknown>, key: string, label: string): Record<string, string> {
  const value = record[key];
  if (value === undefined) {
    throw badRequest(`${label} must be an object with string values.`, label);
  }
  if (!isRecord(value)) {
    throw badRequest(`${label} must be an object with string values.`, label);
  }
  const result: Record<string, string> = {};
  for (const [envKey, envValue] of Object.entries(value)) {
    if (typeof envValue !== "string") {
      throw badRequest(`${label}.${envKey} must be a string.`, `${label}.${envKey}`);
    }
    result[envKey] = envValue;
  }
  return result;
}

function nullableLaunchPolicyField(
  record: Record<string, unknown>,
  key: string,
  label: string,
): WorkstreamLaunchPolicy | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw badRequest(`${label} must be an object.`, label);
  }
  const requiredTracker = value.requiredTracker;
  if (requiredTracker === undefined) {
    return {};
  }
  if (
    typeof requiredTracker !== "string" ||
    !WORKSTREAM_LAUNCH_REQUIRED_TRACKERS.includes(
      requiredTracker as WorkstreamLaunchRequiredTracker,
    )
  ) {
    throw badRequest(
      `${label}.requiredTracker must be one of: ${WORKSTREAM_LAUNCH_REQUIRED_TRACKERS.join(", ")}.`,
      `${label}.requiredTracker`,
    );
  }
  return { requiredTracker: requiredTracker as WorkstreamLaunchRequiredTracker };
}

function recordField(record: Record<string, unknown>, key: string, label: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw badRequest(`${label} must be an object.`, label);
  }
  return value;
}

function parseExistingPullRequest(
  value: unknown,
  label: string,
): NonNullable<PawLaunchMetadata["existingPullRequest"]> {
  if (!isRecord(value)) {
    throw badRequest(`${label} must be an object.`, label);
  }
  if (value.provider !== "azure-devops") {
    throw badRequest(`${label}.provider must be "azure-devops".`, `${label}.provider`);
  }
  if (typeof value.id !== "number" || !Number.isInteger(value.id) || value.id <= 0) {
    throw badRequest(`${label}.id must be a positive integer.`, `${label}.id`);
  }
  return { provider: "azure-devops", id: value.id };
}

function parseBranchLease(value: unknown, label: string): NodeBranchLease {
  if (!isRecord(value)) {
    throw badRequest(`${label} must be an object.`, label);
  }
  stringField(value, "leaseId", `${label}.leaseId`);
  stringField(value, "branchLeaseKey", `${label}.branchLeaseKey`);
  stringField(value, "graphPath", `${label}.graphPath`);
  stringField(value, "nodeId", `${label}.nodeId`);
  stringField(value, "cwd", `${label}.cwd`);
  stringField(value, "targetBranch", `${label}.targetBranch`);
  const requiredStartSha = stringField(
    value,
    "requiredStartSha",
    `${label}.requiredStartSha`,
  );
  if (!/^[0-9a-f]{40}$/i.test(requiredStartSha)) {
    throw badRequest(
      `${label}.requiredStartSha must be a 40-character hexadecimal git SHA.`,
      `${label}.requiredStartSha`,
    );
  }
  if (value.status !== "active") {
    throw badRequest(`${label}.status must be "active".`, `${label}.status`);
  }
  return value as unknown as NodeBranchLease;
}

function parseTerminal(value: unknown): PawLaunchTerminalPreferences {
  if (!isRecord(value)) {
    throw badRequest("handoff.terminal must be an object.", "handoff.terminal");
  }
  if (value.launchMode !== "manual") {
    throw badRequest("handoff.terminal.launchMode must be \"manual\".", "handoff.terminal.launchMode");
  }
  let preferredTerminal: PawLaunchTerminalPreferences["preferredTerminal"] = "default";
  if (
    value.preferredTerminal === "windows-terminal" ||
    value.preferredTerminal === "powershell" ||
    value.preferredTerminal === "default"
  ) {
    preferredTerminal = value.preferredTerminal;
  } else if (value.preferredTerminal !== undefined) {
    throw badRequest(
      "handoff.terminal.preferredTerminal must be \"default\", \"windows-terminal\", or \"powershell\".",
      "handoff.terminal.preferredTerminal",
    );
  }
  return {
    launchMode: "manual",
    preferredTerminal,
    title: optionalTrimmedStringField(value, "title", "handoff.terminal.title"),
    tabColor: optionalHexColorField(value, "tabColor", "handoff.terminal.tabColor"),
  };
}

function parseRuntimeKind(value: unknown): PawLaunchHandoff["runtimeKind"] {
  if (value === undefined || value === null) {
    return "terminal-cli";
  }
  if (value === "terminal-cli" || value === "managed-sdk") {
    return value;
  }
  throw badRequest(
    "handoff.runtimeKind must be \"terminal-cli\" or \"managed-sdk\".",
    "handoff.runtimeKind",
  );
}

function parseLaunchMetadata(value: unknown): PawLaunchMetadata {
  const record = isRecord(value)
    ? value
    : (() => {
      throw badRequest("handoff.launchMetadata must be an object.", "handoff.launchMetadata");
    })();
  const launchMode = record.launchMode === undefined
    ? "standard-github"
    : WORKSTREAM_NODE_LAUNCH_MODES.includes(record.launchMode as WorkstreamNodeLaunchMode)
      ? record.launchMode as WorkstreamNodeLaunchMode
      : (() => {
          throw badRequest(
            `handoff.launchMetadata.launchMode must be one of: ${WORKSTREAM_NODE_LAUNCH_MODES.join(", ")}.`,
            "handoff.launchMetadata.launchMode",
          );
        })();
  const shared = launchMode === "existing-shared-azure-devops";
  const completionMode = record.completionMode === undefined || record.completionMode === null
    ? null
    : record.completionMode === "branch-contribution"
      ? record.completionMode
      : (() => {
          throw badRequest(
            'handoff.launchMetadata.completionMode must be "branch-contribution".',
            "handoff.launchMetadata.completionMode",
          );
        })();
  const targetBranch = optionalTrimmedStringField(
    record,
    "targetBranch",
    "handoff.launchMetadata.targetBranch",
  );
  const requiredStartSha = optionalTrimmedStringField(
    record,
    "requiredStartSha",
    "handoff.launchMetadata.requiredStartSha",
  )?.toLowerCase() ?? null;
  const existingPullRequest = record.existingPullRequest === undefined ||
      record.existingPullRequest === null
    ? null
    : parseExistingPullRequest(
        record.existingPullRequest,
        "handoff.launchMetadata.existingPullRequest",
      );
  const branchLease = record.branchLease === undefined || record.branchLease === null
    ? null
    : parseBranchLease(record.branchLease, "handoff.launchMetadata.branchLease");
  if (
    shared &&
    (
      completionMode !== "branch-contribution" ||
      !targetBranch ||
      !requiredStartSha ||
      !/^[0-9a-f]{40}$/.test(requiredStartSha) ||
      !existingPullRequest ||
      !branchLease
    )
  ) {
    throw badRequest(
      "Shared launch metadata requires targetBranch, requiredStartSha, existingPullRequest, completionMode, and branchLease.",
      "handoff.launchMetadata",
    );
  }
  if (
    !shared &&
    (
      completionMode !== null ||
      targetBranch !== null ||
      requiredStartSha !== null ||
      existingPullRequest !== null ||
      branchLease !== null
    )
  ) {
    throw badRequest(
      "Standard launch metadata cannot carry existing shared-branch fields.",
      "handoff.launchMetadata.launchMode",
    );
  }
  return {
    launchNonce: nullableLaunchPromptTokenField(record, "launchNonce", "handoff.launchMetadata.launchNonce"),
    launchClaimRef: nullableStringField(record, "launchClaimRef"),
    projectKey: stringField(record, "projectKey", "handoff.launchMetadata.projectKey"),
    workstreamId: stringField(record, "workstreamId", "handoff.launchMetadata.workstreamId"),
    nodeId: stringField(record, "nodeId", "handoff.launchMetadata.nodeId"),
    targetRepoIds: stringArrayField(record, "targetRepoIds", "handoff.launchMetadata.targetRepoIds"),
    graphPath: stringField(record, "graphPath", "handoff.launchMetadata.graphPath"),
    branch: stringField(record, "branch", "handoff.launchMetadata.branch"),
    workId: stringField(record, "workId", "handoff.launchMetadata.workId"),
    workTitle: stringField(record, "workTitle", "handoff.launchMetadata.workTitle"),
    trackerUrl: nullableStringField(record, "trackerUrl"),
    launchPolicy: nullableLaunchPolicyField(record, "launchPolicy", "handoff.launchMetadata.launchPolicy"),
    launchMode,
    completionMode,
    targetBranch,
    requiredStartSha,
    existingPullRequest,
    branchLease,
  };
}

function parseContextPackage(value: unknown): LaunchContextPackage {
  const record = isRecord(value)
    ? value
    : (() => {
      throw badRequest("handoff.contextPackage must be an object.", "handoff.contextPackage");
    })();
  stringField(record, "contextId", "handoff.contextPackage.contextId");
  stringField(record, "contextPackagePath", "handoff.contextPackage.contextPackagePath");
  stringField(record, "contextFilePath", "handoff.contextPackage.contextFilePath");
  if (!isRecord(record.metadata)) {
    throw badRequest("handoff.contextPackage.metadata must be an object.", "handoff.contextPackage.metadata");
  }
  if (!Array.isArray(record.unavailableInputs)) {
    throw badRequest("handoff.contextPackage.unavailableInputs must be an array.", "handoff.contextPackage.unavailableInputs");
  }
  // The launch service only consumes the validated top-level fields here;
  // metadata remains the prepared context payload.
  return record as unknown as LaunchContextPackage;
}

function parseBody(body: unknown): ParsedBody {
  const bodyRecord = isRecord(body) ? body : {};
  const handoffRecord = recordField(bodyRecord, "handoff", "handoff");
  const launchMetadata = parseLaunchMetadata(handoffRecord.launchMetadata);
  return {
    handoff: {
      cwd: stringField(handoffRecord, "cwd", "handoff.cwd"),
      branch: stringField(handoffRecord, "branch", "handoff.branch"),
      pawWorkDir: stringField(handoffRecord, "pawWorkDir", "handoff.pawWorkDir"),
      workflowContextPath: stringField(handoffRecord, "workflowContextPath", "handoff.workflowContextPath"),
      streamlinerContextPath: stringField(handoffRecord, "streamlinerContextPath", "handoff.streamlinerContextPath"),
      kickoffPrompt: stringField(handoffRecord, "kickoffPrompt", "handoff.kickoffPrompt"),
      kickoffAdditionalInstructions: optionalStringField(handoffRecord, "kickoffAdditionalInstructions"),
      cliArgs: stringArrayField(handoffRecord, "cliArgs", "handoff.cliArgs"),
      terminal: parseTerminal(handoffRecord.terminal),
      runtimeKind: parseRuntimeKind(handoffRecord.runtimeKind ?? bodyRecord.runtimeKind),
      environment: stringRecordField(handoffRecord, "environment", "handoff.environment"),
      sessionStateRoot: stringField(handoffRecord, "sessionStateRoot", "handoff.sessionStateRoot"),
      launchMetadata,
      contextPackage: parseContextPackage(handoffRecord.contextPackage),
      sdkSession: undefined,
    },
  };
}

function parseResumeBody(body: unknown): ParsedResumeBody {
  const bodyRecord = isRecord(body) ? body : {};
  const launchClaimId = stringField(bodyRecord, "launchClaimId", "launchClaimId");
  return {
    ...parseBody(body),
    launchClaimId,
  };
}

export async function launchTerminalNodeFromHandoff(options: {
  registryStore: SessionRegistryFileStore;
  claimStore: LaunchClaimStore;
  handoff: PawLaunchHandoff;
  nodeLaunchRecordStore?: NodeLaunchRecordStore;
  deps?: NodeLaunchDeps;
  source?: "manual" | "post-preparation";
}): Promise<NodeTerminalLaunchResponse> {
  const markLaunching = options.source === "post-preparation"
    ? options.nodeLaunchRecordStore?.markPostPreparationTerminalLaunching.bind(options.nodeLaunchRecordStore)
    : options.nodeLaunchRecordStore?.markTerminalLaunching.bind(options.nodeLaunchRecordStore);
  await markLaunching?.(options.handoff);
  try {
    const result = await launchPreparedNode(
      options.registryStore,
      options.claimStore,
      options.handoff,
      options.deps,
    );
    await options.nodeLaunchRecordStore?.markTerminalLaunched(options.handoff, result);
    return result;
  } catch (error: unknown) {
    if (
      error instanceof NodeLaunchError &&
      (error.code !== "duplicate_active_launch" || options.source === "post-preparation")
    ) {
      await options.nodeLaunchRecordStore?.markTerminalFailed({
        handoff: options.handoff,
        error: {
          code: error.code,
          error: error.message,
        },
      });
    }
    throw error;
  }
}

export function createNodeLaunchesRouter(options: {
  registryStore: SessionRegistryFileStore;
  claimStore: LaunchClaimStore;
  nodeLaunchRecordStore?: NodeLaunchRecordStore;
  deps?: NodeLaunchDeps;
}): Router {
  const router = Router();
  const logger = getApiLogger().withScope("node-launch.api");

  router.post("/node-launches", async (req, res, next) => {
    // Streamliner's local API treats loopback as the launch trust boundary;
    // same-user local processes are intentionally outside the preventative boundary.
    if (isNonLoopbackRequest(req)) {
      logger.warn("rejected: non-loopback", {
        path: req.originalUrl ?? req.url,
      });
      res.status(403).json({ error: "Node launch must originate from loopback." });
      return;
    }
    let handoff: PawLaunchHandoff | null = null;
    try {
      ({ handoff } = parseBody(req.body));
      const existingOperation = await options.nodeLaunchRecordStore?.getOperation(
        handoff.launchMetadata.graphPath,
        handoff.launchMetadata.nodeId,
      );
      if (existingOperation && isBlockingNodeLaunchOperation(existingOperation)) {
        res.status(409).json({
          code: "duplicate_active_launch_operation",
          error: `Node ${handoff.launchMetadata.nodeId} already has an active launch operation.`,
          operation: existingOperation,
        });
        return;
      }
      if (handoff.runtimeKind === "managed-sdk") {
        await options.nodeLaunchRecordStore?.markManagedStarting(handoff);
        const result = await launchManagedSdkNode(
          options.registryStore,
          options.claimStore,
          handoff,
          options.deps,
        );
        await options.nodeLaunchRecordStore?.markManagedRunning(handoff, {
          launchClaim: result.launchClaim,
          runtimeKind: "managed-sdk",
          registryId: result.managedSdk.registryId,
          sdkSessionId: result.managedSdk.sdkSessionId,
          sdkWorkspacePath: result.managedSdk.sdkWorkspacePath,
          sdkStateRoot: result.managedSdk.sdkStateRoot,
          permissionProfile: result.managedSdk.permissionProfile,
        });
        res.status(201).json(result);
      } else {
        const result = await launchTerminalNodeFromHandoff({
          registryStore: options.registryStore,
          claimStore: options.claimStore,
          nodeLaunchRecordStore: options.nodeLaunchRecordStore,
          deps: options.deps,
          handoff,
          source: "manual",
        });
        res.status(201).json(result);
      }
    } catch (error: unknown) {
      if (error instanceof NodeLaunchError) {
        if (handoff && handoff.runtimeKind === "managed-sdk" && error.code !== "duplicate_active_launch") {
          await options.nodeLaunchRecordStore?.markManagedFailed({
            handoff,
            error: {
              code: error.code,
              error: error.message,
            },
          });
        }
        const body: Record<string, unknown> = {
          code: error.code,
          error: error.message,
        };
        if (error.claim) {
          body.launchClaim = summarizeLaunchClaim(error.claim);
        }
        if (error.details) {
          body.details = error.details;
        }
        res.status(error.statusCode).json(body);
        return;
      }
      if (error instanceof Error && "statusCode" in error) {
        const statusCode = (error as { statusCode?: unknown }).statusCode;
        const body: Record<string, unknown> = {
          code: (error as { code?: unknown }).code ?? "invalid_node_launch_handoff",
          error: error.message,
          input: (error as { input?: unknown }).input,
        };
        const operation = (error as { operation?: unknown }).operation;
        if (operation !== undefined) {
          body.operation = operation;
        }
        res.status(typeof statusCode === "number" ? statusCode : 400).json(body);
        return;
      }
      next(error);
    }
  });

  router.post("/node-launches/managed-resumes", async (req, res, next) => {
    // Same local trust boundary as a fresh node launch: this reconnects a
    // local SDK client to an existing Copilot session and submits a prompt.
    if (isNonLoopbackRequest(req)) {
      logger.warn("resume rejected: non-loopback", {
        path: req.originalUrl ?? req.url,
      });
      res.status(403).json({ error: "Managed session resume must originate from loopback." });
      return;
    }
    let handoff: PawLaunchHandoff | null = null;
    try {
      const parsed = parseResumeBody(req.body);
      handoff = { ...parsed.handoff, runtimeKind: "managed-sdk" };
      const existingOperation = await options.nodeLaunchRecordStore?.getOperation(
        handoff.launchMetadata.graphPath,
        handoff.launchMetadata.nodeId,
      );
      if (existingOperation && isBlockingNodeLaunchOperation(existingOperation)) {
        res.status(409).json({
          code: "duplicate_active_launch_operation",
          error: `Node ${handoff.launchMetadata.nodeId} already has an active launch operation.`,
          operation: existingOperation,
        });
        return;
      }
      await options.nodeLaunchRecordStore?.markManagedStarting(handoff);
      const result = await resumeManagedSdkNode(
        options.registryStore,
        options.claimStore,
        handoff,
        parsed.launchClaimId,
        options.deps,
      );
      await options.nodeLaunchRecordStore?.markManagedRunning(handoff, {
        launchClaim: result.launchClaim,
        runtimeKind: "managed-sdk",
        registryId: result.managedSdk.registryId,
        sdkSessionId: result.managedSdk.sdkSessionId,
        sdkWorkspacePath: result.managedSdk.sdkWorkspacePath,
        sdkStateRoot: result.managedSdk.sdkStateRoot,
        permissionProfile: result.managedSdk.permissionProfile,
      });
      res.status(201).json(result);
    } catch (error: unknown) {
      if (error instanceof NodeLaunchError) {
        if (handoff) {
          await options.nodeLaunchRecordStore?.markManagedFailed({
            handoff,
            error: {
              code: error.code,
              error: error.message,
            },
          });
        }
        const body: Record<string, unknown> = {
          code: error.code,
          error: error.message,
        };
        if (error.claim) {
          body.launchClaim = summarizeLaunchClaim(error.claim);
        }
        if (error.details) {
          body.details = error.details;
        }
        res.status(error.statusCode).json(body);
        return;
      }
      if (error instanceof Error && "statusCode" in error) {
        const statusCode = (error as { statusCode?: unknown }).statusCode;
        res.status(typeof statusCode === "number" ? statusCode : 400).json({
          code: (error as { code?: unknown }).code ?? "invalid_node_launch_handoff",
          error: error.message,
          input: (error as { input?: unknown }).input,
        });
        return;
      }
      next(error);
    }
  });

  return router;
}
