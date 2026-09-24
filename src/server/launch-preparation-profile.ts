import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

import type { CopilotClient, CopilotClientOptions, SessionConfig } from "@github/copilot-sdk";

const DEFAULT_MODEL = "gpt-5.5";
const execFileAsync = promisify(execFile);

interface PreparationProfile {
  configured: boolean;
  context?: "default" | "long_context";
  client: Pick<CopilotClientOptions, "cliPath" | "cliArgs">;
  session: Pick<SessionConfig, "reasoningEffort"> & { model: string };
}

function configuredValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  if (value === "") {
    throw new Error(`${name} must not be empty. Remove it to use the preparation default.`);
  }
  return value;
}

export function readPreparationProfile(env: NodeJS.ProcessEnv = process.env): PreparationProfile {
  const model = configuredValue(env, "STREAMLINER_PAW_INIT_MODEL");
  const reasoningEffort = configuredValue(env, "STREAMLINER_PAW_INIT_REASONING_EFFORT");
  const context = configuredValue(env, "STREAMLINER_PAW_INIT_CONTEXT");
  const cliPath = configuredValue(env, "STREAMLINER_PAW_INIT_CLI_PATH");
  if (reasoningEffort !== undefined &&
      reasoningEffort !== "low" && reasoningEffort !== "medium" &&
      reasoningEffort !== "high" && reasoningEffort !== "xhigh") {
    throw new Error("STREAMLINER_PAW_INIT_REASONING_EFFORT must be low, medium, high, or xhigh (supported by Copilot SDK 0.3.0).");
  }
  if (context !== undefined && context !== "default" && context !== "long_context") {
    throw new Error("STREAMLINER_PAW_INIT_CONTEXT must be default or long_context.");
  }
  if (cliPath !== undefined) {
    if (!isAbsolute(cliPath) || /\.(?:cmd|bat|ps1)$/i.test(cliPath)) {
      throw new Error("STREAMLINER_PAW_INIT_CLI_PATH must be an absolute path to a native executable or JavaScript CLI entry point, not a shell shim.");
    }
    try {
      if (!statSync(cliPath).isFile()) {
        throw new Error("path is not a file");
      }
    } catch (error) {
      throw new Error(`STREAMLINER_PAW_INIT_CLI_PATH is not a readable CLI file: ${cliPath}`, { cause: error });
    }
  }
  if (context !== undefined && cliPath === undefined) {
    throw new Error("STREAMLINER_PAW_INIT_CONTEXT requires STREAMLINER_PAW_INIT_CLI_PATH pointing to Copilot CLI 1.0.87 or newer. The bundled CLI 1.0.36 does not support --context.");
  }
  return {
    configured: [model, reasoningEffort, context, cliPath].some((value) => value !== undefined),
    context,
    client: {
      ...(cliPath !== undefined ? { cliPath } : {}),
      ...(context !== undefined ? { cliArgs: ["--context", context] } : {}),
    },
    session: {
      model: model ?? DEFAULT_MODEL,
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function validatePreparationCli(profile: PreparationProfile): Promise<void> {
  const cliPath = profile.client.cliPath;
  if (cliPath === undefined) {
    return;
  }
  let help: string;
  try {
    const result = await execFileAsync(
      cliPath.endsWith(".js") ? process.execPath : cliPath,
      cliPath.endsWith(".js") ? [cliPath, "--help"] : ["--help"],
      { timeout: 10_000, windowsHide: true },
    );
    help = result.stdout;
  } catch (error) {
    throw new Error(`STREAMLINER_PAW_INIT_CLI_PATH could not run --help: ${cliPath}. Select a working Copilot CLI executable or JavaScript entry point.`, { cause: error });
  }
  if (profile.context !== undefined &&
      (!/--context\s+<tier>/.test(help) || !help.includes(profile.context))) {
    throw new Error(`STREAMLINER_PAW_INIT_CLI_PATH '${cliPath}' does not advertise --context ${profile.context}. Select Copilot CLI 1.0.87 or newer; preparation will not use the bundled CLI as a fallback.`);
  }
}

export async function validatePreparationProfile(
  client: Pick<CopilotClient, "listModels">,
  profile: PreparationProfile,
): Promise<void> {
  if (!profile.configured) {
    return;
  }
  const { model: modelId, reasoningEffort } = profile.session;
  let models: Awaited<ReturnType<CopilotClient["listModels"]>>;
  try {
    models = await client.listModels();
  } catch (error) {
    throw new Error(`Could not validate the PAW preparation profile before session creation: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const model = models.find((entry) => entry.id === modelId);
  if (!model || (model.policy && model.policy.state !== "enabled")) {
    throw new Error(`STREAMLINER_PAW_INIT_MODEL '${modelId}' is unavailable or not enabled in the selected CLI model catalog. Choose an enabled model ID and check CLI authentication.`);
  }
  if (reasoningEffort !== undefined &&
      (!model.capabilities.supports.reasoningEffort || !model.supportedReasoningEfforts?.includes(reasoningEffort))) {
    throw new Error(`STREAMLINER_PAW_INIT_REASONING_EFFORT '${reasoningEffort}' is not advertised for '${modelId}'. Supported values: ${model.supportedReasoningEfforts?.join(", ") || "none"}.`);
  }
  if (profile.context === "long_context") {
    // CLI 1.0.87 advertises long-context availability in billing metadata,
    // which SDK 0.3.0 preserves but does not yet describe in ModelInfo.
    const billing: unknown = model.billing;
    const prices = isRecord(billing) ? billing.tokenPrices : undefined;
    const longContext = isRecord(prices) ? prices.longContext : undefined;
    if (!isRecord(longContext) || typeof longContext.contextMax !== "number" ||
        !Number.isFinite(longContext.contextMax) || longContext.contextMax <= 0) {
      throw new Error(`STREAMLINER_PAW_INIT_CONTEXT 'long_context' is not advertised for '${modelId}' by the selected CLI. Choose a model with long-context catalog metadata; preparation will not fall back to default context.`);
    }
  }
}
