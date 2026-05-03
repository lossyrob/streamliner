import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { Router } from "express";

const MAX_WORKFLOW_CONTEXT_LENGTH = 200_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent).toLowerCase();
  const normalizedChild = resolve(child).toLowerCase();
  const relativePath = relative(normalizedParent, normalizedChild);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function resolveWorkflowContextPath(value: unknown, root: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error("WorkflowContext path is required."), { statusCode: 400 });
  }
  const resolved = resolve(value);
  if (basename(resolved) !== "WorkflowContext.md" || !isPathInside(root, resolved)) {
    throw Object.assign(new Error("WorkflowContext path must be a WorkflowContext.md file under .paw/work."), { statusCode: 400 });
  }
  return resolved;
}

function normalizeContent(value: unknown): string {
  if (typeof value !== "string") {
    throw Object.assign(new Error("WorkflowContext content is required."), { statusCode: 400 });
  }
  if (value.length > MAX_WORKFLOW_CONTEXT_LENGTH) {
    throw Object.assign(new Error(`WorkflowContext content must be ${MAX_WORKFLOW_CONTEXT_LENGTH} characters or less.`), { statusCode: 400 });
  }
  return value;
}

async function workflowContextResponse(path: string): Promise<{
  path: string;
  content: string;
  updatedAt: string;
}> {
  if (!existsSync(path)) {
    throw Object.assign(new Error("WorkflowContext.md was not found."), { statusCode: 404 });
  }
  const [content, stats] = await Promise.all([
    readFile(path, "utf8"),
    stat(path),
  ]);
  return {
    path,
    content,
    updatedAt: stats.mtime.toISOString(),
  };
}

export function createPawWorkflowContextRouter(options: {
  pawWorkRoot?: string;
} = {}): Router {
  const router = Router();
  const pawWorkRoot = resolve(options.pawWorkRoot ?? join(process.cwd(), ".paw", "work"));

  router.get("/paw-workflow-context", async (req, res, next) => {
    try {
      const path = resolveWorkflowContextPath(req.query.path, pawWorkRoot);
      res.json(await workflowContextResponse(path));
    } catch (error: unknown) {
      next(error);
    }
  });

  router.put("/paw-workflow-context", async (req, res, next) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      const path = resolveWorkflowContextPath(body.path, pawWorkRoot);
      const content = normalizeContent(body.content);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
      res.json(await workflowContextResponse(path));
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
