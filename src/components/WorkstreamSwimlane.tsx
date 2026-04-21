import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { WorkstreamCheckpointLaneState } from "../workstream-graph";

export interface WorkstreamSwimlaneData extends Record<string, unknown> {
  title: string;
  subtitle: string;
  index: number;
  state: WorkstreamCheckpointLaneState;
}

const STATE_LABEL: Record<WorkstreamCheckpointLaneState, string> = {
  completed: "Completed",
  current: "Current",
  upcoming: "Upcoming",
};

function WorkstreamSwimlaneImpl({
  data,
}: NodeProps & { data: WorkstreamSwimlaneData }) {
  return (
    <div
      className={`sl-swimlane sl-swimlane--${data.state}`}
      aria-hidden="true"
    >
      <div className="sl-swimlane-header">
        <span className="sl-swimlane-index">
          {String(data.index + 1).padStart(2, "0")}
        </span>
        <div className="sl-swimlane-titles">
          <span className="sl-swimlane-title">{data.title}</span>
          <span className="sl-swimlane-subtitle">
            {STATE_LABEL[data.state]} · {data.subtitle}
          </span>
        </div>
      </div>
    </div>
  );
}

export const WorkstreamSwimlane = memo(
  WorkstreamSwimlaneImpl,
) as unknown as React.ComponentType<NodeProps>;
