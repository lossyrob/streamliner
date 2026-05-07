import type {
  WorkstreamRuntimeGateStatus,
  WorkstreamRuntimeNodeOverlay,
  WorkstreamRuntimeOverlay,
  WorkstreamRuntimeOverlayIssue,
} from "../workstream-runtime-overlay";

function formatLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").toLowerCase();
}

function toneForGateStatus(status: WorkstreamRuntimeGateStatus): string {
  switch (status) {
    case "usable":
      return "green";
    case "degraded":
      return "amber";
    case "not-usable":
      return "red";
  }
}

function toneForIssue(issue: WorkstreamRuntimeOverlayIssue): string {
  switch (issue.severity) {
    case "error":
      return "red";
    case "warning":
      return "amber";
    default:
      return "muted";
  }
}

function formatPawStage(stage: WorkstreamRuntimeNodeOverlay["paw"]["stage"]): string {
  return stage ? formatLabel(stage) : "workflow";
}

function RuntimeIssueList({
  issues,
  emptyLabel,
}: {
  issues: readonly WorkstreamRuntimeOverlayIssue[];
  emptyLabel: string;
}) {
  if (issues.length === 0) {
    return <div className="sl-sidebar-note">{emptyLabel}</div>;
  }

  return (
    <div className="sl-runtime-issue-list">
      {issues.map((issue, index) => (
        <div
          className={`sl-runtime-issue ${toneForIssue(issue)}`}
          key={`${issue.code}:${issue.nodeId ?? "global"}:${issue.sessionId ?? ""}:${issue.launchClaimId ?? ""}:${index}`}
        >
          <span className="sl-runtime-issue-code">{formatLabel(issue.code)}</span>
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

function RuntimeIssueAggregate({
  code,
  count,
  message,
}: {
  code: string;
  count: number;
  message: string;
}) {
  if (count === 0) {
    return null;
  }

  return (
    <div className="sl-runtime-issue amber">
      <span className="sl-runtime-issue-code">{formatLabel(code)}</span>
      <span>{message}</span>
    </div>
  );
}

function SelectedRuntimeDetails({
  node,
}: {
  node: WorkstreamRuntimeNodeOverlay | null;
}) {
  if (!node) {
    return null;
  }

  const primarySession = node.session.primarySession;
  const latestClaim = node.launch.latestClaim;
  const trackerSummary =
    node.tracker.status === "snapshot"
      ? [
          node.tracker.githubIssue
            ? `issue #${node.tracker.githubIssue.number} ${node.tracker.githubIssue.state}`
            : null,
          node.tracker.activePullRequest
            ? `PR #${node.tracker.activePullRequest.number} ${node.tracker.activePullRequest.state}`
            : null,
        ].filter(Boolean).join(" / ")
      : node.tracker.status === "degraded"
        ? "Tracker reference is present but no snapshot is loaded."
        : "No tracker reference.";

  return (
    <div className="sl-runtime-selected">
      <div className="sl-sidebar-section-header">
        <h3 className="sl-sidebar-title">Selected runtime</h3>
        <span className="sl-pill accent">{formatLabel(node.runtimeStatus)}</span>
      </div>
      <div className="sl-runtime-selected-title">{node.node.title}</div>
      <dl className="sl-runtime-fields">
        <div>
          <dt>Session</dt>
          <dd>
            {primarySession
              ? `${primarySession.title} (${formatLabel(primarySession.activityStatus)})`
              : "No bound session."}
          </dd>
        </div>
        <div>
          <dt>Launch</dt>
          <dd>
            {latestClaim
              ? `${formatLabel(latestClaim.status)}${
                  latestClaim.blocksLaunch ? " blocking launch" : ""
                }`
              : "No launch claim."}
          </dd>
        </div>
        <div>
          <dt>PAW</dt>
          <dd>
            {node.paw.status === "recognized"
              ? `${node.paw.workTitle ?? node.paw.workId ?? "PAW work"} (${formatPawStage(node.paw.stage)})`
              : formatLabel(node.paw.status)}
          </dd>
        </div>
        <div>
          <dt>Tracker</dt>
          <dd>{trackerSummary}</dd>
        </div>
      </dl>
      <RuntimeIssueList
        issues={node.degradationReasons}
        emptyLabel="No runtime degradation reasons for this node."
      />
    </div>
  );
}

export function RuntimeOverlayPanel({
  overlay,
  selectedNodeId,
  loading,
  error,
}: {
  overlay: WorkstreamRuntimeOverlay | null;
  selectedNodeId: string | null;
  loading: boolean;
  error: string | null;
}) {
  if (!overlay) {
    return null;
  }

  const counts = overlay.summary.counts;
  const selectedNode = selectedNodeId
    ? overlay.nodesById.get(selectedNodeId) ?? null
    : null;
  const trackerMissingCount = overlay.summary.issues.filter(
    (issue) => issue.code === "tracker-snapshot-missing",
  ).length;
  const nonTrackerSummaryIssues = overlay.summary.issues.filter(
    (issue) => issue.code !== "tracker-snapshot-missing",
  );
  const visibleSummaryIssues = nonTrackerSummaryIssues.slice(0, trackerMissingCount > 0 ? 3 : 4);
  const hiddenSummaryIssueCount = nonTrackerSummaryIssues.length - visibleSummaryIssues.length;

  return (
    <section className="sl-inspector-card sl-runtime-card" aria-label="Runtime overlay">
      <div className="sl-sidebar-section-header">
        <h2 className="sl-sidebar-title">Runtime overlay</h2>
        <div className="sl-chip-list">
          {loading ? <span className="sl-pill muted">refreshing</span> : null}
          {error ? <span className="sl-pill red">record error</span> : null}
          <span className={`sl-pill ${toneForGateStatus(overlay.gateReadiness.status)}`}>
            {formatLabel(overlay.gateReadiness.status)}
          </span>
        </div>
      </div>
      {error ? <div className="sl-action-error">{error}</div> : null}
      <div className="sl-runtime-stats">
        <div>
          <span>{counts.runtimeEvidenceNodes}</span>
          <small>runtime evidence</small>
        </div>
        <div>
          <span>{counts.degradedNodes}</span>
          <small>degraded</small>
        </div>
        <div>
          <span>{counts.unresolvedLaunches}</span>
          <small>unresolved launches</small>
        </div>
        <div>
          <span>{counts.pawEnrichedNodes}</span>
          <small>PAW enriched</small>
        </div>
      </div>
      {trackerMissingCount > 0 ? (
        <RuntimeIssueAggregate
          code="tracker-snapshot-missing"
          count={trackerMissingCount}
          message={`${trackerMissingCount} node${
            trackerMissingCount === 1 ? " has" : "s have"
          } GitHub tracker references but no tracker snapshot loaded.`}
        />
      ) : null}
      <RuntimeIssueList
        issues={visibleSummaryIssues}
        emptyLabel={
          trackerMissingCount > 0
            ? "No other runtime overlay degradation across this graph."
            : "No runtime overlay degradation across this graph."
        }
      />
      {hiddenSummaryIssueCount > 0 ? (
        <div className="sl-sidebar-note">
          {hiddenSummaryIssueCount} more runtime issue{hiddenSummaryIssueCount === 1 ? "" : "s"} hidden.
        </div>
      ) : null}
      <SelectedRuntimeDetails node={selectedNode} />
    </section>
  );
}
