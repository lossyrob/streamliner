import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { WorkstreamIssue } from "../workstream-schema";
import type { WorkstreamGraphNodeData } from "../workstream-graph";

function formatLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").toLowerCase();
}

function issueLabel(issue?: WorkstreamIssue): string | null {
  if (!issue) {
    return null;
  }

  return `${issue.owner}/${issue.repo}#${issue.number}`;
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

function NodeBadges({ data }: { data: WorkstreamGraphNodeData }) {
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
      <span className="sl-node-pill muted">{data.entry.node.type}</span>
      <span className="sl-node-pill muted">{data.entry.node.attention}</span>
      {pullRequestCount > 0 ? (
        <span className="sl-node-pill muted">
          {pullRequestCount} PR{pullRequestCount === 1 ? "" : "s"}
        </span>
      ) : null}
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
  const issue = issueLabel(data.entry.node.issue);
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
      <NodeBadges data={data} />
      <div className="sl-node-summary">{data.entry.node.summary}</div>
      <div className="sl-node-meta">
        <span>{data.repoLabel}</span>
        {issue ? <span>{issue}</span> : null}
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
