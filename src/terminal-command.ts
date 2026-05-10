export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function isSafeCopilotResumeSessionId(copilotSessionId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(copilotSessionId);
}

export function buildCopilotResumeCommand(copilotSessionId: string): string {
  if (!isSafeCopilotResumeSessionId(copilotSessionId)) {
    throw new Error("Copilot resume session id contains unsupported characters.");
  }
  return `copilot ${quotePowerShellLiteral(`--resume=${copilotSessionId}`)}`;
}
