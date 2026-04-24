import { existsSync } from "node:fs";
import { join } from "node:path";

import type { SessionRegistryListItem } from "../session-registry-contract";
import { getDefaultCopilotSessionStateRoot, syncDiscoveredCopilotSessions } from "./copilot-session-discovery";
import {
  computeEventsFingerprint,
  DEFAULT_SUMMARY_MODEL,
  extractRecentUserTurns,
  shutdownSharedCopilotClient,
  summarizeSession,
  type SummarizeSessionResult,
} from "./session-summarizer";
import {
  SessionRegistryFileStore,
  type SessionRegistryDerivedStatePatch,
} from "./file-store";

export const SESSION_REGISTRY_WORKER_POLL_INTERVAL_MS = 15_000;
export const SESSION_REGISTRY_WORKER_MAX_CONCURRENCY = 2;
export const SESSION_REGISTRY_WORKER_INITIAL_DELAY_MS = 10_000;

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
}

export interface SessionRegistryBackgroundWorkerOptions {
  sessionRoot?: string;
  pollIntervalMs?: number;
  initialDelayMs?: number;
  maxConcurrentSummaries?: number;
  summaryModel?: string;
  summaryTimeoutMs?: number;
  now?: () => Date;
  logger?: Pick<Console, "info" | "warn" | "error">;
  summarizer?: Partial<SummarizerDependencies>;
}

function isLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("locked");
}

export class SessionRegistryBackgroundWorker {
  private readonly store: SessionRegistryFileStore;
  private readonly sessionRoot: string;
  private readonly pollIntervalMs: number;
  private readonly initialDelayMs: number;
  private readonly maxConcurrentSummaries: number;
  private readonly summaryModel: string;
  private readonly summaryTimeoutMs: number;
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
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? console;
    this.summarizer = {
      computeEventsFingerprint:
        options.summarizer?.computeEventsFingerprint ?? computeEventsFingerprint,
      extractRecentUserTurns:
        options.summarizer?.extractRecentUserTurns ?? extractRecentUserTurns,
      summarizeSession: options.summarizer?.summarizeSession ?? summarizeSession,
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
      syncDiscoveredCopilotSessions(this.store, this.sessionRoot);
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
      if (session.lifecycleStatus === "archived" || !session.copilotSessionId) {
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
      const needsSummary =
        session.aiSummaryStatus !== "ready" ||
        session.aiSummaryEventsFingerprint !== fingerprint ||
        session.aiSummary === null;
      if (!needsSummary) {
        continue;
      }
      candidates.push({ session, eventsPath, fingerprint });
    }
    return candidates;
  }

  private async summarizeCandidate(candidate: SummaryCandidate): Promise<void> {
    this.tryPatch(candidate.session.id, {
      aiSummaryStatus: "pending",
      aiSummaryEventsFingerprint: candidate.fingerprint,
      aiSummaryError: null,
    });

    try {
      const turns = await this.summarizer.extractRecentUserTurns(candidate.eventsPath, {
        maxTurns: 4,
        maxCharsPerTurn: 1500,
      });
      if (turns.length === 0) {
        this.tryPatch(candidate.session.id, {
          aiSummary: null,
          aiSummaryModel: null,
          aiSummaryUpdatedAt: null,
          aiSummaryEventsFingerprint: candidate.fingerprint,
          aiSummaryStatus: "missing",
          aiSummaryError: null,
        });
        return;
      }

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
        aiSummaryEventsFingerprint: candidate.fingerprint,
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
