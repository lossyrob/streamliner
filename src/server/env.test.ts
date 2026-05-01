import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadDotEnvFile } from "./env";

describe("loadDotEnvFile", () => {
  it("loads .env values without overriding existing environment", () => {
    const root = mkdtempSync(join(tmpdir(), "streamliner-env-"));
    try {
      const envPath = join(root, ".env");
      writeFileSync(
        envPath,
        [
          "# local settings",
          "STREAMLINER_CONTEXT_MODEL=claude-sonnet-4.6",
          "STREAMLINER_API_PORT=4320",
          "QUOTED_VALUE=\"hello world\"",
          "export EXPORTED_VALUE=enabled",
          "STREAMLINER_API_HOST=0.0.0.0",
          "IGNORED LINE",
        ].join("\n"),
        "utf8",
      );
      const env: NodeJS.ProcessEnv = {
        STREAMLINER_API_HOST: "127.0.0.1",
      };

      loadDotEnvFile({ path: envPath, env });

      expect(env).toEqual({
        STREAMLINER_CONTEXT_MODEL: "claude-sonnet-4.6",
        STREAMLINER_API_PORT: "4320",
        QUOTED_VALUE: "hello world",
        EXPORTED_VALUE: "enabled",
        STREAMLINER_API_HOST: "127.0.0.1",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does nothing when the file is missing", () => {
    const env: NodeJS.ProcessEnv = {};

    loadDotEnvFile({ path: join(tmpdir(), "missing-streamliner-env"), env });

    expect(env).toEqual({});
  });
});
