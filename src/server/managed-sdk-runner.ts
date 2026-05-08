import { dirname } from "node:path";

import type {
  PermissionHandler,
  PermissionRequest,
  PermissionRequestResult,
  SessionEvent,
} from "@github/copilot-sdk";

import type {
  SessionRegistryManagedLifecycleState,
  SessionRegistryRuntimeEvidenceKind,
} from "../session-registry-schema";
import type {
  SessionRegistryRuntimeEvidenceInput,
  SessionRegistryRuntimeProgressEventInput,
} from "../session-registry/managed-runtime";

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

export interface ManagedSdkRunner {
  start(input: ManagedSdkRunnerStartInput): Promise<ManagedSdkRunnerStartResult>;
  interrupt?(input: ManagedSdkInterruptInput): Promise<ManagedSdkInterruptResult>;
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
}

const PR_URL_PATTERN = /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/i;

function sdkStateRootFor(workspacePath: string | undefined, fallback: string): string {
  return workspacePath ? dirname(workspacePath) : fallback;
}

function permissionRequestData(
  request: PermissionRequest,
  decision: PermissionRequestResult,
): Record<string, unknown> {
  return {
    kind: request.kind,
    toolCallId: request.toolCallId,
    decision: decision.kind,
  };
}

function lifecycleForSdkEvent(event: SessionEvent): SessionRegistryManagedLifecycleState | null {
  switch (event.type) {
    case "tool.execution_start":
      return "running";
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

function progressForSdkEvent(event: SessionEvent): SessionRegistryRuntimeProgressEventInput | null {
  const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : {};
  switch (event.type) {
    case "assistant.intent":
      return {
        type: "assistant_status",
        message: "Assistant status updated.",
        data: { intentLength: typeof data.intent === "string" ? data.intent.length : undefined },
      };
    case "assistant.message":
      return {
        type: "assistant_status",
        message: "Assistant message received.",
        data: { contentLength: typeof data.content === "string" ? data.content.length : undefined },
      };
    case "tool.execution_start":
      return {
        type: "tool_started",
        message: "Tool execution started.",
        data: {
          toolCallId: data.toolCallId,
          toolName: data.toolName ?? data.name,
        },
      };
    case "tool.execution_complete":
      return {
        type: "tool_completed",
        message: "Tool execution completed.",
        data: {
          toolCallId: data.toolCallId,
          success: data.success,
        },
      };
    case "session.mcp_servers_loaded":
    case "session.mcp_server_status_changed":
      return {
        type: "mcp_status",
        message: "MCP status updated.",
        data,
      };
    case "session.skills_loaded":
    case "skill.invoked":
      return {
        type: "skill_status",
        message: "Skill status updated.",
        data,
      };
    case "hook.start":
    case "hook.end":
      return {
        type: "evidence",
        message: "Hook event observed.",
        data: {
          hookType: data.hookType,
          success: data.success,
        },
      };
    case "session.usage_info":
      return {
        type: "usage",
        message: "Usage counters updated.",
        data: {
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
        },
      };
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
  if (prMatch) {
    evidence.push({
      kind: "pr_ready",
      source: "sdk-assistant-message",
      url: prMatch[0],
      repo: prMatch[1],
      number: Number(prMatch[2]),
      summary: "PR URL detected in managed SDK assistant output.",
    });
  }
  return evidence;
}

function lifecycleStateForEvidence(
  kind: SessionRegistryRuntimeEvidenceKind,
): SessionRegistryManagedLifecycleState {
  return kind;
}

export class DefaultManagedSdkRunner implements ManagedSdkRunner {
  private readonly activeRuns = new Map<string, ActiveManagedRun>();

  async start(input: ManagedSdkRunnerStartInput): Promise<ManagedSdkRunnerStartResult> {
    const sdk = await import("@github/copilot-sdk");
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
      input.onLifecycleState("starting", "Starting managed SDK session.");
      const permissionHandler: PermissionHandler = async (request, invocation) => {
        const decision = await sdk.approveAll(request, invocation);
        input.onProgress({
          type: "permission_decision",
          message: "Managed-autonomous permission approved.",
          data: permissionRequestData(request, decision),
        });
        return decision;
      };
      session = await client.createSession({
        clientName: "streamliner-managed-sdk-worker",
        workingDirectory: input.cwd,
        enableConfigDiscovery: true,
        streaming: true,
        onPermissionRequest: permissionHandler,
        onUserInputRequest: (request) => {
          input.onProgress({
            type: "assistant_status",
            message: "Builder input requested by managed SDK session; auto-answering autonomously.",
            data: {
              questionLength: request.question.length,
              choiceCount: request.choices?.length ?? 0,
            },
          });
          return {
            answer: request.choices?.[0] ?? "Proceed autonomously using the launch context.",
            wasFreeform: !request.choices?.length,
          };
        },
        onEvent: (event) => {
          const progress = progressForSdkEvent(event);
          if (progress) {
            input.onProgress(progress);
          }
          const state = lifecycleForSdkEvent(event);
          if (state) {
            input.onLifecycleState(state, `Managed SDK lifecycle changed to ${state}.`);
          }
        },
      });
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
    input.onStarted(result);
    const activeRun: ActiveManagedRun = { client, session, interrupted: false };
    this.activeRuns.set(input.registryId, activeRun);
    void this.runTurn(input, activeRun);
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
    try {
      active.interrupted = true;
      await active.session.abort();
      return {
        ok: true,
        evidenceState: "interrupted",
        message: input.reason ?? "Managed SDK session abort acknowledged.",
      };
    } catch (error: unknown) {
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
  ): Promise<void> {
    try {
      input.onLifecycleState("running", "Managed SDK worker started.");
      const response = await active.session.sendAndWait({ prompt: input.prompt });
      const content = assistantContent(response);
      const detectedEvidence = evidenceFromAssistantContent(content);
      for (const evidence of detectedEvidence) {
        input.onEvidence(evidence);
        input.onLifecycleState(
          lifecycleStateForEvidence(evidence.kind),
          `Managed SDK evidence detected: ${evidence.kind}.`,
        );
      }
      if (detectedEvidence.length === 0) {
        input.onLifecycleState("completed", "Managed SDK worker completed.");
      }
    } catch (error: unknown) {
      if (active.interrupted) {
        input.onLifecycleState("interrupted", "Managed SDK worker interrupted.");
      } else {
        input.onLifecycleState(
          "failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      this.activeRuns.delete(input.registryId);
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
      if (cleanupErrors.length > 0) {
        input.onProgress({
          type: "error",
          message: "Managed SDK cleanup encountered an error.",
          data: { errorCount: cleanupErrors.length },
        });
      }
    }
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
