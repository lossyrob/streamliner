import { isCopilotSdkSessionFsPath } from "./copilot-sdk-session-paths";

const COPILOT_CLI_SUBAGENT_SESSION_ID_PATTERN = /^call_[A-Za-z0-9_-]{12,}$/;

export function isCopilotCliSubagentSessionId(
  sessionId: string | null | undefined,
): boolean {
  return typeof sessionId === "string" && COPILOT_CLI_SUBAGENT_SESSION_ID_PATTERN.test(sessionId);
}

export function isCopilotHelperSessionIdentity(input: {
  sessionId?: string | null;
  cwd?: string | null;
}): boolean {
  return (
    isCopilotCliSubagentSessionId(input.sessionId) ||
    isCopilotSdkSessionFsPath(input.cwd)
  );
}
