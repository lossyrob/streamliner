import { Router } from "express";

import {
  handleSessionRegistryApiRequest,
  SESSION_REGISTRY_API_BASE_PATH,
} from "../../session-registry/http-api";
import type { LaunchClaimStore } from "../../launch-claim-contract";
import { bindClaimViaTrustedSignal } from "../../session-registry/launch-claims";
import { relaunchSession, type RelaunchDeps } from "../../session-registry/relaunch";
import { SessionRegistryFileStore } from "../../session-registry/file-store";
import { stopSession } from "../../session-registry/stop";
import type {
  SessionRegistryStore,
  SessionRegistryTrustedSignalInput,
} from "../../session-registry-contract";
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
  /**
   * Optional launch-claim store. When provided, the trusted-signal
   * intake (POST /api/sessions/signals) attempts Tier 2 launch-claim
   * binding via `bindClaimViaTrustedSignal` after each successful
   * signal record.
   */
  launchClaimStore?: LaunchClaimStore;
}): Router {
  const router = Router();
  const signalsLogger = getApiLogger().withScope("signals");
  const relaunchLogger = getApiLogger().withScope("relaunch");
  const stopLogger = getApiLogger().withScope("stop");
  const claimBindingLogger = options.launchClaimStore
    ? getApiLogger().withScope("launch-claim.binding")
    : null;

  const onTrustedSignalApplied:
    | ((signal: SessionRegistryTrustedSignalInput) => void)
    | undefined = options.launchClaimStore && claimBindingLogger
    ? (signal) => {
        if (signal.event !== "session.started") return;
        if (!signal.launchClaimId) return;
        // The session-registry store is implementation-detail
        // SessionRegistryFileStore in production; bindClaimViaTrustedSignal
        // requires the file-store atomic primitives. Tests that supply
        // a non-file-store SessionRegistryStore here will not perform
        // Tier 2 binding (Tier 1 nonce path still applies).
        if (!(options.store instanceof SessionRegistryFileStore)) return;
        try {
          const outcome = bindClaimViaTrustedSignal(
            options.store,
            options.launchClaimStore!,
            {
              launchClaimId: signal.launchClaimId,
              copilotSessionId: signal.sessionId,
              cwd: signal.cwd,
              branch: signal.branch ?? null,
              repo: signal.repo ?? null,
              at: signal.timestamp,
            },
          );
          if (outcome.ok) {
            claimBindingLogger.info("bound-via-hook", {
              event: "launch-claim.bound",
              launchClaimId: outcome.claim.launchClaimId,
              copilotSessionId: signal.sessionId,
              registryId: outcome.registryId,
              workstreamId: outcome.claim.workstreamId,
              nodeId: outcome.claim.nodeId,
              via: "trusted-signal",
              at: signal.timestamp,
            });
          } else if (
            outcome.reason !== "claim-not-found" &&
            outcome.reason !== "already-bound"
          ) {
            claimBindingLogger.warn("bound-via-hook-deferred", {
              event: "launch-claim.bound-via-hook-deferred",
              launchClaimId: signal.launchClaimId,
              copilotSessionId: signal.sessionId,
              reason: outcome.reason,
              detail: outcome.detail ?? null,
            });
          }
        } catch (error) {
          claimBindingLogger.warn("bound-via-hook-failed", {
            event: "launch-claim.bound-via-hook-failed",
            launchClaimId: signal.launchClaimId,
            err:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          });
        }
      }
    : undefined;

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

  // Manual stop endpoint — synthesizes a session.ended trusted signal so the
  // user can clean up sessions whose Copilot CLI never fired the sessionEnd
  // hook (e.g. terminal closed before the hook could POST).
  router.post("/:id/stop", (req, res) => {
    const sessionId = req.params.id;

    if (isNonLoopbackRequest(req)) {
      stopLogger.warn("rejected: non-loopback", { sessionId });
      res.status(403).json({ error: "Session stop must originate from loopback." });
      return;
    }

    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.startsWith("application/json")) {
      stopLogger.warn("rejected: bad content-type", { sessionId, contentType });
      res.status(415).json({ error: "Content-Type must be application/json." });
      return;
    }

    stopLogger.info("attempt", { sessionId });
    const outcome = stopSession(options.store, sessionId);
    if (outcome.ok) {
      stopLogger.info("success", {
        sessionId,
        lifecycleStatus: outcome.result.lifecycleStatus,
        trustedEndedAt: outcome.result.trustedEndedAt,
      });
      res.json(outcome.result);
    } else {
      const statusCode =
        outcome.error.code === "session_not_found" ? 404
          : outcome.error.code === "stop_failed" ? 500
            : 400;
      stopLogger.warn("failed", {
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

    const apiResponse = handleSessionRegistryApiRequest(
      options.store,
      {
        method: req.method,
        url: req.originalUrl || `${SESSION_REGISTRY_API_BASE_PATH}${req.url}`,
        body: req.method === "POST" || req.method === "PATCH" ? req.body : undefined,
      },
      onTrustedSignalApplied ? { onTrustedSignalApplied } : undefined,
    );
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
