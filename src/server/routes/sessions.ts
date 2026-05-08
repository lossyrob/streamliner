import { Router } from "express";

import {
  handleSessionRegistryApiRequest,
  SESSION_REGISTRY_API_BASE_PATH,
} from "../../session-registry/http-api";
import type { LaunchClaimStore } from "../../launch-claim-contract";
import { bindClaimViaTrustedSignal } from "../../session-registry/launch-claims";
import { relaunchSession, type RelaunchDeps } from "../../session-registry/relaunch";
import {
  SessionRegistryArchivedError,
  SessionRegistryFileStore,
  SessionRegistryNotFoundError,
} from "../../session-registry/file-store";
import { stopSession } from "../../session-registry/stop";
import type {
  SessionRegistryRecord,
  SessionRegistryRuntimeEvidenceKind,
} from "../../session-registry-schema";
import type { SessionRegistryRuntimeEvidenceInput } from "../../session-registry/managed-runtime";
import type {
  SessionRegistryStore,
  SessionRegistryTrustedSignalInput,
} from "../../session-registry-contract";
import { isLoopbackAddress } from "../config";
import { getApiLogger } from "../logger";
import type { ManagedSdkInterruptResult, ManagedSdkRunner } from "../managed-sdk-runner";
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
  managedSdkRunner?: ManagedSdkRunner;
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
  const managedLogger = getApiLogger().withScope("managed-runtime");
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

  router.post("/:id/managed/interrupt", async (req, res) => {
    const sessionId = req.params.id;
    if (isNonLoopbackRequest(req)) {
      managedLogger.warn("rejected interrupt: non-loopback", { sessionId });
      res.status(403).json({ error: "Managed runtime actions must originate from loopback." });
      return;
    }
    if (!requestHasJsonContent(req)) {
      managedLogger.warn("rejected interrupt: bad content-type", { sessionId });
      res.status(415).json({ error: "Content-Type must be application/json." });
      return;
    }
    const target = managedRuntimeTarget(options.store, sessionId);
    if (!target.ok) {
      managedLogger.warn("rejected interrupt: invalid target", {
        sessionId,
        statusCode: target.statusCode,
      });
      res.status(target.statusCode).json({ error: target.message });
      return;
    }
    const body = isJsonObject(req.body) ? req.body : {};
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    let requested: SessionRegistryRecord;
    try {
      requested = target.store.patchRuntimeMetadata(sessionId, {
        lifecycleState: "interrupt_requested",
        progressEvents: [{
          type: "lifecycle",
          message: "Managed SDK interruption requested.",
          data: reason ? { reason } : undefined,
        }],
      });
    } catch (error: unknown) {
      const failure = managedRuntimeErrorResponse(error);
      managedLogger.warn("interrupt request failed", {
        sessionId,
        statusCode: failure.statusCode,
        err: errorLogDetails(error),
      });
      res.status(failure.statusCode).json({ error: failure.message });
      return;
    }
    const outcome = await interruptManagedSdkRunner(options.managedSdkRunner, sessionId, reason);
    try {
      const finalRecord = target.store.patchRuntimeMetadata(sessionId, {
        lifecycleState: outcome.evidenceState,
        progressEvents: [{
          type: outcome.ok ? "lifecycle" : "error",
          message: outcome.message,
        }],
      });
      managedLogger.info("interrupt", {
        sessionId,
        requestedState: requested.runtime?.lifecycleState,
        outcome: outcome.evidenceState,
        ok: outcome.ok,
      });
      res.json({ outcome, session: finalRecord });
    } catch (error: unknown) {
      const failure = managedRuntimeErrorResponse(error);
      managedLogger.warn("interrupt settle failed", {
        sessionId,
        statusCode: failure.statusCode,
        err: errorLogDetails(error),
      });
      res.status(failure.statusCode).json({ error: failure.message });
    }
  });

  router.post("/:id/managed/cancel", async (req, res) => {
    const sessionId = req.params.id;
    if (isNonLoopbackRequest(req)) {
      managedLogger.warn("rejected cancel: non-loopback", { sessionId });
      res.status(403).json({ error: "Managed runtime actions must originate from loopback." });
      return;
    }
    if (!requestHasJsonContent(req)) {
      managedLogger.warn("rejected cancel: bad content-type", { sessionId });
      res.status(415).json({ error: "Content-Type must be application/json." });
      return;
    }
    const target = managedRuntimeTarget(options.store, sessionId);
    if (!target.ok) {
      managedLogger.warn("rejected cancel: invalid target", {
        sessionId,
        statusCode: target.statusCode,
      });
      res.status(target.statusCode).json({ error: target.message });
      return;
    }
    let requested: SessionRegistryRecord;
    try {
      requested = target.store.patchRuntimeMetadata(sessionId, {
        lifecycleState: "interrupt_requested",
        progressEvents: [{
          type: "lifecycle",
          message: "Managed SDK cancellation requested.",
        }],
      });
    } catch (error: unknown) {
      const failure = managedRuntimeErrorResponse(error);
      managedLogger.warn("cancel request failed", {
        sessionId,
        statusCode: failure.statusCode,
        err: errorLogDetails(error),
      });
      res.status(failure.statusCode).json({ error: failure.message });
      return;
    }
    const hasRunner = Boolean(options.managedSdkRunner?.interrupt);
    const outcome = await interruptManagedSdkRunner(
      options.managedSdkRunner,
      sessionId,
      "Managed SDK run canceled by builder action.",
    );
    const finalState = outcome.ok || !hasRunner ? "canceled" : "failed";
    try {
      const record = target.store.patchRuntimeMetadata(sessionId, {
        lifecycleState: finalState,
        progressEvents: [{
          type: finalState === "canceled" ? "lifecycle" : "error",
          message: finalState === "canceled"
            ? "Managed SDK run canceled by builder action."
            : outcome.message,
        }],
      });
      const responseOutcome = finalState === "canceled"
        ? {
            ...outcome,
            evidenceState: "canceled" as const,
            message: outcome.ok
              ? "Managed SDK run canceled by builder action."
              : `${outcome.message}; recorded cancellation.`,
          }
        : outcome;
      managedLogger.info("cancel", {
        sessionId,
        requestedState: requested.runtime?.lifecycleState,
        outcome: record.runtime?.lifecycleState,
        ok: outcome.ok,
      });
      res.json({ outcome: responseOutcome, session: record });
    } catch (error: unknown) {
      const failure = managedRuntimeErrorResponse(error);
      managedLogger.warn("cancel settle failed", {
        sessionId,
        statusCode: failure.statusCode,
        err: errorLogDetails(error),
      });
      res.status(failure.statusCode).json({ error: failure.message });
    }
  });

  router.post("/:id/managed/evidence", (req, res) => {
    const sessionId = req.params.id;
    if (isNonLoopbackRequest(req)) {
      managedLogger.warn("rejected evidence: non-loopback", { sessionId });
      res.status(403).json({ error: "Managed runtime actions must originate from loopback." });
      return;
    }
    if (!requestHasJsonContent(req)) {
      managedLogger.warn("rejected evidence: bad content-type", { sessionId });
      res.status(415).json({ error: "Content-Type must be application/json." });
      return;
    }
    const target = managedRuntimeTarget(options.store, sessionId);
    if (!target.ok) {
      managedLogger.warn("rejected evidence: invalid target", {
        sessionId,
        statusCode: target.statusCode,
      });
      res.status(target.statusCode).json({ error: target.message });
      return;
    }
    let evidence: SessionRegistryRuntimeEvidenceInput;
    try {
      evidence = parseRuntimeEvidenceInput(req.body);
    } catch (error: unknown) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    try {
      const record = target.store.patchRuntimeMetadata(sessionId, {
        lifecycleState: evidence.kind,
        evidence: [evidence],
        progressEvents: [{
          type: evidence.kind === "terminal_takeover" ? "terminal_takeover" : "evidence",
          message: `Managed runtime evidence recorded: ${evidence.kind}.`,
        }],
      });
      res.json(record);
    } catch (error: unknown) {
      const failure = managedRuntimeErrorResponse(error);
      managedLogger.warn("evidence failed", {
        sessionId,
        statusCode: failure.statusCode,
        err: errorLogDetails(error),
      });
      res.status(failure.statusCode).json({ error: failure.message });
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

async function interruptManagedSdkRunner(
  runner: ManagedSdkRunner | undefined,
  registryId: string,
  reason: string | undefined,
): Promise<ManagedSdkInterruptResult> {
  if (!runner?.interrupt) {
    return {
      ok: false,
      evidenceState: "failed",
      message: "No managed SDK runner is attached to this API process.",
    };
  }
  try {
    return await runner.interrupt({ registryId, reason });
  } catch (error: unknown) {
    return {
      ok: false,
      evidenceState: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

type ManagedRuntimeTarget =
  | { ok: true; store: SessionRegistryFileStore; record: SessionRegistryRecord }
  | { ok: false; statusCode: number; message: string };

function managedRuntimeTarget(
  store: SessionRegistryStore,
  sessionId: string,
): ManagedRuntimeTarget {
  if (!(store instanceof SessionRegistryFileStore)) {
    return {
      ok: false,
      statusCode: 400,
      message: "Managed runtime actions require the file-backed session registry.",
    };
  }
  const record = store.getSession(sessionId);
  if (!record) {
    return {
      ok: false,
      statusCode: 404,
      message: `Session ${sessionId} does not exist.`,
    };
  }
  if (record.lifecycleStatus === "archived") {
    return {
      ok: false,
      statusCode: 409,
      message: `Archived session ${sessionId} cannot update managed runtime metadata.`,
    };
  }
  const runtime = record.runtime;
  if (!runtime || runtime.runtimeKind !== "managed-sdk" || runtime.runtimeOwner !== "streamliner-sdk") {
    return {
      ok: false,
      statusCode: 409,
      message: "Session is not a Streamliner-managed SDK runtime.",
    };
  }
  return { ok: true, store, record };
}

function managedRuntimeErrorResponse(
  error: unknown,
): { statusCode: number; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof SessionRegistryNotFoundError) {
    return { statusCode: 404, message };
  }
  if (error instanceof SessionRegistryArchivedError) {
    return { statusCode: 409, message };
  }
  return { statusCode: 500, message };
}

function errorLogDetails(error: unknown): Record<string, string> | string {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : String(error);
}

function requestHasJsonContent(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const contentType = req.headers["content-type"] ?? "";
  return typeof contentType === "string" && contentType.startsWith("application/json");
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MANAGED_EVIDENCE_KINDS = new Set<SessionRegistryRuntimeEvidenceKind>([
  "pr_ready",
  "review_ready",
  "completed",
  "cleanup_ready",
  "cleaned_up",
  "terminal_takeover",
]);

function parseRuntimeEvidenceInput(value: unknown): SessionRegistryRuntimeEvidenceInput {
  if (!isJsonObject(value)) {
    throw new Error("Expected a JSON object body for managed runtime evidence.");
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !MANAGED_EVIDENCE_KINDS.has(kind as SessionRegistryRuntimeEvidenceKind)) {
    throw new Error("kind must be a supported managed runtime evidence kind.");
  }
  const source = typeof value.source === "string" && value.source.trim().length > 0
    ? value.source
    : "api";
  return {
    kind: kind as SessionRegistryRuntimeEvidenceKind,
    source,
    detectedAt: typeof value.detectedAt === "string" ? value.detectedAt : undefined,
    url: typeof value.url === "string" ? value.url : null,
    repo: typeof value.repo === "string" ? value.repo : null,
    number: typeof value.number === "number" && Number.isInteger(value.number) && value.number > 0
      ? value.number
      : null,
    sha: typeof value.sha === "string" ? value.sha : null,
    summary: typeof value.summary === "string" ? value.summary : null,
  };
}
