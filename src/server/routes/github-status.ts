import { Router } from "express";

import {
  type GithubStatusRef,
  parseGithubStatusRef,
} from "../../github-status";
import {
  createGithubStatusService,
  type GithubStatusService,
  type GithubStatusServiceOptions,
} from "../github-status-service";

export interface GithubStatusRouteOptions {
  service?: GithubStatusService;
  serviceOptions?: GithubStatusServiceOptions;
  now?: () => Date;
}

function refQueryValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function parseRefQuery(values: readonly string[]): {
  refs: GithubStatusRef[];
  invalid: string | null;
} {
  const refs: GithubStatusRef[] = [];
  for (const value of values) {
    const parsed = parseGithubStatusRef(value);
    if (!parsed) {
      return { refs: [], invalid: value };
    }
    refs.push(parsed);
  }
  return { refs, invalid: null };
}

export function createGithubStatusRouter(
  options: GithubStatusRouteOptions = {},
): Router {
  const router = Router();
  const service =
    options.service ?? createGithubStatusService(options.serviceOptions);
  const now = options.now ?? options.serviceOptions?.now ?? (() => new Date());

  router.get("/github/status", async (req, res) => {
    const parsed = parseRefQuery(refQueryValues(req.query.ref));
    if (parsed.invalid !== null) {
      res.status(400).json({
        code: "invalid_github_status_ref",
        error:
          "Expected each ref query parameter to use issue:owner/repo#number or pr:owner/repo#number.",
        ref: parsed.invalid,
      });
      return;
    }

    try {
      res.json({
        generatedAt: now().toISOString(),
        statuses: await service.getStatuses(parsed.refs),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
