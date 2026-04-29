import type { SessionRegistryRecord } from "../session-registry-schema";
import type { SessionRegistryStore } from "../session-registry-contract";

export const STOP_ERROR_CODES = [
  "session_not_found",
  "session_archived",
  "session_already_ended",
  "no_copilot_session_id",
  "stop_failed",
] as const;
export type StopErrorCode = (typeof STOP_ERROR_CODES)[number];

export interface StopResult {
  sessionId: string;
  lifecycleStatus: SessionRegistryRecord["lifecycleStatus"];
  trustedEndedAt: string | null;
}

export interface StopError {
  code: StopErrorCode;
  message: string;
}

export type StopOutcome =
  | { ok: true; result: StopResult }
  | { ok: false; error: StopError };

/**
 * Synthesize a `session.ended` trusted signal for the given registry session.
 *
 * Mirrors the relaunch endpoint's session.started synthesis: when the user
 * closed a Copilot CLI terminal so quickly that the sessionEnd hook never
 * fired (or its POST never landed), the session can stay marked as
 * "interrupted" indefinitely. This lets the UI request a manual end so the
 * registry reflects reality.
 */
export function stopSession(
  store: SessionRegistryStore,
  sessionId: string,
): StopOutcome {
  const session = store.getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      error: {
        code: "session_not_found",
        message: `Session "${sessionId}" does not exist.`,
      },
    };
  }

  if (session.lifecycleStatus === "archived") {
    return {
      ok: false,
      error: {
        code: "session_archived",
        message: `Session "${session.title}" is archived; unarchive before stopping.`,
      },
    };
  }

  if (session.lifecycleStatus === "ended" && session.trustedEndedAt) {
    return {
      ok: false,
      error: {
        code: "session_already_ended",
        message: `Session "${session.title}" is already marked as ended.`,
      },
    };
  }

  if (!session.copilotSessionId) {
    return {
      ok: false,
      error: {
        code: "no_copilot_session_id",
        message: `Session "${session.title}" has no Copilot session id; manual end is only supported for sessions with a recorded Copilot session.`,
      },
    };
  }

  try {
    const updated = store.recordTrustedSessionSignal({
      event: "session.ended",
      source: "copilot-cli-hook",
      sessionId: session.copilotSessionId,
      timestamp: new Date().toISOString(),
      cwd: session.cwd,
      repo: session.repo,
      branch: session.branch,
      endReason: "user_exit",
      executionKind: session.trustedExecutionKind ?? "copilot_cli",
    });
    return {
      ok: true,
      result: {
        sessionId: session.id,
        lifecycleStatus: updated.lifecycleStatus,
        trustedEndedAt: updated.trustedEndedAt,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        code: "stop_failed",
        message: `Failed to stop session: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
