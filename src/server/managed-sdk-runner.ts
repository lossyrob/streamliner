import { dirname } from "node:path";

import type {
  PermissionHandler,
  SessionEvent,
} from "@github/copilot-sdk";

import {
  SESSION_REGISTRY_MANAGED_LIFECYCLE_STATES,
  SESSION_REGISTRY_RUNTIME_EVIDENCE_KINDS,
  type SessionRegistryManagedLifecycleState,
  type SessionRegistryRuntimeEvidenceKind,
} from "../session-registry-schema";
import type {
  SessionRegistryRuntimeEvidenceInput,
  SessionRegistryRuntimeProgressEventInput,
} from "../session-registry-contract";
import { getApiLogger } from "./logger";

export interface ManagedSdkRunnerStartInput {
  registryId: string;
  launchClaimId: string;
  launchNonce: string;
  cwd: string;
  branch: string;
  prompt: string;
  cliArgs: string[];
  environment: Record<string, string>;
  sessionStateRoot: string;
  onLifecycleState: (state: SessionRegistryManagedLifecycleState, message: string) => void;
  onProgress: (event: SessionRegistryRuntimeProgressEventInput) => void;
  onEvidence: (evidence: SessionRegistryRuntimeEvidenceInput) => void;
  onStarted: (details: ManagedSdkRunnerStartResult) => void;
}

export interface ManagedSdkRunnerResumeInput extends ManagedSdkRunnerStartInput {
  sdkSessionId: string;
}

export interface ManagedSdkRunnerStartResult {
  registryId: string;
  sdkSessionId: string | null;
  sdkWorkspacePath: string | null;
  sdkStateRoot: string | null;
}

export interface ManagedSdkInterruptInput {
  registryId: string;
  reason?: string;
}

export interface ManagedSdkInterruptResult {
  ok: boolean;
  evidenceState: Extract<
    SessionRegistryManagedLifecycleState,
    "interrupted" | "waiting_for_builder" | "failed"
  >;
  message: string;
}

export interface ManagedSdkOwnershipTransferInput {
  registryId: string;
  reason?: string;
}

export interface ManagedSdkOwnershipTransferResult {
  ok: boolean;
  message: string;
}

export interface ManagedSdkRunner {
  start(input: ManagedSdkRunnerStartInput): Promise<ManagedSdkRunnerStartResult>;
  resume?(input: ManagedSdkRunnerResumeInput): Promise<ManagedSdkRunnerStartResult>;
  interrupt?(input: ManagedSdkInterruptInput): Promise<ManagedSdkInterruptResult>;
  transferToTerminal?(
    input: ManagedSdkOwnershipTransferInput,
  ): Promise<ManagedSdkOwnershipTransferResult>;
}

export const DEFAULT_MANAGED_SDK_TURN_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface DefaultManagedSdkRunnerOptions {
  /**
   * Timeout passed to the SDK convenience wait for session.idle. This is a
   * supervision guard only; SDK timeouts do not abort in-flight work.
   */
  turnIdleTimeoutMs?: number;
}

interface ActiveManagedRun {
  session: {
    abort: () => Promise<void>;
    disconnect: () => Promise<void>;
    sendAndWait: (options: { prompt: string }, timeout?: number) => Promise<unknown>;
  };
  client: {
    stop: () => Promise<unknown[]>;
  };
  interrupted: boolean;
  ownershipTransferred: boolean;
  interruptPromise?: Promise<ManagedSdkInterruptResult>;
  cleanupPromise?: Promise<string[]>;
}

interface SafeManagedCallbacks {
  onLifecycleState: (state: SessionRegistryManagedLifecycleState, message: string) => void;
  onProgress: (event: SessionRegistryRuntimeProgressEventInput) => void;
  onEvidence: (evidence: SessionRegistryRuntimeEvidenceInput) => void;
  onStarted: (details: ManagedSdkRunnerStartResult) => void;
}

interface ManagedUserInputRequest {
  question: string;
  choices?: string[];
}

interface ToolCallDisplayState {
  toolCallId: string;
  toolName?: string;
  displayTitle?: string;
  displayDetail?: string;
  outputLineCount?: number;
}

type RuntimeEvidenceLifecycleState = Extract<
  SessionRegistryManagedLifecycleState,
  SessionRegistryRuntimeEvidenceKind
>;

const GITHUB_REPO_SEGMENT_PATTERN = String.raw`[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?`;
const PR_URL_PATTERN = new RegExp(
  String.raw`https:\/\/github\.com\/(?<repo>${GITHUB_REPO_SEGMENT_PATTERN}\/${GITHUB_REPO_SEGMENT_PATTERN})\/pull\/(?<number>[1-9]\d*)\b`,
  "i",
);

const MANAGED_LIFECYCLE_STATE_SET = new Set<string>(SESSION_REGISTRY_MANAGED_LIFECYCLE_STATES);
for (const kind of SESSION_REGISTRY_RUNTIME_EVIDENCE_KINDS) {
  if (!MANAGED_LIFECYCLE_STATE_SET.has(kind)) {
    throw new Error(`Runtime evidence kind ${kind} is not a managed lifecycle state.`);
  }
}

function errorLogDetails(error: unknown): Record<string, string> | string {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createSafeManagedCallbacks(input: ManagedSdkRunnerStartInput): SafeManagedCallbacks {
  const logger = getApiLogger().withScope("managed-sdk-runner");
  const report = (callback: string, error: unknown) => {
    logger.warn("managed SDK callback failed", {
      callback,
      registryId: input.registryId,
      launchClaimId: input.launchClaimId,
      err: errorLogDetails(error),
    });
  };
  return {
    onLifecycleState: (state, message) => {
      try {
        input.onLifecycleState(state, message);
      } catch (error: unknown) {
        report("onLifecycleState", error);
      }
    },
    onProgress: (event) => {
      try {
        input.onProgress(event);
      } catch (error: unknown) {
        report("onProgress", error);
      }
    },
    onEvidence: (evidence) => {
      try {
        input.onEvidence(evidence);
      } catch (error: unknown) {
        report("onEvidence", error);
      }
    },
    onStarted: (details) => {
      try {
        input.onStarted(details);
      } catch (error: unknown) {
        report("onStarted", error);
      }
    },
  };
}

function sdkStateRootFor(workspacePath: string | undefined, fallback: string): string {
  return workspacePath ? dirname(workspacePath) : fallback;
}

function managedSdkTurnIdleTimeoutMs(): number {
  const raw = process.env.STREAMLINER_MANAGED_SDK_TURN_IDLE_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_MANAGED_SDK_TURN_IDLE_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  getApiLogger().withScope("managed-sdk-runner").warn(
    "invalid STREAMLINER_MANAGED_SDK_TURN_IDLE_TIMEOUT_MS; using default",
    { value: raw, defaultMs: DEFAULT_MANAGED_SDK_TURN_IDLE_TIMEOUT_MS },
  );
  return DEFAULT_MANAGED_SDK_TURN_IDLE_TIMEOUT_MS;
}

function lifecycleForSdkEvent(event: SessionEvent): SessionRegistryManagedLifecycleState | null {
  switch (event.type) {
    case "session.idle":
      return "idle";
    case "session.error":
      return "failed";
    case "abort":
      return "interrupted";
    default:
      return null;
  }
}

function eventText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function toolDisplayName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "tool";
  }
  return value.trim().replace(/^functions\./, "");
}

function optionalDisplayString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function optionalDisplayNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function assistantDisplayContent(data: Record<string, unknown>): string | undefined {
  return optionalDisplayString(data.content) ??
    optionalDisplayString(data.message) ??
    optionalDisplayString(data.text);
}

function outputLineCount(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return value.split(/\r?\n/).length;
}

function outputLineCountFromResult(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return outputLineCount(value);
  }
  const direct = outputLineCount(value.detailedContent) ?? outputLineCount(value.content);
  if (direct !== undefined) {
    return direct;
  }
  const contents = Array.isArray(value.contents) ? value.contents : [];
  let count = 0;
  for (const block of contents) {
    if (isRecord(block) && typeof block.text === "string") {
      count += outputLineCount(block.text) ?? 0;
    }
  }
  return count > 0 ? count : undefined;
}

function argumentRecord(data: Record<string, unknown>): Record<string, unknown> {
  return isRecord(data.arguments) ? data.arguments : {};
}

function argumentCount(data: Record<string, unknown>): number | undefined {
  const args = argumentRecord(data);
  const count = Object.keys(args).length;
  return count > 0 ? count : undefined;
}

function toolDisplayTitle(
  data: Record<string, unknown>,
  toolName: unknown,
  fallbackVerb: "Run" | "Ran" | "Failed",
): string {
  const args = argumentRecord(data);
  const description = optionalDisplayString(args.description) ??
    optionalDisplayString(data.description);
  if (description) {
    const suffix = toolDisplayName(toolName);
    return suffix === "tool" ? description : `${description} (${suffix})`;
  }
  const defaultTitle = defaultToolDisplayTitle(toolName, fallbackVerb);
  if (defaultTitle) {
    return defaultTitle;
  }
  return `${fallbackVerb} ${toolDisplayName(toolName)}`;
}

function defaultToolDisplayTitle(
  toolName: unknown,
  fallbackVerb: "Run" | "Ran" | "Failed",
): string | undefined {
  const name = toolDisplayName(toolName);
  const prefix = fallbackVerb === "Ran"
    ? "Read"
    : fallbackVerb === "Failed"
      ? "Failed"
      : "Read";
  switch (name) {
    case "view":
      return fallbackVerb === "Failed" ? "Failed reading file" : `${prefix} file`;
    case "rg":
      return fallbackVerb === "Failed" ? "Failed code search" : "Search code";
    case "glob":
      return fallbackVerb === "Failed" ? "Failed file search" : "Find files";
    case "apply_patch":
      return fallbackVerb === "Ran"
        ? "Edited files"
        : fallbackVerb === "Failed"
          ? "Failed editing files"
          : "Edit files";
    case "powershell":
      return fallbackVerb === "Ran"
        ? "Ran shell command"
        : fallbackVerb === "Failed"
          ? "Failed shell command"
          : "Run shell command";
    default:
      return undefined;
  }
}

function toolDisplayDetail(data: Record<string, unknown>): string | undefined {
  const args = argumentRecord(data);
  return optionalDisplayString(args.command) ??
    optionalDisplayString(args.path) ??
    optionalDisplayString(args.filePath) ??
    optionalDisplayString(data.command) ??
    optionalDisplayString(data.path) ??
    optionalDisplayString(data.filePath);
}

function progressForSdkEvent(
  event: SessionEvent,
  toolCalls: Map<string, ToolCallDisplayState>,
): SessionRegistryRuntimeProgressEventInput | null {
  const data = isRecord(event.data) ? event.data : {};
  switch (event.type) {
    case "assistant.intent":
      return {
        type: "assistant_status",
        message: eventText(data.intent, "Thinking..."),
        data: {
          assistantEventKind: "intent",
          intent: typeof data.intent === "string" ? data.intent : undefined,
          agentId: event.agentId,
        },
      };
    case "assistant.reasoning":
      return {
        type: "assistant_status",
        message: "Thinking...",
        data: {
          assistantEventKind: "reasoning",
          contentLength: typeof data.content === "string" ? data.content.length : undefined,
          reasoningId: data.reasoningId,
          agentId: event.agentId,
        },
      };
    case "assistant.reasoning_delta":
      return null;
    case "assistant.message": {
      const displayMessage = assistantDisplayContent(data);
      return {
        type: "assistant_status",
        message: eventText(displayMessage, "Assistant responded."),
        data: {
          assistantEventKind: "message",
          displayMessage,
          contentLength: displayMessage?.length,
          outputTokens: optionalDisplayNumber(data.outputTokens),
          agentId: event.agentId,
        },
      };
    }
    case "tool.execution_start": {
      const toolName = data.toolName ?? data.name;
      const toolCallId = optionalDisplayString(data.toolCallId);
      const displayTitle = toolDisplayTitle(data, toolName, "Run");
      const displayDetail = toolDisplayDetail(data);
      if (toolCallId) {
        toolCalls.set(toolCallId, {
          toolCallId,
          toolName: optionalDisplayString(toolName),
          displayTitle,
          displayDetail,
        });
      }
      return {
        type: "tool_started",
        message: displayTitle,
        data: {
          displayTitle,
          displayDetail,
          argumentCount: argumentCount(data),
          toolCallId: data.toolCallId,
          toolName,
          agentId: event.agentId,
        },
      };
    }
    case "tool.execution_partial_result": {
      const toolCallId = optionalDisplayString(data.toolCallId);
      if (toolCallId) {
        const state = toolCalls.get(toolCallId) ?? { toolCallId };
        const nextCount = (state.outputLineCount ?? 0) +
          (outputLineCount(data.partialOutput) ?? 0);
        toolCalls.set(toolCallId, { ...state, outputLineCount: nextCount });
      }
      return null;
    }
    case "tool.execution_progress":
      return null;
    case "tool.execution_complete": {
      const toolCallId = optionalDisplayString(data.toolCallId);
      const state = toolCallId ? toolCalls.get(toolCallId) : undefined;
      const toolName = state?.toolName ?? optionalDisplayString(data.toolName) ??
        optionalDisplayString(data.name);
      const success = data.success !== false;
      const displayTitle = success
        ? state?.displayTitle?.replace(/^Run\b/, "Ran") ?? toolDisplayTitle(data, toolName, "Ran")
        : state?.displayTitle?.replace(/^Run\b/, "Failed") ?? toolDisplayTitle(data, toolName, "Failed");
      const outputLines = outputLineCountFromResult(data.result) ??
        outputLineCountFromResult(data.output) ??
        state?.outputLineCount;
      return {
        type: "tool_completed",
        message: displayTitle,
        data: {
          displayTitle,
          displayDetail: state?.displayDetail ?? toolDisplayDetail(data),
          outputLineCount: outputLines,
          toolCallId: data.toolCallId,
          toolName,
          agentId: event.agentId,
          success: data.success,
        },
      };
    }
    case "subagent.started": {
      const displayName = eventText(data.agentDisplayName ?? data.agentName, "background agent");
      return {
        type: "subagent_status",
        message: `Started ${displayName}.`,
        data: {
          displayTitle: `Started ${displayName}.`,
          displayDetail: optionalDisplayString(data.agentDescription),
          agentId: event.agentId,
          agentName: data.agentName,
          toolCallId: data.toolCallId,
        },
      };
    }
    case "subagent.completed": {
      const displayName = eventText(data.agentDisplayName ?? data.agentName, "background agent");
      return {
        type: "subagent_status",
        message: `Finished ${displayName}.`,
        data: {
          displayTitle: `Finished ${displayName}.`,
          displayDetail: optionalDisplayString(data.model),
          agentId: event.agentId,
          agentName: data.agentName,
          toolCallId: data.toolCallId,
          durationMs: optionalDisplayNumber(data.durationMs),
          totalToolCalls: optionalDisplayNumber(data.totalToolCalls),
          success: true,
        },
      };
    }
    case "subagent.failed": {
      const displayName = eventText(data.agentDisplayName ?? data.agentName, "background agent");
      return {
        type: "subagent_status",
        message: `Failed ${displayName}.`,
        data: {
          displayTitle: `Failed ${displayName}.`,
          displayDetail: optionalDisplayString(data.error),
          agentId: event.agentId,
          agentName: data.agentName,
          toolCallId: data.toolCallId,
          durationMs: optionalDisplayNumber(data.durationMs),
          totalToolCalls: optionalDisplayNumber(data.totalToolCalls),
          success: false,
        },
      };
    }
    case "session.mcp_servers_loaded":
    case "session.mcp_server_status_changed":
    case "session.skills_loaded":
    case "hook.start":
    case "hook.end":
    case "session.usage_info":
      return null;
    case "skill.invoked":
      return null;
    case "session.error":
      return {
        type: "error",
        message: "SDK session error.",
        data: {
          errorType: data.errorType,
          messageLength: typeof data.message === "string" ? data.message.length : undefined,
        },
      };
    default:
      return null;
  }
}

function evidenceFromAssistantContent(
  content: string | undefined,
): SessionRegistryRuntimeEvidenceInput[] {
  if (!content) {
    return [];
  }
  const evidence: SessionRegistryRuntimeEvidenceInput[] = [];
  const prMatch = content.match(PR_URL_PATTERN);
  const repo = prMatch?.groups?.repo;
  const numberText = prMatch?.groups?.number;
  if (prMatch && repo && numberText) {
    const number = Number(numberText);
    if (!Number.isSafeInteger(number) || number <= 0) {
      return [];
    }
    evidence.push({
      kind: "pr_ready",
      source: "sdk-assistant-message",
      url: prMatch[0],
      repo,
      number,
      summary: "PR URL detected in managed SDK assistant output.",
    });
  }
  return evidence;
}

function lifecycleStateForEvidence(
  kind: SessionRegistryRuntimeEvidenceKind,
): RuntimeEvidenceLifecycleState {
  return kind as RuntimeEvidenceLifecycleState;
}

export class DefaultManagedSdkRunner implements ManagedSdkRunner {
  private readonly activeRuns = new Map<string, ActiveManagedRun>();
  private readonly turnIdleTimeoutMs: number;

  constructor(options: DefaultManagedSdkRunnerOptions = {}) {
    this.turnIdleTimeoutMs = options.turnIdleTimeoutMs ?? managedSdkTurnIdleTimeoutMs();
  }

  async start(input: ManagedSdkRunnerStartInput): Promise<ManagedSdkRunnerStartResult> {
    return await this.startOrResume(input, null);
  }

  async resume(input: ManagedSdkRunnerResumeInput): Promise<ManagedSdkRunnerStartResult> {
    return await this.startOrResume(input, input.sdkSessionId);
  }

  private async startOrResume(
    input: ManagedSdkRunnerStartInput,
    resumeSessionId: string | null,
  ): Promise<ManagedSdkRunnerStartResult> {
    const sdk = await import("@github/copilot-sdk");
    const callbacks = createSafeManagedCallbacks(input);
    let activeRun: ActiveManagedRun | null = null;
    const lastAssistantMessage = { value: null as string | null };
    const toolCalls = new Map<string, ToolCallDisplayState>();
    const client = new sdk.CopilotClient({
      cwd: input.cwd,
      cliArgs: [...input.cliArgs],
      env: { ...process.env, ...input.environment },
      logLevel: "error",
    });
    let clientStarted = false;
    let session: Awaited<ReturnType<typeof client.createSession>>;
    try {
      await client.start();
      clientStarted = true;
      const permissionHandler: PermissionHandler = async (request, invocation) => {
        const decision = await sdk.approveAll(request, invocation);
        return decision;
      };
      const sessionConfig = {
        clientName: "streamliner-managed-sdk-worker",
        workingDirectory: input.cwd,
        enableConfigDiscovery: true,
        streaming: true,
        onPermissionRequest: permissionHandler,
        onUserInputRequest: (request: ManagedUserInputRequest) => {
          if (!activeRun?.ownershipTransferred) {
            callbacks.onLifecycleState(
              "waiting_for_builder",
              "Managed SDK requested builder input; autonomous runtime did not select a provided choice.",
            );
            callbacks.onProgress({
              type: "assistant_status",
              message: "Builder input requested by managed SDK session; continuing without choosing an SDK-provided option.",
              data: {
                questionLength: request.question.length,
                choiceCount: request.choices?.length ?? 0,
              },
            });
          }
          return {
            answer: "Proceed autonomously using the launch context where safe; otherwise stop and report the requested builder input.",
            wasFreeform: true,
          };
        },
        onEvent: (event: SessionEvent) => {
          if (activeRun?.ownershipTransferred) {
            return;
          }
          if (event.type === "assistant.message" && isRecord(event.data)) {
            lastAssistantMessage.value = assistantDisplayContent(event.data) ??
              lastAssistantMessage.value;
          }
          const progress = progressForSdkEvent(event, toolCalls);
          if (progress) {
            callbacks.onProgress(progress);
          }
          const state = lifecycleForSdkEvent(event);
          if (state) {
            callbacks.onLifecycleState(state, `Managed SDK lifecycle changed to ${state}.`);
          }
        },
      };
      if (resumeSessionId) {
        callbacks.onLifecycleState("starting", "Resuming managed SDK session.");
        session = await client.resumeSession(resumeSessionId, sessionConfig);
      } else {
        callbacks.onLifecycleState("starting", "Starting managed SDK session.");
        session = await client.createSession(sessionConfig);
      }
    } catch (error: unknown) {
      if (clientStarted) {
        await client.stop();
      }
      throw error;
    }
    const result: ManagedSdkRunnerStartResult = {
      registryId: input.registryId,
      sdkSessionId: session.sessionId,
      sdkWorkspacePath: session.workspacePath ?? null,
      sdkStateRoot: sdkStateRootFor(session.workspacePath, input.sessionStateRoot),
    };
    callbacks.onStarted(result);
    activeRun = { client, session, interrupted: false, ownershipTransferred: false };
    this.activeRuns.set(input.registryId, activeRun);
    void this.runTurn(input, activeRun, callbacks, lastAssistantMessage);
    return result;
  }

  async interrupt(input: ManagedSdkInterruptInput): Promise<ManagedSdkInterruptResult> {
    const active = this.activeRuns.get(input.registryId);
    if (!active) {
      return {
        ok: false,
        evidenceState: "waiting_for_builder",
        message: "No active managed SDK session is attached to this API process.",
      };
    }
    if (!active.interruptPromise) {
      active.interruptPromise = this.abortActiveRun(active, input.reason);
    }
    const interruptPromise = active.interruptPromise;
    const result = await interruptPromise;
    if (
      !result.ok
      && this.activeRuns.get(input.registryId) === active
      && active.interruptPromise === interruptPromise
    ) {
      active.interruptPromise = undefined;
    }
    return result;
  }

  async transferToTerminal(
    input: ManagedSdkOwnershipTransferInput,
  ): Promise<ManagedSdkOwnershipTransferResult> {
    const active = this.activeRuns.get(input.registryId);
    if (!active) {
      return {
        ok: false,
        message: "No active managed SDK session is attached to this API process.",
      };
    }
    active.ownershipTransferred = true;
    active.interrupted = true;
    this.activeRuns.delete(input.registryId);
    if (!active.interruptPromise) {
      active.interruptPromise = this.abortActiveRun(active, input.reason);
    }
    const interruptResult = await active.interruptPromise;
    const cleanupErrors = await this.cleanupActiveRun(active);
    if (!interruptResult.ok || cleanupErrors.length > 0) {
      const failures = [
        ...(interruptResult.ok ? [] : [interruptResult.message]),
        ...cleanupErrors,
      ];
      return {
        ok: false,
        message:
          `Managed SDK ownership transferred, but release reported ${failures.length} error(s): ${
            failures.join("; ")
          }`,
      };
    }
    return {
      ok: true,
      message: input.reason ?? "Managed SDK ownership transferred to terminal.",
    };
  }

  private async abortActiveRun(
    active: ActiveManagedRun,
    reason: string | undefined,
  ): Promise<ManagedSdkInterruptResult> {
    active.interrupted = true;
    try {
      await active.session.abort();
      return {
        ok: true,
        evidenceState: "interrupted",
        message: reason ?? "Managed SDK session abort acknowledged.",
      };
    } catch (error: unknown) {
      active.interrupted = false;
      return {
        ok: false,
        evidenceState: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async runTurn(
    input: ManagedSdkRunnerStartInput,
    active: ActiveManagedRun,
    callbacks: SafeManagedCallbacks,
    lastAssistantMessage: { value: string | null },
  ): Promise<void> {
    try {
      callbacks.onLifecycleState("running", "Managed SDK worker started.");
      const response = await active.session.sendAndWait(
        { prompt: input.prompt },
        this.turnIdleTimeoutMs,
      );
      if (active.ownershipTransferred) {
        return;
      }
      const content = assistantContent(response);
      if (content && content !== lastAssistantMessage.value) {
        callbacks.onProgress({
          type: "assistant_status",
          message: content,
          data: {
            assistantEventKind: "message",
            displayMessage: content,
            contentLength: content.length,
          },
        });
        lastAssistantMessage.value = content;
      }
      const detectedEvidence = evidenceFromAssistantContent(content);
      for (const evidence of detectedEvidence) {
        callbacks.onEvidence(evidence);
        callbacks.onLifecycleState(
          lifecycleStateForEvidence(evidence.kind),
          `Managed SDK evidence detected: ${evidence.kind}.`,
        );
      }
      if (detectedEvidence.length === 0) {
        callbacks.onLifecycleState("completed", "Managed SDK worker completed.");
      }
    } catch (error: unknown) {
      if (active.ownershipTransferred) {
        return;
      } else if (active.interrupted) {
        callbacks.onLifecycleState("interrupted", "Managed SDK worker interrupted.");
      } else {
        callbacks.onLifecycleState(
          "failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      this.activeRuns.delete(input.registryId);
      const cleanupErrors = await this.cleanupActiveRun(active);
      if (cleanupErrors.length > 0 && !active.ownershipTransferred) {
        callbacks.onProgress({
          type: "error",
          message: "Managed SDK cleanup encountered an error.",
          data: { errorCount: cleanupErrors.length },
        });
      }
    }
  }

  private cleanupActiveRun(active: ActiveManagedRun): Promise<string[]> {
    active.cleanupPromise ??= this.disconnectActiveRun(active);
    return active.cleanupPromise;
  }

  private async disconnectActiveRun(active: ActiveManagedRun): Promise<string[]> {
    const cleanupErrors: string[] = [];
    try {
      await active.session.disconnect();
    } catch (error: unknown) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
    try {
      await active.client.stop();
    } catch (error: unknown) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
    return cleanupErrors;
  }
}

function assistantContent(response: unknown): string | undefined {
  if (!response || typeof response !== "object" || !("data" in response)) {
    return undefined;
  }
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== "object" || !("content" in data)) {
    return undefined;
  }
  const content = (data as { content?: unknown }).content;
  return typeof content === "string" ? content : undefined;
}
