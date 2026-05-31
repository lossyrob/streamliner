#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";

import { runNotify } from "./commands/notify";

type CommandHandler = (argv: string[]) => Promise<number> | number;

const commands: Record<string, CommandHandler> = {
  notify: runNotify,
};

function usage(): string {
  const commandList = Object.keys(commands)
    .map((command) => `  ${command}`)
    .join("\n");
  return `Usage: streamliner <command> [options]\n\nCommands:\n${commandList}\n`;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [commandName, ...commandArgs] = argv;
  if (commandName === undefined || commands[commandName] === undefined) {
    process.stderr.write(usage());
    return 1;
  }
  return commands[commandName](commandArgs);
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    },
  );
}
