import { copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  approveAll,
  CopilotClient,
  defineTool,
} from "@github/copilot-sdk";

import { getApiLogger } from "./logger";
import {
  LaunchContextPreparationError,
  prepareLaunchContextPackage,
  type LaunchContextGenerator,
  type LaunchContextPackage,
  type LaunchContextTrackerResolver,
  type PrepareLaunchContextPackageOptions,
} from "./launch-context";

const DEFAULT_CLI_ARGS = ["--yolo"];
const DEFAULT_PAW_INIT_MODEL = "gpt-5.5";
const DEFAULT_PAW_INIT_TIMEOUT_MS = 120_000;
const TERMINAL_LAUNCH_MODES = ["manual"] as const;
const TERMINAL_PREFERENCES = ["default", "windows-terminal", "powershell"] as const;
const DEFAULT_WORKFLOW_INSTRUCTIONS = [
  "Use PAW with a local final-pr-only review policy.",
  "Do not pause for intermediate review unless there is a serious blocker, unsafe ambiguity, missing credentials/infrastructure, or material scope mismatch.",
  "Use GPT 5.5, Claude Opus 4.7, and Claude Opus 4.6 1M for multi-model planning or review choices where PAW asks for concrete models.",
  "Proceed through implementation and documentation, then create the final PR.",
].join("\n");

export type LaunchPreparationErrorCode =
  | "invalid_node_id"
  | "invalid_launch_configuration"
  | "paw_init_failed"
  | "context_preparation_failed"
  | "missing_context_package";

export type LaunchPreparationStep =
  | "validation"
  | "paw-init"
  | "context-preparation";

export class LaunchPreparationError extends Error {
  code: LaunchPreparationErrorCode;
  statusCode: number;
  step: LaunchPreparationStep;
  input?: string;

  constructor(
    code: LaunchPreparationErrorCode,
    statusCode: number,
    message: string,
    step: LaunchPreparationStep,
    input?: string,
  ) {
    super(message);
    this.name = "LaunchPreparationError";
    this.code = code;
    this.statusCode = statusCode;
    this.step = step;
    if (input !== undefined) {
      this.input = input;
    }
  }
}

export interface PawLaunchTerminalPreferences {
  launchMode: "manual";
  preferredTerminal: "default" | "windows-terminal" | "powershell";
}

export interface PawLaunchConfigurationInput {
  cwd?: string;
  cliArgs?: string[];
  environment?: Record<string, string>;
  workflowInstructions?: string | null;
  terminal?: Partial<PawLaunchTerminalPreferences>;
}

export interface ResolvedPawLaunchConfiguration {
  cwd: string;
  cliArgs: string[];
  environment: Record<string, string>;
  workflowInstructions: string;
  terminal: PawLaunchTerminalPreferences;
}

export interface PawInitRunnerInput {
  nodeId: string;
  graphPath?: string;
  cwd: string;
  sessionStateRoot: string;
  issueUrl?: string;
  launchNonce: string | null;
  configuration: ResolvedPawLaunchConfiguration;
  stagedContextPackage: LaunchContextPackage;
}

export interface PawInitRunnerResult {
  cwd: string;
  branch: string;
  workId: string;
  workTitle: string;
  pawWorkDir: string;
  workflowContextPath: string;
  streamlinerContextPath: string;
  environment?: Record<string, string>;
  sessionStateRoot?: string;
}

export type PawInitRunner = (
  input: PawInitRunnerInput,
) => Promise<PawInitRunnerResult>;

export type LaunchContextPreparer = (
  options: PrepareLaunchContextPackageOptions,
) => Promise<LaunchContextPackage>;

export interface PreparePawLaunchOptions {
  nodeId: string;
  graphPath?: string;
  defaultGraphPath?: string;
  launchNonce?: string | null;
  configuration?: PawLaunchConfigurationInput;
  cwd?: string;
  stateRoot?: string;
  now?: () => Date;
  createContextId?: (now: Date) => string;
  trackerResolver?: LaunchContextTrackerResolver;
  contextGenerator?: LaunchContextGenerator;
  pawInitRunner?: PawInitRunner;
  contextPreparer?: LaunchContextPreparer;
}

export interface PawLaunchMetadata {
  launchNonce: string | null;
  launchClaimRef: string | null;
  projectKey: string;
  workstreamId: string;
  nodeId: string;
  targetRepoIds: string[];
  graphPath: string;
  branch: string;
  workId: string;
  workTitle: string;
  trackerUrl: string | null;
}

export interface PawLaunchHandoff {
  cwd: string;
  branch: string;
  pawWorkDir: string;
  workflowContextPath: string;
  streamlinerContextPath: string;
  kickoffPrompt: string;
  cliArgs: string[];
  environment: Record<string, string>;
  sessionStateRoot: string;
  launchMetadata: PawLaunchMetadata;
  contextPackage: LaunchContextPackage;
}

interface CompletePawInitArgs {
  workTitle: string;
  workId: string;
  targetBranch: string;
  pawWorkDir?: string;
  artifactLifecycle?: string;
}

const DEFAULT_TERMINAL_PREFERENCES: PawLaunchTerminalPreferences = {
  launchMode: "manual",
  preferredTerminal: "default",
};

function defaultStateRoot(): string {
  return resolve(process.env.STREAMLINER_STATE_ROOT ?? join(homedir(), ".streamliner", "state"));
}

function normalizeManifestPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function displayPath(path: string): string {
  return normalizeManifestPath(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOptionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      `${field} must be a string.`,
      "validation",
      field,
    );
  }
  return value;
}

function assertOptionalStringArray(
  value: unknown,
  field: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      `${field} must be an array of strings.`,
      "validation",
      field,
    );
  }
  return [...value];
}

function assertOptionalStringRecord(
  value: unknown,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      `${field} must be an object with string values.`,
      "validation",
      field,
    );
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new LaunchPreparationError(
        "invalid_launch_configuration",
        400,
        `${field}.${key} must be a string.`,
        "validation",
        `${field}.${key}`,
      );
    }
    record[key] = item;
  }
  return record;
}

function assertOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      `${field} must be one of: ${allowed.join(", ")}.`,
      "validation",
      field,
    );
  }
  return value as T;
}

function assertOptionalRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      `${field} must be an object.`,
      "validation",
      field,
    );
  }
  return value;
}

function normalizeAbsolutePath(path: string, field: string): string {
  if (!isAbsolute(path)) {
    throw new LaunchPreparationError(
      "invalid_launch_configuration",
      400,
      `${field} must be an absolute path.`,
      "validation",
      field,
    );
  }
  return resolve(path);
}

function normalizeTerminalPreferences(
  value: Partial<PawLaunchTerminalPreferences> | undefined,
): Partial<PawLaunchTerminalPreferences> {
  const record = assertOptionalRecord(value, "configuration.terminal");
  if (!record) {
    return {};
  }
  const normalized: Partial<PawLaunchTerminalPreferences> = {};
  const launchMode = assertOptionalEnum(
    record.launchMode,
    TERMINAL_LAUNCH_MODES,
    "configuration.terminal.launchMode",
  );
  const preferredTerminal = assertOptionalEnum(
    record.preferredTerminal,
    TERMINAL_PREFERENCES,
    "configuration.terminal.preferredTerminal",
  );
  if (launchMode !== undefined) {
    normalized.launchMode = launchMode;
  }
  if (preferredTerminal !== undefined) {
    normalized.preferredTerminal = preferredTerminal;
  }
  return normalized;
}

function normalizeConfiguration(
  input: PawLaunchConfigurationInput | undefined,
  options: { cwd?: string },
): ResolvedPawLaunchConfiguration {
  const rawCwd = assertOptionalString(input?.cwd, "configuration.cwd");
  const workflowInstructions = assertOptionalString(
    input?.workflowInstructions,
    "configuration.workflowInstructions",
  )?.trim() || DEFAULT_WORKFLOW_INSTRUCTIONS;
  const cliArgs = assertOptionalStringArray(input?.cliArgs, "configuration.cliArgs")
    ?? [...DEFAULT_CLI_ARGS];
  const environment = assertOptionalStringRecord(input?.environment, "configuration.environment")
    ?? {};
  const terminalOverrides = normalizeTerminalPreferences(input?.terminal);
  const cwd = normalizeAbsolutePath(rawCwd ?? options.cwd ?? process.cwd(), "configuration.cwd");

  return {
    cwd,
    cliArgs,
    environment,
    workflowInstructions,
    terminal: {
      ...DEFAULT_TERMINAL_PREFERENCES,
      ...terminalOverrides,
    },
  };
}

function parseSdkJsonResponse(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    const parsed = JSON.parse(candidate);
    if (!isRecord(parsed)) {
      throw new Error("response was not a JSON object");
    }
    return parsed;
  } catch (error: unknown) {
    throw new Error(
      `Copilot SDK returned invalid PAW init JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function pawInitTimeoutMs(): number {
  const raw = Number(process.env.STREAMLINER_PAW_INIT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PAW_INIT_TIMEOUT_MS;
}

function pawSkillDirectories(): string[] {
  const configured = process.env.STREAMLINER_PAW_SKILL_DIR
    ?.split(";")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];
  const candidates = [
    ...configured,
    join(homedir(), ".copilot", "skills"),
    join(homedir(), ".copilot", "installed-plugins", "_direct", "lossyrob--phased-agent-workflow", "skills"),
  ];
  return candidates.filter((candidate, index) =>
    candidates.indexOf(candidate) === index &&
    existsSync(join(candidate, "paw-init", "SKILL.md"))
  );
}

function assertSlug(value: string, field: string): string {
  const trimmed = value.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    throw new Error(`${field} must be kebab-case.`);
  }
  return trimmed;
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function hasStreamlinerContextAdditionalInput(content: string): boolean {
  const linePattern = /^Additional Inputs:\s*(.*)$/m;
  const match = content.match(linePattern);
  return Boolean(match?.[1]?.includes("streamliner-context="));
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent).toLowerCase();
  const normalizedChild = resolve(child).toLowerCase();
  const relativePath = relative(normalizedParent, normalizedChild);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function buildPawInitPrompt(input: PawInitRunnerInput): string {
  return [
    "Initialize a PAW workflow for a Streamliner graph launch.",
    "",
    "Use the preloaded `paw-init` skill as the source of truth for deriving the WorkflowContext.",
    "You are running in a fully capable Copilot SDK session with Copilot CLI-style tool access. Read repository files, inspect git state, and use GitHub or shell tools when PAW init needs that context.",
    "PAW init is a skill, not a callable function, so follow its prompt contract and finish initialization through the Streamliner-owned `complete_paw_init` tool.",
    "",
    "Important behavior:",
    "- Do not ask follow-up questions during launch preparation.",
    "- If information is missing but PAW has a documented default or derivation rule, use that default and your best judgment.",
    "- If a serious blocker prevents safe initialization, do not call the tool; respond with JSON: {\"status\":\"blocked\",\"reason\":\"...\"}.",
    "- Do not start the worker session, open a terminal, create the final PR, or continue into implementation.",
    "- Let the paw-init skill create WorkflowContext.md through its normal PAW workflow path. Do not ask Streamliner to generate or write WorkflowContext.md.",
    "- Do not inline the Streamliner context into WorkflowContext.md. Reference the installed Streamliner context as an Additional Input instead.",
    "",
    "Selected Streamliner node:",
    `- Node ID: ${input.nodeId}`,
    `- Graph path: ${input.graphPath ?? "default graph"}`,
    `- Tracker/issue URL: ${input.issueUrl ?? "none"}`,
    `- Launch nonce: ${input.launchNonce ?? "none"}`,
    "",
    "Staged Streamliner context package:",
    `- Staged context file: ${input.stagedContextPackage.contextFilePath}`,
    `- Staged context package directory: ${input.stagedContextPackage.contextPackagePath}`,
    "",
    "Workflow instructions from the builder:",
    "```text",
    input.configuration.workflowInstructions.trim(),
    "```",
    "",
    "Before calling `complete_paw_init`, use paw-init's normal file-writing path to create WorkflowContext.md in the PAW work directory.",
    "The WorkflowContext Additional Inputs must include at least `streamliner-context=<installed-context-path>`, where the installed context path is `<pawWorkDir>/streamliner/context.md`.",
    "Recommended Additional Inputs metadata: `streamliner-staged-context`, `streamliner-context-id`, `node`, `graph`, and `launch-nonce` using the values above.",
    "",
    "When PAW init has completed its reasoning and created WorkflowContext.md, call `complete_paw_init` exactly once with:",
    "- `workTitle`: the PAW work title derived by paw-init.",
    "- `workId`: the PAW work ID derived by paw-init.",
    "- `targetBranch`: the target branch derived by paw-init.",
    "- `pawWorkDir`: optional absolute PAW work directory. If omitted, Streamliner uses `<cwd>/.paw/work/<workId>`.",
    "- `artifactLifecycle`: optional artifact lifecycle if resolved.",
    "",
    "The tool copies the staged Streamliner context into `<pawWorkDir>/streamliner/context.md` and verifies that paw-init already created WorkflowContext.md with a `streamliner-context` Additional Input. It does not write WorkflowContext.md.",
    "",
    "After the tool succeeds, respond with only this JSON shape:",
    "{",
    "  \"status\": \"ready\"",
    "}",
  ].join("\n");
}

export async function defaultPawInitRunner(
  input: PawInitRunnerInput,
): Promise<PawInitRunnerResult> {
  const skillDirectories = pawSkillDirectories();
  if (skillDirectories.length === 0) {
    throw new Error("Could not find the installed paw-init skill. Set STREAMLINER_PAW_SKILL_DIR to the PAW skills directory.");
  }

  const client = new CopilotClient({
    cwd: input.cwd,
    logLevel: "error",
  });
  let session: Awaited<ReturnType<CopilotClient["createSession"]>> | undefined;
  let toolResult: PawInitRunnerResult | undefined;
  let started = false;
  let cleanupError: Error | undefined;

  try {
    await client.start();
    started = true;
    const completeTool = defineTool<CompletePawInitArgs>(
      "complete_paw_init",
      {
        description: "Complete PAW initialization for a Streamliner launch after paw-init has written WorkflowContext.md by installing the staged context bundle.",
        parameters: {
          type: "object",
          properties: {
            workTitle: { type: "string" },
            workId: { type: "string" },
            targetBranch: { type: "string" },
            pawWorkDir: { type: "string" },
            artifactLifecycle: { type: "string" },
          },
          required: ["workTitle", "workId", "targetBranch"],
          additionalProperties: false,
        },
        skipPermission: true,
        handler: async (args) => {
          if (!isRecord(args)) {
            throw new Error("complete_paw_init received invalid arguments.");
          }
          const workTitle = assertNonEmpty(args.workTitle, "workTitle");
          const workId = assertSlug(assertNonEmpty(args.workId, "workId"), "workId");
          const targetBranch = assertNonEmpty(args.targetBranch, "targetBranch");
          const pawRoot = join(input.cwd, ".paw", "work");
          const pawWorkDir = typeof args.pawWorkDir === "string" && args.pawWorkDir.trim()
            ? resolve(args.pawWorkDir)
            : join(pawRoot, workId);
          if (!isPathInside(pawRoot, pawWorkDir)) {
            throw new Error("pawWorkDir must be inside the repository .paw/work directory.");
          }

          const workflowContextPath = join(pawWorkDir, "WorkflowContext.md");
          const streamlinerContextPath = join(pawWorkDir, "streamliner", "context.md");
          if (!existsSync(workflowContextPath)) {
            throw new Error("paw-init must create WorkflowContext.md before calling complete_paw_init.");
          }
          const workflowContextContent = await readFile(workflowContextPath, "utf8");
          if (!hasStreamlinerContextAdditionalInput(workflowContextContent)) {
            throw new Error("WorkflowContext.md must include a streamliner-context Additional Input before calling complete_paw_init.");
          }

          await mkdir(dirname(streamlinerContextPath), { recursive: true });
          await copyFile(input.stagedContextPackage.contextFilePath, streamlinerContextPath);

          toolResult = {
            cwd: normalizeManifestPath(input.cwd),
            branch: targetBranch,
            workId,
            workTitle,
            pawWorkDir: normalizeManifestPath(pawWorkDir),
            workflowContextPath: normalizeManifestPath(workflowContextPath),
            streamlinerContextPath: normalizeManifestPath(streamlinerContextPath),
            environment: { ...input.configuration.environment },
            sessionStateRoot: normalizeManifestPath(input.sessionStateRoot),
          };
          return {
            ...toolResult,
            artifactLifecycle: typeof args.artifactLifecycle === "string"
              ? args.artifactLifecycle
              : "unspecified",
          };
        },
      },
    );

    session = await client.createSession({
      clientName: "streamliner-paw-launch-initializer",
      model: process.env.STREAMLINER_PAW_INIT_MODEL ?? DEFAULT_PAW_INIT_MODEL,
      workingDirectory: input.cwd,
      enableConfigDiscovery: true,
      skillDirectories,
      tools: [completeTool],
      onPermissionRequest: approveAll,
      customAgents: [
        {
          name: "streamliner-paw-init",
          displayName: "Streamliner PAW Init",
          description: "Runs PAW init for a Streamliner graph launch with Copilot CLI-style tool access.",
          tools: null,
          skills: ["paw-init"],
          prompt: "Use the paw-init skill to initialize PAW workflows from user intent. You have Copilot CLI-style tool access for repository, shell, GitHub, and configured MCP context. Complete Streamliner launch initialization through the supplied complete_paw_init tool and never ask the user follow-up questions.",
        },
      ],
      agent: "streamliner-paw-init",
      systemMessage: {
        mode: "append",
        content: "You are a Streamliner PAW launch initializer running as a fully capable SDK session. Use the same kind of repository, shell, GitHub, and configured MCP context a Copilot CLI PAW init session would use, then return the structured launch handoff through Streamliner's completion tool.",
      },
    });
    const response = await session.sendAndWait(
      { prompt: buildPawInitPrompt(input) },
      pawInitTimeoutMs(),
    );
    const content = response?.data.content ?? "";
    if (!toolResult) {
      const trimmed = content.trim();
      if (trimmed.includes("?")) {
        throw new Error(`PAW init asked for clarification instead of using defaults: ${trimmed}`);
      }
      throw new Error(`PAW init did not call complete_paw_init. Response: ${trimmed || "(empty)"}`);
    }
    const parsed = parseSdkJsonResponse(content);
    if (parsed.status === "blocked") {
      throw new Error(typeof parsed.reason === "string" ? parsed.reason : "PAW init reported blocked status.");
    }
    if (parsed.status !== "ready") {
      throw new Error("Copilot SDK PAW init did not report ready status.");
    }
    if (!existsSync(toolResult.workflowContextPath)) {
      throw new Error("PAW init completed without creating WorkflowContext.md.");
    }
    if (!existsSync(toolResult.streamlinerContextPath)) {
      throw new Error("PAW init completed without installing the Streamliner context.");
    }
    return toolResult;
  } finally {
    if (session) {
      try {
        await session.disconnect();
      } catch (error: unknown) {
        cleanupError = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (started) {
      try {
        const stopErrors = await client.stop();
        if (stopErrors.length > 0) {
          const stopError = new Error(
            `Copilot SDK PAW init cleanup failed: ${stopErrors.map((error) => error.message).join("; ")}`,
          );
          cleanupError = cleanupError
            ? new Error(`${cleanupError.message}; ${stopError.message}`)
            : stopError;
        }
      } catch (error: unknown) {
        const stopError = error instanceof Error ? error : new Error(String(error));
        cleanupError = cleanupError
          ? new Error(`${cleanupError.message}; ${stopError.message}`)
          : stopError;
      }
    }
    if (cleanupError) {
      getApiLogger().withScope("launch-preparation").warn(
        "copilot sdk cleanup failed after paw init",
        { err: cleanupError },
      );
    }
  }
}

function trackerUrlOf(contextPackage: LaunchContextPackage): string | null {
  const trackerReference = contextPackage.metadata.sourceReferences.find(
    (reference) => reference.kind === "tracker" && typeof reference.url === "string",
  );
  return trackerReference?.url ?? null;
}

function assertContextPackageAvailable(contextPackage: LaunchContextPackage): void {
  if (!contextPackage.contextFilePath || !contextPackage.contextPackagePath) {
    throw new LaunchPreparationError(
      "missing_context_package",
      500,
      "Launch context preparation did not return a context package path.",
      "context-preparation",
      "contextPackage",
    );
  }
}

export function buildKickoffPrompt(input: {
  workflowContextPath: string;
  streamlinerContextPath: string;
  launchMetadata: PawLaunchMetadata;
}): string {
  const lines = [
    "You are a Streamliner node session launched from a workstream graph node.",
    "",
    "Start by reading the prepared PAW workflow context and Streamliner launch context:",
    `- PAW workflow context: ${displayPath(input.workflowContextPath)}`,
    `- Streamliner launch context: ${displayPath(input.streamlinerContextPath)}`,
    "",
    "Launch identity:",
    `- Project: ${input.launchMetadata.projectKey}`,
    `- Workstream: ${input.launchMetadata.workstreamId}`,
    `- Node: ${input.launchMetadata.nodeId}`,
    `- Branch: ${input.launchMetadata.branch}`,
    `- Work ID: ${input.launchMetadata.workId}`,
    `- Launch nonce: ${input.launchMetadata.launchNonce ?? "none"}`,
    `- Launch claim: ${input.launchMetadata.launchClaimRef ?? "not-created"}`,
    `- Target repos: ${input.launchMetadata.targetRepoIds.join(", ") || "none"}`,
  ];
  if (input.launchMetadata.trackerUrl) {
    lines.push(`- Tracker: ${input.launchMetadata.trackerUrl}`);
  }
  lines.push(
    "",
    "Proceed through the PAW workflow using WorkflowContext.md as the durable source of truth. The Streamliner context has already been installed into the PAW work directory and recorded as an Additional Input.",
  );
  return `${lines.join("\n")}\n`;
}

export async function preparePawLaunch(
  options: PreparePawLaunchOptions,
): Promise<PawLaunchHandoff> {
  if (!options.nodeId.trim()) {
    throw new LaunchPreparationError(
      "invalid_node_id",
      400,
      "nodeId is required.",
      "validation",
      "nodeId",
    );
  }

  const sessionStateRoot = resolve(options.stateRoot ?? defaultStateRoot());
  const configuration = normalizeConfiguration(options.configuration, {
    cwd: options.cwd,
  });

  const contextPreparer = options.contextPreparer ?? prepareLaunchContextPackage;
  let stagedContextPackage: LaunchContextPackage;
  try {
    stagedContextPackage = await contextPreparer({
      graphPath: options.graphPath,
      defaultGraphPath: options.defaultGraphPath,
      nodeId: options.nodeId,
      launchNonce: options.launchNonce,
      stateRoot: sessionStateRoot,
      now: options.now,
      createContextId: options.createContextId,
      trackerResolver: options.trackerResolver,
      contextGenerator: options.contextGenerator,
    });
    assertContextPackageAvailable(stagedContextPackage);
  } catch (error: unknown) {
    if (error instanceof LaunchPreparationError) {
      throw error;
    }
    const message = error instanceof LaunchContextPreparationError || error instanceof Error
      ? error.message
      : String(error);
    throw new LaunchPreparationError(
      "context_preparation_failed",
      error instanceof LaunchContextPreparationError ? error.statusCode : 500,
      message,
      "context-preparation",
      error instanceof LaunchContextPreparationError ? error.code : "contextPackage",
    );
  }

  const runner = options.pawInitRunner ?? defaultPawInitRunner;
  let pawInit: PawInitRunnerResult;
  try {
    pawInit = await runner({
      nodeId: options.nodeId,
      graphPath: options.graphPath,
      cwd: configuration.cwd,
      sessionStateRoot,
      issueUrl: trackerUrlOf(stagedContextPackage) ?? undefined,
      launchNonce: options.launchNonce ?? null,
      configuration,
      stagedContextPackage,
    });
  } catch (error: unknown) {
    throw new LaunchPreparationError(
      "paw_init_failed",
      500,
      error instanceof Error ? error.message : String(error),
      "paw-init",
      "pawInitRunner",
    );
  }

  const launchMetadata: PawLaunchMetadata = {
    launchNonce: stagedContextPackage.metadata.launchNonce,
    launchClaimRef: stagedContextPackage.metadata.launchClaimRef,
    projectKey: stagedContextPackage.metadata.projectKey,
    workstreamId: stagedContextPackage.metadata.workstreamId,
    nodeId: stagedContextPackage.metadata.nodeId,
    targetRepoIds: [...stagedContextPackage.metadata.targetRepoIds],
    graphPath: stagedContextPackage.metadata.graphPath,
    branch: pawInit.branch,
    workId: pawInit.workId,
    workTitle: pawInit.workTitle,
    trackerUrl: trackerUrlOf(stagedContextPackage),
  };
  const kickoffPrompt = buildKickoffPrompt({
    workflowContextPath: pawInit.workflowContextPath,
    streamlinerContextPath: pawInit.streamlinerContextPath,
    launchMetadata,
  });

  return {
    cwd: pawInit.cwd || normalizeManifestPath(configuration.cwd),
    branch: pawInit.branch,
    pawWorkDir: pawInit.pawWorkDir,
    workflowContextPath: pawInit.workflowContextPath,
    streamlinerContextPath: pawInit.streamlinerContextPath,
    kickoffPrompt,
    cliArgs: [...configuration.cliArgs],
    environment: {
      ...configuration.environment,
      ...(pawInit.environment ?? {}),
    },
    sessionStateRoot: pawInit.sessionStateRoot ?? normalizeManifestPath(sessionStateRoot),
    launchMetadata,
    contextPackage: stagedContextPackage,
  };
}
