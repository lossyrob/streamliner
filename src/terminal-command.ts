export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function quotePosixShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export type CopilotCommandShellDialect = "powershell" | "posix";

function quoteCopilotShellLiteral(value: string, shellDialect: CopilotCommandShellDialect): string {
  return shellDialect === "posix"
    ? quotePosixShellLiteral(value)
    : quotePowerShellLiteral(value);
}

export function isSafeCopilotResumeSessionId(copilotSessionId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(copilotSessionId);
}

export function buildCopilotResumeCommand(
  copilotSessionId: string,
  cliArgs: readonly string[] = [],
  shellDialect: CopilotCommandShellDialect = "powershell",
): string {
  if (!isSafeCopilotResumeSessionId(copilotSessionId)) {
    throw new Error("Copilot resume session id contains unsupported characters.");
  }
  const args = [
    ...cliArgs,
    `--resume=${copilotSessionId}`,
  ];
  return `copilot ${args.map((arg) => quoteCopilotShellLiteral(arg, shellDialect)).join(" ")}`;
}

export function buildCopilotResumePosixCommand(
  copilotSessionId: string,
  cliArgs: readonly string[] = [],
): string {
  return buildCopilotResumeCommand(copilotSessionId, cliArgs, "posix");
}
