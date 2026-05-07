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
  launchPreparedNode,
  NodeLaunchError,
  summarizeLaunchClaim,
  type NodeLaunchDeps,
} from "../node-launch";
import { SessionRegistryFileStore } from "../../session-registry/file-store";
import {
  WORKSTREAM_LAUNCH_REQUIRED_TRACKERS,
  type WorkstreamLaunchPolicy,
  type WorkstreamLaunchRequiredTracker,
} from "../../workstream-schema";
import { isLoopbackAddress } from "../config";
import { getApiLogger } from "../logger";

interface ParsedBody {
  handoff: PawLaunchHandoff;
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

function parseLaunchMetadata(value: unknown): PawLaunchMetadata {
  const record = isRecord(value)
    ? value
    : (() => {
      throw badRequest("handoff.launchMetadata must be an object.", "handoff.launchMetadata");
    })();
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
      environment: stringRecordField(handoffRecord, "environment", "handoff.environment"),
      sessionStateRoot: stringField(handoffRecord, "sessionStateRoot", "handoff.sessionStateRoot"),
      launchMetadata,
      contextPackage: parseContextPackage(handoffRecord.contextPackage),
      sdkSession: undefined,
    },
  };
}

export function createNodeLaunchesRouter(options: {
  registryStore: SessionRegistryFileStore;
  claimStore: LaunchClaimStore;
  deps?: NodeLaunchDeps;
}): Router {
  const router = Router();
  const logger = getApiLogger().withScope("node-launch.api");

  router.post("/node-launches", (req, res, next) => {
    // Streamliner's local API treats loopback as the launch trust boundary;
    // same-user local processes are intentionally outside the preventative boundary.
    if (isNonLoopbackRequest(req)) {
      logger.warn("rejected: non-loopback", {
        path: req.originalUrl ?? req.url,
      });
      res.status(403).json({ error: "Node launch must originate from loopback." });
      return;
    }
    try {
      const { handoff } = parseBody(req.body);
      const result = launchPreparedNode(
        options.registryStore,
        options.claimStore,
        handoff,
        options.deps,
      );
      res.status(201).json(result);
    } catch (error: unknown) {
      if (error instanceof NodeLaunchError) {
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
