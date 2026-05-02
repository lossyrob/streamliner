import {
  type LaunchClaim,
  type LaunchClaimIndexEntry,
  type LaunchClaimStatus,
  LAUNCH_CLAIM_STATUSES,
  LAUNCH_CLAIM_TERMINAL_STATUSES,
} from "../launch-claim-schema";
import {
  type LaunchClaimListOptions,
  type LaunchClaimStore,
} from "../launch-claim-contract";

export const LAUNCH_CLAIMS_API_BASE_PATH = "/api/launch-claims";
export const LAUNCH_CLAIMS_API_DEFAULT_LIMIT = 50;
export const LAUNCH_CLAIMS_API_MAX_LIMIT = 200;
export const LAUNCH_CLAIMS_API_VERSION = 1 as const;
export const LAUNCH_CLAIMS_PRUNE_SOON_WINDOW_MS = 5 * 60 * 1000;

export type LaunchClaimLifecyclePhase =
  | "active-window"
  | "expired-retained"
  | "pruned-soon";

export interface LaunchClaimDerived {
  lifecyclePhase: LaunchClaimLifecyclePhase;
  bindingWindowExpiresAt: string;
  retentionExpiresAt: string;
}

export interface LaunchClaimSummary {
  launchClaimId: string;
  workstreamId: string;
  nodeId: string;
  status: LaunchClaimStatus;
  launchedAt: string;
  derived: LaunchClaimDerived;
  boundCopilotSessionId: string | null;
  boundRegistryId: string | null;
  reservedRegistryId: string | null;
  failureCode: LaunchClaim["failureCode"];
}

export interface LaunchClaimListMeta {
  total: number;
  serverTime: string;
  diagnosticsSummary: {
    pendingCount: number;
    activeWindowCount: number;
    recentBindCount: number;
    recentFailureCount: number;
  };
}

export interface LaunchClaimListResponse {
  apiVersion: typeof LAUNCH_CLAIMS_API_VERSION;
  items: LaunchClaimSummary[];
  /**
   * Reserved for future cursor-based pagination. Always null in this
   * slice; consumers should use `meta.total` to detect when more
   * records exist than `items.length` and either widen the
   * `?status` / `?workstreamId` / `?nodeId` filter or raise
   * `?limit` (max 200). A real cursor protocol is captured as a Phase
   * Candidate; the field stays in the envelope so adding pagination
   * later is non-breaking.
   */
  nextCursor: string | null;
  meta: LaunchClaimListMeta;
}

export interface LaunchClaimDetailResponse {
  apiVersion: typeof LAUNCH_CLAIMS_API_VERSION;
  claim: LaunchClaim;
  derived: LaunchClaimDerived;
}

export interface LaunchClaimsApiRequest {
  method?: string;
  url: string;
}

export interface LaunchClaimsApiResponse {
  statusCode: number;
  body?: unknown;
}

const RECENT_WINDOW_MS = 60 * 60 * 1000;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function parseStatusFilter(raw: string | null): LaunchClaimStatus | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (const part of parts) {
    if (!LAUNCH_CLAIM_STATUSES.includes(part as LaunchClaimStatus)) {
      throw new Error(`Invalid status filter: ${part}`);
    }
  }
  return parts.length === 0 ? undefined : (parts[0] as LaunchClaimStatus);
}

function lifecyclePhaseFor(claim: LaunchClaim, nowMs: number): LaunchClaimDerived {
  const launchedAtMs = Date.parse(claim.launchedAt);
  const updatedAtMs = Date.parse(claim.updatedAt);
  const bindingWindowExpiresAtMs = Number.isFinite(launchedAtMs)
    ? launchedAtMs + claim.bindingWindowMs
    : nowMs;
  const retentionExpiresAtMs = Number.isFinite(updatedAtMs)
    ? updatedAtMs + claim.retentionWindowMs
    : nowMs;
  let phase: LaunchClaimLifecyclePhase;
  if (claim.status === "pending" && nowMs <= bindingWindowExpiresAtMs) {
    phase = "active-window";
  } else if (
    LAUNCH_CLAIM_TERMINAL_STATUSES.has(claim.status) &&
    nowMs > retentionExpiresAtMs - LAUNCH_CLAIMS_PRUNE_SOON_WINDOW_MS
  ) {
    phase = "pruned-soon";
  } else if (LAUNCH_CLAIM_TERMINAL_STATUSES.has(claim.status)) {
    phase = "expired-retained";
  } else {
    // Pending past binding window — sweep will transition; surface as pruned-soon for visibility.
    phase = "pruned-soon";
  }
  return {
    lifecyclePhase: phase,
    bindingWindowExpiresAt: new Date(bindingWindowExpiresAtMs).toISOString(),
    retentionExpiresAt: new Date(retentionExpiresAtMs).toISOString(),
  };
}

function summarize(
  claim: LaunchClaim,
  derived: LaunchClaimDerived,
): LaunchClaimSummary {
  return {
    launchClaimId: claim.launchClaimId,
    workstreamId: claim.workstreamId,
    nodeId: claim.nodeId,
    status: claim.status,
    launchedAt: claim.launchedAt,
    derived,
    boundCopilotSessionId: claim.boundCopilotSessionId,
    boundRegistryId: claim.boundRegistryId,
    reservedRegistryId: claim.reservedRegistryId,
    failureCode: claim.failureCode,
  };
}

function summarizeFromIndexEntry(
  entry: LaunchClaimIndexEntry,
  fullClaim: LaunchClaim | null,
  nowMs: number,
): LaunchClaimSummary {
  if (fullClaim) {
    return summarize(fullClaim, lifecyclePhaseFor(fullClaim, nowMs));
  }
  // Defensive synthetic summary if claim file vanished between list and read.
  return {
    launchClaimId: entry.launchClaimId,
    workstreamId: entry.workstreamId,
    nodeId: entry.nodeId,
    status: entry.status,
    launchedAt: entry.launchedAt,
    derived: {
      lifecyclePhase: "expired-retained",
      bindingWindowExpiresAt: entry.launchedAt,
      retentionExpiresAt: entry.updatedAt,
    },
    boundCopilotSessionId: entry.boundCopilotSessionId,
    boundRegistryId: entry.boundRegistryId,
    reservedRegistryId: entry.reservedRegistryId,
    failureCode: null,
  };
}

function decodePathSegments(pathname: string): string[] {
  const suffix = pathname.slice(LAUNCH_CLAIMS_API_BASE_PATH.length);
  if (suffix.length === 0) return [];
  if (!suffix.startsWith("/")) return ["__no_match__"];
  return suffix
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
}

function buildErrorResponse(error: unknown): LaunchClaimsApiResponse {
  const message = error instanceof Error ? error.message : String(error);
  return { statusCode: 400, body: { error: message } };
}

function buildDiagnosticsSummary(
  claimStore: LaunchClaimStore,
  nowMs: number,
): LaunchClaimListMeta["diagnosticsSummary"] {
  const all = claimStore.listClaims();
  let pendingCount = 0;
  let activeWindowCount = 0;
  let recentBindCount = 0;
  let recentFailureCount = 0;
  for (const entry of all) {
    if (entry.status === "pending") {
      pendingCount += 1;
      const launchedAtMs = Date.parse(entry.launchedAt);
      // Need bindingWindowMs from full record to know if active-window;
      // approximate by checking updatedAt freshness (cheap).
      const updatedAtMs = Date.parse(entry.updatedAt);
      if (Number.isFinite(updatedAtMs) && nowMs - updatedAtMs < RECENT_WINDOW_MS) {
        activeWindowCount += 1;
      }
      void launchedAtMs;
    }
    if (entry.status === "bound") {
      const updatedAtMs = Date.parse(entry.updatedAt);
      if (Number.isFinite(updatedAtMs) && nowMs - updatedAtMs < RECENT_WINDOW_MS) {
        recentBindCount += 1;
      }
    }
    if (
      entry.status === "expired" ||
      entry.status === "nonce-missing" ||
      entry.status === "ambiguous" ||
      entry.status === "failed"
    ) {
      const updatedAtMs = Date.parse(entry.updatedAt);
      if (Number.isFinite(updatedAtMs) && nowMs - updatedAtMs < RECENT_WINDOW_MS) {
        recentFailureCount += 1;
      }
    }
  }
  return {
    pendingCount,
    activeWindowCount,
    recentBindCount,
    recentFailureCount,
  };
}

/**
 * Pure handler for the launch-claims read-only HTTP API. Mirrors the
 * pattern used by `handleSessionRegistryApiRequest`. Returns null when
 * the request is outside this API's surface, or a response object
 * otherwise. Express adapters handle loopback enforcement before
 * calling this function.
 */
export function handleLaunchClaimsApiRequest(
  claimStore: LaunchClaimStore,
  request: LaunchClaimsApiRequest,
  nowFn: () => Date = () => new Date(),
): LaunchClaimsApiResponse | null {
  const url = new URL(request.url, "http://localhost");
  if (!url.pathname.startsWith(LAUNCH_CLAIMS_API_BASE_PATH)) {
    return null;
  }
  const method = request.method?.toUpperCase() ?? "GET";
  const segments = decodePathSegments(url.pathname);
  if (segments[0] === "__no_match__") {
    return null;
  }
  if (method !== "GET") {
    return {
      statusCode: 405,
      body: { error: `Unsupported ${method} ${url.pathname}.` },
    };
  }
  const now = nowFn();
  const nowMs = now.getTime();

  try {
    if (segments.length === 0) {
      const limit = clampInt(
        Number.parseInt(url.searchParams.get("limit") ?? "", 10) ||
          LAUNCH_CLAIMS_API_DEFAULT_LIMIT,
        1,
        LAUNCH_CLAIMS_API_MAX_LIMIT,
      );
      const status = parseStatusFilter(url.searchParams.get("status"));
      const workstreamId = url.searchParams.get("workstreamId") ?? undefined;
      const nodeId = url.searchParams.get("nodeId") ?? undefined;
      const opts: LaunchClaimListOptions = {};
      if (status) opts.status = status;
      if (workstreamId) opts.workstreamId = workstreamId;
      if (nodeId) opts.nodeId = nodeId;
      const totalEntries = claimStore.listClaims(opts);
      const slice = totalEntries.slice(0, limit);
      const items = slice.map((entry) =>
        summarizeFromIndexEntry(
          entry,
          claimStore.getClaim(entry.launchClaimId),
          nowMs,
        ),
      );
      const response: LaunchClaimListResponse = {
        apiVersion: LAUNCH_CLAIMS_API_VERSION,
        items,
        nextCursor: null,
        meta: {
          total: totalEntries.length,
          serverTime: now.toISOString(),
          diagnosticsSummary: buildDiagnosticsSummary(claimStore, nowMs),
        },
      };
      return { statusCode: 200, body: response };
    }

    if (segments.length === 1) {
      const launchClaimId = segments[0];
      const claim = claimStore.getClaim(launchClaimId);
      if (!claim) {
        return {
          statusCode: 404,
          body: { error: `Launch claim ${launchClaimId} not found.` },
        };
      }
      const detail: LaunchClaimDetailResponse = {
        apiVersion: LAUNCH_CLAIMS_API_VERSION,
        claim,
        derived: lifecyclePhaseFor(claim, nowMs),
      };
      return { statusCode: 200, body: detail };
    }

    return null;
  } catch (error) {
    return buildErrorResponse(error);
  }
}
