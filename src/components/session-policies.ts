import type { SessionRegistryListItem } from "../session-registry-contract";
import { isManagedRuntimeLifecycleCleanlyEnded } from "../managed-runtime-contract";
import {
  buildCopilotResumeCommand,
  quotePowerShellLiteral,
} from "../terminal-command";

export function getDisplaySessionId(session: SessionRegistryListItem): string {
  return session.copilotSessionId ?? session.id;
}

function normalizePathForPowerShell(value: string): string {
  const trimmed = value.trim();
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("\\\\")) {
    return trimmed.replace(/\//g, "\\");
  }
  return trimmed;
}

export function buildRestartCommand(
  session: SessionRegistryListItem,
  defaultCliArgs: readonly string[] = [],
): string | null {
  if (!session.copilotSessionId) {
    return null;
  }
  const worktree = normalizePathForPowerShell(session.derivedWorktreePath ?? session.cwd);
  const cliArgs = session.launchCliArgs ?? defaultCliArgs;
  const resumeCommand = buildCopilotResumeCommand(session.copilotSessionId, cliArgs);
  if (worktree.length === 0) {
    return resumeCommand;
  }
  return `Set-Location -LiteralPath ${quotePowerShellLiteral(worktree)}; ${resumeCommand}`;
}

export function canRelaunch(session: SessionRegistryListItem): boolean {
  // Cannot relaunch archived sessions
  if (session.lifecycleStatus === "archived") {
    return false;
  }
  
  // Cannot relaunch if the session is trusted-active (high-confidence live check:
  // has trusted signal source, no end signal, and live process state)
  if (isTrustedActiveSession(session)) {
    return false;
  }
  
  // Must have a valid cwd or derivedWorktreePath
  const worktree = session.derivedWorktreePath ?? session.cwd;
  if (!worktree || worktree.trim().length === 0) {
    return false;
  }
  
  return true;
}

export function canManuallyStop(session: SessionRegistryListItem): boolean {
  // Manual stop synthesizes a session.ended trusted signal. It only makes
  // sense for sessions that have a Copilot session id (so the signal can be
  // attributed) and aren't already terminally archived or ended.
  if (session.lifecycleStatus === "archived") {
    return false;
  }
  if (session.lifecycleStatus === "ended" && session.trustedEndedAt) {
    return false;
  }
  if (!session.copilotSessionId) {
    return false;
  }
  return true;
}

export function isTrustedActiveSession(session: SessionRegistryListItem): boolean {
  return (
    session.trustedSignalSource !== null &&
    session.trustedEndedAt === null &&
    session.copilotProcessState === "live"
  );
}

export function isTrustedInterruptedSession(session: SessionRegistryListItem): boolean {
  return (
    session.trustedSignalSource !== null &&
    session.trustedStartedAt !== null &&
    session.trustedEndedAt === null &&
    session.copilotProcessState !== "live"
  );
}

export function isCleanlyEndedSession(session: SessionRegistryListItem): boolean {
  if (isTrustedInterruptedSession(session)) {
    return false;
  }
  const managedLifecycleState = session.runtime?.runtimeKind === "managed-sdk"
    ? session.runtime.lifecycleState
    : null;
  if (managedLifecycleState && !isManagedRuntimeLifecycleCleanlyEnded(managedLifecycleState)) {
    return false;
  }
  return (
    session.trustedEndedAt !== null ||
    session.activityStatus === "exited" ||
    session.lifecycleStatus === "ended"
  );
}

export function filterEndedSessions(
  sessions: readonly SessionRegistryListItem[],
  showEnded: boolean,
): SessionRegistryListItem[] {
  return showEnded ? [...sessions] : sessions.filter((session) => !isCleanlyEndedSession(session));
}
