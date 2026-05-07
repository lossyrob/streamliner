import { Router, type Response } from "express";

import {
  LaunchPreparationError,
  preparePawLaunch,
  type LaunchContextPreparer,
  type PawLaunchSessionRunner,
  type PawInitRunner,
  type PawLaunchConfigurationInput,
} from "../launch-preparation";
import {
  LaunchPreparationRunManager,
  type LaunchPreparationRunEvent,
} from "../launch-preparation-runs";
import type {
  LaunchContextGenerator,
  LaunchContextTrackerResolver,
} from "../launch-context";
import type { NodeLaunchRecordStore } from "../node-launch-record-store";

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

export function createLaunchPreparationsRouter(options: {
  defaultGraphPath?: string;
  deps?: LaunchPreparationRouteDeps;
} = {}): Router {
  const router = Router();
  const runManager = options.deps?.runManager ?? new LaunchPreparationRunManager();

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
    return {
      nodeId,
      graphPath,
      defaultGraphPath: options.defaultGraphPath,
      launchNonce,
      configuration: requestConfiguration(body.configuration),
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
      onProgress,
    };
  };

  router.post("/launch-preparations", async (req, res, next) => {
    const body = requestBodyRecord(req.body);

    try {
      const result = await preparePawLaunch(await buildPrepareOptions(body));
      await options.deps?.nodeLaunchRecordStore?.upsertFromHandoff(result);
      res.status(200).json(result);
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

  router.post("/launch-preparations/runs", async (req, res, next) => {
    const body = requestBodyRecord(req.body);
    try {
      const prepareOptions = await buildPrepareOptions(body);
      const snapshot = runManager.start(async (onProgress) => {
        const result = await preparePawLaunch({
          ...prepareOptions,
          onProgress,
        });
        await options.deps?.nodeLaunchRecordStore?.upsertFromHandoff(result);
        return result;
      });
      res.status(202).json({
        runId: snapshot.runId,
        status: snapshot.status,
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

    const lastEventId = parseLastEventId(req.header("last-event-id"));
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
