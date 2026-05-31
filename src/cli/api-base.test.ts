import process from "node:process";

import { afterEach, describe, expect, it } from "vitest";

import { resolveApiBaseUrl } from "./api-base";

const originalApiBaseUrl = process.env.STREAMLINER_API_BASE_URL;

afterEach(() => {
  if (originalApiBaseUrl === undefined) {
    delete process.env.STREAMLINER_API_BASE_URL;
  } else {
    process.env.STREAMLINER_API_BASE_URL = originalApiBaseUrl;
  }
});

describe("resolveApiBaseUrl", () => {
  it("uses the default local API URL when the env var is unset", () => {
    delete process.env.STREAMLINER_API_BASE_URL;
    expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:4319");
  });

  it("uses STREAMLINER_API_BASE_URL when set", () => {
    process.env.STREAMLINER_API_BASE_URL = "http://127.0.0.1:9999";
    expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:9999");
  });

  it("strips trailing slashes and whitespace so path concatenation stays valid", () => {
    process.env.STREAMLINER_API_BASE_URL = "  http://127.0.0.1:4319/  ";
    expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:4319");
    process.env.STREAMLINER_API_BASE_URL = "http://127.0.0.1:4319///";
    expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:4319");
  });

  it("falls back to the default when the env var is only slashes/whitespace", () => {
    process.env.STREAMLINER_API_BASE_URL = "  /  ";
    expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:4319");
  });
});
