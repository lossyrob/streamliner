import { env } from "node:process";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4319";

export function resolveApiBaseUrl(): string {
  const raw = env.STREAMLINER_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  // Trim whitespace and trailing slashes so callers can safely concatenate
  // `/api/...` paths (a trailing slash would otherwise yield `//api/...`,
  // which Express does not match). Mirrors the server/desktop config behavior.
  return raw.trim().replace(/\/+$/, "") || DEFAULT_API_BASE_URL;
}
