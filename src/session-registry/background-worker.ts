import { existsSync } from "node:fs";
import { join } from "node:path";

import type { SessionRegistryListItem } from "../session-registry-contract";
import {
  type DiscoveredCopilotSession,
  discoverCopilotSessions,
  getDefaultCopilotSessionStateRoot,
  syncDiscoveredCopilotSessions,
} from "./copilot-session-discovery";
import {
  computeEventsFingerprint,
  countUserMessageTurns,
  DEFAULT_SUMMARY_MODEL,
  extractRecentUserTurns,
  shutdownSharedCopilotClient,
  summarizeSession,
  type SummarizeSessionResult,
} from "./session-summarizer";
import { indexSessionContext } from "./session-context-indexer";
import { indexSessionActivity } from "./session-activity-indexer";
import { indexPawWorkflow } from "./paw-artifact-indexer";
import {
  SessionRegistryFileStore,
  type SessionRegistryDerivedStatePatch,
} from "./file-store";
import { drainTrustedSessionSignalSpool } from "./trusted-session-signals";
import { runLaunchClaimBindingPass } from "./launch-claim-binding";
import { runLaunchClaimSweep } from "./launch-claim-sweep";
import {
  bindClaimViaTrustedSignal,
  reconcileOrphanReservedRows,
} from "./launch-claims";
import {
  reconcileManagedRuntimeStartupRows,
  type ManagedRuntimeOwnerVerifier,
} from "./managed-runtime-startup-reconciliation";
import type {
  LaunchClaimStore,
} from "../launch-claim-contract";
import type { SessionRegistryTrustedSignalInput } from "../session-registry-contract";
import type { ApiLogger } from "../server/logger";

export const SESSION_REGISTRY_WORKER_POLL_INTERVAL_MS = 15_000;
export const SESSION_REGISTRY_WORKER_MAX_CONCURRENCY = 2;
export const SESSION_REGISTRY_WORKER_INITIAL_DELAY_MS = 10_000;
export const SESSION_REGISTRY_SUMMARY_REFRESH_USER_TURNS = 5;
export const SESSION_REGISTRY_SUMMARY_FORMAT_VERSION = "description-v2";

interface SummaryCandidate {
  session: SessionRegistryListItem;
  eventsPath: string;
  fingerprint: string;
}

interface SummarizerDependencies {
  computeEventsFingerprint: typeof computeEventsFingerprint;
  countUserMessageTurns: typeof countUserMessageTurns;
  extractRecentUserTurns: typeof extractRecentUserTurns;
  summarizeSession: (options: {
    turns: Awaited<ReturnType<typeof extractRecentUserTurns>>;
    context: {
      title?: string | null;
      repo?: string | null;
      branch?: string | null;
      cwd?: string | null;
    };
    model: string;
    timeoutMs?: number;
  }) => Promise<SummarizeSessionResult>;
  indexSessionContext: typeof indexSessionContext;
  indexSessionActivity: typeof indexSessionActivity;
  indexPawWorkflow: typeof indexPawWorkflow;
}

export interface SessionRegistryBackgroundWorkerOptions {
  sessionRoot?: string;
  pollIntervalMs?: number;
  initialDelayMs?: number;
  maxConcurrentSummaries?: number;
  summaryModel?: string;
  summaryTimeoutMs?: number;
  signalSpoolRoot?: string;
  now?: () => Date;
  logger?: Pick<Console, "info" | "warn" | "error">;
  summarizer?: Partial<SummarizerDependencies>;
  /** Optional launch-claim store. When provided, the worker runs the
   * launch-claim binding pass + sweep each cycle and runs
   * reconcileOrphanReservedRows once on startup before the first poll
   * cycle. When omitted, all launch-claim behavior is skipped (NFR-5
   * backward compatibility). */
  claimStore?: LaunchClaimStore;
  /** Optional structured logger for launch-claim diagnostics. Required
   * when `claimStore` is provided so binding-pass and sweep events can
   * be emitted under `withScope("launch-claim")`. */
  claimLogger?: ApiLogger;
  /** Optional live-owner verifier for managed SDK startup reconciliation.
   * Production currently has no cross-process SDK owner proof, so omitted
   * means active Streamliner-owned rows are treated as unverifiable. */
  managedRuntimeOwnerVerifier?: ManagedRuntimeOwnerVerifier;
}

function isLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("locked");
}

function eventsFingerprintFromSummaryFingerprint(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const withoutUserTurns = value.split("|userTurns=", 1)[0] || "";
  return withoutUserTurns.split("|summary=", 1)[0] || null;
}

function summaryFormatVersionFromSummaryFingerprint(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/(?:^|\|)summary=([^|]+)(?:\||$)/);
  return match?.[1] ?? null;
}

function userTurnCountFromSummaryFingerprint(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/(?:^|\|)userTurns=(\d+)(?:\||$)/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function summaryFingerprint(eventsFingerprint: string, userTurnCount: number): string {
  return `${eventsFingerprint}|summary=${SESSION_REGISTRY_SUMMARY_FORMAT_VERSION}|userTurns=${userTurnCount}`;
}

function shouldProcessSessionLog(
  session: SessionRegistryListItem,
): session is SessionRegistryListItem & { copilotSessionId: string } {
  return (
    session.lifecycleStatus !== "archived" &&
    session.copilotSessionId !== null &&
    session.trustedSignalSource !== null
  );
}

export class SessionRegistryBackgroundWorker {
  private readonly store: SessionRegistryFileStore;
  private readonly sessionRoot: string;
  private readonly pollIntervalMs: number;
  private readonly initialDelayMs: number;
  private readonly maxConcurrentSummaries: number;
  private readonly summaryModel: string;
  private readonly summaryTimeoutMs: number;
  private readonly signalSpoolRoot: string | undefined;
  private readonly now: () => Date;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private readonly summarizer: SummarizerDependencies;
  private readonly claimStore: LaunchClaimStore | null;
  private readonly claimLogger: ApiLogger | null;
  private readonly managedRuntimeOwnerVerifier: ManagedRuntimeOwnerVerifier | undefined;

  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private hasReconciledOnStartup = false;

  constructor(
    store: SessionRegistryFileStore,
    options: SessionRegistryBackgroundWorkerOptions = {},
  ) {
    this.store = store;
    this.sessionRoot = options.sessionRoot ?? getDefaultCopilotSessionStateRoot();
    this.pollIntervalMs = options.pollIntervalMs ?? SESSION_REGISTRY_WORKER_POLL_INTERVAL_MS;
    this.initialDelayMs =
      options.initialDelayMs ?? SESSION_REGISTRY_WORKER_INITIAL_DELAY_MS;
    this.maxConcurrentSummaries =
      options.maxConcurrentSummaries ?? SESSION_REGISTRY_WORKER_MAX_CONCURRENCY;
    this.summaryModel = options.summaryModel ?? DEFAULT_SUMMARY_MODEL;
    this.summaryTimeoutMs = options.summaryTimeoutMs ?? 60_000;
    this.signalSpoolRoot = options.signalSpoolRoot;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? console;
    this.claimStore = options.claimStore ?? null;
    this.claimLogger = options.claimLogger ?? null;
    this.managedRuntimeOwnerVerifier = options.managedRuntimeOwnerVerifier;
    this.summarizer = {
      computeEventsFingerprint:
        options.summarizer?.computeEventsFingerprint ?? computeEventsFingerprint,
      countUserMessageTurns:
        options.summarizer?.countUserMessageTurns ?? countUserMessageTurns,
      extractRecentUserTurns:
        options.summarizer?.extractRecentUserTurns ?? extractRecentUserTurns,
      summarizeSession: options.summarizer?.summarizeSession ?? summarizeSession,
      indexSessionContext: options.summarizer?.indexSessionContext ?? indexSessionContext,
      indexSessionActivity: options.summarizer?.indexSessionActivity ?? indexSessionActivity,
      indexPawWorkflow: options.summarizer?.indexPawWorkflow ?? indexPawWorkflow,
    };
  }

  start(): void {
    if (this.timer) {
      return;
    }
    // Startup recovery runs synchronously before the first poll cycle so
    // stale managed runtime rows and orphan launch reservations cannot
    // masquerade as active work during the first projection pass.
    if (!this.hasReconciledOnStartup) {
      try {
        const result = reconcileManagedRuntimeStartupRows(this.store, {
          now: this.now,
          isOwnerLive: this.managedRuntimeOwnerVerifier,
          logger: this.logger,
        });
        if (
          result.rowsReconciled > 0 ||
          result.rowsSkippedLiveOwner > 0 ||
          result.rowsSkippedTerminalTakeover > 0 ||
          result.rowsSkippedTerminalTakeoverSdkOwnedAnomaly > 0 ||
          result.rowsFailed > 0
        ) {
          this.logger.info(
            `[session-worker] managed-runtime startup reconciliation: examined=${result.rowsExamined} active=${result.activeRowsFound} reconciled=${result.rowsReconciled} liveSkipped=${result.rowsSkippedLiveOwner} takeoverSkipped=${result.rowsSkippedTerminalTakeover} takeoverAnomalySkipped=${result.rowsSkippedTerminalTakeoverSdkOwnedAnomaly} failed=${result.rowsFailed}`,
          );
        }
      } catch (error) {
        this.logger.warn("[session-worker] managed-runtime startup reconciliation failed", error);
      }
      if (this.claimStore) {
        try {
          const result = reconcileOrphanReservedRows(this.store, this.claimStore);
          if (result.rowsDeleted > 0 || result.rowsGraphBindingCleared > 0) {
            this.logger.info(
              `[session-worker] launch-claim startup reconciliation: deleted=${result.rowsDeleted} graphBindingCleared=${result.rowsGraphBindingCleared}`,
            );
          }
        } catch (error) {
          this.logger.warn("[session-worker] launch-claim startup reconciliation failed", error);
        }
      }
      this.hasReconciledOnStartup = true;
    }
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.runCycle();
    }, this.initialDelayMs);
    this.timer = setInterval(() => {
      void this.runCycle();
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await shutdownSharedCopilotClient();
  }

  async runCycle(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      try {
        drainTrustedSessionSignalSpool(this.store, {
          rootDir: this.signalSpoolRoot,
          logger: this.logger,
          onSignalApplied: this.claimStore && this.claimLogger
            ? (signal) => {
                this.tryBindClaimViaTrustedSignal(signal);
              }
            : undefined,
        });
      } catch (error) {
        this.logger.warn("[session-worker] trusted signal drain failed", error);
      }
      // Capture one discovery snapshot for both the registry sync and the
      // launch-claim binding pass to avoid double-scanning and to
      // guarantee within-cycle consistency.
      let discoveredSessions: DiscoveredCopilotSession[] = [];
      try {
        discoveredSessions = discoverCopilotSessions(this.sessionRoot);
      } catch (error) {
        if (!isLockedError(error)) {
          this.logger.warn("[session-worker] Copilot session discovery scan failed", error);
        }
      }
      try {
        syncDiscoveredCopilotSessions(this.store, this.sessionRoot, discoveredSessions);
      } catch (error) {
        if (!isLockedError(error)) {
          this.logger.warn("[session-worker] Copilot session discovery sync failed", error);
        }
      }
      if (this.claimStore && this.claimLogger) {
        try {
          await runLaunchClaimBindingPass({
            registryStore: this.store,
            claimStore: this.claimStore,
            discoveredSessions,
            sessionStateRoot: this.sessionRoot,
            now: this.now,
            logger: this.claimLogger.withScope("launch-claim.binding"),
          });
        } catch (error) {
          if (!isLockedError(error)) {
            this.logger.warn("[session-worker] launch-claim binding failed", error);
          }
        }
        try {
          runLaunchClaimSweep({
            registryStore: this.store,
            claimStore: this.claimStore,
            now: this.now,
            logger: this.claimLogger.withScope("launch-claim.sweep"),
          });
        } catch (error) {
          if (!isLockedError(error)) {
            this.logger.warn("[session-worker] launch-claim sweep failed", error);
          }
        }
      }
      this.indexSessionActivities();
      this.indexSessionContexts();
      this.indexSessionPawWorkflows();
      const candidates = this.collectSummaryCandidates().slice(0, this.maxConcurrentSummaries);
      await Promise.all(candidates.map((candidate) => this.summarizeCandidate(candidate)));
    } catch (error) {
      this.logger.error("[session-worker] cycle failed", error);
    } finally {
      this.running = false;
    }
  }

  /**
   * Tier 2 launch-claim binding hook. Called from the trusted-signal
   * spool drain `onSignalApplied` callback after a `session.started`
   * signal carrying `launchClaimId` has been recorded. Failures are
   * logged via the claim logger and never propagate to the drain.
   */
  private tryBindClaimViaTrustedSignal(
    signal: SessionRegistryTrustedSignalInput,
  ): void {
    if (!this.claimStore || !this.claimLogger) return;
    if (signal.event !== "session.started") return;
    if (!signal.launchClaimId) return;
    const bindLogger = this.claimLogger.withScope("launch-claim.binding");
    try {
      const outcome = bindClaimViaTrustedSignal(this.store, this.claimStore, {
        launchClaimId: signal.launchClaimId,
        copilotSessionId: signal.sessionId,
        cwd: signal.cwd,
        branch: signal.branch ?? null,
        repo: signal.repo ?? null,
        at: signal.timestamp,
        now: this.now,
      });
      if (outcome.ok) {
        bindLogger.info("bound-via-hook", {
          event: "launch-claim.bound",
          launchClaimId: outcome.claim.launchClaimId,
          copilotSessionId: signal.sessionId,
          registryId: outcome.registryId,
          workstreamId: outcome.claim.workstreamId,
          nodeId: outcome.claim.nodeId,
          via: "trusted-signal",
          at: signal.timestamp,
        });
      } else if (outcome.reason !== "claim-not-found" && outcome.reason !== "already-bound") {
        bindLogger.warn("bound-via-hook-deferred", {
          event: "launch-claim.bound-via-hook-deferred",
          launchClaimId: signal.launchClaimId,
          copilotSessionId: signal.sessionId,
          reason: outcome.reason,
          detail: outcome.detail ?? null,
        });
      }
    } catch (error) {
      bindLogger.warn("bound-via-hook-failed", {
        event: "launch-claim.bound-via-hook-failed",
        launchClaimId: signal.launchClaimId,
        err: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
    }
  }

  private collectSummaryCandidates(): SummaryCandidate[] {
    const sessions = this.store.listSessions({ includeArchived: true });
    const candidates: SummaryCandidate[] = [];
    for (const session of sessions) {
      if (!shouldProcessSessionLog(session)) {
        continue;
      }
      const eventsPath = join(this.sessionRoot, session.copilotSessionId, "events.jsonl");
      if (!existsSync(eventsPath)) {
        continue;
      }
      const fingerprint = this.summarizer.computeEventsFingerprint(eventsPath);
      if (!fingerprint) {
        continue;
      }
      const eventsChanged =
        eventsFingerprintFromSummaryFingerprint(session.aiSummaryEventsFingerprint) !==
        fingerprint;
      const summaryFormatChanged =
        summaryFormatVersionFromSummaryFingerprint(session.aiSummaryEventsFingerprint) !==
        SESSION_REGISTRY_SUMMARY_FORMAT_VERSION;
      const needsSummary =
        session.aiSummaryStatus === "ready"
          ? eventsChanged || summaryFormatChanged || session.aiSummary === null
          : session.aiSummaryStatus === "missing"
            ? eventsChanged || summaryFormatChanged || session.aiSummaryEventsFingerprint === null
            : true;
      if (!needsSummary) {
        continue;
      }
      candidates.push({ session, eventsPath, fingerprint });
    }
    return candidates;
  }

  private indexSessionContexts(): void {
    const sessions = this.store.listSessions({ includeArchived: true });
    for (const session of sessions) {
      if (!shouldProcessSessionLog(session)) {
        continue;
      }
      const eventsPath = join(this.sessionRoot, session.copilotSessionId, "events.jsonl");
      try {
        const patch = this.summarizer.indexSessionContext(session, eventsPath, {
          now: this.now,
        });
        if (patch) {
          this.tryPatch(session.id, patch);
        }
      } catch (error) {
        this.logger.warn(
          `[session-worker] context indexing failed for ${session.id}`,
          error,
        );
      }
    }
  }

  private indexSessionActivities(): void {
    const sessions = this.store.listSessions({ includeArchived: true });
    for (const session of sessions) {
      if (!shouldProcessSessionLog(session)) {
        continue;
      }
      const eventsPath = join(this.sessionRoot, session.copilotSessionId, "events.jsonl");
      try {
        const patch = this.summarizer.indexSessionActivity(session, eventsPath, {
          now: this.now,
        });
        if (patch) {
          this.tryPatch(session.id, patch);
        }
      } catch (error) {
        this.logger.warn(
          `[session-worker] activity indexing failed for ${session.id}`,
          error,
        );
      }
    }
  }

  private indexSessionPawWorkflows(): void {
    const sessions = this.store.listSessions({ includeArchived: true });
    for (const session of sessions) {
      if (session.lifecycleStatus === "archived") {
        continue;
      }
      try {
        const expectedWorkDir = this.expectedPawWorkDirFor(session);
        if (!expectedWorkDir) {
          if (session.pawWorkflow) {
            this.tryPatch(session.id, { pawWorkflow: null });
          }
          continue;
        }
        const patch = this.summarizer.indexPawWorkflow(session, {
          expectedWorkDir,
          now: this.now,
        });
        if (patch) {
          this.tryPatch(session.id, patch);
        }
      } catch (error) {
        this.logger.warn(
          `[session-worker] PAW artifact indexing failed for ${session.id}`,
          error,
        );
      }
    }
  }

  private expectedPawWorkDirFor(session: SessionRegistryListItem): string | null {
    if (session.originKind !== "launched") {
      return null;
    }

    const launchedPawWorkDir = session.pawLaunch?.pawWorkDir;
    if (launchedPawWorkDir && launchedPawWorkDir.trim().length > 0) {
      return launchedPawWorkDir;
    }

    const launchClaimId = session.graphBinding?.launchClaimId;
    if (!launchClaimId || !this.claimStore) {
      return null;
    }
    const claim = this.claimStore.getClaim(launchClaimId);
    const pawWorkDir = claim?.lineageMetadata?.pawWorkDir;
    return typeof pawWorkDir === "string" && pawWorkDir.trim().length > 0
      ? pawWorkDir
      : null;
  }

  private async summarizeCandidate(candidate: SummaryCandidate): Promise<void> {
    try {
      const totalUserTurns = await this.summarizer.countUserMessageTurns(candidate.eventsPath);
      const nextFingerprint = summaryFingerprint(candidate.fingerprint, totalUserTurns);
      if (totalUserTurns === 0) {
        this.tryPatch(candidate.session.id, {
          aiSummary: null,
          aiSummaryModel: null,
          aiSummaryUpdatedAt: null,
          aiSummaryEventsFingerprint: nextFingerprint,
          aiSummaryStatus: "missing",
          aiSummaryError: null,
        });
        return;
      }

      const lastSummaryTurnCount = userTurnCountFromSummaryFingerprint(
        candidate.session.aiSummaryEventsFingerprint,
      );
      const summaryFormatChanged =
        summaryFormatVersionFromSummaryFingerprint(candidate.session.aiSummaryEventsFingerprint) !==
        SESSION_REGISTRY_SUMMARY_FORMAT_VERSION;
      if (
        candidate.session.aiSummaryStatus === "ready" &&
        candidate.session.aiSummary !== null &&
        !summaryFormatChanged &&
        lastSummaryTurnCount !== null &&
        totalUserTurns - lastSummaryTurnCount < SESSION_REGISTRY_SUMMARY_REFRESH_USER_TURNS
      ) {
        this.tryPatch(candidate.session.id, {
          aiSummaryEventsFingerprint: summaryFingerprint(
            candidate.fingerprint,
            lastSummaryTurnCount,
          ),
          aiSummaryStatus: "ready",
          aiSummaryError: null,
        });
        return;
      }

      const turns = await this.summarizer.extractRecentUserTurns(candidate.eventsPath, {
        maxTurns: 4,
        maxCharsPerTurn: 1500,
      });
      if (turns.length === 0) {
        this.tryPatch(candidate.session.id, {
          aiSummary: null,
          aiSummaryModel: null,
          aiSummaryUpdatedAt: null,
          aiSummaryEventsFingerprint: nextFingerprint,
          aiSummaryStatus: "missing",
          aiSummaryError: null,
        });
        return;
      }

      this.tryPatch(candidate.session.id, {
        aiSummaryStatus: "pending",
        aiSummaryEventsFingerprint: nextFingerprint,
        aiSummaryError: null,
      });

      const result = await this.summarizer.summarizeSession({
        turns,
        context: {
          title: candidate.session.title,
          repo: candidate.session.repo,
          branch: candidate.session.branch,
          cwd: candidate.session.cwd,
        },
        model: this.summaryModel,
        timeoutMs: this.summaryTimeoutMs,
      });

      if (!result.summary.trim()) {
        throw new Error("Summary model returned empty content.");
      }

      this.tryPatch(candidate.session.id, {
        aiSummary: result.summary,
        aiSummaryModel: result.model,
        aiSummaryUpdatedAt: this.now().toISOString(),
        aiSummaryEventsFingerprint: nextFingerprint,
        aiSummaryStatus: "ready",
        aiSummaryError: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[session-worker] summary failed for ${candidate.session.id}: ${message}`);
      this.tryPatch(candidate.session.id, {
        aiSummaryStatus: "error",
        aiSummaryEventsFingerprint: candidate.fingerprint,
        aiSummaryError: message,
      });
    }
  }

  private tryPatch(id: string, patch: SessionRegistryDerivedStatePatch): void {
    try {
      this.store.patchDerivedSessionState(id, patch);
    } catch (error) {
      if (isLockedError(error)) {
        return;
      }
      throw error;
    }
  }
}

let sharedWorker: SessionRegistryBackgroundWorker | null = null;

export function ensureSessionRegistryBackgroundWorkerStarted(
  store: SessionRegistryFileStore,
  options?: SessionRegistryBackgroundWorkerOptions,
): SessionRegistryBackgroundWorker {
  if (!sharedWorker) {
    sharedWorker = new SessionRegistryBackgroundWorker(store, options);
    sharedWorker.start();
  }
  return sharedWorker;
}

export async function stopSessionRegistryBackgroundWorker(): Promise<void> {
  if (!sharedWorker) {
    return;
  }
  const worker = sharedWorker;
  sharedWorker = null;
  await worker.stop();
}
