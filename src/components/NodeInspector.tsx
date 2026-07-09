import { useState } from "react";

import type { WorkstreamNode } from "../workstream-schema";
import type {
  WorkstreamDerivedNode,
  WorkstreamExternalDependencyView,
} from "../workstream-view-model";
import type { WorkstreamGraphLayoutResult } from "../workstream-graph";
import type { WorkstreamDocument } from "../workstream-schema";
import type {
  NodeLaunchOperation,
  NodeLaunchRecord,
} from "../node-launch-record-contract";
import { handleInAppLinkClick } from "../dashboard-routing";
import type {
  WorkstreamRuntimeNodeOverlay,
  WorkstreamRuntimeOverlayIssue,
} from "../workstream-runtime-overlay";
import {
  githubIssueSnapshotLabel,
  githubIssueSnapshotTone,
  githubPullRequestSnapshotLabel,
  githubPullRequestSnapshotTone,
  githubStatusPillClass,
} from "../github-status-view";
import {
  formatManagedRuntimeLabel,
  managedLifecycleStatusClass,
} from "../managed-runtime-contract";
import { trackerLabel, trackerUrl } from "../workstream-links";
import { humanizeLaunchClaim } from "./launch-claim-display";
import {
  ManagedRuntimeConsolePanel,
} from "./ManagedRuntimeConsolePanel";

interface NodeInspectorProps {
  entry: WorkstreamDerivedNode | null;
  externalDependency?: WorkstreamExternalDependencyView | null;
  layout: WorkstreamGraphLayoutResult;
  workstream: WorkstreamDocument;
  externalRouteForDependency?: (
    dependency: WorkstreamExternalDependencyView,
  ) => {
    href: string;
    onOpen: () => void | Promise<void>;
  } | null;
  canLaunch?: boolean;
  launchDisabledReason?: string;
  launchRecord?: NodeLaunchRecord | null;
  launchOperation?: NodeLaunchOperation | null;
  launchRecordLoading?: boolean;
  launchRecordError?: string | null;
  runtimeOverlay?: WorkstreamRuntimeNodeOverlay | null;
  onLaunch?: () => void;
  onOpenConsole?: () => void;
  onOpenConsoleInSessions?: () => void | Promise<void>;
  onManagedRuntimeActionComplete?: () => void | Promise<void>;
  /**
   * Optional handler for releasing a stuck active launch operation or
   * resolving a stale terminal launch that is no longer blocked by a claim.
   */
  onReleaseStuckOperation?: () => Promise<void>;
  onClearPreviousInit?: () => Promise<void>;
}

const ACTIVE_LAUNCH_OPERATION_STATUSES = new Set([
  "preparing",
  "launching",
  "managed_starting",
]);

function canReleaseStuckOperation(operation: NodeLaunchOperation): boolean {
  return ACTIVE_LAUNCH_OPERATION_STATUSES.has(operation.status) ||
    (
      operation.status === "launched_pending_binding" &&
      operation.latestClaim?.blocksLaunch !== true
    );
}

function formatStatus(status: string): string {
  return status.replace(/[_-]+/g, " ");
}

function formatRuntimeLabel(value: string): string {
  return formatStatus(value).toLowerCase();
}

function statusPillClass(status: string): string {
  switch (status) {
    case "in-progress":
      return "status-green";
    case "ready":
    case "completed":
      return "status-accent";
    case "blocked":
      return "status-red";
    case "retired":
      return "status-retired";
    default:
      return "status-amber";
  }
}

function attentionPillClass(attention: string): string {
  switch (attention) {
    case "focus":
      return "accent";
    case "watch":
      return "amber";
    default:
      return "muted";
  }
}

function formatTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? timestamp : new Date(parsed).toLocaleString();
}

function pathStatusClass(exists: boolean): string {
  return exists ? "status-green" : "status-amber";
}

function pathStatusLabel(exists: boolean): string {
  return exists ? "present" : "missing";
}

function runtimePillClass(status: string): string {
  switch (status) {
    case "active":
      return "green";
    case "launching":
    case "needs-input":
      return "amber";
    case "interrupted":
    case "unresolved":
      return "red";
    case "ended":
      return "muted";
    default:
      return "accent";
  }
}

function externalDependencyPillClass(status: string): string {
  switch (status) {
    case "resolved":
    case "manual":
      return "status-green";
    case "unresolved":
    case "error":
      return "status-red";
    default:
      return "status-amber";
  }
}

function launchOperationPillClass(status: string): string {
  switch (status) {
    case "managed_running":
    case "launched_pending_binding":
      return "status-green";
    case "preparation_failed":
    case "managed_failed":
    case "terminal_failed":
      return "status-red";
    case "preparing":
    case "launching":
    case "managed_starting":
      return "status-amber";
    default:
      return "status-accent";
  }
}

function launchOperationSummary(operation: NodeLaunchOperation): string {
  const managed = operation.handoff?.runtimeKind === "managed-sdk" || Boolean(operation.managedLaunch);
  switch (operation.status) {
    case "preparing":
      return managed
        ? "PAW init is running; Streamliner will start the background session when the handoff is ready."
        : "PAW init is running and assembling the handoff.";
    case "prepared":
      return managed
        ? "PAW init is complete. This node has a prepared background-session handoff ready to start."
        : "PAW init is complete. This node has a prepared terminal handoff.";
    case "managed_starting":
      return "PAW init is complete. Streamliner is creating the background SDK session now.";
    case "managed_running":
      return "Background session launch completed; ongoing lifecycle appears in Runtime Details.";
    case "launching":
      return "Streamliner is launching the terminal handoff.";
    case "launched_pending_binding":
      return "Terminal launch completed and Streamliner is waiting for the session to bind.";
    case "preparation_failed":
      return "PAW init failed before a launch handoff was ready.";
    case "managed_failed":
      return "Background session launch failed.";
    case "terminal_failed":
      return "Terminal launch failed.";
    default:
      return `Launch operation is ${formatStatus(operation.status)}.`;
  }
}

function runtimeIssueClass(issue: WorkstreamRuntimeOverlayIssue): string {
  switch (issue.severity) {
    case "error":
      return "red";
    case "warning":
      return "amber";
    default:
      return "muted";
  }
}

function formatPawStage(
  stage: WorkstreamRuntimeNodeOverlay["paw"]["stage"],
): string {
  return stage ? formatRuntimeLabel(stage) : "workflow";
}

function RuntimeIssueList({
  issues,
}: {
  issues: readonly WorkstreamRuntimeOverlayIssue[];
}) {
  if (issues.length === 0) {
    return (
      <div className="sl-sidebar-note">
        No runtime degradation reasons for this node.
      </div>
    );
  }

  return (
    <div className="sl-runtime-issue-list">
      {issues.map((issue, index) => (
        <div
          className={`sl-runtime-issue ${runtimeIssueClass(issue)}`}
          key={`${issue.code}:${issue.sessionId ?? ""}:${issue.launchClaimId ?? ""}:${index}`}
        >
          <span className="sl-runtime-issue-code">{formatRuntimeLabel(issue.code)}</span>
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

function RuntimeDetails({
  overlay,
  onOpenConsole,
  onOpenConsoleInSessions,
  onManagedRuntimeActionComplete,
}: {
  overlay: WorkstreamRuntimeNodeOverlay | null;
  onOpenConsole?: () => void;
  onOpenConsoleInSessions?: () => void | Promise<void>;
  onManagedRuntimeActionComplete?: () => void | Promise<void>;
}) {
  if (!overlay) {
    return null;
  }

  const primarySession = overlay.session.primarySession;
  const latestClaim = overlay.launch.latestClaim;
  const managedRuntime = overlay.managedRuntime;
  const trackerSnapshotSummary = [
    overlay.tracker.githubIssue
      ? `issue #${overlay.tracker.githubIssue.number} ${overlay.tracker.githubIssue.state}`
      : null,
    overlay.tracker.activePullRequest
      ? `PR #${overlay.tracker.activePullRequest.number} ${overlay.tracker.activePullRequest.state}`
      : null,
  ]
    .filter(Boolean)
    .join(" / ");
  let trackerSummary = "No tracker reference.";
  if (overlay.tracker.status === "snapshot") {
    trackerSummary = trackerSnapshotSummary || "Tracker snapshot loaded.";
  } else if (
    overlay.tracker.status === "degraded" &&
    overlay.tracker.githubIssue?.error
  ) {
    trackerSummary = `GitHub tracker snapshot degraded: ${overlay.tracker.githubIssue.error}`;
  } else if (overlay.tracker.status === "linked") {
    trackerSummary = "GitHub tracker linked; live issue/PR snapshot not loaded.";
  } else if (overlay.tracker.status === "degraded") {
    trackerSummary = "Tracker reference is present but no snapshot is loaded.";
  }

  return (
    <div className="sl-sidebar-section">
      <span className="sl-section-label">RUNTIME DETAILS</span>
      <div className="sl-inspector-card sl-runtime-card">
        <div className="sl-sidebar-section-header">
          <h3 className="sl-sidebar-title">{overlay.node.title}</h3>
          <span className={`sl-pill ${runtimePillClass(overlay.runtimeStatus)}`}>
            {formatRuntimeLabel(overlay.runtimeStatus)}
          </span>
        </div>
        <dl className="sl-runtime-fields">
          <div>
            <dt>Session</dt>
            <dd>
              {primarySession
                ? `${primarySession.title} (${formatRuntimeLabel(primarySession.activityStatus)})`
                : "No bound session."}
            </dd>
          </div>
          <div>
            <dt>Launch</dt>
            <dd>
              {latestClaim
                ? `${formatRuntimeLabel(latestClaim.status)}${
                    latestClaim.blocksLaunch ? " blocking launch" : ""
                  }`
                : "No launch claim."}
            </dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>
              {managedRuntime ? (
                <span
                  className={`sl-runtime-inline-state ${managedLifecycleStatusClass(managedRuntime.lifecycleState)}`}
                >
                  background session / {managedRuntime.lifecycleLabel}
                </span>
              ) : (
                "terminal cli"
              )}
            </dd>
          </div>
          <div>
            <dt>PAW</dt>
            <dd>
              {overlay.paw.status === "recognized"
                ? `${
                    overlay.paw.workTitle ?? overlay.paw.workId ?? "PAW work"
                  } (${formatPawStage(overlay.paw.stage)})`
                : formatRuntimeLabel(overlay.paw.status)}
            </dd>
          </div>
          <div>
            <dt>Tracker</dt>
            <dd>{trackerSummary}</dd>
          </div>
        </dl>
        {managedRuntime && (
          <div className="sl-managed-runtime-inspector">
            <div className="sl-managed-runtime-inspector-actions">
              <button
                className="sl-action-btn primary"
                type="button"
                disabled={!onOpenConsole}
                onClick={onOpenConsole}
              >
                Open console
              </button>
              <button
                className="sl-action-btn"
                type="button"
                disabled={!onOpenConsoleInSessions}
                onClick={() => void onOpenConsoleInSessions?.()}
              >
                Open in Sessions
              </button>
            </div>
            <ManagedRuntimeConsolePanel
              runtime={managedRuntime.projection}
              sessionId={primarySession?.id ?? null}
              title="Background session console"
              subtitle={`${formatManagedRuntimeLabel(
                managedRuntime.projection.permissionProfile,
              )}; sanitized Streamliner activity only.`}
              compact
              onActionComplete={onManagedRuntimeActionComplete}
            />
          </div>
        )}
        <RuntimeIssueList issues={overlay.degradationReasons} />
      </div>
    </div>
  );
}

function LaunchPathRow({
  label,
  path,
  exists,
}: {
  label: string;
  path: string;
  exists: boolean;
}) {
  return (
    <div className="sl-node-launch-path">
      <dt>{label}</dt>
      <dd>
        <span className={`sl-node-pill ${pathStatusClass(exists)}`}>
          {pathStatusLabel(exists)}
        </span>
        <code>{path}</code>
      </dd>
    </div>
  );
}

export function NodeInspector({
  entry,
  externalDependency,
  layout,
  workstream,
  externalRouteForDependency,
  canLaunch = false,
  launchDisabledReason,
  launchRecord,
  launchOperation,
  launchRecordLoading = false,
  launchRecordError,
  runtimeOverlay = null,
  onLaunch,
  onOpenConsole,
  onOpenConsoleInSessions,
  onManagedRuntimeActionComplete,
  onReleaseStuckOperation,
  onClearPreviousInit,
}: NodeInspectorProps) {
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  if (!entry && externalDependency) {
    const route = externalRouteForDependency?.(externalDependency) ?? null;
    const blockedNode = workstream.nodes.find((node) => node.id === externalDependency.nodeId);
    return (
      <div className="sl-sidebar-section">
        <span className="sl-section-label">INSPECTOR</span>
        <div className="sl-inspector-card">
          <h3 className="sl-sidebar-title">{externalDependency.label}</h3>
          <p className="sl-inspector-summary">{externalDependency.detail}</p>
          <div className="sl-inspector-meta">
            <span className="sl-pill status-red">external dependency</span>
            <span className={`sl-pill ${externalDependencyPillClass(externalDependency.state)}`}>
              {externalDependency.statusLabel}
            </span>
            {externalDependency.archived ? (
              <span className="sl-pill muted">archived source</span>
            ) : null}
          </div>
          <dl className="sl-node-launch-fields">
            {blockedNode ? (
              <div>
                <dt>Blocks</dt>
                <dd>{blockedNode.title}</dd>
              </div>
            ) : null}
            {externalDependency.target ? (
              <>
                <div>
                  <dt>Project</dt>
                  <dd>{externalDependency.target.projectKey}</dd>
                </div>
                <div>
                  <dt>Workstream</dt>
                  <dd>{externalDependency.target.workstreamId}</dd>
                </div>
                {externalDependency.target.nodeId ? (
                  <div>
                    <dt>Node</dt>
                    <dd>{externalDependency.target.nodeId}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
            {externalDependency.targetTitle ? (
              <div>
                <dt>Resolved target</dt>
                <dd>{externalDependency.targetTitle}</dd>
              </div>
            ) : null}
            {externalDependency.targetStatus ? (
              <div>
                <dt>Target status</dt>
                <dd>{formatStatus(externalDependency.targetStatus)}</dd>
              </div>
            ) : null}
            {externalDependency.ignoredStatus ? (
              <div>
                <dt>Manual status</dt>
                <dd>Ignored because the target resolved.</dd>
              </div>
            ) : null}
            {externalDependency.error ? (
              <div>
                <dt>Resolution error</dt>
                <dd>{externalDependency.error}</dd>
              </div>
            ) : null}
          </dl>
          {route ? (
            <a
              className="sl-action-btn primary"
              href={route.href}
              onClick={(event) => handleInAppLinkClick(event, route.onOpen)}
              target={externalDependency.target ? undefined : "_blank"}
              rel={externalDependency.target ? undefined : "noopener noreferrer"}
            >
              {externalDependency.target ? "Open upstream" : "Open dependency URL"}
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="sl-sidebar-section">
        <span className="sl-section-label">INSPECTOR</span>
        <div className="sl-empty-state">
          Click a node to inspect its details, dependencies, and status.
        </div>
      </div>
    );
  }

  const { node } = entry;
  const nodeById = new Map(workstream.nodes.map((n) => [n.id, n]));

  const dependencies = (layout.dependenciesByNode.get(node.id) ?? [])
    .map((id) => nodeById.get(id))
    .filter((n): n is WorkstreamNode => n !== undefined);

  const dependents = (layout.dependentsByNode.get(node.id) ?? [])
    .map((id) => nodeById.get(id))
    .filter((n): n is WorkstreamNode => n !== undefined);

  const tracker = trackerLabel(node.tracker);
  const trackerHref = trackerUrl(node.tracker);
  const trackerLabelText = node.tracker?.type === "github" ? "Issue" : "Tracker";
  const trackerStatusChips = [
    entry.githubIssue
      ? {
          key: "issue",
          label: githubIssueSnapshotLabel(entry.githubIssue),
          tone: githubIssueSnapshotTone(entry.githubIssue),
          title: entry.githubIssue.error ?? entry.githubIssue.title,
        }
      : null,
    entry.activePullRequest
      ? {
          key: "pr",
          label: githubPullRequestSnapshotLabel(entry.activePullRequest),
          tone: githubPullRequestSnapshotTone(entry.activePullRequest),
          title: entry.activePullRequest.title,
        }
      : null,
  ].filter(
    (
      chip,
    ): chip is {
      key: string;
      label: string;
      tone: ReturnType<typeof githubIssueSnapshotTone>;
      title: string;
    } => chip !== null,
  );
  const latestClaim = launchRecord?.latestClaim
    ?? launchOperation?.latestClaim
    ?? runtimeOverlay?.launch.latestClaim
    ?? null;
  const latestClaimDisplay = latestClaim ? humanizeLaunchClaim(latestClaim) : null;
  const canReleaseOperation = launchOperation
    ? canReleaseStuckOperation({ ...launchOperation, latestClaim })
    : false;
  const releaseButtonLabel = launchOperation?.status === "launched_pending_binding"
    ? "Resolve stale launch"
    : "Release stuck operation";
  const releaseDescription = launchOperation?.status === "launched_pending_binding"
    ? "Use this when the launch claim is gone or terminal, but the operation is still waiting for binding. Streamliner will restore a verified session binding when possible, otherwise it marks the operation as failed so the node can be re-launched."
    : "Use this if PAW init looks stuck — for example, after the Streamliner API restarted mid-launch. It marks the operation as failed without affecting any session that may have actually started.";
  const releaseTitle = launchOperation?.status === "launched_pending_binding"
    ? "Resolve this stale pending-binding launch by restoring a verified graph binding when possible, or by marking the operation failed so the node can be re-launched."
    : "Mark this in-flight operation as failed so the node can be re-launched. Use when the API restarted while a PAW init was running and the in-memory run state is gone.";
  const launchButtonLabel = latestClaim?.blocksLaunch || launchOperation || launchRecord
    ? "Open PAW launch"
    : "Initialize PAW launch";
  const hasPreviousInitState = Boolean(launchRecord || launchOperation || latestClaim);

  const repoById = new Map(workstream.repos.map((r) => [r.id, r]));
  const repoLabels = node.repoIds.map((id) => {
    const repo = repoById.get(id);
    return repo ? `${repo.owner}/${repo.name}` : id;
  });

  return (
    <div className="sl-sidebar-section">
      <span className="sl-section-label">INSPECTOR</span>
      <div className="sl-inspector-card">
        <h3 className="sl-sidebar-title">{node.title}</h3>
        <div className="sl-inspector-node-id">
          <span>Node ID</span>
          <code>{node.id}</code>
        </div>
        <p className="sl-inspector-summary">{node.summary}</p>
        <div className="sl-inspector-meta">
          <span className={`sl-pill ${statusPillClass(entry.operationalStatus)}`}>
            {formatStatus(entry.operationalStatus)}
          </span>
          <span className="sl-pill muted">{node.type}</span>
          <span className={`sl-pill ${attentionPillClass(node.attention)}`}>
            {node.attention}
          </span>
        </div>
        {tracker && (
          <div className="sl-sidebar-item-meta">
            <span>
              {trackerLabelText}:{" "}
              {trackerHref ? (
                <a
                  href={trackerHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sl-inline-link"
                >
                  {tracker}
                </a>
              ) : (
                tracker
              )}
            </span>
            {trackerStatusChips.length > 0 && (
              <span className="sl-inspector-github-status">
                {trackerStatusChips.map((chip) => (
                  <span
                    key={chip.key}
                    className={`sl-pill ${githubStatusPillClass(chip.tone)}`}
                    title={chip.title}
                  >
                    {chip.label}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
        {repoLabels.length > 0 && (
          <div className="sl-sidebar-item-meta">
            <span>Repos: {repoLabels.join(" · ")}</span>
          </div>
        )}
        <div className="sl-inspector-actions">
          <button
            className="sl-action-btn primary"
            disabled={!canLaunch}
            onClick={onLaunch}
            type="button"
          >
            {launchButtonLabel}
          </button>
          {!canLaunch && launchDisabledReason ? (
            <span className="sl-sidebar-note">{launchDisabledReason}</span>
          ) : null}
        </div>
      </div>

      <RuntimeDetails
        overlay={runtimeOverlay}
        onOpenConsole={onOpenConsole}
        onOpenConsoleInSessions={onOpenConsoleInSessions}
        onManagedRuntimeActionComplete={onManagedRuntimeActionComplete}
      />

      {(launchRecordLoading || launchRecordError || launchRecord || launchOperation || latestClaim) && (
        <div className="sl-sidebar-section">
          <span className="sl-section-label">LATEST PAW LAUNCH</span>
          <div className="sl-inspector-card sl-node-launch-card">
            {launchRecordLoading ? (
              <p className="sl-sidebar-note">Loading launch details…</p>
            ) : launchRecordError ? (
              <p className="sl-action-error">{launchRecordError}</p>
            ) : launchRecord || launchOperation || latestClaim ? (
              <>
                <div className="sl-inspector-meta">
                  {launchOperation && (
                    <span className={`sl-pill ${launchOperationPillClass(launchOperation.status)}`}>
                      {formatStatus(launchOperation.status)}
                    </span>
                  )}
                  {launchRecord && (
                    <>
                      <span className={`sl-pill ${pathStatusClass(launchRecord.pathStatus.workflowContextExists)}`}>
                        {launchRecord.pathStatus.workflowContextExists ? "context ready" : "context missing"}
                      </span>
                      <span className={`sl-pill ${pathStatusClass(launchRecord.pathStatus.cwdExists)}`}>
                        {launchRecord.pathStatus.cwdExists ? "worktree present" : "worktree missing"}
                      </span>
                    </>
                  )}
                  {latestClaimDisplay && (
                    <span className={`sl-pill ${latestClaimDisplay.pillClass}`}>
                      {latestClaimDisplay.label}
                    </span>
                  )}
                </div>
                {launchOperation && (
                  <p className="sl-sidebar-note">{launchOperationSummary(launchOperation)}</p>
                )}
                <dl className="sl-node-launch-fields">
                  {launchRecord && (
                    <>
                      <div>
                        <dt>Branch</dt>
                        <dd>{launchRecord.branch}</dd>
                      </div>
                      <div>
                        <dt>Work ID</dt>
                        <dd>{launchRecord.workId}</dd>
                      </div>
                      <div>
                        <dt>Prepared</dt>
                        <dd>{formatTimestamp(launchRecord.updatedAt)}</dd>
                      </div>
                    </>
                  )}
                  {launchOperation && (
                    <>
                      <div>
                        <dt>Operation</dt>
                        <dd>{formatStatus(launchOperation.status)}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{formatTimestamp(launchOperation.updatedAt)}</dd>
                      </div>
                      {launchOperation.preparationRunId && (
                        <div>
                          <dt>Run</dt>
                          <dd>{launchOperation.preparationRunId}</dd>
                        </div>
                      )}
                      {launchOperation.error && (
                        <div>
                          <dt>Operation error</dt>
                          <dd>{launchOperation.error.error}</dd>
                        </div>
                      )}
                    </>
                  )}
                  {latestClaimDisplay && (
                    <div>
                      <dt>Terminal launch</dt>
                      <dd>{latestClaimDisplay.detail}</dd>
                    </div>
                  )}
                  {latestClaim?.failureCode && (
                    <div>
                      <dt>Failure</dt>
                      <dd>{latestClaim.failureCode}</dd>
                    </div>
                  )}
                </dl>
                {launchOperation
                  && canReleaseOperation
                  && onReleaseStuckOperation && (
                  <div className="sl-node-launch-release">
                    <button
                      type="button"
                      className="sl-action-btn danger"
                      disabled={releasing}
                      onClick={() => {
                        if (releasing) return;
                        setReleasing(true);
                        setReleaseError(null);
                        void (async () => {
                          try {
                            await onReleaseStuckOperation();
                          } catch (error: unknown) {
                            setReleaseError(
                              error instanceof Error ? error.message : String(error),
                            );
                          } finally {
                            setReleasing(false);
                          }
                        })();
                      }}
                      title={releaseTitle}
                    >
                      {releasing ? "Releasing..." : releaseButtonLabel}
                    </button>
                    <p className="sl-sidebar-note">
                      {releaseDescription}
                    </p>
                    {releaseError && (
                      <p className="sl-action-error">{releaseError}</p>
                    )}
                  </div>
                )}
                {hasPreviousInitState && onClearPreviousInit && (
                  <div className="sl-node-launch-release">
                    <button
                      type="button"
                      className="sl-action-btn danger"
                      disabled={clearing}
                      onClick={() => {
                        if (clearing) return;
                        setClearing(true);
                        setClearError(null);
                        void (async () => {
                          try {
                            await onClearPreviousInit();
                          } catch (error: unknown) {
                            setClearError(
                              error instanceof Error ? error.message : String(error),
                            );
                          } finally {
                            setClearing(false);
                          }
                        })();
                      }}
                      title="Clear the saved PAW init, launch operation, launch claim, and node session binding so this node can be initialized again."
                    >
                      {clearing ? "Clearing..." : "Clear previous init"}
                    </button>
                    <p className="sl-sidebar-note">
                      Removes Streamliner&apos;s saved PAW init state and detaches
                      any session binding for this node. Use when prior work was
                      retargeted and the node should run from scratch.
                    </p>
                    {clearError && (
                      <p className="sl-action-error">{clearError}</p>
                    )}
                  </div>
                )}
                {launchRecord && (
                  <dl className="sl-node-launch-paths">
                    <LaunchPathRow
                      label="Worktree"
                      path={launchRecord.cwd}
                      exists={launchRecord.pathStatus.cwdExists}
                    />
                    <LaunchPathRow
                      label="PAW work dir"
                      path={launchRecord.pawWorkDir}
                      exists={launchRecord.pathStatus.pawWorkDirExists}
                    />
                    <LaunchPathRow
                      label="WorkflowContext.md"
                      path={launchRecord.workflowContextPath}
                      exists={launchRecord.pathStatus.workflowContextExists}
                    />
                    <LaunchPathRow
                      label="Streamliner context"
                      path={launchRecord.streamlinerContextPath}
                      exists={launchRecord.pathStatus.streamlinerContextExists}
                    />
                    {launchRecord.sdkSessionStateRoot && (
                      <LaunchPathRow
                        label="SDK state"
                        path={launchRecord.sdkSessionStateRoot}
                        exists={launchRecord.pathStatus.sdkSessionStateRootExists ?? false}
                      />
                    )}
                    {launchRecord.sdkSessionWorkspacePath && (
                      <LaunchPathRow
                        label="SDK workspace"
                        path={launchRecord.sdkSessionWorkspacePath}
                        exists={launchRecord.pathStatus.sdkSessionWorkspaceExists ?? false}
                      />
                    )}
                  </dl>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {dependencies.length > 0 && (
        <div className="sl-sidebar-section">
          <span className="sl-section-label">
            DEPENDENCIES ({dependencies.length})
          </span>
          <div className="sl-sidebar-list">
            {dependencies.map((dep) => (
              <div key={dep.id} className="sl-sidebar-item">
                <div className="sl-sidebar-item-header">
                  <span className="sl-sidebar-item-title">{dep.title}</span>
                  <span
                    className={`sl-node-pill ${statusPillClass(dep.status)}`}
                  >
                    {formatStatus(dep.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {entry.externalDependencies.length > 0 && (
        <div className="sl-sidebar-section">
          <span className="sl-section-label">
            EXTERNAL DEPENDENCIES ({entry.externalDependencies.length})
          </span>
          <div className="sl-sidebar-list">
            {entry.externalDependencies.map((dependency) => {
              const route = externalRouteForDependency?.(dependency) ?? null;
              const content = (
                <>
                  <div className="sl-sidebar-item-header">
                    <span className="sl-sidebar-item-title">{dependency.label}</span>
                    <span className={`sl-node-pill ${externalDependencyPillClass(dependency.state)}`}>
                      {dependency.statusLabel}
                    </span>
                  </div>
                  <div className="sl-sidebar-item-meta">
                    <span>{dependency.detail}</span>
                    {dependency.archived ? <span>archived</span> : null}
                  </div>
                </>
              );
              return route ? (
                <a
                  key={dependency.key}
                  className="sl-sidebar-item"
                  href={route.href}
                  onClick={(event) => handleInAppLinkClick(event, route.onOpen)}
                  target={dependency.target ? undefined : "_blank"}
                  rel={dependency.target ? undefined : "noopener noreferrer"}
                >
                  {content}
                </a>
              ) : (
                <div key={dependency.key} className="sl-sidebar-item">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {dependents.length > 0 && (
        <div className="sl-sidebar-section">
          <span className="sl-section-label">
            DEPENDENTS ({dependents.length})
          </span>
          <div className="sl-sidebar-list">
            {dependents.map((dep) => (
              <div key={dep.id} className="sl-sidebar-item">
                <div className="sl-sidebar-item-header">
                  <span className="sl-sidebar-item-title">{dep.title}</span>
                  <span
                    className={`sl-node-pill ${statusPillClass(dep.status)}`}
                  >
                    {formatStatus(dep.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
