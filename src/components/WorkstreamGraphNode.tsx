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
  if (data.sessionStatusState === "loading") {
    return (
      <div className="sl-node-session inactive">
        <span className="sl-node-session-empty">Loading sessions…</span>
      </div>
    );
  }

  if (data.sessionStatusState === "error") {
    return (
      <div className="sl-node-session inactive">
        <span className="sl-node-session-empty">Session status unavailable</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="sl-node-session inactive">
        <span className="sl-node-session-empty">No bound sessions</span>
      </div>
    );
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
