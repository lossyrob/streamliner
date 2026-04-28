import { describe, expect, it } from "vitest";

import {
  createApiProxyConfig,
  readApiProxyTarget,
  STREAMLINER_VITE_HOST,
} from "./vite-proxy-config";

describe("Vite API proxy config helpers", () => {
  it("defaults the API proxy target to the local Streamliner API", () => {
    expect(readApiProxyTarget({})).toBe("http://127.0.0.1:4319");
  });

  it("honors explicit API host and port overrides", () => {
    expect(
      readApiProxyTarget({
        STREAMLINER_API_HOST: "127.0.0.2",
        STREAMLINER_API_PORT: "4999",
      }),
    ).toBe("http://127.0.0.2:4999");
  });

  it("pins the frontend host to loopback and configures an SSE-safe API proxy", () => {
    expect(STREAMLINER_VITE_HOST).toBe("127.0.0.1");
    expect(createApiProxyConfig()).toEqual({
      target: "http://127.0.0.1:4319",
      changeOrigin: true,
      secure: false,
      timeout: 0,
      proxyTimeout: 0,
    });
  });
});
