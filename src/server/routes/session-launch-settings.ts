import { Router } from "express";

import {
  readSessionLaunchSettings,
  SessionLaunchSettingsError,
  writeSessionLaunchSettings,
} from "../session-launch-settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureAllowedKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new SessionLaunchSettingsError(
      "invalid_session_launch_settings",
      400,
      `Unexpected session launch settings key: ${unknownKeys[0]}.`,
    );
  }
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
      ensureAllowedKeys(body, ["defaultCliArgs"]);
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
