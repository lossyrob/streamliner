export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildCopilotResumeCommand(copilotSessionId: string): string {
  return `copilot ${quotePowerShellLiteral(`--resume=${copilotSessionId}`)}`;
}
