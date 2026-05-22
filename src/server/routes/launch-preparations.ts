import { randomUUID } from "node:crypto";

import { Router, type Response } from "express";

import type { LaunchClaimStore } from "../../launch-claim-contract";
import {
  LaunchPreparationError,
  preparePawLaunch,
  type LaunchContextPreparer,
  type PawLaunchHandoff,
  type PawLaunchSessionRunner,
  type PawInitRunner,
  type PawLaunchConfigurationInput,
  type PawLaunchProgressEvent,
} from "../launch-preparation";
import {
  LaunchPreparationRunManager,
  type LaunchPreparationPostPreparationOutcome,
  type LaunchPreparationRunPostPreparationError,
  type LaunchPreparationRunEvent,
} from "../launch-preparation-runs";
import type {
  LaunchContextGenerator,
  LaunchContextTrackerResolver,
} from "../launch-context";
import type { NodeLaunchRecordStore } from "../node-launch-record-store";
import {
  isBlockingNodeLaunchOperation,
  type NodeLaunchOperation,
  type NodePostPreparationIntent,
} from "../../node-launch-record-contract";
import { getApiLogger } from "../logger";
import { readSessionLaunchSettings } from "../session-launch-settings";
import { SessionRegistryFileStore } from "../../session-registry/file-store";
import {
  NodeLaunchError,
  summarizeLaunchClaim,
  type NodeLaunchDeps,
} from "../node-launch";
import { launchTerminalNodeFromHandoff } from "./node-launches";
import { launchCompanionTerminal } from "./companion-terminal-launches";

export interface LaunchPreparationRouteDeps {
  cwd?: string;
  stateRoot?: string;
  now?: () => Date;
  createContextId?: (now: Date) => string;
  trackerResolver?: LaunchContextTrackerResolver;
  contextGenerator?: LaunchContextGenerator;
  pawLaunchRunner?: PawLaunchSessionRunner;
  pawInitRunner?: PawInitRunner;
  contextPreparer?: LaunchContextPreparer;
  runManager?: LaunchPreparationRunManager;
  nodeLaunchRecordStore?: NodeLaunchRecordStore;
  loadDefaultCliArgs?: () => Promise<string[]> | string[];
  registryStore?: SessionRegistryFileStore;
  launchClaimStore?: LaunchClaimStore;
  nodeLaunchDeps?: NodeLaunchDeps;
}

function requestBodyRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}

function requestConfiguration(value: unknown): PawLaunchConfigurationInput | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      "configuration must be an object.",
      "validation",
      "configuration",
    );
  }
  return value as PawLaunchConfigurationInput;
}

function hasExplicitCliArgs(configuration: PawLaunchConfigurationInput | undefined): boolean {
  return Boolean(configuration && Object.prototype.hasOwnProperty.call(configuration, "cliArgs"));
}

function optionalIntentString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      `${label} must be a string.`,
      "validation",
      label,
    );
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalIntentColor(value: unknown, label: string): string | null {
  const color = optionalIntentString(value, label);
  if (color === null) {
    return null;
  }
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      `${label} must be a #RRGGBB color.`,
      "validation",
      label,
    );
  }
  return color.toLowerCase();
}

function intentRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      `${label} must be an object.`,
      "validation",
      label,
    );
  }
  return value as Record<string, unknown>;
}

function requestPostPreparation(value: unknown): NodePostPreparationIntent | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      "postPreparation must be an object.",
      "validation",
      "postPreparation",
    );
  }
  const record = value as Record<string, unknown>;
  const postPreparation: NodePostPreparationIntent = {};
  if (record.launchTerminal !== undefined) {
    const launchTerminal = intentRecord(record.launchTerminal, "postPreparation.launchTerminal");
    const kickoffPrompt = optionalIntentString(
      launchTerminal.kickoffPrompt,
      "postPreparation.launchTerminal.kickoffPrompt",
    );
    const terminalTitle = optionalIntentString(
      launchTerminal.terminalTitle,
      "postPreparation.launchTerminal.terminalTitle",
    );
    const terminalColor = optionalIntentColor(
      launchTerminal.terminalColor,
      "postPreparation.launchTerminal.terminalColor",
    );
    postPreparation.launchTerminal = {
      ...(kickoffPrompt !== null ? { kickoffPrompt } : {}),
      ...(terminalTitle !== null ? { terminalTitle } : {}),
      ...(terminalColor !== null ? { terminalColor } : {}),
    };
  }
  if (record.launchCompanion !== undefined) {
    const launchCompanion = intentRecord(record.launchCompanion, "postPreparation.launchCompanion");
    const kickoffPrompt = optionalIntentString(
      launchCompanion.kickoffPrompt,
      "postPreparation.launchCompanion.kickoffPrompt",
    );
    if (!kickoffPrompt) {
      throw new LaunchPreparationError(
        "invalid_launch_configuration",
        400,
        "postPreparation.launchCompanion.kickoffPrompt is required.",
        "validation",
        "postPreparation.launchCompanion.kickoffPrompt",
      );
    }
    postPreparation.launchCompanion = { kickoffPrompt };
  }
  if (postPreparation.launchCompanion && !postPreparation.launchTerminal) {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      "postPreparation.launchCompanion requires postPreparation.launchTerminal.",
      "validation",
      "postPreparation.launchCompanion",
    );
  }
  return postPreparation.launchTerminal || postPreparation.launchCompanion
    ? postPreparation
    : null;
}

function hasPostPreparationTerminalIntent(
  intent: NodePostPreparationIntent | null,
): intent is NodePostPreparationIntent & { launchTerminal: NonNullable<NodePostPreparationIntent["launchTerminal"]> } {
  return Boolean(intent?.launchTerminal);
}

function postPreparationError(error: unknown): LaunchPreparationRunPostPreparationError {
  if (error instanceof NodeLaunchError) {
    return {
      code: error.code,
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(error.claim ? { launchClaim: summarizeLaunchClaim(error.claim) } : {}),
    };
  }
  if (error instanceof Error && "statusCode" in error) {
    const maybeCode = (error as Error & { code?: unknown }).code;
    return {
      code: typeof maybeCode === "string" ? maybeCode : "post_preparation_launch_failed",
      error: error.message,
    };
  }
  return {
    code: "post_preparation_launch_failed",
    error: error instanceof Error ? error.message : String(error),
  };
}

function terminalHandoffForPostPreparation(
  handoff: PawLaunchHandoff,
  postPreparation: NodePostPreparationIntent & {
    launchTerminal: NonNullable<NodePostPreparationIntent["launchTerminal"]>;
  },
): PawLaunchHandoff {
  return {
    ...handoff,
    kickoffPrompt: postPreparation.launchTerminal.kickoffPrompt ?? handoff.kickoffPrompt,
    terminal: {
      ...handoff.terminal,
      title: postPreparation.launchTerminal.terminalTitle ?? handoff.terminal.title,
      tabColor: postPreparation.launchTerminal.terminalColor ?? handoff.terminal.tabColor,
    },
  };
}

async function operationSnapshot(
  store: NodeLaunchRecordStore | undefined,
  graphPath: string,
  nodeId: string,
): Promise<NodeLaunchOperation | null> {
  return await store?.getOperation(graphPath, nodeId) ?? null;
}

async function safeOperationSnapshot(
  store: NodeLaunchRecordStore | undefined,
  graphPath: string,
  nodeId: string,
  logger: { error: (message: string, fields?: Record<string, unknown>) => void },
  fields: Record<string, unknown>,
): Promise<NodeLaunchOperation | null> {
  try {
    return await operationSnapshot(store, graphPath, nodeId);
  } catch (error: unknown) {
    logger.error("failed to read post-preparation operation snapshot", {
      ...fields,
      err: loggableError(error),
    });
    return null;
  }
}

export function createLaunchPreparationsRouter(options: {
  defaultGraphPath?: string;
  deps?: LaunchPreparationRouteDeps;
} = {}): Router {
  const router = Router();
  const runManager = options.deps?.runManager ?? new LaunchPreparationRunManager();
  const logger = getApiLogger().withScope("launch-preparations");

  const buildPrepareOptions = async (
    body: Record<string, unknown>,
    onProgress?: Parameters<typeof preparePawLaunch>[0]["onProgress"],
  ): Promise<Parameters<typeof preparePawLaunch>[0]> => {
    const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
    const graphPath = typeof body.graphPath === "string" ? body.graphPath : undefined;
    const launchNonce =
      typeof body.launchNonce === "string"
        ? body.launchNonce
        : body.launchNonce === null
          ? null
          : undefined;
    const lookupGraphPath = graphPath ?? options.defaultGraphPath;
    const existingLaunch = nodeId.trim() && lookupGraphPath
      ? await options.deps?.nodeLaunchRecordStore?.get(lookupGraphPath, nodeId)
      : null;
    const configuration = requestConfiguration(body.configuration);
    const defaultCliArgs = hasExplicitCliArgs(configuration)
      ? undefined
      : [...(await (options.deps?.loadDefaultCliArgs?.() ?? readSessionLaunchSettings().then((settings) => settings.defaultCliArgs)))];
    return {
      nodeId,
      graphPath,
      defaultGraphPath: options.defaultGraphPath,
      launchNonce,
      configuration,
      cwd: options.deps?.cwd,
      stateRoot: options.deps?.stateRoot,
      now: options.deps?.now,
      createContextId: options.deps?.createContextId,
      trackerResolver: options.deps?.trackerResolver,
      contextGenerator: options.deps?.contextGenerator,
      pawLaunchRunner: options.deps?.pawLaunchRunner,
      pawInitRunner: options.deps?.pawInitRunner,
      contextPreparer: options.deps?.contextPreparer,
      existingLaunch,
      defaultCliArgs,
      onProgress,
    };
  };

  router.post("/launch-preparations", async (req, res, next) => {
    const body = requestBodyRecord(req.body);
    const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
    const graphPath = typeof body.graphPath === "string"
      ? body.graphPath
      : options.defaultGraphPath;
    const operationStore = options.deps?.nodeLaunchRecordStore;
    let operationStarted = false;

    try {
      const prepareOptions = await buildPrepareOptions(body);
      const existingOperation = graphPath && nodeId.trim()
        ? await operationStore?.getOperation(graphPath, nodeId)
        : null;
      if (existingOperation && isBlockingNodeLaunchOperation(existingOperation)) {
        res.status(409).json({
          code: "duplicate_active_launch_operation",
          error: `Node ${nodeId} already has an active launch operation.`,
          operation: existingOperation,
        });
        return;
      }
      const runId = randomUUID();
      if (graphPath && nodeId.trim()) {
        await operationStore?.startPreparationOperation({ graphPath, nodeId, runId });
        operationStarted = true;
      }
      const progress = (event: PawLaunchProgressEvent) => {
        if (graphPath && nodeId.trim() && operationStore) {
          void operationStore.appendOperationProgress(graphPath, nodeId, event).catch((error: unknown) => {
            logger.error("failed to store launch preparation progress", {
              graphPath,
              nodeId,
              err: loggableError(error),
            });
          });
        }
      };
      const result = await preparePawLaunch({
        ...prepareOptions,
        onProgress: progress,
      });
      await operationStore?.markPreparationSucceeded(result);
      res.status(200).json(result);
    } catch (error: unknown) {
      if (operationStarted && graphPath && nodeId.trim()) {
        await operationStore?.markPreparationFailed({
          graphPath,
          nodeId,
          error: toOperationError(error),
        });
      }
      if (error instanceof LaunchPreparationError) {
        res.status(error.statusCode).json({
          code: error.code,
          error: error.message,
          step: error.step,
          input: error.input,
          details: error.details,
        });
        return;
      }
      next(error);
    }
  });

  router.post("/launch-preparations/runs", async (req, res, next) => {
    const body = requestBodyRecord(req.body);
    try {
      const prepareOptions = await buildPrepareOptions(body);
      const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
      const graphPath = typeof body.graphPath === "string"
        ? body.graphPath
        : options.defaultGraphPath;
      const operationStore = options.deps?.nodeLaunchRecordStore;
      const postPreparation = requestPostPreparation(body.postPreparation);
      if (postPreparation && (!graphPath || !nodeId.trim())) {
        throw new LaunchPreparationError(
          "invalid_launch_configuration",
          400,
          "postPreparation requires a graphPath and nodeId.",
          "validation",
          "postPreparation",
        );
      }
      if (postPreparation && (!operationStore || !options.deps?.registryStore || !options.deps.launchClaimStore)) {
        throw new LaunchPreparationError(
          "invalid_launch_configuration",
          503,
          "Server-driven post-preparation launch is not available in this server configuration.",
          "validation",
          "postPreparation",
        );
      }
      const existingOperation = graphPath && nodeId.trim()
        ? await operationStore?.getOperation(graphPath, nodeId)
        : null;
      if (existingOperation && isBlockingNodeLaunchOperation(existingOperation)) {
        res.status(409).json({
          code: "duplicate_active_launch_operation",
          error: `Node ${nodeId} already has an active launch operation.`,
          operation: existingOperation,
        });
        return;
      }
      const runId = randomUUID();
      const startedOperation = graphPath && nodeId.trim()
        ? await operationStore?.startPreparationOperation({
          graphPath,
          nodeId,
          runId,
          postPreparation: postPreparation ?? undefined,
        })
        : null;
      const snapshot = runManager.start(async (onProgress, publish) => {
        const progress = (event: PawLaunchProgressEvent) => {
          onProgress(event);
          if (graphPath && nodeId.trim() && operationStore) {
            void operationStore.appendOperationProgress(graphPath, nodeId, event).catch((error: unknown) => {
              logger.error("failed to store launch preparation progress", {
                graphPath,
                nodeId,
                err: loggableError(error),
              });
            });
          }
        };
        let preparationSucceeded = false;
        try {
          const result = await preparePawLaunch({
            ...prepareOptions,
            onProgress: progress,
          });
          await operationStore?.markPreparationSucceeded(result);
          preparationSucceeded = true;
          if (!hasPostPreparationTerminalIntent(postPreparation)) {
            return result;
          }
          const launchHandoff = terminalHandoffForPostPreparation(result, postPreparation);
          const outcome: LaunchPreparationPostPreparationOutcome = {};
          const snapshotFields = {
            runId,
            graphPath: launchHandoff.launchMetadata.graphPath,
            nodeId: launchHandoff.launchMetadata.nodeId,
          };
          const readOperationSnapshot = () =>
            safeOperationSnapshot(
              operationStore,
              launchHandoff.launchMetadata.graphPath,
              launchHandoff.launchMetadata.nodeId,
              logger,
              snapshotFields,
            );
          logger.info("post-preparation terminal launch starting", {
            runId,
            graphPath: launchHandoff.launchMetadata.graphPath,
            nodeId: launchHandoff.launchMetadata.nodeId,
          });
          try {
            const terminalResult = await launchTerminalNodeFromHandoff({
              registryStore: options.deps!.registryStore!,
              claimStore: options.deps!.launchClaimStore!,
              handoff: launchHandoff,
              nodeLaunchRecordStore: operationStore,
              deps: options.deps?.nodeLaunchDeps,
              source: "post-preparation",
            });
            outcome.terminal = { status: "launched", result: terminalResult };
            outcome.operation = await readOperationSnapshot();
            logger.info("post-preparation terminal launch succeeded", {
              runId,
              graphPath: launchHandoff.launchMetadata.graphPath,
              nodeId: launchHandoff.launchMetadata.nodeId,
              operationStatus: outcome.operation?.status ?? null,
            });
            publish("terminal_launched", {
              terminal: outcome.terminal,
              postPreparation: {
                terminal: outcome.terminal,
                operation: outcome.operation,
              },
              operation: outcome.operation,
              timestamp: new Date().toISOString(),
            });
          } catch (error: unknown) {
            outcome.terminal = { status: "failed", error: postPreparationError(error) };
            outcome.companion = postPreparation.launchCompanion ? { status: "skipped" } : undefined;
            outcome.operation = await readOperationSnapshot();
            logger.error("post-preparation terminal launch failed", {
              runId,
              graphPath: launchHandoff.launchMetadata.graphPath,
              nodeId: launchHandoff.launchMetadata.nodeId,
              operationStatus: outcome.operation?.status ?? null,
              err: loggableError(error),
            });
            publish("terminal_failed", {
              terminal: outcome.terminal,
              companion: outcome.companion,
              postPreparation: {
                terminal: outcome.terminal,
                companion: outcome.companion,
                operation: outcome.operation,
              },
              operation: outcome.operation,
              timestamp: new Date().toISOString(),
            });
            return { result, postPreparation: outcome, operation: outcome.operation };
          }
          if (postPreparation.launchCompanion) {
            logger.info("post-preparation companion launch starting", {
              runId,
              graphPath: launchHandoff.launchMetadata.graphPath,
              nodeId: launchHandoff.launchMetadata.nodeId,
            });
            try {
              const companionResult = await launchCompanionTerminal(
                {
                  cwd: launchHandoff.cwd,
                  kickoffPrompt: postPreparation.launchCompanion.kickoffPrompt,
                  cliArgs: launchHandoff.cliArgs,
                  preferredTerminal: launchHandoff.terminal.preferredTerminal,
                  title: `${launchHandoff.terminal.title} Review`,
                  ...(launchHandoff.terminal.tabColor ? { tabColor: launchHandoff.terminal.tabColor } : {}),
                },
                { launchTerminal: options.deps?.nodeLaunchDeps?.launchTerminal },
              );
              await operationStore?.markCompanionLaunched({
                handoff: launchHandoff,
                companionLaunch: companionResult,
              });
              outcome.companion = { status: "launched", result: companionResult };
              outcome.operation = await readOperationSnapshot();
              logger.info("post-preparation companion launch succeeded", {
                runId,
                graphPath: launchHandoff.launchMetadata.graphPath,
                nodeId: launchHandoff.launchMetadata.nodeId,
                operationStatus: outcome.operation?.status ?? null,
              });
              publish("companion_launched", {
                companion: outcome.companion,
                postPreparation: outcome,
                operation: outcome.operation,
                timestamp: new Date().toISOString(),
              });
            } catch (error: unknown) {
              const companionError = postPreparationError(error);
              try {
                await operationStore?.markCompanionFailed({
                  handoff: launchHandoff,
                  error: companionError,
                });
              } catch (storeError: unknown) {
                logger.error("failed to store post-preparation companion failure", {
                  runId,
                  graphPath: launchHandoff.launchMetadata.graphPath,
                  nodeId: launchHandoff.launchMetadata.nodeId,
                  err: loggableError(storeError),
                });
              }
              outcome.companion = { status: "failed", error: companionError };
              outcome.operation = await readOperationSnapshot();
              logger.error("post-preparation companion launch failed", {
                runId,
                graphPath: launchHandoff.launchMetadata.graphPath,
                nodeId: launchHandoff.launchMetadata.nodeId,
                operationStatus: outcome.operation?.status ?? null,
                err: loggableError(error),
              });
              publish("companion_failed", {
                companion: outcome.companion,
                postPreparation: outcome,
                operation: outcome.operation,
                timestamp: new Date().toISOString(),
              });
            }
          } else {
            outcome.companion = { status: "skipped" };
            outcome.operation = await readOperationSnapshot();
          }
          return { result, postPreparation: outcome, operation: outcome.operation };
        } catch (error: unknown) {
          if (!preparationSucceeded && graphPath && nodeId.trim()) {
            await operationStore?.markPreparationFailed({
              graphPath,
              nodeId,
              error: toOperationError(error),
            });
          }
          throw error;
        }
      }, { runId });
      res.status(202).json({
        runId: snapshot.runId,
        status: snapshot.status,
        operation: startedOperation,
      });
    } catch (error: unknown) {
      if (error instanceof LaunchPreparationError) {
        res.status(error.statusCode).json({
          code: error.code,
          error: error.message,
          step: error.step,
          input: error.input,
          details: error.details,
        });
        return;
      }
      next(error);
    }
  });

  router.get("/launch-preparations/runs/:runId", (req, res) => {
    const snapshot = runManager.get(req.params.runId);
    if (!snapshot) {
      res.status(404).json({
        code: "launch_preparation_run_not_found",
        error: `Unknown launch preparation run: ${req.params.runId}`,
      });
      return;
    }
    res.status(200).json(snapshot);
  });

  router.get("/launch-preparations/runs/:runId/events", (req, res) => {
    const snapshot = runManager.get(req.params.runId);
    if (!snapshot) {
      res.status(404).json({
        code: "launch_preparation_run_not_found",
        error: `Unknown launch preparation run: ${req.params.runId}`,
      });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const queryLastEventId = typeof req.query.lastEventId === "string" ? req.query.lastEventId : undefined;
    const lastEventId = parseLastEventId(req.header("last-event-id") ?? queryLastEventId);
    for (const event of runManager.eventsAfter(req.params.runId, lastEventId) ?? []) {
      writeRunSse(res, event);
    }
    const unsubscribe = runManager.subscribe(req.params.runId, (event) => {
      writeRunSse(res, event);
    });
    const heartbeat = setInterval(() => {
      res.write("event: heartbeat\n");
      res.write(`data: ${JSON.stringify({ sentAt: new Date().toISOString() })}\n\n`);
    }, 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe?.();
    });
  });

  return router;
}

function toOperationError(error: unknown): {
  code: string;
  error: string;
  step?: string;
  input?: string;
} {
  if (error instanceof LaunchPreparationError) {
    return {
      code: error.code,
      error: error.message,
      step: error.step,
      input: error.input,
    };
  }
  return {
    code: "launch_preparation_failed",
    error: error instanceof Error ? error.message : String(error),
  };
}

function loggableError(error: unknown): Record<string, string> | string {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : String(error);
}

function parseLastEventId(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function writeRunSse(
  res: Response,
  event: LaunchPreparationRunEvent,
): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.name}\n`);
  res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
}
