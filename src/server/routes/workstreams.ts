import { Router } from "express";

import {
  archiveWorkstreamIdentity,
  combineWorkstreamCandidates,
  addWorkstreamSource,
  deleteWorkstreamSource,
  readSourceWorkstreamGraph,
  restoreWorkstreamIdentity,
  scanWorkstreamSources,
  type WorkstreamSourceAddRequest,
} from "../workstream-sources";
import {
  deleteRegisteredWorkstream,
  listRegisteredWorkstreams,
  readRegisteredGraph,
  registerWorkstreamPath,
  registeredEntryWithStatus,
  relinkRegisteredWorkstream,
  type WorkstreamRegistryOptions,
} from "../workstream-registry";
import {
  updateWorkstreamConfigurationFile,
  type WorkstreamConfigurationUpdateInput,
} from "../workstream-configuration";
import {
  readWorkstreamPositions,
  writeWorkstreamPositions,
} from "../workstream-positions";
import type { WorkstreamSourceType } from "../../workstream-registry-contract";

function requestPath(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const path = (body as { path?: unknown }).path;
  return typeof path === "string" && path.trim().length > 0 ? path : null;
}

function requestSource(body: unknown): WorkstreamSourceAddRequest | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const path = (body as { path?: unknown }).path;
  const type = (body as { type?: unknown }).type;
  if (typeof path !== "string" || path.trim().length === 0) {
    return null;
  }
  if (type !== "project-root" && type !== "workstreams-root") {
    return null;
  }
  return { path, type: type as WorkstreamSourceType };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function requestConfiguration(body: unknown): WorkstreamConfigurationUpdateInput | null {
  if (!isRecord(body)) {
    return null;
  }
  const configuration: WorkstreamConfigurationUpdateInput = {};
  let hasConfigurationField = false;
  if (hasOwn(body, "launchPolicy")) {
    hasConfigurationField = true;
    configuration.launchPolicy = body.launchPolicy as WorkstreamConfigurationUpdateInput["launchPolicy"];
  }
  if (hasOwn(body, "launchDefaults")) {
    hasConfigurationField = true;
    configuration.launchDefaults = body.launchDefaults as WorkstreamConfigurationUpdateInput["launchDefaults"];
  }
  return hasConfigurationField ? configuration : null;
}

function requestPositions(body: unknown): unknown | null {
  if (!isRecord(body) || !hasOwn(body, "positions")) {
    return null;
  }
  return body.positions;
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
    case "EINVALIDCONFIG":
      res.status(400).json({ code: "invalid_workstream_configuration", error: message });
      return;
    case "EINVALIDGRAPH":
      res.status(422).json({ code: "workstream_graph_invalid", error: message });
      return;
    case "ENOTDIR":
      res.status(400).json({ code: "source_path_not_directory", error: message });
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
      const combined = await combineWorkstreamCandidates(workstreams, options);
      res.json({
        version: registry.version,
        migratedFromRecentsAt: registry.migratedFromRecentsAt,
        migrationWarnings: registry.migrationWarnings,
        ...combined,
      });
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  router.post("/workstream-sources", async (req, res) => {
    const sourceRequest = requestSource(req.body);
    if (!sourceRequest) {
      res.status(400).json({
        code: "source_required",
        error: "Expected request body to include a source type and path.",
      });
      return;
    }

    try {
      const source = await addWorkstreamSource(sourceRequest, options);
      const { registry, workstreams } = await listRegisteredWorkstreams(options);
      const combined = await combineWorkstreamCandidates(workstreams, options);
      res.status(201).json({
        version: registry.version,
        migratedFromRecentsAt: registry.migratedFromRecentsAt,
        migrationWarnings: registry.migrationWarnings,
        source,
        ...combined,
      });
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  router.post("/workstream-sources/refresh", async (_req, res) => {
    try {
      await scanWorkstreamSources(options);
      const { registry, workstreams } = await listRegisteredWorkstreams(options);
      res.json({
        version: registry.version,
        migratedFromRecentsAt: registry.migratedFromRecentsAt,
        migrationWarnings: registry.migrationWarnings,
        ...(await combineWorkstreamCandidates(workstreams, options)),
      });
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  router.delete("/workstream-sources/:sourceId", async (req, res) => {
    try {
      const deleted = await deleteWorkstreamSource(req.params.sourceId, options);
      if (!deleted) {
        res.status(404).json({ code: "source_not_found", error: "Workstream source is not registered." });
        return;
      }
      res.status(204).end();
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
      let graph: Awaited<ReturnType<typeof readRegisteredGraph>>;
      try {
        graph = await readRegisteredGraph(
          projectKey,
          workstreamId,
          options,
          ifModifiedSince,
        );
      } catch (error: unknown) {
        if (errorCode(error) !== "ENOTREGISTERED") {
          throw error;
        }
        graph = await readSourceWorkstreamGraph(
          projectKey,
          workstreamId,
          options,
          ifModifiedSince,
        );
      }
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

  async function assertReadableWorkstream(projectKey: string, workstreamId: string): Promise<void> {
    try {
      await readRegisteredGraph(projectKey, workstreamId, options);
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOTREGISTERED") {
        throw error;
      }
      await readSourceWorkstreamGraph(projectKey, workstreamId, options);
    }
  }

  router.get("/workstreams/:projectKey/:workstreamId/positions", async (req, res) => {
    const { projectKey, workstreamId } = req.params;
    try {
      await assertReadableWorkstream(projectKey, workstreamId);
      const document = await readWorkstreamPositions(projectKey, workstreamId, options);
      res.setHeader("Cache-Control", "no-cache");
      res.json(document);
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  router.put("/workstreams/:projectKey/:workstreamId/positions", async (req, res) => {
    const positions = requestPositions(req.body);
    if (positions === null) {
      res.status(400).json({
        code: "positions_required",
        error: "Expected request body to include positions.",
      });
      return;
    }

    const { projectKey, workstreamId } = req.params;
    try {
      await assertReadableWorkstream(projectKey, workstreamId);
      const document = await writeWorkstreamPositions(
        projectKey,
        workstreamId,
        positions,
        options,
      );
      res.json({
        ...document,
        savedAt: (options.now?.() ?? new Date()).toISOString(),
      });
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  router.patch("/workstreams/:projectKey/:workstreamId/configuration", async (req, res) => {
    const configuration = requestConfiguration(req.body);
    if (!configuration) {
      res.status(400).json({
        code: "configuration_required",
        error: "Expected request body to include workstream configuration fields.",
      });
      return;
    }

    const { projectKey, workstreamId } = req.params;
    try {
      let graph: Awaited<ReturnType<typeof readRegisteredGraph>>;
      try {
        graph = await readRegisteredGraph(projectKey, workstreamId, options);
      } catch (error: unknown) {
        if (errorCode(error) !== "ENOTREGISTERED") {
          throw error;
        }
        graph = await readSourceWorkstreamGraph(projectKey, workstreamId, options);
      }
      const result = await updateWorkstreamConfigurationFile({
        graphPath: graph.entry.path,
        content: graph.content ?? "",
        projectKey,
        workstreamId,
        configuration,
        now: options.now,
      });
      res.setHeader("Last-Modified", result.lastModified);
      res.json({ workstream: result.workstream });
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  router.post("/workstreams/:projectKey/:workstreamId/archive", async (req, res) => {
    try {
      await archiveWorkstreamIdentity(req.params.projectKey, req.params.workstreamId, options);
      const { registry, workstreams } = await listRegisteredWorkstreams(options);
      res.json({
        version: registry.version,
        migratedFromRecentsAt: registry.migratedFromRecentsAt,
        migrationWarnings: registry.migrationWarnings,
        ...(await combineWorkstreamCandidates(workstreams, options)),
      });
    } catch (error: unknown) {
      sendRegistryError(res, error);
    }
  });

  router.delete("/workstreams/:projectKey/:workstreamId/archive", async (req, res) => {
    try {
      const restored = await restoreWorkstreamIdentity(req.params.projectKey, req.params.workstreamId, options);
      if (!restored) {
        res.status(404).json({ code: "workstream_archive_not_found", error: "Workstream is not archived." });
        return;
      }
      const { registry, workstreams } = await listRegisteredWorkstreams(options);
      res.json({
        version: registry.version,
        migratedFromRecentsAt: registry.migratedFromRecentsAt,
        migrationWarnings: registry.migrationWarnings,
        ...(await combineWorkstreamCandidates(workstreams, options)),
      });
    } catch (error: unknown) {
      sendRegistryError(res, error);
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
