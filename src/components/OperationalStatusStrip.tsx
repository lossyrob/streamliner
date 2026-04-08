import type { WorkstreamViewModel } from "../workstream-view-model";

interface OperationalStatusStripProps {
  viewModel: WorkstreamViewModel;
}

export function OperationalStatusStrip({
  viewModel,
}: OperationalStatusStripProps) {
  return (
    <div className="sl-stat-strip">
      <div className="sl-stat">
        <span className="sl-stat-value">{viewModel.readyNow.length}</span>
        <span className="sl-stat-label">Ready</span>
      </div>
      <div className="sl-stat">
        <span className="sl-stat-value">{viewModel.inFlight.length}</span>
        <span className="sl-stat-label">In Flight</span>
      </div>
      <div className="sl-stat">
        <span className="sl-stat-value">
          {viewModel.blockedOrAttention.length}
        </span>
        <span className="sl-stat-label">Blocked</span>
      </div>
      <div className="sl-stat">
        <span className="sl-stat-value">
          {viewModel.waitingForReview.length}
        </span>
        <span className="sl-stat-label">Review</span>
      </div>
      <div className="sl-stat">
        <span className="sl-stat-value">{viewModel.gateNodes.length}</span>
        <span className="sl-stat-label">Gates</span>
      </div>
    </div>
  );
}
