export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildCopilotResumeCommand(
  copilotSessionId: string,
  cliArgs: readonly string[] = [],
): string {
  const args = [
    ...cliArgs,
    `--resume=${copilotSessionId}`,
  ];
  return `copilot ${args.map(quotePowerShellLiteral).join(" ")}`;
}
