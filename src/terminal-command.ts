export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function isSafeCopilotResumeSessionId(copilotSessionId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(copilotSessionId);
}

export function buildCopilotResumeCommand(
  copilotSessionId: string,
  cliArgs: readonly string[] = [],
): string {
  if (!isSafeCopilotResumeSessionId(copilotSessionId)) {
    throw new Error("Copilot resume session id contains unsupported characters.");
  }
  const args = [
    ...cliArgs,
    `--resume=${copilotSessionId}`,
  ];
  return `copilot ${args.map(quotePowerShellLiteral).join(" ")}`;
}
