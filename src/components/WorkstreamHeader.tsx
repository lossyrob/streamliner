import { useState, useRef, useEffect } from "react";
import type { WorkstreamDocument } from "../workstream-schema";
import type { WorkstreamRegistryListEntry } from "../workstream-registry-contract";
import type { WorkstreamViewModel } from "../workstream-view-model";
import { issueLabel, issueUrl } from "../workstream-links";

interface WorkstreamHeaderProps {
  workstream: WorkstreamDocument;
  viewModel: WorkstreamViewModel;
  activeWorkstream: { projectKey: string; workstreamId: string };
  trackedWorkstreams: WorkstreamRegistryListEntry[];
  onOpenWorkstream: (entry: WorkstreamRegistryListEntry) => void;
  onAddWorkstream: () => void | Promise<void>;
  onUntrackWorkstream: (entry: WorkstreamRegistryListEntry) => void | Promise<void>;
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
  onUntrackWorkstream,
}: WorkstreamHeaderProps) {
  const [showWorkstreams, setShowWorkstreams] = useState(false);
  const [picking, setPicking] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleAddWorkstream = async () => {
    setPicking(true);
    try {
      await onAddWorkstream();
      setShowWorkstreams(false);
    } finally {
      setPicking(false);
    }
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
        <div className="sl-recents-container" ref={dropdownRef}>
          <button
            className="sl-action-btn"
            onClick={() => setShowWorkstreams((v) => !v)}
          >
            Tracked workstreams ▾
          </button>
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
                      <button
                        className="sl-recents-item"
                        onClick={() => {
                          onOpenWorkstream(entry);
                          setShowWorkstreams(false);
                        }}
                      >
                        <span className="sl-recents-title">{entry.title}</span>
                        <span className="sl-recents-id">{key}</span>
                      </button>
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
        <button
          className="sl-action-btn"
          onClick={handleAddWorkstream}
          disabled={picking}
        >
          {picking ? "Opening…" : "Add workstream…"}
        </button>
      </div>
    </header>
  );
}
