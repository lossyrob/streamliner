import { env } from "node:process";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4319";

export function resolveApiBaseUrl(): string {
  return env.STREAMLINER_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}
