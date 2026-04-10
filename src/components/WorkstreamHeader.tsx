import { useState, useRef, useEffect } from "react";
import type { WorkstreamDocument } from "../workstream-schema";
import type { WorkstreamViewModel } from "../workstream-view-model";

interface RecentEntry {
  path: string;
  title: string;
  id: string;
  lastOpened: string;
}

interface WorkstreamHeaderProps {
  workstream: WorkstreamDocument;
  viewModel: WorkstreamViewModel;
  onLoadPath: (path: string) => void;
  recents: RecentEntry[];
  onSwitchRecent: (path: string) => void;
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

export function WorkstreamHeader({
  workstream,
  viewModel,
  onLoadPath,
  recents,
  onSwitchRecent,
}: WorkstreamHeaderProps) {
  const [showRecents, setShowRecents] = useState(false);
  const [picking, setPicking] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handlePickFile = async () => {
    setPicking(true);
    try {
      const res = await fetch("/api/pick-file", { method: "POST" });
      if (res.status === 204) return; // user cancelled
      if (!res.ok) return;
      const { path } = await res.json();
      if (path) onLoadPath(path);
    } catch { /* ignore */ }
    finally { setPicking(false); }
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!showRecents) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowRecents(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showRecents]);

  const trackingIssue = workstream.trackingIssue
    ? `${workstream.trackingIssue.owner}/${workstream.trackingIssue.repo}#${workstream.trackingIssue.number}`
    : null;

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
          {trackingIssue && <span>Tracking: {trackingIssue}</span>}
          <span>{workstream.nodes.length} nodes</span>
        </div>
      </div>
      <div className="sl-header-actions">
        <div className="sl-recents-container" ref={dropdownRef}>
          <button
            className="sl-action-btn"
            onClick={() => setShowRecents((v) => !v)}
          >
            Recent workstreams ▾
          </button>
          {showRecents && (
            <div className="sl-recents-dropdown">
              {recents.length === 0 ? (
                <div className="sl-recents-empty">No recent workstreams</div>
              ) : (
                recents.map((entry) => (
                  <button
                    key={entry.path}
                    className={`sl-recents-item${entry.id === workstream.id ? " active" : ""}`}
                    onClick={() => {
                      onSwitchRecent(entry.path);
                      setShowRecents(false);
                    }}
                  >
                    <span className="sl-recents-title">{entry.title}</span>
                    <span className="sl-recents-id">{entry.id}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button
          className="sl-action-btn"
          onClick={handlePickFile}
          disabled={picking}
        >
          {picking ? "Opening…" : "Open graph…"}
        </button>
      </div>
    </header>
  );
}
