import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { Router } from "express";

export interface PawReviewPromptTemplate {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

interface ReviewPromptTemplateDocument {
  version: 1;
  templates: PawReviewPromptTemplate[];
}

const MAX_TEMPLATE_NAME_LENGTH = 120;
const MAX_TEMPLATE_PROMPT_LENGTH = 50_000;

function defaultTemplatesPath(): string {
  const stateRoot = resolve(process.env.STREAMLINER_STATE_ROOT ?? join(homedir(), ".streamliner", "state"));
  return join(stateRoot, "paw-review-prompt-templates.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTemplateName(value: unknown): string {
  if (typeof value !== "string") {
    throw Object.assign(new Error("Review prompt template name is required."), { statusCode: 400 });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw Object.assign(new Error("Review prompt template name is required."), { statusCode: 400 });
  }
  if (trimmed.length > MAX_TEMPLATE_NAME_LENGTH) {
    throw Object.assign(new Error(`Review prompt template name must be ${MAX_TEMPLATE_NAME_LENGTH} characters or less.`), { statusCode: 400 });
  }
  return trimmed;
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== "string") {
    throw Object.assign(new Error("Review prompt template text is required."), { statusCode: 400 });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw Object.assign(new Error("Review prompt template text is required."), { statusCode: 400 });
  }
  if (trimmed.length > MAX_TEMPLATE_PROMPT_LENGTH) {
    throw Object.assign(new Error(`Review prompt template text must be ${MAX_TEMPLATE_PROMPT_LENGTH} characters or less.`), { statusCode: 400 });
  }
  return trimmed;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "template";
}

function templateNameKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findTemplateByName(
  templates: PawReviewPromptTemplate[],
  name: string,
  exceptId?: string,
): PawReviewPromptTemplate | undefined {
  const key = templateNameKey(name);
  return templates.find((template) =>
    template.id !== exceptId && templateNameKey(template.name) === key
  );
}

function templateUpdatedAtMs(template: PawReviewPromptTemplate): number {
  const parsed = Date.parse(template.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dedupeTemplatesByName(templates: PawReviewPromptTemplate[]): PawReviewPromptTemplate[] {
  const byName = new Map<string, PawReviewPromptTemplate>();
  for (const template of templates) {
    const key = templateNameKey(template.name);
    const existing = byName.get(key);
    if (!existing || templateUpdatedAtMs(template) >= templateUpdatedAtMs(existing)) {
      byName.set(key, template);
    }
  }
  return [...byName.values()];
}

function uniqueTemplateId(name: string, templates: PawReviewPromptTemplate[]): string {
  const base = slugify(name);
  const used = new Set(templates.map((template) => template.id));
  if (!used.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not allocate a unique review prompt template id.");
}

async function readDocument(path: string): Promise<ReviewPromptTemplateDocument> {
  if (!existsSync(path)) {
    return { version: 1, templates: [] };
  }
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.templates)) {
    throw Object.assign(new Error("Review prompt template store is malformed."), { statusCode: 500 });
  }
  return {
    version: 1,
    templates: dedupeTemplatesByName(parsed.templates.filter(isRecord).map((template) => ({
      id: typeof template.id === "string" ? template.id : "",
      name: typeof template.name === "string" ? template.name : "",
      prompt: typeof template.prompt === "string" ? template.prompt : "",
      createdAt: typeof template.createdAt === "string" ? template.createdAt : new Date(0).toISOString(),
      updatedAt: typeof template.updatedAt === "string" ? template.updatedAt : new Date(0).toISOString(),
    })).filter((template) => template.id && template.name && template.prompt)),
  };
}

async function writeDocument(path: string, document: ReviewPromptTemplateDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export function createPawReviewPromptTemplatesRouter(options: {
  templatesPath?: string;
} = {}): Router {
  const router = Router();
  const templatesPath = options.templatesPath ?? defaultTemplatesPath();

  router.get("/paw-review-prompt-templates", async (_req, res, next) => {
    try {
      const document = await readDocument(templatesPath);
      res.set("Cache-Control", "no-store");
      res.json({
        templates: [...document.templates].sort((left, right) => left.name.localeCompare(right.name)),
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  router.post("/paw-review-prompt-templates", async (req, res, next) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      const now = new Date().toISOString();
      const document = await readDocument(templatesPath);
      const name = normalizeTemplateName(body.name);
      const duplicate = findTemplateByName(document.templates, name);
      if (duplicate) {
        res.status(409).json({
          code: "review_prompt_template_name_conflict",
          error: `A review prompt template named "${duplicate.name}" already exists.`,
          template: duplicate,
        });
        return;
      }
      const template: PawReviewPromptTemplate = {
        id: uniqueTemplateId(name, document.templates),
        name,
        prompt: normalizePrompt(body.prompt),
        createdAt: now,
        updatedAt: now,
      };
      document.templates.push(template);
      await writeDocument(templatesPath, document);
      res.status(201).json({ template });
    } catch (error: unknown) {
      next(error);
    }
  });

  router.put("/paw-review-prompt-templates/:id", async (req, res, next) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      const document = await readDocument(templatesPath);
      const index = document.templates.findIndex((template) => template.id === req.params.id);
      if (index === -1) {
        res.status(404).json({ code: "review_prompt_template_not_found", error: "Review prompt template not found." });
        return;
      }
      const current = document.templates[index];
      const name = normalizeTemplateName(body.name ?? current.name);
      const duplicate = findTemplateByName(document.templates, name, current.id);
      if (duplicate) {
        res.status(409).json({
          code: "review_prompt_template_name_conflict",
          error: `A review prompt template named "${duplicate.name}" already exists.`,
          template: duplicate,
        });
        return;
      }
      const updated: PawReviewPromptTemplate = {
        ...current,
        name,
        prompt: normalizePrompt(body.prompt ?? current.prompt),
        updatedAt: new Date().toISOString(),
      };
      document.templates[index] = updated;
      await writeDocument(templatesPath, document);
      res.json({ template: updated });
    } catch (error: unknown) {
      next(error);
    }
  });

  router.delete("/paw-review-prompt-templates/:id", async (req, res, next) => {
    try {
      const document = await readDocument(templatesPath);
      const nextTemplates = document.templates.filter((template) => template.id !== req.params.id);
      if (nextTemplates.length === document.templates.length) {
        res.status(404).json({ code: "review_prompt_template_not_found", error: "Review prompt template not found." });
        return;
      }
      await writeDocument(templatesPath, {
        ...document,
        templates: nextTemplates,
      });
      res.status(204).end();
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
