import { Router } from "express";

import type { WorkstreamRegistryEntry } from "../../workstream-registry-contract";
import {
  isEventKind,
  isSeverity,
  validateToastLink,
  type NotificationCreateResponse,
  type NotificationGetResponse,
  type NotificationListResponse,
  type NotificationRequest,
} from "../../notification-contract";
import { loadWorkstreamRegistry } from "../workstream-registry";
import { resolveDashboardBaseUrl } from "../notification-config";
import { enrichNotification } from "../notification-enrichment";
import type { NotificationEventStream } from "../notification-events";
import type { NotificationStore } from "../notification-store";

export interface NotificationsRouteDeps {
  store: NotificationStore;
  eventStream: NotificationEventStream;
  /** Override the registry source (tests). Defaults to the workstream registry. */
  loadWorkstreams?: () => Promise<WorkstreamRegistryEntry[]>;
  workstreamRegistryPath?: string;
  dashboardBaseUrl?: string;
}

interface ValidationError {
  code: string;
  error: string;
}

function badRequest(code: string, error: string): ValidationError {
  return { code, error };
}

function validateRequest(body: unknown): NotificationRequest | ValidationError {
  if (!body || typeof body !== "object") {
    return badRequest("invalid_body", "Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;

  const title = record.title;
  if (typeof title !== "string" || title.trim().length === 0) {
    return badRequest("invalid_title", "`title` is required and must be a non-empty string.");
  }
  const bodyText = record.body;
  if (typeof bodyText !== "string" || bodyText.trim().length === 0) {
    return badRequest("invalid_body_text", "`body` is required and must be a non-empty string.");
  }

  if (record.severity !== undefined && !isSeverity(record.severity)) {
    return badRequest("invalid_severity", "`severity` must be one of info, warn, error.");
  }
  if (record.eventKind !== undefined && !isEventKind(record.eventKind)) {
    return badRequest(
      "invalid_event_kind",
      "`eventKind` must be one of online, pr-created, pr-approved, issue-closed, reconciled, done, generic.",
    );
  }

  const optionalStrings: Array<keyof NotificationRequest> = [
    "workstreamId",
    "projectKey",
    "nodeId",
    "sessionId",
    "source",
  ];
  for (const key of optionalStrings) {
    if (record[key] !== undefined && typeof record[key] !== "string") {
      return badRequest("invalid_field", `\`${key}\` must be a string.`);
    }
  }

  let link: string | undefined;
  if (record.link !== undefined) {
    if (typeof record.link !== "string") {
      return badRequest("invalid_link", "`link` must be a string.");
    }
    if (record.link.trim().length > 0) {
      const validation = validateToastLink(record.link);
      if (!validation.ok) {
        return badRequest("invalid_link", validation.reason);
      }
      link = validation.url;
    }
  }

  const request: NotificationRequest = {
    title,
    body: bodyText,
    ...(isSeverity(record.severity) ? { severity: record.severity } : {}),
    ...(isEventKind(record.eventKind) ? { eventKind: record.eventKind } : {}),
    ...(typeof record.workstreamId === "string" ? { workstreamId: record.workstreamId } : {}),
    ...(typeof record.projectKey === "string" ? { projectKey: record.projectKey } : {}),
    ...(typeof record.nodeId === "string" ? { nodeId: record.nodeId } : {}),
    ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
    ...(typeof record.source === "string" ? { source: record.source } : {}),
    ...(link !== undefined ? { link } : {}),
  };
  return request;
}

function isValidationError(value: unknown): value is ValidationError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "error" in value
  );
}

export function createNotificationsRouter(deps: NotificationsRouteDeps): Router {
  const router = Router();
  const loadWorkstreams = deps.loadWorkstreams
    ?? (async () => {
      const registry = await loadWorkstreamRegistry(
        deps.workstreamRegistryPath ? { registryPath: deps.workstreamRegistryPath } : {},
      );
      return registry.workstreams;
    });

  router.post("/notifications", (req, res, next) => {
    void (async () => {
      const validated = validateRequest(req.body);
      if (isValidationError(validated)) {
        res.status(400).json(validated);
        return;
      }

      let workstreams: WorkstreamRegistryEntry[] = [];
      try {
        workstreams = await loadWorkstreams();
      } catch {
        // Enrichment is best-effort; proceed with no registry data.
        workstreams = [];
      }

      const dashboardBaseUrl = deps.dashboardBaseUrl ?? resolveDashboardBaseUrl();
      const { draft, warnings } = enrichNotification(validated, {
        workstreams,
        dashboardBaseUrl,
      });

      // Persist before publishing so a crash can never emit an event that is
      // absent from the snapshot/backfill.
      const record = await deps.store.append(draft);
      deps.eventStream.publish(record);

      const response: NotificationCreateResponse = {
        notification: record,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
      res.status(201).json(response);
    })().catch(next);
  });

  router.get("/notifications", (req, res, next) => {
    void (async () => {
      const afterIdRaw = req.query.afterId;
      const limitRaw = req.query.limit;
      let afterId: number | null = null;
      if (afterIdRaw !== undefined) {
        const parsed = Number(afterIdRaw);
        if (!Number.isInteger(parsed) || parsed < 0) {
          res.status(400).json(badRequest("invalid_after_id", "`afterId` must be a non-negative integer."));
          return;
        }
        afterId = parsed;
      }
      let limit: number | undefined;
      if (limitRaw !== undefined) {
        const parsed = Number(limitRaw);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          res.status(400).json(badRequest("invalid_limit", "`limit` must be a positive integer."));
          return;
        }
        limit = parsed;
      }

      const notifications = afterId !== null
        ? await deps.store.listSince(afterId, limit)
        : await deps.store.listRecent(limit ?? 100);
      const response: NotificationListResponse = { notifications };
      res.json(response);
    })().catch(next);
  });

  // Digit-only guard (Express 5 / path-to-regexp 8 has no inline regex params):
  // a non-numeric segment falls through via next() so this never shadows the
  // literal `/notifications/events` SSE route (which is also mounted earlier in
  // the real app). Used by desktop protocol activation to resolve <id> -> link.
  router.get("/notifications/:id", (req, res, next) => {
    void (async () => {
      const raw = req.params.id;
      if (!/^\d+$/.test(raw)) {
        next();
        return;
      }
      const id = Number(raw);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json(badRequest("invalid_id", "`id` must be a positive integer."));
        return;
      }
      const notification = await deps.store.get(id);
      if (!notification) {
        res.status(404).json(badRequest("not_found", `No notification with id ${id}.`));
        return;
      }
      const response: NotificationGetResponse = { notification };
      res.json(response);
    })().catch(next);
  });

  return router;
}
