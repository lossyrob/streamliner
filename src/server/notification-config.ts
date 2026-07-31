import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_STREAMLINER_API_HOST,
  DEFAULT_STREAMLINER_API_PORT,
} from "./config";

/** Default dev dashboard origin (Vite). Overridable for installed setups. */
export const DEFAULT_DASHBOARD_BASE_URL = "http://127.0.0.1:5173";

export function resolveStateRoot(): string {
  return resolve(
    process.env.STREAMLINER_STATE_ROOT ?? join(homedir(), ".streamliner", "state"),
  );
}

export function defaultNotificationStorePath(): string {
  return join(resolveStateRoot(), "notifications", "notifications.ndjson");
}

/**
 * Resolve the dashboard base URL used to compose notification deep links and
 * returned by the discovery endpoint. Single source of truth for enrichment and
 * `GET /api/health`.
 */
export function resolveDashboardBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.STREAMLINER_DASHBOARD_BASE_URL?.trim();
  if (configured) {
    // Normalize away a trailing slash so composition is predictable.
    return configured.replace(/\/+$/, "");
  }
  return DEFAULT_DASHBOARD_BASE_URL;
}

export function defaultApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.STREAMLINER_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return `http://${DEFAULT_STREAMLINER_API_HOST}:${DEFAULT_STREAMLINER_API_PORT}`;
}
