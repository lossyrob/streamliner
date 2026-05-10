import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  activitySignalClass,
  activityStatusHint,
  getActivityStatusLabel,
} from "./session-activity-status";
import { handleInAppLinkClick } from "../dashboard-routing";
import type { WorkstreamGraphNodeData } from "../workstream-graph";
import { trackerLabel, trackerUrl } from "../workstream-links";

function formatLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").toLowerCase();
}

function formatPawStage(value: string | null): string {
  return value ? formatLabel(value) : "workflow";
}

function highlightClassName(highlight: WorkstreamGraphNodeData["highlight"]) {
  switch (highlight) {
    case "selected":
      return "selected";
    case "ancestor":
      return "ancestor";
    case "descendant":
      return "descendant";
    case "dim":
      return "dim";
    default:
      return "";
  }
}

function statusClassName(value: string) {
  switch (value) {
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

function runtimeStatusClassName(value: string) {
  switch (value) {
    case "active":
      return "status-green";
    case "launching":
    case "needs-input":
      return "status-amber";
    case "interrupted":
    case "unresolved":
      return "status-red";
    case "ended":
      return "muted";
    default:
      return "status-accent";
  }
}

function launchOperationClassName(status: string) {
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

function launchOperationLabel(data: WorkstreamGraphNodeData): string | null {
  const operation = data.launchOperation;
  if (!operation) {
    return null;
  }
  const managed = operation.handoff?.runtimeKind === "managed-sdk" || Boolean(operation.managedLaunch);
  switch (operation.status) {
    case "preparing":
      return "PAW init running";
    case "prepared":
      return managed ? "background prepared" : "handoff prepared";
    case "launching":
      return "terminal launching";
    case "launched_pending_binding":
      return "terminal launched";
    case "managed_starting":
      return "background starting";
    case "managed_running":
      return "background launched";
    case "preparation_failed":
      return "PAW init failed";
    case "managed_failed":
      return "background failed";
    case "terminal_failed":
      return "terminal failed";
    default:
      return null;
  }
}

function NodeBadges({
  data,
  gate,
}: {
  data: WorkstreamGraphNodeData;
  gate: boolean;
}) {
  const pullRequestCount =
    data.entry.githubIssue?.linkedPullRequests.length ??
    (data.entry.activePullRequest ? 1 : 0);
  const overlay = data.runtimeOverlay;
  const showRuntimeStatus =
    overlay &&
    (overlay.runtimeStatus !== data.entry.operationalStatus ||
      overlay.hasRuntimeEvidence);
  const launchLabel = launchOperationLabel(data);

  return (
    <div className="sl-node-badges">
      <span
        className={`sl-node-pill ${statusClassName(data.entry.operationalStatus)}`}
      >
        {formatLabel(data.entry.operationalStatus)}
      </span>
      {gate ? (
        <span className="sl-node-pill muted">milestone</span>
      ) : (
        <>
          <span className="sl-node-pill muted">{data.entry.node.type}</span>
          <span className="sl-node-pill muted">{data.entry.node.attention}</span>
        </>
      )}
      {pullRequestCount > 0 ? (
        <span className="sl-node-pill muted">
          {pullRequestCount} PR{pullRequestCount === 1 ? "" : "s"}
        </span>
      ) : null}
      {showRuntimeStatus && overlay ? (
        <span
          className={`sl-node-pill ${runtimeStatusClassName(overlay.runtimeStatus)}`}
        >
          runtime {formatLabel(overlay.runtimeStatus)}
        </span>
      ) : null}
      {launchLabel && data.launchOperation ? (
        <span className={`sl-node-pill ${launchOperationClassName(data.launchOperation.status)}`}>
          {launchLabel}
        </span>
      ) : null}
    </div>
  );
}

function NodeSessionIndicator({
  data,
  gate,
}: {
  data: WorkstreamGraphNodeData;
  gate: boolean;
}) {
  if (gate) {
    return null;
  }

  const status = data.sessionStatus;
  if (!status) {
    return null;
  }

  const primarySession = status.primarySession;
  const signalClass = activitySignalClass(primarySession.activityStatus);
  const activityLabel = getActivityStatusLabel(primarySession);
  const activityHint = activityStatusHint(primarySession.activityStatus);
  const countLabel =
    status.count === 1 ? "1 session" : `${status.count} sessions`;
  const detail =
    status.count === 1
      ? primarySession.title
      : `${primarySession.title} + ${status.count - 1} more`;
  const href = data.sessionsHref ?? "/sessions";
  const openSessions = data.onOpenSessions;

  return (
    <div
      className={`sl-node-session ${signalClass}`}
      title={`${activityHint} · ${detail}`}
    >
      <div className="sl-node-session-main">
        <span className={`sl-session-row-status-pill ${signalClass}`}>
          {activityLabel}
        </span>
        <span className="sl-session-row-signal-track" aria-hidden="true">
          <span className="sl-session-row-signal-pulse" />
        </span>
        <span className="sl-node-session-count">{countLabel}</span>
      </div>
      <a
        className="sl-node-session-link"
        href={href}
        onClick={(event) => {
          event.stopPropagation();
          if (openSessions) {
            handleInAppLinkClick(event, openSessions);
          }
        }}
      >
        View in Sessions
      </a>
    </div>
  );
}

function NodeRuntimeOverlayIndicator({
  data,
  gate,
}: {
  data: WorkstreamGraphNodeData;
  gate: boolean;
}) {
  if (gate || !data.runtimeOverlay) {
    return null;
  }

  const overlay = data.runtimeOverlay;
  const issueCount = overlay.degradationReasons.filter(
    (reason) => reason.code !== "tracker-snapshot-missing",
  ).length;
  const chips: Array<{ key: string; label: string; className: string }> = [];
  if (overlay.launch.unresolved) {
    chips.push({
      key: "launch",
      label: overlay.runtimeStatus === "launching" ? "launching" : "launch unresolved",
      className: runtimeStatusClassName(overlay.runtimeStatus),
    });
  }
  if (overlay.paw.status === "recognized") {
    chips.push({
      key: "paw",
      label: `PAW ${formatPawStage(overlay.paw.stage)}`,
      className: "status-accent",
    });
  } else if (overlay.paw.status === "unavailable" || overlay.paw.status === "unknown") {
    chips.push({
      key: "paw-degraded",
      label: "PAW degraded",
      className: "status-amber",
    });
  }
  if (overlay.managedRuntime) {
    chips.push({
      key: "managed-runtime",
      label: `background ${overlay.managedRuntime.lifecycleLabel}`,
      className: runtimeStatusClassName(overlay.runtimeStatus),
    });
  }
  if (overlay.session.ambiguous) {
    chips.push({
      key: "ambiguous",
      label: "multiple sessions",
      className: "status-amber",
    });
  }
  if (issueCount > 0) {
    chips.push({
      key: "issues",
      label: `${issueCount} runtime issue${issueCount === 1 ? "" : "s"}`,
      className: "status-amber",
    });
  }

  if (chips.length === 0) {
    return null;
  }

  return (
    <div
      className="sl-node-runtime"
      title={overlay.degradationReasons.map((reason) => reason.message).join(" ")}
    >
      {chips.map((chip) => (
        <span key={chip.key} className={`sl-node-pill ${chip.className}`}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function NodeShell({
  data,
  gate,
}: {
  data: WorkstreamGraphNodeData;
  gate: boolean;
}) {
  const tracker = trackerLabel(data.entry.node.tracker);
  const trackerHref = trackerUrl(data.entry.node.tracker);
  const rootClassName = [
    "sl-node",
    gate ? "gate" : "task",
    statusClassName(data.entry.operationalStatus),
    highlightClassName(data.highlight),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      <Handle isConnectable={false} position={Position.Top} type="target" />
      <Handle isConnectable={false} position={Position.Bottom} type="source" />
      <div className="sl-node-title">{data.entry.node.title}</div>
      {data.showId ? (
        <div className="sl-node-id">{data.entry.node.id}</div>
      ) : null}
      <NodeBadges data={data} gate={gate} />
      <NodeSessionIndicator data={data} gate={gate} />
      <NodeRuntimeOverlayIndicator data={data} gate={gate} />
      <div className="sl-node-summary">{data.entry.node.summary}</div>
      <div className="sl-node-meta">
        <span>{data.repoLabel}</span>
        {tracker ? (
          trackerHref ? (
            <a
              href={trackerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="sl-node-issue-link"
            >
              {tracker}
            </a>
          ) : (
            <span>{tracker}</span>
          )
        ) : null}
      </div>
    </div>
  );
}

export function WorkstreamGraphNode({
  data,
}: NodeProps<Node<WorkstreamGraphNodeData>>) {
  return <NodeShell data={data} gate={false} />;
}

export function WorkstreamGraphGateNode({
  data,
}: NodeProps<Node<WorkstreamGraphNodeData>>) {
  return <NodeShell data={data} gate />;
}
