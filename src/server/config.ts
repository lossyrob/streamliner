import { resolve } from "node:path";

export const DEFAULT_STREAMLINER_API_PORT = 4319;
export const DEFAULT_STREAMLINER_API_HOST = "127.0.0.1";

export interface StreamlinerApiConfig {
  host: string;
  port: number;
  graphPath?: string;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_STREAMLINER_API_PORT;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`STREAMLINER_API_PORT must be a TCP port, received ${value}.`);
  }
  return parsed;
}

export function readStreamlinerApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): StreamlinerApiConfig {
  return {
    host: env.STREAMLINER_API_HOST ?? DEFAULT_STREAMLINER_API_HOST,
    port: parsePort(env.STREAMLINER_API_PORT),
    graphPath: env.STREAMLINER_GRAPH
      ? resolve(env.STREAMLINER_GRAPH)
      : undefined,
  };
}

export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) {
    return false;
  }
  return (
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1"
  );
}
