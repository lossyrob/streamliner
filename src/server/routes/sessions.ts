import { Router } from "express";

import {
  handleSessionRegistryApiRequest,
  SESSION_REGISTRY_API_BASE_PATH,
} from "../../session-registry/http-api";
import { MANAGED_RUNTIME_ACTION_ROUTE_SUFFIXES } from "../../managed-runtime-contract";
import type { LaunchClaimStore } from "../../launch-claim-contract";
import { bindClaimViaTrustedSignal } from "../../session-registry/launch-claims";
import { relaunchSession, type RelaunchDeps } from "../../session-registry/relaunch";
import {
  executeManagedCleanup,
  managedCleanupSummary,
  validateManagedCleanup,
  withManagedCleanupLock,
  type ManagedCleanupDeps,
} from "../managed-cleanup";
import {
  SessionRegistryArchivedError,
  SessionRegistryFileStore,
  SessionRegistryNotFoundError,
} from "../../session-registry/file-store";
import { stopSession } from "../../session-registry/stop";
import type {
  SessionRegistryRecord,
  SessionRegistryManagedLifecycleState,
  SessionRegistryRuntimeEvidenceKind,
  SessionRegistryRuntimeOwner,
} from "../../session-registry-schema";
import type {
  SessionRegistryRuntimeEvidenceInput,
  SessionRegistryStore,
  SessionRegistryTrustedSignalInput,
} from "../../session-registry-contract";
import { isLoopbackAddress } from "../config";
import { getApiLogger } from "../logger";
import type {
  ManagedSdkInterruptResult,
  ManagedSdkOwnershipTransferResult,
  ManagedSdkRunner,
} from "../managed-sdk-runner";
import type { ManagedRuntimePatchCoalescer } from "../managed-runtime-patch-coalescer";
import { SessionRegistryEventStream } from "../session-events";
import {
  buildCopilotResumeCommand,
  isSafeCopilotResumeSessionId,
  launchTerminal,
  type TerminalLaunchOptions,
  type TerminalLaunchResult,
} from "../terminal-launch";

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
  runtimePatchCoalescer: ManagedRuntimePatchCoalescer;
  managedCleanupDeps?: Partial<ManagedCleanupDeps>;
  now?: () => Date;
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
  const quiesceRuntimePatchQueue = (sessionId: string): void => {
    options.runtimePatchCoalescer.flush(sessionId);
    options.runtimePatchCoalescer.close(sessionId);
  };

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
          : outcome.error.code === "spawn_failed" || outcome.error.code === "default_args_unavailable" ? 500
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

  router.post(
    `/:id/managed/${MANAGED_RUNTIME_ACTION_ROUTE_SUFFIXES.interrupt}`,
    async (req, res) => {
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
      quiesceRuntimePatchQueue(sessionId);
      requested = target.store.patchRuntimeMetadata(sessionId, {
        lifecycleState: "interrupt_requested",
        forceLifecycleState: true,
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
    const finalState = outcome.ok ? outcome.evidenceState : "interrupt_requested";
    try {
      quiesceRuntimePatchQueue(sessionId);
      const finalRecord = target.store.patchRuntimeMetadata(sessionId, {
        lifecycleState: finalState,
        forceLifecycleState: true,
        progressEvents: [{
          type: outcome.ok ? "lifecycle" : "error",
          message: outcome.ok
            ? outcome.message
            : `Managed SDK interruption failed; runtime remains active for retry: ${outcome.message}`,
        }],
      });
      assertManagedRuntimePatch(finalRecord, {
        lifecycleState: finalState,
        context: "interrupt",
      });
      managedLogger.info("interrupt", {
        sessionId,
        requestedState: requested.runtime?.lifecycleState,
        outcome: finalState,
        ok: outcome.ok,
      });
      res.json({
        outcome: outcome.ok
          ? outcome
          : {
              ...outcome,
              evidenceState: finalState,
              message: `Managed SDK interruption failed; runtime remains active for retry: ${outcome.message}`,
            },
        session: finalRecord,
      });
    } catch (error: unknown) {
      const failure = managedRuntimeErrorResponse(error);
      managedLogger.warn("interrupt settle failed", {
        sessionId,
        statusCode: failure.statusCode,
        err: errorLogDetails(error),
      });
      res.status(failure.statusCode).json({ error: failure.message });
    }
    },
  );

  router.post(
    `/:id/managed/${MANAGED_RUNTIME_ACTION_ROUTE_SUFFIXES.cancel}`,
    async (req, res) => {
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
      quiesceRuntimePatchQueue(sessionId);
      requested = target.store.patchRuntimeMetadata(sessionId, {
        lifecycleState: "interrupt_requested",
        forceLifecycleState: true,
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
    const finalState = outcome.ok || !hasRunner || outcome.evidenceState === "waiting_for_builder"
      ? "canceled"
      : "interrupt_requested";
    try {
      quiesceRuntimePatchQueue(sessionId);
      const record = target.store.patchRuntimeMetadata(sessionId, {
        lifecycleState: finalState,
        forceLifecycleState: true,
        progressEvents: [{
          type: finalState === "canceled" ? "lifecycle" : "error",
          message: finalState === "canceled"
            ? "Managed SDK run canceled by builder action."
            : `Managed SDK cancellation failed; runtime remains active for retry: ${outcome.message}`,
        }],
      });
      if (finalState === "canceled") {
        options.runtimePatchCoalescer.close(sessionId);
      }
      assertManagedRuntimePatch(record, {
        lifecycleState: finalState,
        context: "cancel",
      });
      const responseOutcome = finalState === "canceled"
        ? {
            ...outcome,
            ok: true,
            evidenceState: "canceled" as const,
            message: outcome.ok
              ? "Managed SDK run canceled by builder action."
              : `${outcome.message}; recorded cancellation.`,
          }
        : {
            ...outcome,
            evidenceState: finalState,
            message: `Managed SDK cancellation failed; runtime remains active for retry: ${outcome.message}`,
          };
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
    },
  );

  router.post(
    `/:id/managed/${MANAGED_RUNTIME_ACTION_ROUTE_SUFFIXES["terminal-takeover"]}`,
    async (req, res) => {
    const sessionId = req.params.id;
    if (isNonLoopbackRequest(req)) {
      managedLogger.warn("rejected takeover: non-loopback", { sessionId });
      res.status(403).json({ error: "Managed runtime actions must originate from loopback." });
      return;
    }
    if (!requestHasJsonContent(req)) {
      managedLogger.warn("rejected takeover: bad content-type", { sessionId });
      res.status(415).json({ error: "Content-Type must be application/json." });
      return;
    }
    const target = managedRuntimeTarget(options.store, sessionId);
    if (!target.ok) {
      managedLogger.warn("rejected takeover: invalid target", {
        sessionId,
        statusCode: target.statusCode,
      });
      res.status(target.statusCode).json({ error: target.message });
      return;
    }
    const runtime = target.record.runtime;
    const sdkSessionId = runtime?.sdkSessionId;
    if (!sdkSessionId) {
      try {
        quiesceRuntimePatchQueue(sessionId);
        const failed = target.store.patchRuntimeMetadata(sessionId, {
          lifecycleState: "failed",
          progressEvents: [{
            type: "error",
            message: "Terminal takeover requires an SDK session id.",
          }],
        });
        res.status(409).json({
          error: "Terminal takeover requires an SDK session id.",
          session: failed,
        });
      } catch (error: unknown) {
        const failure = managedRuntimeErrorResponse(error);
        res.status(failure.statusCode).json({ error: failure.message });
      }
      return;
    }
    if (!isSafeCopilotResumeSessionId(sdkSessionId)) {
      try {
        quiesceRuntimePatchQueue(sessionId);
        const failed = target.store.patchRuntimeMetadata(sessionId, {
          lifecycleState: "failed",
          progressEvents: [{
            type: "error",
            message: "Terminal takeover requires a valid SDK session id.",
          }],
        });
        res.status(409).json({
          error: "Terminal takeover requires a valid SDK session id.",
          session: failed,
        });
      } catch (error: unknown) {
        const failure = managedRuntimeErrorResponse(error);
        res.status(failure.statusCode).json({ error: failure.message });
      }
      return;
    }

    const cwd = target.record.derivedWorktreePath ?? target.record.cwd;
    const timestamp = (options.now?.() ?? new Date()).toISOString();
    let prebound: SessionRegistryRecord;
    try {
      quiesceRuntimePatchQueue(sessionId);
      // Pre-bind before launch so a fast resume hook attaches to this managed row
      // instead of creating a duplicate observed session.
      prebound = target.store.attachObservedSession(sessionId, {
        copilotSessionId: sdkSessionId,
        cwd,
        repo: target.record.repo,
        branch: target.record.branch,
        lastSeenAt: timestamp,
        lifecycleStatus: "active",
        observedSessionKind: "interactive",
        copilotProcessState: "none",
        trustedStartSource: "resume",
        trustedExecutionKind: "copilot_cli",
      });
    } catch (error: unknown) {
      const failure = managedRuntimeErrorResponse(error);
      res.status(failure.statusCode).json({ error: failure.message });
      return;
    }
    const terminalOptions: TerminalLaunchOptions = {
      cwd,
      command: buildCopilotResumeCommand(sdkSessionId),
      title: prebound.title,
      tabColor: prebound.color ?? undefined,
    };
    let terminal: TerminalLaunchResult;
    try {
      terminal = (options.relaunchDeps?.launchTerminal ?? launchTerminal)(terminalOptions);
    } catch (error: unknown) {
      const message = `Failed to launch terminal takeover: ${error instanceof Error ? error.message : String(error)}`;
      try {
        const blocked = target.store.patchRuntimeMetadata(sessionId, {
          lifecycleState: "waiting_for_builder",
          progressEvents: [{
            type: "error",
            message,
          }],
        });
        res.status(500).json({ error: message, session: blocked });
      } catch (patchError: unknown) {
        const failure = managedRuntimeErrorResponse(patchError);
        res.status(failure.statusCode).json({ error: failure.message });
      }
      return;
    }
    try {
      quiesceRuntimePatchQueue(sessionId);
      const reason = "Terminal takeover requested by builder action.";
      const runnerSettlement = await releaseManagedSdkRunnerForTerminal(
        options.managedSdkRunner,
        sessionId,
        reason,
      );
      const transferOutcome = runnerSettlement.ownershipTransfer;
      const interruptOutcome = runnerSettlement.interrupt;
      const runnerWarnings = [
        ...(interruptOutcome.ok ? [] : [interruptOutcome.message]),
        ...(transferOutcome.ok ? [] : [transferOutcome.message]),
      ];
      const progressMessage = runnerWarnings.length === 0
        ? "Terminal takeover opened and SDK ownership was transferred."
        : `Terminal takeover opened with SDK release warning: ${runnerWarnings.join("; ")}`;
      const withTakeoverRuntime = target.store.patchRuntimeMetadata(sessionId, {
        runtimeOwner: "builder-terminal",
        lifecycleState: "terminal_takeover",
        forceLifecycleState: true,
        evidence: [{
          kind: "terminal_takeover",
          source: "managed-runtime-action",
          detectedAt: timestamp,
          summary: "Terminal takeover opened visible Copilot CLI for the managed SDK session.",
        }],
        progressEvents: [{
          type: "terminal_takeover",
          message: progressMessage,
          timestamp,
          data: {
            method: terminal.method,
            hasPid: terminal.pid !== undefined,
            ownershipTransferred: transferOutcome.ok,
            runnerReleaseOk: interruptOutcome.ok && transferOutcome.ok,
          },
        }],
      });
      options.runtimePatchCoalescer.close(sessionId);
      assertManagedRuntimePatch(withTakeoverRuntime, {
        runtimeOwner: "builder-terminal",
        lifecycleState: "terminal_takeover",
        context: "takeover",
      });
      // Post-launch rebind refreshes non-trusted observation fields only; trusted
      // hook/live-process fields are written exclusively by real hook intake.
      const attached = target.store.attachObservedSession(sessionId, {
        copilotSessionId: sdkSessionId,
        cwd,
        repo: withTakeoverRuntime.repo,
        branch: withTakeoverRuntime.branch,
        lastSeenAt: timestamp,
        lifecycleStatus: "active",
        observedSessionKind: "interactive",
        trustedStartSource: "resume",
        trustedExecutionKind: "copilot_cli",
      });
      managedLogger.info("takeover", {
        sessionId,
        sdkSessionId,
        method: terminal.method,
        pid: terminal.pid,
        interruptOk: interruptOutcome.ok,
      });
      res.json({
        outcome: {
          ok: true,
          evidenceState: "terminal_takeover",
          message: "Terminal takeover opened visible Copilot CLI.",
          interrupt: interruptOutcome,
          ownershipTransfer: transferOutcome,
        },
        terminal: {
          method: terminal.method,
          pid: terminal.pid,
          copilotResumed: true,
        },
        session: attached,
      });
    } catch (error: unknown) {
      const failure = managedRuntimeErrorResponse(error);
      managedLogger.warn("takeover settle failed", {
        sessionId,
        statusCode: failure.statusCode,
        err: errorLogDetails(error),
      });
      res.status(failure.statusCode).json({ error: failure.message });
    }
    },
  );

  router.post(
    `/:id/managed/${MANAGED_RUNTIME_ACTION_ROUTE_SUFFIXES.cleanup}`,
    async (req, res) => {
    const sessionId = req.params.id;
    if (isNonLoopbackRequest(req)) {
      managedLogger.warn("rejected cleanup: non-loopback", { sessionId });
      res.status(403).json({ error: "Managed runtime actions must originate from loopback." });
      return;
    }
    if (!requestHasJsonContent(req)) {
      managedLogger.warn("rejected cleanup: bad content-type", { sessionId });
      res.status(415).json({ error: "Content-Type must be application/json." });
      return;
    }
    try {
      await withManagedCleanupLock(sessionId, async () => {
        options.runtimePatchCoalescer.flush(sessionId);
        const target = managedRuntimeTarget(options.store, sessionId, {
          allowedOwners: ["streamliner-sdk", "builder-terminal"],
        });
        if (!target.ok) {
          managedLogger.warn("rejected cleanup: invalid target", {
            sessionId,
            statusCode: target.statusCode,
          });
          res.status(target.statusCode).json({ error: target.message });
          return;
        }
        if (!target.record.runtime) {
          res.status(409).json({ error: "Session is not a Streamliner-managed SDK runtime." });
          return;
        }
        const validation = await validateManagedCleanup(
          target.record,
          target.store.listSessions({ includeArchived: false }),
          options.managedCleanupDeps,
        );
        if (!validation.ok) {
          const message = validation.blockers[0]?.message ?? "Cleanup is blocked by managed runtime guardrails.";
          quiesceRuntimePatchQueue(sessionId);
          const blocked = target.store.patchRuntimeMetadata(sessionId, {
            lifecycleState: "waiting_for_builder",
            progressEvents: [{
              type: "error",
              message,
              data: {
                blockerCount: validation.blockers.length,
                firstBlockerCode: validation.blockers[0]?.code,
              },
            }],
          });
          res.json({
            outcome: {
              ok: false,
              evidenceState: "waiting_for_builder",
              message,
              blockers: validation.blockers,
            },
            session: blocked,
          });
          return;
        }

        quiesceRuntimePatchQueue(sessionId);
        const cleaning = target.store.patchRuntimeMetadata(sessionId, {
          lifecycleState: "cleaning_up",
          progressEvents: [{
            type: "lifecycle",
            message: "Managed cleanup-after-merge started.",
          }],
        });
        assertManagedRuntimePatch(cleaning, {
          lifecycleState: "cleaning_up",
          context: "cleanup start",
        });
        const cleanup = await executeManagedCleanup(validation.plan, options.managedCleanupDeps);
        if (!cleanup.ok) {
          quiesceRuntimePatchQueue(sessionId);
          const failed = target.store.patchRuntimeMetadata(sessionId, {
            lifecycleState: "waiting_for_builder",
            progressEvents: [{
              type: "error",
              message: cleanup.message,
              data: {
                removedWorktree: cleanup.removedWorktree,
                deletedBranch: cleanup.deletedBranch,
                blockerCount: cleanup.blockers.length,
                firstBlockerCode: cleanup.blockers[0]?.code,
              },
            }],
          });
          res.json({
            outcome: {
              ok: false,
              evidenceState: "waiting_for_builder",
              message: cleanup.message,
              blockers: cleanup.blockers,
              removedWorktree: cleanup.removedWorktree,
              deletedBranch: cleanup.deletedBranch,
            },
            session: failed,
          });
          return;
        }
        const summary = managedCleanupSummary(validation.plan, cleanup);
        quiesceRuntimePatchQueue(sessionId);
        const cleaned = target.store.patchRuntimeMetadata(sessionId, {
          lifecycleState: "cleaned_up",
          evidence: [{
            kind: "cleaned_up",
            source: "managed-cleanup",
            repo: validation.plan.pr.repo,
            number: validation.plan.pr.number,
            sha: validation.plan.pr.headSha,
            url: validation.plan.pr.url,
            summary,
          }],
          progressEvents: [{
            type: "evidence",
            message: summary,
            data: {
              removedWorktree: cleanup.removedWorktree,
              deletedBranch: cleanup.deletedBranch,
            },
          }],
        });
        options.runtimePatchCoalescer.close(sessionId);
        assertManagedRuntimePatch(cleaned, {
          lifecycleState: "cleaned_up",
          context: "cleanup finish",
        });
        managedLogger.info("cleanup", {
          sessionId,
          worktreePath: validation.plan.worktreePath,
          branch: validation.plan.branch,
          pr: validation.plan.pr.number,
        });
        res.json({
          outcome: {
            ok: true,
            evidenceState: "cleaned_up",
            message: summary,
            removedWorktree: cleanup.removedWorktree,
            deletedBranch: cleanup.deletedBranch,
          },
          session: cleaned,
        });
      });
    } catch (error: unknown) {
      const failure = managedRuntimeErrorResponse(error);
      managedLogger.warn("cleanup failed", {
        sessionId,
        statusCode: failure.statusCode,
        err: errorLogDetails(error),
      });
      if (!res.headersSent) {
        res.status(failure.statusCode).json({ error: failure.message });
      }
    }
    },
  );

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
      quiesceRuntimePatchQueue(sessionId);
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
      evidenceState: "waiting_for_builder",
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

async function releaseManagedSdkRunnerForTerminal(
  runner: ManagedSdkRunner | undefined,
  registryId: string,
  reason: string | undefined,
): Promise<{
  interrupt: ManagedSdkInterruptResult;
  ownershipTransfer: ManagedSdkOwnershipTransferResult;
}> {
  if (runner?.transferToTerminal) {
    const ownershipTransfer = await transferManagedSdkRunnerToTerminal(
      runner,
      registryId,
      "Visible terminal takeover opened for the managed SDK session.",
    );
    return {
      ownershipTransfer,
      interrupt: ownershipTransfer.ok
        ? {
            ok: true,
            evidenceState: "interrupted",
            message: ownershipTransfer.message,
          }
        : {
            ok: false,
            evidenceState: "waiting_for_builder",
            message: ownershipTransfer.message,
          },
    };
  }

  return {
    interrupt: await interruptManagedSdkRunner(runner, registryId, reason),
    ownershipTransfer: {
      ok: false,
      message: "No managed SDK runner ownership-transfer hook is attached to this API process.",
    },
  };
}

async function transferManagedSdkRunnerToTerminal(
  runner: ManagedSdkRunner | undefined,
  registryId: string,
  reason: string | undefined,
): Promise<ManagedSdkOwnershipTransferResult> {
  if (!runner?.transferToTerminal) {
    return {
      ok: false,
      message: "No managed SDK runner ownership-transfer hook is attached to this API process.",
    };
  }
  try {
    return await runner.transferToTerminal({ registryId, reason });
  } catch (error: unknown) {
    return {
      ok: false,
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
  validation: {
    allowedOwners?: readonly SessionRegistryRuntimeOwner[];
  } = {},
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
  const allowedOwners = validation.allowedOwners ?? ["streamliner-sdk"];
  if (
    !runtime ||
    runtime.runtimeKind !== "managed-sdk" ||
    !allowedOwners.includes(runtime.runtimeOwner)
  ) {
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

function assertManagedRuntimePatch(
  record: SessionRegistryRecord,
  expected: {
    runtimeOwner?: SessionRegistryRuntimeOwner;
    lifecycleState?: SessionRegistryManagedLifecycleState | null;
    context: string;
  },
): void {
  const runtime = record.runtime;
  if (
    (expected.runtimeOwner !== undefined && runtime?.runtimeOwner !== expected.runtimeOwner) ||
    (expected.lifecycleState !== undefined && runtime?.lifecycleState !== expected.lifecycleState)
  ) {
    throw new Error(
      `Managed runtime ${expected.context} patch did not persist expected owner/lifecycle.`,
    );
  }
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

const MANAGED_EVIDENCE_SCALAR_MAX_LENGTH = 1024;

function parseRuntimeEvidenceInput(value: unknown): SessionRegistryRuntimeEvidenceInput {
  if (!isJsonObject(value)) {
    throw new Error("Expected a JSON object body for managed runtime evidence.");
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !MANAGED_EVIDENCE_KINDS.has(kind as SessionRegistryRuntimeEvidenceKind)) {
    throw new Error("kind must be a supported managed runtime evidence kind.");
  }
  const source = parseEvidenceSource(value.source);
  return {
    kind: kind as SessionRegistryRuntimeEvidenceKind,
    source,
    detectedAt: parseEvidenceTimestamp(value.detectedAt),
    url: parseOptionalEvidenceString(value.url, "url"),
    repo: parseOptionalEvidenceString(value.repo, "repo"),
    number: parseOptionalEvidenceNumber(value.number),
    sha: parseOptionalEvidenceString(value.sha, "sha"),
    summary: parseOptionalEvidenceString(value.summary, "summary", { allowEmpty: true }),
  };
}

function parseEvidenceSource(value: unknown): string {
  if (value === undefined || value === null) {
    return "api";
  }
  if (typeof value !== "string") {
    throw new Error("source must be a string when provided.");
  }
  const source = value.trim();
  if (source.length === 0) {
    throw new Error("source must be non-empty when provided.");
  }
  if (source.length > MANAGED_EVIDENCE_SCALAR_MAX_LENGTH) {
    throw new Error("source is too long.");
  }
  return source;
}

function parseEvidenceTimestamp(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("detectedAt must be an ISO timestamp string when provided.");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("detectedAt must be a valid timestamp.");
  }
  return value;
}

function parseOptionalEvidenceString(
  value: unknown,
  fieldName: string,
  options: { allowEmpty?: boolean } = {},
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string when provided.`);
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new Error(`${fieldName} must be non-empty when provided.`);
  }
  if (value.length > MANAGED_EVIDENCE_SCALAR_MAX_LENGTH) {
    throw new Error(`${fieldName} is too long.`);
  }
  return value.length === 0 ? null : value;
}

function parseOptionalEvidenceNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("number must be a positive safe integer when provided.");
  }
  return value;
}
