import type { WorkstreamDocument } from "../workstream-schema";
import type { WorkstreamViewModel } from "../workstream-view-model";

interface WorkstreamHeaderProps {
  workstream: WorkstreamDocument;
  viewModel: WorkstreamViewModel;
  onLoadFile: (file: File) => void;
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
  onLoadFile,
}: WorkstreamHeaderProps) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoadFile(file);
  };

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
        <label className="sl-action-btn">
          Load workstream…
          <input
            type="file"
            accept=".json"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </label>
      </div>
    </header>
  );
}
