import type { WorkstreamRegistryEntry } from "../workstream-registry-contract";
import {
  DEFAULT_EVENT_KIND,
  DEFAULT_SEVERITY,
  type NotificationRecord,
  type NotificationRequest,
} from "../notification-contract";
import { resolveDashboardBaseUrl } from "./notification-config";

export interface NotificationEnrichmentDeps {
  /** Registered workstreams used to resolve color / short name / project. */
  workstreams?: WorkstreamRegistryEntry[];
  dashboardBaseUrl?: string;
}

export type EnrichedNotificationDraft = Omit<NotificationRecord, "id" | "createdAt">;

export interface EnrichmentResult {
  draft: EnrichedNotificationDraft;
  warnings: string[];
}

function normalizeColor(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().replace(/^#/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function composeLink(
  baseUrl: string,
  projectKey: string,
  workstreamId: string,
  nodeId: string | null,
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const segments = [
    "workstreams",
    encodeURIComponent(projectKey),
    encodeURIComponent(workstreamId),
  ];
  if (nodeId) {
    segments.push("nodes", encodeURIComponent(nodeId));
  }
  return `${base}/${segments.join("/")}`;
}

interface WorkstreamMatch {
  entry: WorkstreamRegistryEntry | null;
  ambiguous: boolean;
}

function matchWorkstream(
  workstreams: WorkstreamRegistryEntry[],
  workstreamId: string,
  projectKey: string | undefined,
): WorkstreamMatch {
  if (projectKey) {
    const exact = workstreams.find(
      (entry) => entry.projectKey === projectKey && entry.workstreamId === workstreamId,
    );
    return { entry: exact ?? null, ambiguous: false };
  }

  const byId = workstreams.filter((entry) => entry.workstreamId === workstreamId);
  if (byId.length === 1) {
    return { entry: byId[0], ambiguous: false };
  }
  if (byId.length > 1) {
    return { entry: null, ambiguous: true };
  }

  const byShortName = workstreams.filter(
    (entry) => entry.presentation?.shortName === workstreamId,
  );
  if (byShortName.length === 1) {
    return { entry: byShortName[0], ambiguous: false };
  }
  if (byShortName.length > 1) {
    return { entry: null, ambiguous: true };
  }

  return { entry: null, ambiguous: false };
}

/**
 * Resolve registry-derived fields (`projectKey`, `workstreamColor`,
 * `workstreamShortName`) and an absolute deep `link` for a notification request.
 *
 * Resolution is best-effort and never throws on a registry miss: unknown
 * workstreams simply yield null enrichment. An ambiguous unqualified
 * workstream id (the id is only unique within a `projectKey`) is NOT guessed —
 * the notification is still created, but the project/color/short-name/derived
 * link are left null and a warning advises passing `projectKey`.
 *
 * Validation of the request (required fields, enums, explicit-link scheme) is
 * the route's responsibility; this function assumes a validated request.
 */
export function enrichNotification(
  request: NotificationRequest,
  deps: NotificationEnrichmentDeps = {},
): EnrichmentResult {
  const workstreams = deps.workstreams ?? [];
  const dashboardBaseUrl = deps.dashboardBaseUrl ?? resolveDashboardBaseUrl();
  const warnings: string[] = [];

  const workstreamId = request.workstreamId ?? null;
  const nodeId = request.nodeId ?? null;
  const explicitLink = request.link?.trim() ? request.link.trim() : null;

  let projectKey: string | null = request.projectKey ?? null;
  let workstreamColor: string | null = null;
  let workstreamShortName: string | null = null;
  let resolvedEntry: WorkstreamRegistryEntry | null = null;

  if (workstreamId) {
    const match = matchWorkstream(workstreams, workstreamId, request.projectKey);
    if (match.ambiguous) {
      warnings.push(
        `workstream '${workstreamId}' matches multiple registered workstreams; ` +
          "pass projectKey to disambiguate. Enrichment skipped.",
      );
      projectKey = null;
    } else if (match.entry) {
      resolvedEntry = match.entry;
      projectKey = match.entry.projectKey;
      workstreamColor = normalizeColor(match.entry.presentation?.color);
      workstreamShortName = match.entry.presentation?.shortName?.trim() || null;
    }
  }

  let link: string | null = null;
  if (explicitLink) {
    link = explicitLink;
  } else if (resolvedEntry && projectKey && workstreamId) {
    link = composeLink(dashboardBaseUrl, projectKey, workstreamId, nodeId);
  }

  return {
    draft: {
      title: request.title,
      body: request.body,
      severity: request.severity ?? DEFAULT_SEVERITY,
      eventKind: request.eventKind ?? DEFAULT_EVENT_KIND,
      workstreamId,
      projectKey,
      workstreamColor,
      workstreamShortName,
      nodeId,
      sessionId: request.sessionId ?? null,
      link,
      source: request.source?.trim() || "cli",
    },
    warnings,
  };
}
