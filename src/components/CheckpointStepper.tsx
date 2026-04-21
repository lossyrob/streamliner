import type { WorkstreamCheckpointProgress } from "../workstream-view-model";

interface CheckpointStepperProps {
  checkpoints: WorkstreamCheckpointProgress[];
}

type StepState = "completed" | "current" | "upcoming";

const STATE_LABELS: Record<StepState, string> = {
  completed: "Completed",
  current: "Current",
  upcoming: "Upcoming",
};

function stepStateOf(progress: WorkstreamCheckpointProgress): StepState {
  if (progress.checkpoint.status === "completed") {
    return "completed";
  }
  if (
    progress.totalNodes > 0 &&
    progress.completedNodes === progress.totalNodes
  ) {
    return "completed";
  }
  if (progress.isCurrent) {
    return "current";
  }
  return "upcoming";
}

export function CheckpointStepper({ checkpoints }: CheckpointStepperProps) {
  if (checkpoints.length === 0) {
    return null;
  }

  return (
    <ol className="sl-checkpoint-stepper" aria-label="Workstream checkpoints">
      {checkpoints.map((progress, index) => {
        const state = stepStateOf(progress);
        const { checkpoint, completedNodes, totalNodes } = progress;
        const progressLabel =
          totalNodes === 0
            ? "No nodes tracked"
            : `${completedNodes} / ${totalNodes} nodes complete`;
        return (
          <li
            key={checkpoint.id}
            className={`sl-checkpoint-step sl-checkpoint-step--${state}`}
            title={checkpoint.summary}
            aria-current={state === "current" ? "step" : undefined}
          >
            <div className="sl-checkpoint-marker" aria-hidden="true">
              <span className="sl-checkpoint-marker-index">
                {state === "completed" ? "\u2713" : index + 1}
              </span>
            </div>
            <div className="sl-checkpoint-body">
              <span className="sl-checkpoint-title">{checkpoint.title}</span>
              <span className="sl-checkpoint-progress">{progressLabel}</span>
            </div>
            <span className="sl-visually-hidden">
              {`${STATE_LABELS[state]}. ${progressLabel}.`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
