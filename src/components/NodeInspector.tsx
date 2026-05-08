import type { WorkstreamNode } from "../workstream-schema";
import type { WorkstreamDerivedNode } from "../workstream-view-model";
import type { WorkstreamGraphLayoutResult } from "../workstream-graph";
import type { WorkstreamDocument } from "../workstream-schema";
import type {
  NodeLaunchOperation,
  NodeLaunchRecord,
} from "../node-launch-record-contract";
import type {
  WorkstreamRuntimeNodeOverlay,
  WorkstreamRuntimeOverlayIssue,
} from "../workstream-runtime-overlay";
import { trackerLabel, trackerUrl } from "../workstream-links";
import { humanizeLaunchClaim } from "./launch-claim-display";

interface NodeInspectorProps {
  entry: WorkstreamDerivedNode | null;
  layout: WorkstreamGraphLayoutResult;
  workstream: WorkstreamDocument;
  canLaunch?: boolean;
  launchDisabledReason?: string;
  launchRecord?: NodeLaunchRecord | null;
  launchOperation?: NodeLaunchOperation | null;
  launchRecordLoading?: boolean;
  launchRecordError?: string | null;
  runtimeOverlay?: WorkstreamRuntimeNodeOverlay | null;
  onLaunch?: () => void;
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

function RuntimeDetails({ overlay }: { overlay: WorkstreamRuntimeNodeOverlay | null }) {
  if (!overlay) {
    return null;
  }

  const primarySession = overlay.session.primarySession;
  const latestClaim = overlay.launch.latestClaim;
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
  const trackerSummary =
    overlay.tracker.status === "snapshot"
      ? trackerSnapshotSummary || "Tracker snapshot loaded."
      : overlay.tracker.status === "linked"
        ? "GitHub tracker linked; live issue/PR snapshot not loaded."
      : overlay.tracker.status === "degraded"
        ? "Tracker reference is present but no snapshot is loaded."
        : "No tracker reference.";

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
  layout,
  workstream,
  canLaunch = false,
  launchDisabledReason,
  launchRecord,
  launchOperation,
  launchRecordLoading = false,
  launchRecordError,
  runtimeOverlay = null,
  onLaunch,
}: NodeInspectorProps) {
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
  const latestClaim = launchRecord?.latestClaim ?? launchOperation?.latestClaim ?? null;
  const latestClaimDisplay = latestClaim ? humanizeLaunchClaim(latestClaim) : null;
  const launchButtonLabel = latestClaim?.blocksLaunch || launchOperation?.status === "preparing" || launchOperation?.status === "launching"
    ? "Open PAW launch"
    : "Initialize PAW launch";

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

      <RuntimeDetails overlay={runtimeOverlay} />

      {(launchRecordLoading || launchRecordError || launchRecord || launchOperation) && (
        <div className="sl-sidebar-section">
          <span className="sl-section-label">LATEST PAW LAUNCH</span>
          <div className="sl-inspector-card sl-node-launch-card">
            {launchRecordLoading ? (
              <p className="sl-sidebar-note">Loading launch details…</p>
            ) : launchRecordError ? (
              <p className="sl-action-error">{launchRecordError}</p>
            ) : launchRecord || launchOperation ? (
              <>
                <div className="sl-inspector-meta">
                  {launchOperation && (
                    <span className={`sl-pill ${launchOperation.status.endsWith("failed") ? "status-red" : "status-accent"}`}>
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
