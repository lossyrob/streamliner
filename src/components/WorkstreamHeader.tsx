import { useState, useRef, useEffect } from "react";
import type { WorkstreamDocument } from "../workstream-schema";
import type { WorkstreamRegistryListEntry } from "../workstream-registry-contract";
import type { WorkstreamViewModel } from "../workstream-view-model";
import { issueLabel, issueUrl } from "../workstream-links";
import { handleInAppLinkClick, routePath, workstreamRoutePath } from "../dashboard-routing";

interface WorkstreamHeaderProps {
  workstream: WorkstreamDocument;
  viewModel: WorkstreamViewModel;
  activeWorkstream: { projectKey: string; workstreamId: string };
  trackedWorkstreams: WorkstreamRegistryListEntry[];
  onOpenWorkstream: (entry: WorkstreamRegistryListEntry) => void;
  onAddWorkstream: () => void | Promise<void>;
  onConfigureWorkstream: () => void;
  configureDisabledReason?: string | null;
  onUntrackWorkstream: (entry: WorkstreamRegistryListEntry) => void | Promise<void>;
  dimCompleted: boolean;
  dimPlanned: boolean;
  onDimCompletedChange: (dimmed: boolean) => void;
  onDimPlannedChange: (dimmed: boolean) => void;
}

function statusPillClass(status: string): string {
  switch (status) {
    case "active":
      return "green";
    case "blocked":
      return "red";
    default:
      return "accent";
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

function registryKey(entry: { projectKey: string; workstreamId: string }): string {
  return `${entry.projectKey}/${entry.workstreamId}`;
}

export function WorkstreamHeader({
  workstream,
  viewModel,
  activeWorkstream,
  trackedWorkstreams,
  onOpenWorkstream,
  onAddWorkstream,
  onConfigureWorkstream,
  configureDisabledReason,
  onUntrackWorkstream,
  dimCompleted,
  dimPlanned,
  onDimCompletedChange,
  onDimPlannedChange,
}: WorkstreamHeaderProps) {
  const [showWorkstreams, setShowWorkstreams] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleAddWorkstream = () => {
    void onAddWorkstream();
    setShowWorkstreams(false);
  };

  useEffect(() => {
    if (!showWorkstreams) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowWorkstreams(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showWorkstreams]);

  const trackingIssue = issueLabel(workstream.trackingIssue);
  const trackingIssueHref = issueUrl(workstream.trackingIssue);
  const activeKey = registryKey(activeWorkstream);

  return (
    <header className="sl-header">
      <div className="sl-header-main">
        <span className="sl-eyebrow">WORKSTREAM</span>
        <div className="sl-title-row">
          <h1 className="sl-title">{workstream.title}</h1>
          <div className="sl-badges">
            <span className={`sl-pill ${statusPillClass(workstream.status)}`}>
              {workstream.status}
            </span>
            <span
              className={`sl-pill ${attentionPillClass(workstream.attention)}`}
            >
              {workstream.attention}
            </span>
          </div>
        </div>
        <p className="sl-summary">{workstream.summary}</p>
        <div className="sl-meta-row">
          <span>{viewModel.freshness.label}</span>
          {trackingIssue && (
            <span>
              Tracking:{" "}
              {trackingIssueHref ? (
                <a
                  href={trackingIssueHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sl-inline-link"
                >
                  {trackingIssue}
                </a>
              ) : (
                trackingIssue
              )}
            </span>
          )}
          <span>{workstream.nodes.length} nodes</span>
          <span>{activeKey}</span>
        </div>
      </div>
      <div className="sl-header-actions">
        <div className="sl-graph-display-controls" role="group" aria-label="Graph display">
          <button
            className={`sl-action-btn${dimCompleted ? " active" : ""}`}
            type="button"
            aria-pressed={dimCompleted}
            onClick={() => onDimCompletedChange(!dimCompleted)}
            title="Fade completed items while keeping them on the graph"
          >
            Dim completed
          </button>
          <button
            className={`sl-action-btn${dimPlanned ? " active" : ""}`}
            type="button"
            aria-pressed={dimPlanned}
            onClick={() => onDimPlannedChange(!dimPlanned)}
            title="Fade planned items while keeping them on the graph"
          >
            Dim planned
          </button>
        </div>
        <div className="sl-recents-container" ref={dropdownRef}>
          <a
            className="sl-action-btn"
            href={routePath({ view: "workstreams" })}
            onClick={(event) => handleInAppLinkClick(event, () => setShowWorkstreams((v) => !v))}
          >
            Workstreams ▾
          </a>
          {showWorkstreams && (
            <div className="sl-recents-dropdown">
              {trackedWorkstreams.length === 0 ? (
                <div className="sl-recents-empty">No tracked workstreams</div>
              ) : (
                trackedWorkstreams.map((entry) => {
                  const key = registryKey(entry);
                  return (
                    <div
                      key={key}
                      className={`sl-recents-item-row${key === activeKey ? " active" : ""}`}
                    >
                      <a
                        className="sl-recents-item"
                        href={workstreamRoutePath(entry)}
                        onClick={(event) => handleInAppLinkClick(event, () => {
                          onOpenWorkstream(entry);
                          setShowWorkstreams(false);
                        })}
                      >
                        <span className="sl-recents-title">{entry.title}</span>
                        <span className="sl-recents-id">{key}</span>
                      </a>
                      <button
                        className="sl-recents-remove"
                        onClick={() => {
                          void onUntrackWorkstream(entry);
                        }}
                        aria-label={`Untrack ${entry.title}`}
                        title="Untrack workstream"
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
        <a
          className="sl-action-btn"
          href={routePath({ view: "workstreams" })}
          onClick={(event) => handleInAppLinkClick(event, handleAddWorkstream)}
        >
          Manage sources…
        </a>
        <button
          className="sl-action-btn"
          type="button"
          onClick={onConfigureWorkstream}
          disabled={Boolean(configureDisabledReason)}
          title={configureDisabledReason ?? "Configure workstream launch settings"}
        >
          Configure…
        </button>
      </div>
    </header>
  );
}
