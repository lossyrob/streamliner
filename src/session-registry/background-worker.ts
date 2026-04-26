import { existsSync } from "node:fs";
import { join } from "node:path";

import type { SessionRegistryListItem } from "../session-registry-contract";
import { getDefaultCopilotSessionStateRoot } from "./copilot-session-discovery";
import {
  computeEventsFingerprint,
  DEFAULT_SUMMARY_MODEL,
  extractRecentUserTurns,
  shutdownSharedCopilotClient,
  summarizeSession,
  type SummarizeSessionResult,
} from "./session-summarizer";
import { indexSessionContext } from "./session-context-indexer";
import { indexSessionActivity } from "./session-activity-indexer";
import {
  SessionRegistryFileStore,
  type SessionRegistryDerivedStatePatch,
} from "./file-store";
import { drainTrustedSessionSignalSpool } from "./trusted-session-signals";

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

  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

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
    this.summarizer = {
      computeEventsFingerprint:
        options.summarizer?.computeEventsFingerprint ?? computeEventsFingerprint,
      extractRecentUserTurns:
        options.summarizer?.extractRecentUserTurns ?? extractRecentUserTurns,
      summarizeSession: options.summarizer?.summarizeSession ?? summarizeSession,
      indexSessionContext: options.summarizer?.indexSessionContext ?? indexSessionContext,
      indexSessionActivity: options.summarizer?.indexSessionActivity ?? indexSessionActivity,
    };
  }

  start(): void {
    if (this.timer) {
      return;
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
        });
      } catch (error) {
        this.logger.warn("[session-worker] trusted signal drain failed", error);
      }
      this.indexSessionActivities();
      this.indexSessionContexts();
      const candidates = this.collectSummaryCandidates().slice(0, this.maxConcurrentSummaries);
      await Promise.all(candidates.map((candidate) => this.summarizeCandidate(candidate)));
    } catch (error) {
      this.logger.error("[session-worker] cycle failed", error);
    } finally {
      this.running = false;
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

  private async summarizeCandidate(candidate: SummaryCandidate): Promise<void> {
    try {
      const turns = await this.summarizer.extractRecentUserTurns(candidate.eventsPath, {
        maxTurns: 4,
        maxCharsPerTurn: 1500,
      });
      const totalUserTurns = turns.at(-1)?.absoluteIndex ?? 0;
      const nextFingerprint = summaryFingerprint(candidate.fingerprint, totalUserTurns);
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
