import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { GithubStatusRef } from "../github-status";

export interface GithubAuthProfile {
  ghConfigDir?: string;
  user?: string;
  hostname?: string;
}

export interface GithubAuthSettings {
  profiles: Record<string, GithubAuthProfile>;
  repositories: Record<string, GithubAuthProfile | string>;
}

const GITHUB_AUTH_CONFIG_ENV = "STREAMLINER_GITHUB_AUTH_CONFIG";

function defaultStateRoot(): string {
  return resolve(process.env.STREAMLINER_STATE_ROOT ?? join(homedir(), ".streamliner", "state"));
}

export function defaultGithubAuthSettingsPath(): string {
  return process.env[GITHUB_AUTH_CONFIG_ENV] ?? join(defaultStateRoot(), "github-auth.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function normalizedOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeProfile(value: unknown): GithubAuthProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const profile: GithubAuthProfile = {};
  const ghConfigDir = normalizedOptionalString(value.ghConfigDir);
  const user = normalizedOptionalString(value.user);
  const hostname = normalizedOptionalString(value.hostname);
  if (ghConfigDir) {
    profile.ghConfigDir = ghConfigDir;
  }
  if (user) {
    profile.user = user;
  }
  if (hostname) {
    profile.hostname = hostname;
  }
  return Object.keys(profile).length > 0 ? profile : {};
}

function normalizeProfileMap(value: unknown): Record<string, GithubAuthProfile> {
  if (!isRecord(value)) {
    return {};
  }
  const profiles: Record<string, GithubAuthProfile> = {};
  for (const [key, profileValue] of Object.entries(value)) {
    const profile = normalizeProfile(profileValue);
    if (profile) {
      profiles[key.trim()] = profile;
    }
  }
  return profiles;
}

function normalizeRepositoryMap(
  value: unknown,
): Record<string, GithubAuthProfile | string> {
  if (!isRecord(value)) {
    return {};
  }
  const repositories: Record<string, GithubAuthProfile | string> = {};
  for (const [key, profileValue] of Object.entries(value)) {
    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey) {
      continue;
    }
    const profileName = normalizedOptionalString(profileValue);
    if (profileName) {
      repositories[normalizedKey] = profileName;
      continue;
    }
    const profile = normalizeProfile(profileValue);
    if (profile) {
      repositories[normalizedKey] = profile;
    }
  }
  return repositories;
}

function normalizeSettings(value: unknown): GithubAuthSettings {
  if (!isRecord(value)) {
    return { profiles: {}, repositories: {} };
  }
  return {
    profiles: normalizeProfileMap(value.profiles),
    repositories: normalizeRepositoryMap(value.repositories),
  };
}

export async function readGithubAuthSettings(
  path = defaultGithubAuthSettingsPath(),
): Promise<GithubAuthSettings> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return normalizeSettings(parsed);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return { profiles: {}, repositories: {} };
    }
    throw error;
  }
}

function repositoryKeys(ref: GithubStatusRef): string[] {
  const owner = ref.owner.toLowerCase();
  const repo = ref.repo.toLowerCase();
  return [
    `github.com/${owner}/${repo}`,
    `github.com/${owner}/*`,
    "github.com/*",
  ];
}

export function resolveGithubAuthProfile(
  ref: GithubStatusRef,
  settings: GithubAuthSettings,
): GithubAuthProfile | null {
  for (const key of repositoryKeys(ref)) {
    const entry = settings.repositories[key];
    if (!entry) {
      continue;
    }
    if (typeof entry === "string") {
      return settings.profiles[entry] ?? null;
    }
    return entry;
  }
  return null;
}
