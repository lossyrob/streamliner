import { Router } from "express";

import {
  handleSessionRegistryApiRequest,
  SESSION_REGISTRY_API_BASE_PATH,
} from "../../session-registry/http-api";
import { relaunchSession, type RelaunchDeps } from "../../session-registry/relaunch";
import type { SessionRegistryStore } from "../../session-registry-contract";
import { isLoopbackAddress } from "../config";
import { getApiLogger } from "../logger";
import { SessionRegistryEventStream } from "../session-events";

function hasNonLoopbackForwardedFor(value: string | string[] | undefined): boolean {
  if (!value) {
    return false;
  }
  const values = Array.isArray(value) ? value : value.split(",");
  return values.some((entry) => !isLoopbackAddress(entry.trim()));
}

function isNonLoopbackRequest(req: { socket: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> }): boolean {
  return (
    !isLoopbackAddress(req.socket.remoteAddress) ||
    hasNonLoopbackForwardedFor(req.headers["x-forwarded-for"])
  );
}

export function createSessionsRouter(options: {
  store: SessionRegistryStore;
  eventStream: SessionRegistryEventStream;
  relaunchDeps?: Partial<RelaunchDeps>;
}): Router {
  const router = Router();
  const signalsLogger = getApiLogger().withScope("signals");
  const relaunchLogger = getApiLogger().withScope("relaunch");

  router.get("/events", options.eventStream.handle);

  // Relaunch endpoint — registered before the catch-all so it isn't swallowed.
  // Loopback-only: relaunch spawns local processes.
  // Requires non-simple request (Content-Type header) to prevent CSRF from
  // cross-origin pages that can POST to loopback without preflight.
  router.post("/:id/relaunch", (req, res) => {
    const sessionId = req.params.id;

    if (isNonLoopbackRequest(req)) {
      relaunchLogger.warn("rejected: non-loopback", { sessionId });
      res.status(403).json({ error: "Session relaunch must originate from loopback." });
      return;
    }

    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.startsWith("application/json")) {
      relaunchLogger.warn("rejected: bad content-type", { sessionId, contentType });
      res.status(415).json({ error: "Content-Type must be application/json." });
      return;
    }

    relaunchLogger.info("attempt", { sessionId });
    const outcome = relaunchSession(options.store, sessionId, options.relaunchDeps);
    if (outcome.ok) {
      relaunchLogger.info("success", {
        sessionId,
        method: outcome.result.method,
        copilotResumed: outcome.result.copilotResumed,
        colorApplied: outcome.result.colorApplied,
        pid: outcome.result.pid,
      });
      res.json(outcome.result);
    } else {
      const statusCode =
        outcome.error.code === "session_not_found" ? 404
          : outcome.error.code === "spawn_failed" ? 500
            : 400;
      relaunchLogger.warn("failed", {
        sessionId,
        code: outcome.error.code,
        message: outcome.error.message,
        statusCode,
      });
      res.status(statusCode).json(outcome.error);
    }
  });

  router.use((req, res, next) => {
    if (req.path === "/signals" && isNonLoopbackRequest(req)) {
      signalsLogger.warn("rejected: non-loopback signal");
      res.status(403).json({ error: "Trusted session signals must originate from loopback." });
      return;
    }

    if (req.path === "/signals" && req.method === "POST") {
      const body = req.body as Record<string, unknown> | undefined;
      signalsLogger.info("received", {
        event: body?.event,
        sessionId: body?.sessionId,
        hookSource: body?.hookSource,
        cwd: body?.cwd,
        endReason: body?.endReason,
      });
    }

    const apiResponse = handleSessionRegistryApiRequest(options.store, {
      method: req.method,
      url: req.originalUrl || `${SESSION_REGISTRY_API_BASE_PATH}${req.url}`,
      body: req.method === "POST" || req.method === "PATCH" ? req.body : undefined,
    });
    if (!apiResponse) {
      next();
      return;
    }
    if (apiResponse.body === undefined) {
      res.status(apiResponse.statusCode).end();
      return;
    }
    res.status(apiResponse.statusCode).json(apiResponse.body);
  });

  return router;
}
