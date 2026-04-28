import { Router } from "express";

import {
  handleSessionRegistryApiRequest,
  SESSION_REGISTRY_API_BASE_PATH,
} from "../../session-registry/http-api";
import type { SessionRegistryStore } from "../../session-registry-contract";
import { isLoopbackAddress } from "../config";
import { SessionRegistryEventStream } from "../session-events";

function hasNonLoopbackForwardedFor(value: string | string[] | undefined): boolean {
  if (!value) {
    return false;
  }
  const values = Array.isArray(value) ? value : value.split(",");
  return values.some((entry) => !isLoopbackAddress(entry.trim()));
}

export function createSessionsRouter(options: {
  store: SessionRegistryStore;
  eventStream: SessionRegistryEventStream;
}): Router {
  const router = Router();

  router.get("/events", options.eventStream.handle);

  router.use((req, res, next) => {
    if (
      req.path === "/signals" &&
      (!isLoopbackAddress(req.socket.remoteAddress) ||
        hasNonLoopbackForwardedFor(req.headers["x-forwarded-for"]))
    ) {
      res.status(403).json({ error: "Trusted session signals must originate from loopback." });
      return;
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
