import { existsSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";

import {
  type DiscoveredCopilotSession,
  getDefaultCopilotSessionStateRoot,
} from "./copilot-session-discovery";
import { SessionRegistryFileStore } from "./file-store";
import {
  type LaunchClaim,
  type LaunchClaimEvidenceAttempt,
  type LaunchClaimEvidenceDecision,
  type LaunchClaimEvidenceReason,
} from "../launch-claim-schema";
import {
  type LaunchClaimStore,
  LaunchClaimNotFoundError,
} from "../launch-claim-contract";
import type { ScopedLogger } from "../server/logger";

const DEFAULT_NONCE_SCAN_BYTE_CAP = 256 * 1024;
const DEFAULT_NONCE_SCAN_USER_MESSAGE_CAP = 50;

export interface LaunchClaimBindingPassOptions {
  registryStore: SessionRegistryFileStore;
  claimStore: LaunchClaimStore;
  /**
   * Discovered Copilot CLI sessions snapshot for this poll cycle. The
   * background worker captures this once per runCycle and shares it
   * between syncDiscoveredCopilotSessions and the binding pass to
   * avoid double-scanning the session-state root and to guarantee
   * within-cycle consistency.
   */
  discoveredSessions: ReadonlyArray<DiscoveredCopilotSession>;
  /** Defaults to ~/.copilot/session-state/. */
  sessionStateRoot?: string;
  now: () => Date;
  logger: ScopedLogger;
  /** Defaults to comparing pathKey-normalized strings. */
  pathCompare?: (a: string, b: string) => boolean;
  /** Defaults to 256 KB tail per scan. */
  maxScanBytesPerSession?: number;
  /** Defaults to 50 user.message events per scan. */
  maxUserMessagesPerScan?: number;
}

export interface LaunchClaimBindingPassResult {
  claimsConsidered: number;
  claimsBoundThisCycle: number;
  claimsTransitionedToAmbiguous: number;
}

interface CandidateNonceMatch {
  copilotSessionId: string;
  nonceMatch: boolean;
  byteOffset: number | null;
  eventIndex: number | null;
  eventsFileUnreadable: boolean;
  scanCutoffReached: boolean;
}

function pathKeyForCompare(value: string): string {
  const resolved = resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function defaultPathCompare(a: string, b: string): boolean {
  return pathKeyForCompare(a) === pathKeyForCompare(b);
}

function eventsPathFor(sessionStateRoot: string, copilotSessionId: string): string {
  return join(sessionStateRoot, copilotSessionId, "events.jsonl");
}

function extractUserMessageContent(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const data = (parsed as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const content = (data as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const pieces = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : null;
        }
        return null;
      })
      .filter((piece): piece is string => piece !== null);
    return pieces.length > 0 ? pieces.join("\n") : null;
  }
  if (typeof content === "object" && content !== null && "text" in content) {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text : null;
  }
  return null;
}

/**
 * Scans the head of a session's events.jsonl for the launch nonce.
 * Reads up to `maxScanBytesPerSession` bytes OR `maxUserMessagesPerScan`
 * user.message events, whichever comes first. Returns whether the nonce
 * was found and the byte/event offset for evidence.
 */
async function scanEventsFileForNonce(
  eventsPath: string,
  nonce: string,
  maxScanBytes: number,
  maxUserMessages: number,
): Promise<CandidateNonceMatch> {
  const result: CandidateNonceMatch = {
    copilotSessionId: "",
    nonceMatch: false,
    byteOffset: null,
    eventIndex: null,
    eventsFileUnreadable: false,
    scanCutoffReached: false,
  };
  if (!existsSync(eventsPath)) {
    result.eventsFileUnreadable = true;
    return result;
  }
  let stat;
  try {
    stat = statSync(eventsPath);
  } catch {
    result.eventsFileUnreadable = true;
    return result;
  }
  const end = Math.min(stat.size, maxScanBytes);
  if (end === 0) {
    return result;
  }
  let stream: import("node:fs").ReadStream;
  try {
    stream = createReadStream(eventsPath, { encoding: "utf8", start: 0, end: end - 1 });
  } catch {
    result.eventsFileUnreadable = true;
    return result;
  }
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  let userMessageIndex = 0;
  let bytesRead = 0;
  for await (const line of lines) {
    bytesRead += line.length + 1;
    if (!line || line[0] !== "{") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const type = (parsed as { type?: unknown }).type;
    if (type !== "user.message") continue;
    const content = extractUserMessageContent(parsed);
    if (!content) continue;
    userMessageIndex += 1;
    if (content.includes(nonce)) {
      result.nonceMatch = true;
      result.byteOffset = bytesRead;
      result.eventIndex = userMessageIndex;
      stream.destroy();
      return result;
    }
    if (userMessageIndex >= maxUserMessages) {
      result.scanCutoffReached = true;
      stream.destroy();
      return result;
    }
  }
  if (stat.size > maxScanBytes) {
    result.scanCutoffReached = true;
  }
  return result;
}

function makeAttempt(
  at: string,
  candidateCopilotSessionId: string | null,
  decision: LaunchClaimEvidenceDecision,
  reason: LaunchClaimEvidenceReason,
  match: { nonceMatch: boolean; byteOffset: number | null; eventIndex: number | null },
  cwdMatch: boolean,
  branchMatch: boolean | null,
  repoMatch: boolean | null,
): LaunchClaimEvidenceAttempt {
  return {
    at,
    candidateCopilotSessionId,
    decision,
    reason,
    nonceMatch: match.nonceMatch,
    nonceScanByteOffset: match.byteOffset,
    nonceScanEventIndex: match.eventIndex,
    cwdMatch,
    branchMatch,
    repoMatch,
  };
}

function appendEvidenceIfNew(
  claim: LaunchClaim,
  attempt: LaunchClaimEvidenceAttempt,
): LaunchClaim {
  // Dedup by (candidate, decision) so reruns on unchanged inputs are no-ops.
  const exists = claim.evidence.attempts.some(
    (existing) =>
      existing.candidateCopilotSessionId === attempt.candidateCopilotSessionId &&
      existing.decision === attempt.decision &&
      existing.reason === attempt.reason,
  );
  if (exists) {
    return claim;
  }
  return {
    ...claim,
    evidence: {
      attempts: [...claim.evidence.attempts, attempt],
    },
  };
}

function addSeenCandidate(claim: LaunchClaim, copilotSessionId: string): LaunchClaim {
  if (claim.seenCandidateCopilotSessionIds.includes(copilotSessionId)) {
    return claim;
  }
  return {
    ...claim,
    seenCandidateCopilotSessionIds: [
      ...claim.seenCandidateCopilotSessionIds,
      copilotSessionId,
    ],
  };
}

interface ResolvedCandidate {
  session: DiscoveredCopilotSession;
  cwdMatch: boolean;
  branchMatch: boolean | null;
  repoMatch: boolean | null;
}

function classifyCandidate(
  claim: LaunchClaim,
  session: DiscoveredCopilotSession,
  pathCompare: (a: string, b: string) => boolean,
): ResolvedCandidate | null {
  if (!pathCompare(session.cwd, claim.expectedCwd)) {
    return null;
  }
  let branchMatch: boolean | null = null;
  if (claim.expectedBranch !== null) {
    branchMatch = session.branch === claim.expectedBranch;
    if (!branchMatch) return null;
  }
  let repoMatch: boolean | null = null;
  if (claim.expectedRepo !== null) {
    repoMatch = session.repo === claim.expectedRepo;
    if (!repoMatch) return null;
  }
  return {
    session,
    cwdMatch: true,
    branchMatch,
    repoMatch,
  };
}

/**
 * Runs one launch-claim binding pass. Iterates over pending claims in
 * the claim store and attempts to bind discovered Copilot sessions to
 * them via the FR-5 algorithm. Idempotent: rerunning on unchanged
 * inputs produces no new evidence entries.
 */
export async function runLaunchClaimBindingPass(
  options: LaunchClaimBindingPassOptions,
): Promise<LaunchClaimBindingPassResult> {
  const sessionStateRoot = options.sessionStateRoot ?? getDefaultCopilotSessionStateRoot();
  const pathCompare = options.pathCompare ?? defaultPathCompare;
  const maxScanBytes = options.maxScanBytesPerSession ?? DEFAULT_NONCE_SCAN_BYTE_CAP;
  const maxUserMessages = options.maxUserMessagesPerScan ?? DEFAULT_NONCE_SCAN_USER_MESSAGE_CAP;
  const nowIso = options.now().toISOString();
  const nowMs = options.now().getTime();
  const result: LaunchClaimBindingPassResult = {
    claimsConsidered: 0,
    claimsBoundThisCycle: 0,
    claimsTransitionedToAmbiguous: 0,
  };

  const pendingEntries = options.claimStore.listClaims({ status: "pending" });
  for (const entry of pendingEntries) {
    const claim = options.claimStore.getClaim(entry.launchClaimId);
    if (!claim) continue;
    if (claim.status !== "pending") continue;
    const launchedAtMs = Date.parse(claim.launchedAt);
    if (Number.isFinite(launchedAtMs) && nowMs > launchedAtMs + claim.bindingWindowMs) {
      // Claim window already closed; sweep will handle the transition.
      continue;
    }
    result.claimsConsidered += 1;

    // Step 1: narrow to candidate sessions by cwd/branch/repo.
    const candidates: ResolvedCandidate[] = [];
    for (const session of options.discoveredSessions) {
      const classified = classifyCandidate(claim, session, pathCompare);
      if (classified) candidates.push(classified);
    }

    if (candidates.length === 0) {
      // Append a no-candidates evidence entry once (deduped by (null, decision, reason)).
      const attempt = makeAttempt(
        nowIso,
        null,
        "wait-for-more-evidence",
        "no-candidates",
        { nonceMatch: false, byteOffset: null, eventIndex: null },
        false,
        null,
        null,
      );
      try {
        options.claimStore.updateClaim(claim.launchClaimId, (current) =>
          appendEvidenceIfNew(current, attempt),
        );
      } catch (error) {
        if (!(error instanceof LaunchClaimNotFoundError)) throw error;
      }
      continue;
    }

    // Step 2: scan each candidate for the nonce.
    const matches: Array<{ candidate: ResolvedCandidate; scan: CandidateNonceMatch }> = [];
    for (const candidate of candidates) {
      const eventsPath = eventsPathFor(sessionStateRoot, candidate.session.sessionId);
      const scan = await scanEventsFileForNonce(
        eventsPath,
        claim.launchNonce,
        maxScanBytes,
        maxUserMessages,
      );
      scan.copilotSessionId = candidate.session.sessionId;
      matches.push({ candidate, scan });
    }

    const matched = matches.filter((m) => m.scan.nonceMatch);

    // Step 3: decide.
    if (matched.length > 1) {
      // Ambiguous. Transition the claim to ambiguous (terminal).
      try {
        options.claimStore.updateClaim(claim.launchClaimId, (current) => {
          let next = current;
          for (const m of matched) {
            next = appendEvidenceIfNew(
              next,
              makeAttempt(
                nowIso,
                m.scan.copilotSessionId,
                "ambiguous",
                "nonce-match-multiple",
                m.scan,
                true,
                m.candidate.branchMatch,
                m.candidate.repoMatch,
              ),
            );
            next = addSeenCandidate(next, m.scan.copilotSessionId);
          }
          return {
            ...next,
            status: "ambiguous",
            failureCode: "ambiguous-candidates",
            failureReason: "Multiple Copilot sessions in expectedCwd matched nonce.",
            updatedAt: nowIso,
          };
        });
        result.claimsTransitionedToAmbiguous += 1;
        options.logger.warn("launch-claim.ambiguous", {
          event: "launch-claim.launch-claim-ambiguous",
          launchClaimId: claim.launchClaimId,
          workstreamId: claim.workstreamId,
          nodeId: claim.nodeId,
          candidateCount: matched.length,
          at: nowIso,
        });
      } catch (error) {
        if (!(error instanceof LaunchClaimNotFoundError)) throw error;
      }
      continue;
    }

    if (matched.length === 1) {
      const { candidate, scan } = matched[0];
      const candidateSessionId = candidate.session.sessionId;

      // Persist seenCandidate + bind action atomically via updateClaim AFTER successful row write.
      // First, attempt the row-side binding.
      let bindOutcome: "bound" | "wait" = "wait";
      let bindReason: LaunchClaimEvidenceReason = "row-attached-during-cleanup-window";
      let boundRegistryId: string | null = null;

      if (claim.reservedRegistryId !== null) {
        // Path A: prefer fusion when there's a separate observed row.
        const observedRowId =
          options.registryStore.findRecordIdByCopilotSession(candidateSessionId);
        const reservedRow = options.registryStore.getSession(claim.reservedRegistryId);
        if (!reservedRow) {
          // Reserved row vanished; treat as wait (sweep may transition the claim later).
          bindOutcome = "wait";
          bindReason = "row-attached-during-cleanup-window";
        } else if (observedRowId && observedRowId !== claim.reservedRegistryId) {
          const fuseResult = options.registryStore.fuseObservedRowIntoReservedRow({
            reservedRowId: claim.reservedRegistryId,
            observedRowId,
            bindClaim: {
              workstreamId: claim.workstreamId,
              nodeId: claim.nodeId,
              launchClaimId: claim.launchClaimId,
            },
          });
          if (fuseResult.ok) {
            bindOutcome = "bound";
            bindReason = "duplicate-observed-row-deleted";
            boundRegistryId = claim.reservedRegistryId;
          } else {
            bindOutcome = "wait";
            bindReason = "row-attached-during-cleanup-window";
            options.logger.info("launch-claim.fuse-deferred", {
              event: "launch-claim.fuse-deferred",
              launchClaimId: claim.launchClaimId,
              reason: fuseResult.reason,
              detail: fuseResult.detail ?? null,
            });
          }
        } else if (observedRowId === claim.reservedRegistryId) {
          // Reserved row already attached to the candidate; just confirm the binding.
          const bindResult = options.registryStore.bindClaimToRow(
            claim.reservedRegistryId,
            {
              cwdAfterNormalize: reservedRow.cwd,
              branch: claim.expectedBranch,
              repo: claim.expectedRepo,
              requireGraphBindingNullOrMatching: {
                workstreamId: claim.workstreamId,
                nodeId: claim.nodeId,
                launchClaimId: claim.launchClaimId,
              },
            },
            {
              graphBinding: {
                workstreamId: claim.workstreamId,
                nodeId: claim.nodeId,
                launchClaimId: claim.launchClaimId,
              },
            },
            pathCompare,
          );
          if (bindResult.ok) {
            bindOutcome = "bound";
            bindReason = "nonce-match-single";
            boundRegistryId = claim.reservedRegistryId;
          }
        } else {
          // observedRowId is null — discovery hasn't created a row yet. Wait one more cycle.
          bindOutcome = "wait";
          bindReason = "awaiting-registry-row";
        }
      } else {
        // Path B: write graphBinding directly onto the existing observed row.
        const observedRowId =
          options.registryStore.findRecordIdByCopilotSession(candidateSessionId);
        if (observedRowId === null) {
          bindOutcome = "wait";
          bindReason = "awaiting-registry-row";
        } else {
          const observedRow = options.registryStore.getSession(observedRowId);
          if (!observedRow) {
            bindOutcome = "wait";
            bindReason = "row-attached-during-cleanup-window";
          } else {
            const bindResult = options.registryStore.bindClaimToRow(
              observedRowId,
              {
                cwdAfterNormalize: claim.expectedCwd,
                branch: claim.expectedBranch,
                repo: claim.expectedRepo,
                requireGraphBindingNullOrMatching: {
                  workstreamId: claim.workstreamId,
                  nodeId: claim.nodeId,
                  launchClaimId: claim.launchClaimId,
                },
              },
              {
                graphBinding: {
                  workstreamId: claim.workstreamId,
                  nodeId: claim.nodeId,
                  launchClaimId: claim.launchClaimId,
                },
              },
              pathCompare,
            );
            if (bindResult.ok) {
              bindOutcome = "bound";
              bindReason = "nonce-match-single";
              boundRegistryId = observedRowId;
            } else {
              bindOutcome = "wait";
              if (bindResult.reason === "graph-binding-conflict") {
                bindReason = "row-attached-during-cleanup-window";
                options.logger.warn("launch-claim.rebind-attempt", {
                  event: "launch-claim.launch-claim-rebind-attempt",
                  launchClaimId: claim.launchClaimId,
                  registryId: observedRowId,
                  detail: bindResult.detail ?? null,
                });
              } else if (bindResult.reason === "branch-changed") {
                bindReason = "candidate-branch-mismatch";
              } else if (bindResult.reason === "repo-changed") {
                bindReason = "candidate-repo-mismatch";
              } else {
                bindReason = "candidate-cwd-mismatch-after-recheck";
              }
            }
          }
        }
      }

      try {
        options.claimStore.updateClaim(claim.launchClaimId, (current) => {
          let next = addSeenCandidate(current, candidateSessionId);
          const attempt = makeAttempt(
            nowIso,
            candidateSessionId,
            bindOutcome === "bound" ? "bind" : "wait-for-more-evidence",
            bindReason,
            scan,
            true,
            candidate.branchMatch,
            candidate.repoMatch,
          );
          next = appendEvidenceIfNew(next, attempt);
          if (bindOutcome === "bound") {
            return {
              ...next,
              status: "bound",
              boundCopilotSessionId: candidateSessionId,
              boundRegistryId,
              updatedAt: nowIso,
            };
          }
          return next;
        });
        if (bindOutcome === "bound") {
          result.claimsBoundThisCycle += 1;
          options.logger.info("launch-claim.bound", {
            event: "launch-claim.bound",
            launchClaimId: claim.launchClaimId,
            copilotSessionId: candidateSessionId,
            registryId: boundRegistryId,
            workstreamId: claim.workstreamId,
            nodeId: claim.nodeId,
            at: nowIso,
          });
        }
      } catch (error) {
        if (!(error instanceof LaunchClaimNotFoundError)) throw error;
      }
      continue;
    }

    // No matched candidates this cycle. Persist the seen candidates and per-candidate
    // evidence (no-nonce-match, events-file-unreadable, or scan-cutoff-reached).
    try {
      options.claimStore.updateClaim(claim.launchClaimId, (current) => {
        let next = current;
        for (const m of matches) {
          next = addSeenCandidate(next, m.scan.copilotSessionId);
          let reason: LaunchClaimEvidenceReason;
          if (m.scan.eventsFileUnreadable) {
            reason = "events-file-unreadable";
          } else if (m.scan.scanCutoffReached) {
            reason = "events-scan-cutoff-reached";
          } else {
            reason = "no-nonce-match";
          }
          const attempt = makeAttempt(
            nowIso,
            m.scan.copilotSessionId,
            "wait-for-more-evidence",
            reason,
            m.scan,
            true,
            m.candidate.branchMatch,
            m.candidate.repoMatch,
          );
          next = appendEvidenceIfNew(next, attempt);
        }
        return next;
      });
    } catch (error) {
      if (!(error instanceof LaunchClaimNotFoundError)) throw error;
    }
  }

  return result;
}
