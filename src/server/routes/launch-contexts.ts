import { Router } from "express";

import {
  LaunchContextPreparationError,
  prepareLaunchContextPackage,
  type LaunchContextTrackerResolver,
} from "../launch-context";

export interface LaunchContextRouteDeps {
  stateRoot?: string;
  now?: () => Date;
  createContextId?: (now: Date) => string;
  trackerResolver?: LaunchContextTrackerResolver;
}

export function createLaunchContextsRouter(options: {
  defaultGraphPath?: string;
  deps?: LaunchContextRouteDeps;
} = {}): Router {
  const router = Router();

  router.post("/launch-contexts", async (req, res, next) => {
    const body = req.body as Record<string, unknown> | undefined;
    const nodeId = typeof body?.nodeId === "string" ? body.nodeId : "";
    const graphPath = typeof body?.graphPath === "string" ? body.graphPath : undefined;
    const outputDir = typeof body?.outputDir === "string" ? body.outputDir : undefined;
    const launchNonce =
      typeof body?.launchNonce === "string"
        ? body.launchNonce
        : body?.launchNonce === null
          ? null
          : undefined;

    try {
      const result = await prepareLaunchContextPackage({
        graphPath,
        defaultGraphPath: options.defaultGraphPath,
        nodeId,
        outputDir,
        launchNonce,
        stateRoot: options.deps?.stateRoot,
        now: options.deps?.now,
        createContextId: options.deps?.createContextId,
        trackerResolver: options.deps?.trackerResolver,
      });
      res.status(200).json(result);
    } catch (error: unknown) {
      if (error instanceof LaunchContextPreparationError) {
        res.status(error.statusCode).json({
          code: error.code,
          error: error.message,
        });
        return;
      }
      next(error);
    }
  });

  return router;
}

