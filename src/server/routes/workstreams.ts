import { Router } from "express";

import {
  deleteRegisteredWorkstream,
  listRegisteredWorkstreams,
  readRegisteredGraph,
  registerWorkstreamPath,
  registeredEntryWithStatus,
  relinkRegisteredWorkstream,
  type WorkstreamRegistryOptions,
} from "../workstream-registry";

function requestPath(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const path = (body as { path?: unknown }).path;
  return typeof path === "string" && path.trim().length > 0 ? path : null;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as Error & { code?: string }).code : undefined;
}

function sendRegistryError(res: {
  status: (code: number) => { json: (body: unknown) => void };
}, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  switch (errorCode(error)) {
    case "EEXIST":
      res.status(409).json({ code: "workstream_identity_conflict", error: message });
      return;
    case "EIDMISMATCH":
      res.status(409).json({ code: "workstream_identity_mismatch", error: message });
      return;
    case "ENOENT":
      res.status(404).json({ code: "workstream_not_found", error: message });
      return;
    case "EINVAL":
      res.status(400).json({ code: "invalid_workstream_identity", error: message });
      return;
    default:
      res.status(500).json({ error: message });
  }
}

export function createWorkstreamsRouter(options: WorkstreamRegistryOptions = {}): Router {
  const router = Router();

  router.get("/workstreams", async (_req, res) => {
    try {
      const { registry, workstreams } = await listRegisteredWorkstreams(options);
      res.json({
        version: registry.version,
        migratedFromRecentsAt: registry.migratedFromRecentsAt,
        migrationWarnings: registry.migrationWarnings,
        workstreams,
      });
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  router.post("/workstreams", async (req, res) => {
    const path = requestPath(req.body);
    if (!path) {
      res.status(400).json({ code: "path_required", error: "Expected request body to include a graph path." });
      return;
    }

    try {
      const entry = await registerWorkstreamPath(path, options);
      res.status(201).json({ workstream: await registeredEntryWithStatus(entry) });
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  router.get("/workstreams/:projectKey/:workstreamId/graph", async (req, res) => {
    const { projectKey, workstreamId } = req.params;
    try {
      const ifModifiedSince = req.header("if-modified-since");
      const graph = await readRegisteredGraph(
        projectKey,
        workstreamId,
        options,
        ifModifiedSince,
      );
      if (graph.notModified) {
        res.status(304).end();
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Last-Modified", graph.lastModified);
      res.setHeader("Cache-Control", "no-cache");
      res.status(200).send(graph.content);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (errorCode(error) === "ENOTREGISTERED") {
        res.status(404).json({ code: "workstream_not_found", error: message });
        return;
      }
      if (errorCode(error) === "ENOENT") {
        res.status(404).json({ code: "workstream_file_missing", error: message });
        return;
      }
      if (errorCode(error) === "EINVAL") {
        res.status(400).json({ code: "invalid_workstream_identity", error: message });
        return;
      }
      if (errorCode(error) === "EINVALIDGRAPH") {
        res.status(422).json({ code: "workstream_graph_invalid", error: message });
        return;
      }
      res.status(500).json({ code: "workstream_file_unreadable", error: message });
    }
  });

  router.patch("/workstreams/:projectKey/:workstreamId", async (req, res) => {
    const path = requestPath(req.body);
    if (!path) {
      res.status(400).json({ code: "path_required", error: "Expected request body to include a graph path." });
      return;
    }

    try {
      const entry = await relinkRegisteredWorkstream(
        req.params.projectKey,
        req.params.workstreamId,
        path,
        options,
      );
      res.json({ workstream: await registeredEntryWithStatus(entry) });
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  router.delete("/workstreams/:projectKey/:workstreamId", async (req, res) => {
    try {
      const deleted = await deleteRegisteredWorkstream(
        req.params.projectKey,
        req.params.workstreamId,
        options,
      );
      if (!deleted) {
        res.status(404).json({ code: "workstream_not_found", error: "Workstream is not registered." });
        return;
      }
      res.status(204).end();
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  return router;
}
