import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LoadDotEnvFileOptions {
  path?: string;
  env?: NodeJS.ProcessEnv;
}

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === "\"" || quote === "'") && trimmed[trimmed.length - 1] === quote) {
      const unquoted = trimmed.slice(1, -1);
      return quote === "\""
        ? unquoted
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, "\"")
          .replace(/\\\\/g, "\\")
        : unquoted;
    }
  }
  return trimmed;
}

export function loadDotEnvFile(options: LoadDotEnvFileOptions = {}): void {
  const envPath = resolve(options.path ?? ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const env = options.env ?? process.env;
  const content = readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || env[key] !== undefined) {
      continue;
    }
    env[key] = parseEnvValue(normalized.slice(equalsIndex + 1));
  }
}
