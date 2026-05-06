import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { Router } from "express";

export interface PawLaunchPromptProfile {
  id: string;
  name: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

interface PromptProfileDocument {
  version: 1;
  profiles: PawLaunchPromptProfile[];
}

const MAX_PROFILE_NAME_LENGTH = 120;
const MAX_PROFILE_INSTRUCTIONS_LENGTH = 50_000;

function defaultProfilesPath(): string {
  const stateRoot = resolve(process.env.STREAMLINER_STATE_ROOT ?? join(homedir(), ".streamliner", "state"));
  return join(stateRoot, "paw-launch-prompt-profiles.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProfileName(value: unknown): string {
  if (typeof value !== "string") {
    throw Object.assign(new Error("Profile name is required."), { statusCode: 400 });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw Object.assign(new Error("Profile name is required."), { statusCode: 400 });
  }
  if (trimmed.length > MAX_PROFILE_NAME_LENGTH) {
    throw Object.assign(new Error(`Profile name must be ${MAX_PROFILE_NAME_LENGTH} characters or less.`), { statusCode: 400 });
  }
  return trimmed;
}

function normalizeInstructions(value: unknown): string {
  if (typeof value !== "string") {
    throw Object.assign(new Error("Profile instructions are required."), { statusCode: 400 });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw Object.assign(new Error("Profile instructions are required."), { statusCode: 400 });
  }
  if (trimmed.length > MAX_PROFILE_INSTRUCTIONS_LENGTH) {
    throw Object.assign(new Error(`Profile instructions must be ${MAX_PROFILE_INSTRUCTIONS_LENGTH} characters or less.`), { statusCode: 400 });
  }
  return trimmed;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}

function profileNameKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findProfileByName(
  profiles: PawLaunchPromptProfile[],
  name: string,
  exceptId?: string,
): PawLaunchPromptProfile | undefined {
  const key = profileNameKey(name);
  return profiles.find((profile) =>
    profile.id !== exceptId && profileNameKey(profile.name) === key
  );
}

function profileUpdatedAtMs(profile: PawLaunchPromptProfile): number {
  const parsed = Date.parse(profile.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dedupeProfilesByName(profiles: PawLaunchPromptProfile[]): PawLaunchPromptProfile[] {
  const byName = new Map<string, PawLaunchPromptProfile>();
  for (const profile of profiles) {
    const key = profileNameKey(profile.name);
    const existing = byName.get(key);
    if (!existing || profileUpdatedAtMs(profile) >= profileUpdatedAtMs(existing)) {
      byName.set(key, profile);
    }
  }
  return [...byName.values()];
}

function uniqueProfileId(name: string, profiles: PawLaunchPromptProfile[]): string {
  const base = slugify(name);
  const used = new Set(profiles.map((profile) => profile.id));
  if (!used.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not allocate a unique profile id.");
}

async function readDocument(path: string): Promise<PromptProfileDocument> {
  if (!existsSync(path)) {
    return { version: 1, profiles: [] };
  }
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.profiles)) {
    throw Object.assign(new Error("Prompt profile store is malformed."), { statusCode: 500 });
  }
  return {
    version: 1,
    profiles: dedupeProfilesByName(parsed.profiles.filter(isRecord).map((profile) => ({
      id: typeof profile.id === "string" ? profile.id : "",
      name: typeof profile.name === "string" ? profile.name : "",
      instructions: typeof profile.instructions === "string" ? profile.instructions : "",
      createdAt: typeof profile.createdAt === "string" ? profile.createdAt : new Date(0).toISOString(),
      updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : new Date(0).toISOString(),
    })).filter((profile) => profile.id && profile.name && profile.instructions)),
  };
}

async function writeDocument(path: string, document: PromptProfileDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export function createPawLaunchPromptProfilesRouter(options: {
  profilesPath?: string;
} = {}): Router {
  const router = Router();
  const profilesPath = options.profilesPath ?? defaultProfilesPath();

  router.get("/paw-launch-prompt-profiles", async (_req, res, next) => {
    try {
      const document = await readDocument(profilesPath);
      res.set("Cache-Control", "no-store");
      res.json({
        profiles: [...document.profiles].sort((left, right) => left.name.localeCompare(right.name)),
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  router.post("/paw-launch-prompt-profiles", async (req, res, next) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      const now = new Date().toISOString();
      const document = await readDocument(profilesPath);
      const name = normalizeProfileName(body.name);
      const duplicate = findProfileByName(document.profiles, name);
      if (duplicate) {
        res.status(409).json({
          code: "prompt_profile_name_conflict",
          error: `A prompt profile named "${duplicate.name}" already exists.`,
          profile: duplicate,
        });
        return;
      }
      const profile: PawLaunchPromptProfile = {
        id: uniqueProfileId(name, document.profiles),
        name,
        instructions: normalizeInstructions(body.instructions),
        createdAt: now,
        updatedAt: now,
      };
      document.profiles.push(profile);
      await writeDocument(profilesPath, document);
      res.status(201).json({ profile });
    } catch (error: unknown) {
      next(error);
    }
  });

  router.put("/paw-launch-prompt-profiles/:id", async (req, res, next) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      const document = await readDocument(profilesPath);
      const index = document.profiles.findIndex((profile) => profile.id === req.params.id);
      if (index === -1) {
        res.status(404).json({ code: "prompt_profile_not_found", error: "Prompt profile not found." });
        return;
      }
      const current = document.profiles[index];
      const name = normalizeProfileName(body.name ?? current.name);
      const duplicate = findProfileByName(document.profiles, name, current.id);
      if (duplicate) {
        res.status(409).json({
          code: "prompt_profile_name_conflict",
          error: `A prompt profile named "${duplicate.name}" already exists.`,
          profile: duplicate,
        });
        return;
      }
      const updated: PawLaunchPromptProfile = {
        ...current,
        name,
        instructions: normalizeInstructions(body.instructions ?? current.instructions),
        updatedAt: new Date().toISOString(),
      };
      document.profiles[index] = updated;
      await writeDocument(profilesPath, document);
      res.json({ profile: updated });
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
