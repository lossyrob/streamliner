#!/usr/bin/env node
/**
 * Refresh the locally-installed Streamliner Copilot CLI plugin from the
 * worktree. The plugin is normally installed via `copilot /plugin install`
 * which copies files into ~/.copilot/installed-plugins/<marketplace>/<plugin>/.
 * That cached copy does NOT auto-update when worktree files change, so
 * iterating on hook scripts requires either reinstalling the plugin or
 * overwriting the cached files. This script does the second.
 *
 * Usage:
 *   npm run refresh-copilot-plugin
 *
 * Reads ~/.copilot/config.json to find the streamliner plugin's cache_path,
 * then copies copilot-plugin/streamliner/* into it.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_SOURCE = join(REPO_ROOT, "copilot-plugin", "streamliner");

function readCopilotConfig() {
  const path = join(homedir(), ".copilot", "config.json");
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf8");
    // Copilot config is JSONC — strip line comments and block comments before parsing.
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(stripped);
  } catch (error) {
    console.error(`Could not parse ${path}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

function findStreamlinerCachePath(config) {
  if (!config?.installedPlugins) {
    return null;
  }
  const entry = config.installedPlugins.find(
    (plugin) => plugin.name === "streamliner" && typeof plugin.cache_path === "string",
  );
  return entry?.cache_path ?? null;
}

function copyDirRecursive(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const src = join(srcDir, name);
    const dst = join(dstDir, name);
    if (statSync(src).isDirectory()) {
      copyDirRecursive(src, dst);
    } else {
      copyFileSync(src, dst);
    }
  }
}

function main() {
  if (!existsSync(PLUGIN_SOURCE)) {
    console.error(`Plugin source not found at ${PLUGIN_SOURCE}`);
    process.exit(1);
  }

  const config = readCopilotConfig();
  if (!config) {
    console.error(
      "Streamliner plugin is not installed yet. Install it from this repo via the Copilot CLI plugin command first.",
    );
    process.exit(1);
  }

  const cachePath = findStreamlinerCachePath(config);
  if (!cachePath) {
    console.error(
      "Could not find an installed 'streamliner' plugin in ~/.copilot/config.json. Install it first.",
    );
    process.exit(1);
  }

  console.log(`Source:      ${PLUGIN_SOURCE}`);
  console.log(`Destination: ${cachePath}`);
  copyDirRecursive(PLUGIN_SOURCE, cachePath);
  console.log("Plugin refreshed. New Copilot CLI sessions will use the updated scripts.");
}

main();
