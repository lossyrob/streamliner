import type { SessionRegistryListItem } from "../session-registry-contract";

export function getDisplaySessionId(session: SessionRegistryListItem): string {
  return session.copilotSessionId ?? session.id;
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizePathForPowerShell(value: string): string {
  const trimmed = value.trim();
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("\\\\")) {
    return trimmed.replace(/\//g, "\\");
  }
  return trimmed;
}

export function buildRestartCommand(session: SessionRegistryListItem): string | null {
  if (!session.copilotSessionId) {
    return null;
  }
  const worktree = normalizePathForPowerShell(session.derivedWorktreePath ?? session.cwd);
  const resumeCommand = `copilot --resume ${quotePowerShellLiteral(session.copilotSessionId)}`;
  if (worktree.length === 0) {
    return resumeCommand;
  }
  return `Set-Location -LiteralPath ${quotePowerShellLiteral(worktree)}; ${resumeCommand}`;
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
