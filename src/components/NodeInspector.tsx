import type { WorkstreamNode } from "../workstream-schema";
import type { WorkstreamDerivedNode } from "../workstream-view-model";
import type { WorkstreamGraphLayoutResult } from "../workstream-graph";
import type { WorkstreamDocument } from "../workstream-schema";
import { trackerLabel, trackerUrl } from "../workstream-links";

interface NodeInspectorProps {
  entry: WorkstreamDerivedNode | null;
  layout: WorkstreamGraphLayoutResult;
  workstream: WorkstreamDocument;
  canLaunch?: boolean;
  launchDisabledReason?: string;
  onLaunch?: () => void;
}

function formatStatus(status: string): string {
  return status.replace(/[_-]+/g, " ");
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

export function NodeInspector({
  entry,
  layout,
  workstream,
  canLaunch = false,
  launchDisabledReason,
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
            Initialize PAW launch
          </button>
          {!canLaunch && launchDisabledReason ? (
            <span className="sl-sidebar-note">{launchDisabledReason}</span>
          ) : null}
        </div>
      </div>

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
