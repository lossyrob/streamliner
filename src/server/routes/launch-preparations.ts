import { Router } from "express";

import {
  LaunchPreparationError,
  preparePawLaunch,
  type LaunchContextPreparer,
  type PawInitRunner,
  type PawLaunchConfigurationInput,
} from "../launch-preparation";
import type {
  LaunchContextGenerator,
  LaunchContextTrackerResolver,
} from "../launch-context";

export interface LaunchPreparationRouteDeps {
  cwd?: string;
  stateRoot?: string;
  now?: () => Date;
  createContextId?: (now: Date) => string;
  trackerResolver?: LaunchContextTrackerResolver;
  contextGenerator?: LaunchContextGenerator;
  pawInitRunner?: PawInitRunner;
  contextPreparer?: LaunchContextPreparer;
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

  router.post("/launch-preparations", async (req, res, next) => {
    const body = requestBodyRecord(req.body);
    const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
    const graphPath = typeof body.graphPath === "string" ? body.graphPath : undefined;
    const launchNonce =
      typeof body.launchNonce === "string"
        ? body.launchNonce
        : body.launchNonce === null
          ? null
          : undefined;

    try {
      const result = await preparePawLaunch({
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
        pawInitRunner: options.deps?.pawInitRunner,
        contextPreparer: options.deps?.contextPreparer,
      });
      res.status(200).json(result);
    } catch (error: unknown) {
      if (error instanceof LaunchPreparationError) {
        res.status(error.statusCode).json({
          code: error.code,
          error: error.message,
          step: error.step,
          input: error.input,
        });
        return;
      }
      next(error);
    }
  });

  return router;
}
