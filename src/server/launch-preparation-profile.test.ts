import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelInfo } from "@github/copilot-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readPreparationProfile, validatePreparationCli, validatePreparationProfile } from "./launch-preparation-profile";

let root: string;
let cliPath: string;

function modelInfo(): ModelInfo {
  const billing = {
    multiplier: 1,
    tokenPrices: { longContext: { contextMax: 1_050_000 } },
  };
  return {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    capabilities: {
      supports: { vision: true, reasoningEffort: true },
      limits: { max_context_window_tokens: 1_050_000 },
    },
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    policy: { state: "enabled", terms: "" },
    billing,
  };
}

function configuredEnv(): NodeJS.ProcessEnv {
  return {
    STREAMLINER_PAW_INIT_MODEL: "gpt-6-astra",
    STREAMLINER_PAW_INIT_REASONING_EFFORT: "high",
    STREAMLINER_PAW_INIT_CONTEXT: "long_context",
    STREAMLINER_PAW_INIT_CLI_PATH: cliPath,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "streamliner-preparation-profile-"));
  cliPath = join(root, "cli.js");
  writeFileSync(cliPath, 'console.log("--context <tier> [possible values: default, long_context]");');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("PAW preparation profile", () => {
  it("preserves the default session and client without catalog or CLI probes", async () => {
    const profile = readPreparationProfile({});
    const client = { listModels: vi.fn() };
    expect(profile).toEqual({
      configured: false,
      context: undefined,
      client: {},
      session: { model: "gpt-5.5" },
    });
    await validatePreparationCli(profile);
    await validatePreparationProfile(client, profile);
    expect(client.listModels).not.toHaveBeenCalled();
  });

  it("uses SDK-supported fields and exact CLI arguments for the explicit profile", async () => {
    const profile = readPreparationProfile(configuredEnv());
    expect(profile.client).toEqual({ cliPath, cliArgs: ["--context", "long_context"] });
    expect(profile.session).toEqual({ model: "gpt-6-astra", reasoningEffort: "high" });
    await validatePreparationCli(profile);
    await validatePreparationProfile({ listModels: vi.fn(async () => [modelInfo()]) }, profile);
  });

  it.each(["low", "medium", "high", "xhigh"])("accepts SDK reasoning value %s", (effort) => {
    expect(readPreparationProfile({ STREAMLINER_PAW_INIT_REASONING_EFFORT: effort }).session.reasoningEffort).toBe(effort);
  });

  it("allows explicit default context without requiring long-context model metadata", async () => {
    const profile = readPreparationProfile({ ...configuredEnv(), STREAMLINER_PAW_INIT_CONTEXT: "default" });
    const model = modelInfo();
    delete model.billing;
    expect(profile.client.cliArgs).toEqual(["--context", "default"]);
    await validatePreparationCli(profile);
    await validatePreparationProfile({ listModels: vi.fn(async () => [model]) }, profile);
  });

  it.each([
    ["STREAMLINER_PAW_INIT_MODEL", ""],
    ["STREAMLINER_PAW_INIT_MODEL", "   "],
    ["STREAMLINER_PAW_INIT_REASONING_EFFORT", ""],
    ["STREAMLINER_PAW_INIT_REASONING_EFFORT", "max"],
    ["STREAMLINER_PAW_INIT_REASONING_EFFORT", "HIGH"],
    ["STREAMLINER_PAW_INIT_CONTEXT", ""],
    ["STREAMLINER_PAW_INIT_CONTEXT", "1.2M"],
    ["STREAMLINER_PAW_INIT_CONTEXT", "long"],
    ["STREAMLINER_PAW_INIT_CLI_PATH", ""],
    ["STREAMLINER_PAW_INIT_CLI_PATH", "copilot"],
  ])("rejects invalid %s=%j without a default fallback", (key, value) => {
    expect(() => readPreparationProfile({ ...configuredEnv(), [key]: value })).toThrow(key);
  });

  it("requires an explicit compatible CLI for either context selection", () => {
    expect(() => readPreparationProfile({ STREAMLINER_PAW_INIT_CONTEXT: "long_context" }))
      .toThrow("requires STREAMLINER_PAW_INIT_CLI_PATH");
  });

  it.each(["missing.exe", "copilot.cmd", "copilot.ps1"])("rejects unusable CLI path %s", (name) => {
    expect(() => readPreparationProfile({ STREAMLINER_PAW_INIT_CLI_PATH: join(root, name) }))
      .toThrow("STREAMLINER_PAW_INIT_CLI_PATH");
  });

  it("rejects a directory as the CLI", () => {
    expect(() => readPreparationProfile({ STREAMLINER_PAW_INIT_CLI_PATH: root }))
      .toThrow("not a readable CLI file");
  });

  it("rejects CLI help without the selected context option before any SDK client is needed", async () => {
    writeFileSync(cliPath, 'console.log("Old Copilot CLI --model <model>");');
    await expect(validatePreparationCli(readPreparationProfile(configuredEnv())))
      .rejects.toThrow("does not advertise --context long_context");
  });

  it("rejects an executable that fails its help probe", async () => {
    writeFileSync(cliPath, "process.exit(1);");
    await expect(validatePreparationCli(readPreparationProfile(configuredEnv())))
      .rejects.toThrow("could not run --help");
  });

  it("fails closed if the catalog lookup fails", async () => {
    await expect(validatePreparationProfile(
      { listModels: vi.fn().mockRejectedValue(new Error("authentication required")) },
      readPreparationProfile(configuredEnv()),
    )).rejects.toThrow("before session creation: authentication required");
  });

  it("accepts a supported model when the catalog omits policy", async () => {
    const model = modelInfo();
    delete model.policy;
    await validatePreparationProfile(
      { listModels: vi.fn(async () => [model]) },
      readPreparationProfile(configuredEnv()),
    );
  });

  it.each(["missing", "disabled", "unconfigured", "reasoning-disabled", "effort-unavailable", "long-context-unavailable"])(
    "rejects unsupported model catalog state %s",
    async (state) => {
      const model = modelInfo();
      if (state === "disabled" || state === "unconfigured") model.policy = { state, terms: "" };
      if (state === "reasoning-disabled") model.capabilities.supports.reasoningEffort = false;
      if (state === "effort-unavailable") model.supportedReasoningEfforts = ["low"];
      if (state === "long-context-unavailable") delete model.billing;
      const client = { listModels: vi.fn(async () => state === "missing" ? [] : [model]) };
      await expect(validatePreparationProfile(client, readPreparationProfile(configuredEnv())))
        .rejects.toThrow(/STREAMLINER_PAW_INIT_(MODEL|REASONING_EFFORT|CONTEXT)/);
    },
  );
});
