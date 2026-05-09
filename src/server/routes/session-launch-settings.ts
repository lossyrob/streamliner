import { Router } from "express";

import {
  readSessionLaunchSettings,
  writeSessionLaunchSettings,
} from "../session-launch-settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createSessionLaunchSettingsRouter(options: {
  settingsPath?: string;
} = {}): Router {
  const router = Router();

  router.get("/session-launch-settings", async (_req, res, next) => {
    try {
      const settings = await readSessionLaunchSettings(options.settingsPath);
      res.set("Cache-Control", "no-store");
      res.json(settings);
    } catch (error: unknown) {
      next(error);
    }
  });

  router.put("/session-launch-settings", async (req, res, next) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      const settings = await writeSessionLaunchSettings({
        defaultCliArgs: body.defaultCliArgs,
      }, options.settingsPath);
      res.json(settings);
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
