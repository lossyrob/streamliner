export const STREAMLINER_VITE_HOST = "127.0.0.1";

export function readApiProxyTarget(
  env: Partial<Record<"STREAMLINER_API_HOST" | "STREAMLINER_API_PORT", string>> = process.env,
): string {
  const host = env.STREAMLINER_API_HOST ?? "127.0.0.1";
  const port = env.STREAMLINER_API_PORT ?? "4319";
  return `http://${host}:${port}`;
}

export function createApiProxyConfig(
  env: Partial<Record<"STREAMLINER_API_HOST" | "STREAMLINER_API_PORT", string>> = process.env,
) {
  return {
    target: readApiProxyTarget(env),
    changeOrigin: true,
    secure: false,
    timeout: 0,
    proxyTimeout: 0,
  };
}
