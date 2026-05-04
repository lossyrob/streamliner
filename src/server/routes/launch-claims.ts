import { Router } from "express";

import {
  handleLaunchClaimsApiRequest,
  LAUNCH_CLAIMS_API_BASE_PATH,
} from "../../session-registry/launch-claims-http-api";
import type { LaunchClaimStore } from "../../launch-claim-contract";
import { isLoopbackAddress } from "../config";
import { getApiLogger } from "../logger";

function hasNonLoopbackForwardedFor(value: string | string[] | undefined): boolean {
  if (!value) {
    return false;
  }
  const values = Array.isArray(value) ? value : value.split(",");
  return values.some((entry) => !isLoopbackAddress(entry.trim()));
}

function isNonLoopbackRequest(req: {
  socket: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}): boolean {
  return (
    !isLoopbackAddress(req.socket.remoteAddress) ||
    hasNonLoopbackForwardedFor(req.headers["x-forwarded-for"])
  );
}

export function createLaunchClaimsRouter(options: {
  claimStore: LaunchClaimStore;
}): Router {
  const router = Router();
  const logger = getApiLogger().withScope("launch-claim.api");

  router.use((req, res, next) => {
    if (isNonLoopbackRequest(req)) {
      logger.warn("rejected: non-loopback", {
        path: req.originalUrl ?? req.url,
        method: req.method,
      });
      res.status(403).json({ error: "Launch claim API must originate from loopback." });
      return;
    }
    const fullUrl = req.originalUrl ?? req.url;
    const url = fullUrl.startsWith(LAUNCH_CLAIMS_API_BASE_PATH)
      ? fullUrl
      : `${LAUNCH_CLAIMS_API_BASE_PATH}${req.url}`;
    const response = handleLaunchClaimsApiRequest(options.claimStore, {
      method: req.method,
      url,
    });
    if (!response) {
      next();
      return;
    }
    res.status(response.statusCode);
    if (response.body !== undefined) {
      res.json(response.body);
    } else {
      res.end();
    }
  });

  return router;
}
