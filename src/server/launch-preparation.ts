import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  CopilotClient,
  defineTool,
  type PermissionHandler,
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

const execFileAsync = promisify(execFile);

const DEFAULT_CLI_ARGS = ["--yolo"];
const DEFAULT_PAW_INIT_MODEL = "claude-sonnet-4.6";
const DEFAULT_PAW_INIT_TIMEOUT_MS = 120_000;
const WORKFLOW_IDENTITIES = ["paw"] as const;
const WORKFLOW_MODES = ["full", "minimal", "custom"] as const;
const REVIEW_STRATEGIES = ["local", "prs"] as const;
const REVIEW_POLICIES = ["every-stage", "milestones", "planning-only", "final-pr-only"] as const;
const ENABLEMENT_VALUES = ["enabled", "disabled"] as const;
const TERMINAL_LAUNCH_MODES = ["manual"] as const;
const TERMINAL_PREFERENCES = ["default", "windows-terminal", "powershell"] as const;

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

export interface PawLaunchWorkflowOptions {
  workflowIdentity: "paw";
  workflowMode: "full" | "minimal" | "custom";
  reviewStrategy: "local" | "prs";
  reviewPolicy: "every-stage" | "milestones" | "planning-only" | "final-pr-only";
  planningDocsReview: "enabled" | "disabled";
  finalAgentReview: "enabled" | "disabled";
}

export interface PawLaunchTerminalPreferences {
  launchMode: "manual";
  preferredTerminal: "default" | "windows-terminal" | "powershell";
}

export interface PawLaunchConfigurationInput {
  workTitle?: string;
  workId?: string;
  baseBranch?: string;
  targetBranch?: string;
  cwd?: string;
  pawWorkDir?: string;
  cliArgs?: string[];
  environment?: Record<string, string>;
  customMessage?: string | null;
  paw?: Partial<PawLaunchWorkflowOptions>;
  terminal?: Partial<PawLaunchTerminalPreferences>;
}

export interface ResolvedPawLaunchConfiguration {
  workTitle: string;
  workId: string;
  baseBranch: string;
  targetBranch: string;
  cwd: string;
  pawWorkDir: string;
  workflowContextPath: string;
  streamlinerContextPath: string;
  cliArgs: string[];
  environment: Record<string, string>;
  customMessage: string | null;
  paw: PawLaunchWorkflowOptions;
  terminal: PawLaunchTerminalPreferences;
}

export interface PawInitRunnerInput {
  nodeId: string;
  graphPath?: string;
  cwd: string;
  branch: string;
  pawWorkDir: string;
  workflowContextPath: string;
  streamlinerContextPath: string;
  sessionStateRoot: string;
  workTitle: string;
  workId: string;
  baseBranch: string;
  issueUrl?: string;
  launchNonce: string | null;
  configuration: ResolvedPawLaunchConfiguration;
}

export interface PawInitRunnerResult {
  cwd: string;
  branch: string;
  pawWorkDir: string;
  workflowContextPath: string;
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

interface InitializePawWorkflowArgs {
  workflowContextPath: string;
}

const DEFAULT_PAW_OPTIONS: PawLaunchWorkflowOptions = {
  workflowIdentity: "paw",
  workflowMode: "full",
  reviewStrategy: "local",
  reviewPolicy: "final-pr-only",
  planningDocsReview: "enabled",
  finalAgentReview: "enabled",
};

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
  if (value === undefined) {
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

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "streamliner-launch";
}

function titleFromNodeId(nodeId: string): string {
  return nodeId
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Streamliner Launch";
}

function normalizePawOptions(
  value: Partial<PawLaunchWorkflowOptions> | undefined,
): Partial<PawLaunchWorkflowOptions> {
  const record = assertOptionalRecord(value, "configuration.paw");
  if (!record) {
    return {};
  }
  const normalized: Partial<PawLaunchWorkflowOptions> = {};
  const workflowIdentity = assertOptionalEnum(
    record.workflowIdentity,
    WORKFLOW_IDENTITIES,
    "configuration.paw.workflowIdentity",
  );
  const workflowMode = assertOptionalEnum(
    record.workflowMode,
    WORKFLOW_MODES,
    "configuration.paw.workflowMode",
  );
  const reviewStrategy = assertOptionalEnum(
    record.reviewStrategy,
    REVIEW_STRATEGIES,
    "configuration.paw.reviewStrategy",
  );
  const reviewPolicy = assertOptionalEnum(
    record.reviewPolicy,
    REVIEW_POLICIES,
    "configuration.paw.reviewPolicy",
  );
  const planningDocsReview = assertOptionalEnum(
    record.planningDocsReview,
    ENABLEMENT_VALUES,
    "configuration.paw.planningDocsReview",
  );
  const finalAgentReview = assertOptionalEnum(
    record.finalAgentReview,
    ENABLEMENT_VALUES,
    "configuration.paw.finalAgentReview",
  );
  if (workflowIdentity !== undefined) {
    normalized.workflowIdentity = workflowIdentity;
  }
  if (workflowMode !== undefined) {
    normalized.workflowMode = workflowMode;
  }
  if (reviewStrategy !== undefined) {
    normalized.reviewStrategy = reviewStrategy;
  }
  if (reviewPolicy !== undefined) {
    normalized.reviewPolicy = reviewPolicy;
  }
  if (planningDocsReview !== undefined) {
    normalized.planningDocsReview = planningDocsReview;
  }
  if (finalAgentReview !== undefined) {
    normalized.finalAgentReview = finalAgentReview;
  }
  return normalized;
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
  nodeId: string,
  input: PawLaunchConfigurationInput | undefined,
  options: { cwd?: string; stateRoot: string },
): ResolvedPawLaunchConfiguration {
  const rawWorkTitle = assertOptionalString(input?.workTitle, "configuration.workTitle");
  const rawWorkId = assertOptionalString(input?.workId, "configuration.workId");
  const rawBaseBranch = assertOptionalString(input?.baseBranch, "configuration.baseBranch");
  const rawTargetBranch = assertOptionalString(input?.targetBranch, "configuration.targetBranch");
  const rawCwd = assertOptionalString(input?.cwd, "configuration.cwd");
  const rawPawWorkDir = assertOptionalString(input?.pawWorkDir, "configuration.pawWorkDir");
  const cliArgs = assertOptionalStringArray(input?.cliArgs, "configuration.cliArgs")
    ?? [...DEFAULT_CLI_ARGS];
  const environment = assertOptionalStringRecord(input?.environment, "configuration.environment")
    ?? {};
  const customMessage = input?.customMessage === undefined || input.customMessage === null
    ? null
    : assertOptionalString(input.customMessage, "configuration.customMessage") ?? null;
  const workTitle = rawWorkTitle?.trim() || titleFromNodeId(nodeId);
  const workId = slugify(rawWorkId ?? nodeId);
  const cwd = normalizeAbsolutePath(rawCwd ?? options.cwd ?? process.cwd(), "configuration.cwd");
  const pawWorkDir = normalizeAbsolutePath(
    rawPawWorkDir ?? join(cwd, ".paw", "work", workId),
    "configuration.pawWorkDir",
  );
  const workflowContextPath = join(pawWorkDir, "WorkflowContext.md");
  const streamlinerContextPath = join(pawWorkDir, "streamliner", "context.md");
  const pawOverrides = normalizePawOptions(input?.paw);
  const terminalOverrides = normalizeTerminalPreferences(input?.terminal);

  return {
    workTitle,
    workId,
    baseBranch: rawBaseBranch?.trim() || "main",
    targetBranch: rawTargetBranch?.trim() || `feature/${workId}`,
    cwd,
    pawWorkDir,
    workflowContextPath,
    streamlinerContextPath,
    cliArgs,
    environment,
    customMessage,
    paw: {
      ...DEFAULT_PAW_OPTIONS,
      ...pawOverrides,
    },
    terminal: {
      ...DEFAULT_TERMINAL_PREFERENCES,
      ...terminalOverrides,
    },
  };
}

async function currentCommit(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      timeout: 5_000,
    });
    return stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function buildWorkflowContextContent(
  input: PawInitRunnerInput,
  gitCommit: string,
): string {
  const issueUrl = input.issueUrl ?? "none";
  return [
    "# WorkflowContext",
    "",
    `Work Title: ${input.workTitle}`,
    `Work ID: ${input.workId}`,
    `Workflow Identity: ${input.configuration.paw.workflowIdentity}`,
    `Base Branch: ${input.baseBranch}`,
    `Target Branch: ${input.branch}`,
    "Execution Mode: worktree",
    "Repository Identity: none",
    `Execution Binding: streamliner-launch:${input.workId}`,
    `Workflow Mode: ${input.configuration.paw.workflowMode}`,
    `Review Strategy: ${input.configuration.paw.reviewStrategy}`,
    `Review Policy: ${input.configuration.paw.reviewPolicy}`,
    "Session Policy: continuous",
    `Final Agent Review: ${input.configuration.paw.finalAgentReview}`,
    "Final Review Mode: multi-model",
    "Final Review Interactive: smart",
    "Final Review Models: latest GPT, latest Gemini, latest Claude Opus",
    "Implementation Model: none",
    "Plan Generation Mode: single-model",
    "Plan Generation Models: latest GPT, latest Gemini, latest Claude Opus",
    `Planning Docs Review: ${input.configuration.paw.planningDocsReview}`,
    "Planning Review Mode: multi-model",
    "Planning Review Interactive: smart",
    "Planning Review Models: latest GPT, latest Gemini, latest Claude Opus",
    "Custom Workflow Instructions: none",
    "Initial Prompt: streamliner-launch-kickoff",
    `Issue URL: ${issueUrl}`,
    "Remote: origin",
    "Artifact Lifecycle: commit-and-clean",
    "Artifact Paths: auto-derived",
    `Additional Inputs: node=${input.nodeId}, graph=${input.graphPath ?? "default"}, streamliner-context=${displayPath(input.streamlinerContextPath)}, launch-nonce=${input.launchNonce ?? "none"}, git-commit=${gitCommit}`,
    "",
  ].join("\n");
}

function buildPawInitPrompt(
  input: PawInitRunnerInput,
  workflowContextContent: string,
): string {
  return [
    "Initialize a PAW workflow for a Streamliner graph launch.",
    `Selected node: ${input.nodeId}`,
    `Graph path: ${input.graphPath ?? "default graph"}`,
    "",
    "You must call the `initialize_paw_workflow` tool exactly once with this path:",
    displayPath(input.workflowContextPath),
    "",
    "The tool is Streamliner-owned and writes the canonical WorkflowContext.md content.",
    "Do not use any filesystem or shell tools. Do not start Copilot CLI. Do not open a terminal.",
    "",
    "After the tool succeeds, respond with only this JSON shape:",
    "{",
    '  "status": "ready",',
    `  "cwd": ${JSON.stringify(displayPath(input.cwd))},`,
    `  "branch": ${JSON.stringify(input.branch)},`,
    `  "pawWorkDir": ${JSON.stringify(displayPath(input.pawWorkDir))},`,
    `  "workflowContextPath": ${JSON.stringify(displayPath(input.workflowContextPath))}`,
    "}",
    "",
    "WorkflowContext.md content that the tool will write:",
    "```markdown",
    workflowContextContent.trimEnd(),
    "```",
  ].join("\n");
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

const denyPawInitBuiltInTools: PermissionHandler = () => ({
  kind: "reject",
  feedback: "PAW launch initialization may only use Streamliner-owned PAW init tools.",
});

export async function defaultPawInitRunner(
  input: PawInitRunnerInput,
): Promise<PawInitRunnerResult> {
  const gitCommit = await currentCommit(input.cwd);
  const workflowContextContent = buildWorkflowContextContent(input, gitCommit);
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
    const initializeTool = defineTool<InitializePawWorkflowArgs>(
      "initialize_paw_workflow",
      {
        description: "Create the PAW launch work directory and WorkflowContext.md file for a Streamliner graph launch.",
        parameters: {
          type: "object",
          properties: {
            workflowContextPath: {
              type: "string",
              description: "Absolute path to the WorkflowContext.md file to create.",
            },
          },
          required: ["workflowContextPath"],
          additionalProperties: false,
        },
        skipPermission: true,
        handler: async (args) => {
          if (
            !isRecord(args) ||
            typeof args.workflowContextPath !== "string" ||
            resolve(args.workflowContextPath) !== resolve(input.workflowContextPath)
          ) {
            throw new Error("initialize_paw_workflow received an unexpected workflowContextPath.");
          }
          await mkdir(dirname(input.workflowContextPath), { recursive: true });
          await writeFile(input.workflowContextPath, workflowContextContent, "utf8");
          toolResult = {
            cwd: normalizeManifestPath(input.cwd),
            branch: input.branch,
            pawWorkDir: normalizeManifestPath(input.pawWorkDir),
            workflowContextPath: normalizeManifestPath(input.workflowContextPath),
            environment: { ...input.configuration.environment },
            sessionStateRoot: normalizeManifestPath(input.sessionStateRoot),
          };
          return toolResult;
        },
      },
    );
    session = await client.createSession({
      clientName: "streamliner-paw-launch-initializer",
      model: process.env.STREAMLINER_PAW_INIT_MODEL ?? DEFAULT_PAW_INIT_MODEL,
      workingDirectory: input.cwd,
      enableConfigDiscovery: false,
      tools: [initializeTool],
      availableTools: ["initialize_paw_workflow"],
      onPermissionRequest: denyPawInitBuiltInTools,
      systemMessage: {
        mode: "append",
        content: "You are a constrained Streamliner PAW launch initializer. You may only use Streamliner-owned PAW init tools supplied by this session.",
      },
    });
    const response = await session.sendAndWait(
      { prompt: buildPawInitPrompt(input, workflowContextContent) },
      pawInitTimeoutMs(),
    );
    const content = response?.data.content ?? "";
    const parsed = parseSdkJsonResponse(content);
    if (parsed.status !== "ready") {
      throw new Error("Copilot SDK PAW init did not report ready status.");
    }
    if (!toolResult) {
      throw new Error("Copilot SDK did not invoke initialize_paw_workflow.");
    }
    if (!existsSync(input.workflowContextPath)) {
      throw new Error("PAW init completed without creating WorkflowContext.md.");
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
  customMessage: string | null;
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
    "Proceed through the PAW workflow using the WorkflowContext.md as the durable source of truth. Do not inline the Streamliner context; treat the file path above as the authoritative launch context artifact.",
  );
  if (input.customMessage !== null && input.customMessage.trim().length > 0) {
    lines.push(
      "",
      "## Builder Custom Message",
      "",
      input.customMessage.trimEnd(),
    );
  }
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
  const configuration = normalizeConfiguration(options.nodeId, options.configuration, {
    cwd: options.cwd,
    stateRoot: sessionStateRoot,
  });
  const runner = options.pawInitRunner ?? defaultPawInitRunner;
  let pawInit: PawInitRunnerResult;
  try {
    pawInit = await runner({
      nodeId: options.nodeId,
      graphPath: options.graphPath,
      cwd: configuration.cwd,
      branch: configuration.targetBranch,
      pawWorkDir: configuration.pawWorkDir,
      workflowContextPath: configuration.workflowContextPath,
      streamlinerContextPath: configuration.streamlinerContextPath,
      sessionStateRoot,
      workTitle: configuration.workTitle,
      workId: configuration.workId,
      baseBranch: configuration.baseBranch,
      launchNonce: options.launchNonce ?? null,
      configuration,
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

  const contextPreparer = options.contextPreparer ?? prepareLaunchContextPackage;
  let contextPackage: LaunchContextPackage;
  try {
    const pawWorkDirForContext = normalizeAbsolutePath(
      pawInit.pawWorkDir || configuration.pawWorkDir,
      "pawInitRunner.pawWorkDir",
    );
    contextPackage = await contextPreparer({
      graphPath: options.graphPath,
      defaultGraphPath: options.defaultGraphPath,
      nodeId: options.nodeId,
      outputDir: pawWorkDirForContext,
      launchNonce: options.launchNonce,
      stateRoot: sessionStateRoot,
      now: options.now,
      createContextId: options.createContextId,
      trackerResolver: options.trackerResolver,
      contextGenerator: options.contextGenerator,
    });
    assertContextPackageAvailable(contextPackage);
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

  const launchMetadata: PawLaunchMetadata = {
    launchNonce: contextPackage.metadata.launchNonce,
    launchClaimRef: contextPackage.metadata.launchClaimRef,
    projectKey: contextPackage.metadata.projectKey,
    workstreamId: contextPackage.metadata.workstreamId,
    nodeId: contextPackage.metadata.nodeId,
    targetRepoIds: [...contextPackage.metadata.targetRepoIds],
    graphPath: contextPackage.metadata.graphPath,
    branch: pawInit.branch,
    workId: configuration.workId,
    workTitle: configuration.workTitle,
    trackerUrl: trackerUrlOf(contextPackage),
  };
  const workflowContextPath = pawInit.workflowContextPath || configuration.workflowContextPath;
  const kickoffPrompt = buildKickoffPrompt({
    workflowContextPath,
    streamlinerContextPath: contextPackage.contextFilePath,
    launchMetadata,
    customMessage: configuration.customMessage,
  });

  return {
    cwd: pawInit.cwd || normalizeManifestPath(configuration.cwd),
    branch: pawInit.branch,
    pawWorkDir: pawInit.pawWorkDir || normalizeManifestPath(configuration.pawWorkDir),
    workflowContextPath,
    streamlinerContextPath: contextPackage.contextFilePath,
    kickoffPrompt,
    cliArgs: [...configuration.cliArgs],
    environment: {
      ...configuration.environment,
      ...(pawInit.environment ?? {}),
    },
    sessionStateRoot: pawInit.sessionStateRoot ?? normalizeManifestPath(sessionStateRoot),
    launchMetadata,
    contextPackage,
  };
}
