import type { FormEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  DEFAULT_PAW_WORKFLOW_CONFIGURATION,
  DEFAULT_REVIEW_MODELS,
  type ArtifactLifecycle,
  type Enablement,
  type ModelReviewMode,
  type PawLaunchDialogConfiguration,
  type PawLaunchDialogDefaults,
  type PawLaunchWorkflowConfiguration,
  type PreferredTerminal,
  type ReviewInteractive,
  type ReviewInteractionMode,
  type ReviewMode,
  type ReviewPolicy,
  type ReviewStrategy,
  type SessionPolicy,
  type WorkflowIdentity,
  type WorkflowMode,
} from "./paw-launch-config";

export interface PawLaunchDialogHandoff {
  branch: string;
  pawWorkDir: string;
  workflowContextPath: string;
  streamlinerContextPath: string;
  cliArgs: string[];
  kickoffPrompt: string;
}

interface PawLaunchDialogProps {
  nodeTitle: string;
  defaults: PawLaunchDialogDefaults;
  preparing: boolean;
  error: string | null;
  handoff: PawLaunchDialogHandoff | null;
  onCancel: () => void;
  onSubmit: (configuration: PawLaunchDialogConfiguration) => void;
}

interface Option<T extends string> {
  value: T;
  label: string;
}

const WORKFLOW_MODE_OPTIONS: Option<WorkflowMode>[] = [
  { value: "full", label: "Full PAW" },
  { value: "minimal", label: "Minimal" },
  { value: "custom", label: "Custom" },
];

const WORKFLOW_IDENTITY_OPTIONS: Option<WorkflowIdentity>[] = [
  { value: "paw", label: "PAW" },
  { value: "paw-lite", label: "PAW Lite" },
];

const REVIEW_STRATEGY_OPTIONS: Option<ReviewStrategy>[] = [
  { value: "local", label: "Local" },
  { value: "prs", label: "PR-based" },
];

const REVIEW_POLICY_OPTIONS: Option<ReviewPolicy>[] = [
  { value: "final-pr-only", label: "Final PR only" },
  { value: "planning-only", label: "Planning only" },
  { value: "milestones", label: "Milestones" },
  { value: "every-stage", label: "Every stage" },
];

const SESSION_POLICY_OPTIONS: Option<SessionPolicy>[] = [
  { value: "continuous", label: "Continuous" },
  { value: "pause-after-stage", label: "Pause after stages" },
];

const ENABLEMENT_OPTIONS: Option<Enablement>[] = [
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

const REVIEW_MODE_OPTIONS: Option<ReviewMode>[] = [
  { value: "single-model", label: "Single model" },
  { value: "multi-model", label: "Multi-model" },
  { value: "society-of-thought", label: "Society of Thought" },
];

const PLAN_MODE_OPTIONS: Option<ModelReviewMode>[] = [
  { value: "single-model", label: "Single model" },
  { value: "multi-model", label: "Multi-model" },
];

const INTERACTIVE_OPTIONS: Option<ReviewInteractive>[] = [
  { value: "smart", label: "Smart" },
  { value: "false", label: "False" },
  { value: "true", label: "True" },
];

const INTERACTION_MODE_OPTIONS: Option<ReviewInteractionMode>[] = [
  { value: "parallel", label: "Parallel" },
  { value: "debate", label: "Debate" },
];

const ARTIFACT_LIFECYCLE_OPTIONS: Option<ArtifactLifecycle>[] = [
  { value: "commit-and-clean", label: "Commit and clean" },
  { value: "commit-and-persist", label: "Commit and persist" },
  { value: "never-commit", label: "Never commit" },
];

const TERMINAL_OPTIONS: Option<PreferredTerminal>[] = [
  { value: "default", label: "Default" },
  { value: "windows-terminal", label: "Windows Terminal" },
  { value: "powershell", label: "PowerShell" },
];

function parseCliArgs(value: string): string[] {
  return value
    .split(/\s+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function countModels(value: string): number {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") {
    return 0;
  }
  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function firstModel(value: string): string {
  return value.split(",").map((part) => part.trim()).find(Boolean) ?? value.trim();
}

function validateModelMode(
  label: string,
  mode: ModelReviewMode,
  models: string,
): string | null {
  const count = countModels(models);
  if (mode === "single-model" && count > 1) {
    return `${label} uses multiple models, so choose multi-model mode or keep one model.`;
  }
  if (mode === "multi-model" && count < 2) {
    return `${label} is multi-model, so provide at least two comma-separated models.`;
  }
  return null;
}

function validatePawConfiguration(
  workTitle: string,
  workId: string,
  paw: PawLaunchWorkflowConfiguration,
): string[] {
  const errors: string[] = [];
  if (!workTitle.trim()) {
    errors.push("Work title is required.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workId.trim())) {
    errors.push("Work ID must be kebab-case.");
  }
  if (paw.workflowMode === "minimal" && paw.reviewStrategy !== "local") {
    errors.push("Minimal workflow mode requires local review strategy.");
  }
  if (
    (paw.reviewPolicy === "planning-only" || paw.reviewPolicy === "final-pr-only") &&
    paw.reviewStrategy !== "local"
  ) {
    errors.push("Planning-only and final-PR-only policies require local review strategy.");
  }
  if (
    paw.workflowMode === "custom" &&
    paw.workflowIdentity !== "paw-lite" &&
    !paw.customWorkflowInstructions.trim()
  ) {
    errors.push("Custom workflow mode requires custom workflow instructions.");
  }
  if (
    paw.workflowIdentity === "paw-lite" &&
    (paw.workflowMode !== "custom" ||
      paw.reviewStrategy !== "local" ||
      paw.reviewPolicy !== "final-pr-only")
  ) {
    errors.push("PAW Lite requires custom workflow mode, local strategy, and final-PR-only policy.");
  }
  if (paw.finalReviewMode === "society-of-thought" && paw.finalAgentReview !== "enabled") {
    errors.push("Final Society of Thought review requires final agent review to be enabled.");
  }
  if (paw.planningReviewMode === "society-of-thought" && paw.planningDocsReview !== "enabled") {
    errors.push("Planning Society of Thought review requires planning docs review to be enabled.");
  }
  if (paw.finalReviewMode !== "society-of-thought") {
    const error = validateModelMode("Final review", paw.finalReviewMode, paw.finalReviewModels);
    if (error) errors.push(error);
  }
  if (paw.planningReviewMode !== "society-of-thought") {
    const error = validateModelMode("Planning review", paw.planningReviewMode, paw.planningReviewModels);
    if (error) errors.push(error);
  }
  const planModelError = validateModelMode("Plan generation", paw.planGenerationMode, paw.planGenerationModels);
  if (planModelError) {
    errors.push(planModelError);
  }
  if (paw.finalReviewPerspectiveCap < 1 || !Number.isInteger(paw.finalReviewPerspectiveCap)) {
    errors.push("Final review perspective cap must be a positive integer.");
  }
  if (paw.planningReviewPerspectiveCap < 1 || !Number.isInteger(paw.planningReviewPerspectiveCap)) {
    errors.push("Planning review perspective cap must be a positive integer.");
  }
  return errors;
}

function presetFinalPrOnly(): PawLaunchWorkflowConfiguration {
  return { ...DEFAULT_PAW_WORKFLOW_CONFIGURATION };
}

function presetFullLocalReviews(): PawLaunchWorkflowConfiguration {
  return {
    ...DEFAULT_PAW_WORKFLOW_CONFIGURATION,
    reviewPolicy: "every-stage",
    finalAgentReview: "enabled",
    finalReviewMode: "multi-model",
    planningDocsReview: "enabled",
    planningReviewMode: "multi-model",
    customWorkflowInstructions:
      "Run the full PAW workflow with configured local reviews at each required gate.",
  };
}

function presetPlanningOnly(): PawLaunchWorkflowConfiguration {
  return {
    ...DEFAULT_PAW_WORKFLOW_CONFIGURATION,
    reviewPolicy: "planning-only",
    finalAgentReview: "disabled",
    planningDocsReview: "enabled",
    finalReviewMode: "single-model",
    finalReviewModels: firstModel(DEFAULT_REVIEW_MODELS),
    customWorkflowInstructions:
      "Complete planning and planning-docs review, then stop unless explicitly instructed to implement.",
  };
}

function presetMinimalHandoff(): PawLaunchWorkflowConfiguration {
  return {
    ...DEFAULT_PAW_WORKFLOW_CONFIGURATION,
    workflowMode: "minimal",
    reviewStrategy: "local",
    reviewPolicy: "final-pr-only",
    planningDocsReview: "disabled",
    finalAgentReview: "disabled",
    finalReviewMode: "single-model",
    finalReviewModels: firstModel(DEFAULT_REVIEW_MODELS),
    planGenerationMode: "single-model",
    planGenerationModels: firstModel(DEFAULT_REVIEW_MODELS),
    planningReviewMode: "single-model",
    planningReviewModels: firstModel(DEFAULT_REVIEW_MODELS),
    customWorkflowInstructions:
      "Prepare a minimal PAW handoff and continue only through the requested graph-node work.",
  };
}

function presetPawLite(): PawLaunchWorkflowConfiguration {
  return {
    ...DEFAULT_PAW_WORKFLOW_CONFIGURATION,
    workflowIdentity: "paw-lite",
    workflowMode: "custom",
    reviewStrategy: "local",
    reviewPolicy: "final-pr-only",
    planningDocsReview: "disabled",
    finalAgentReview: "disabled",
    finalReviewMode: "single-model",
    finalReviewModels: firstModel(DEFAULT_REVIEW_MODELS),
    planGenerationMode: "single-model",
    planGenerationModels: firstModel(DEFAULT_REVIEW_MODELS),
    planningReviewMode: "single-model",
    planningReviewModels: firstModel(DEFAULT_REVIEW_MODELS),
    customWorkflowInstructions:
      "Use the paw-lite workflow: plan, implement, configurable final review, and final PR without standard PAW spec/research artifacts.",
  };
}

function FieldNote({ children }: { children: ReactNode }) {
  return <span className="sl-field-note">{children}</span>;
}

function TextField({
  label,
  value,
  onChange,
  ariaLabel = label,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
}) {
  return (
    <label className="sl-field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  ariaLabel = label,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
}) {
  return (
    <label className="sl-field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        type="number"
        min={1}
        value={String(value)}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  ariaLabel = label,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="sl-field">
      <span>{label}</span>
      <textarea
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        rows={rows}
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  ariaLabel = label,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <label className="sl-field">
      <span>{label}</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PawLaunchDialog({
  nodeTitle,
  defaults,
  preparing,
  error,
  handoff,
  onCancel,
  onSubmit,
}: PawLaunchDialogProps) {
  const [workTitle, setWorkTitle] = useState(defaults.workTitle);
  const [workId, setWorkId] = useState(defaults.workId);
  const [baseBranch, setBaseBranch] = useState(defaults.baseBranch);
  const [targetBranch, setTargetBranch] = useState(defaults.targetBranch);
  const [cliArgsText, setCliArgsText] = useState(defaults.cliArgsText);
  const [customMessage, setCustomMessage] = useState("");
  const [paw, setPaw] = useState(defaults.paw);
  const [terminal, setTerminal] = useState(defaults.terminal);

  const validationErrors = useMemo(
    () => validatePawConfiguration(workTitle, workId, paw),
    [paw, workId, workTitle],
  );

  const updatePaw = <K extends keyof PawLaunchWorkflowConfiguration>(
    field: K,
    value: PawLaunchWorkflowConfiguration[K],
  ) => {
    setPaw((current) => ({ ...current, [field]: value }));
  };

  const applyPreset = (next: PawLaunchWorkflowConfiguration) => {
    setPaw(next);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validationErrors.length > 0) {
      return;
    }
    onSubmit({
      workTitle,
      workId,
      baseBranch,
      targetBranch,
      cliArgs: parseCliArgs(cliArgsText),
      customMessage: customMessage.trim().length > 0 ? customMessage : null,
      paw,
      terminal,
    });
  };

  return (
    <>
      <div className="sl-sheet-backdrop open" onClick={onCancel} />
      <form className="sl-sheet sl-paw-launch-dialog open" onSubmit={handleSubmit}>
        <div className="sl-sheet-head">
          <div>
            <div className="sl-sheet-head-pills">
              <span className="sl-pill accent">PAW configuration</span>
              <span className="sl-pill muted">WorkflowContext front end</span>
            </div>
            <h2 className="sl-sheet-title">Configure PAW launch</h2>
            <p className="sl-paw-launch-subtitle">
              Selected node: <strong>{nodeTitle}</strong>.{" "}
              Configure the PAW WorkflowContext before Streamliner prepares the
              work area and kickoff prompt. Terminal launch still happens later.
            </p>
          </div>
          <button
            type="button"
            className="sl-sheet-close"
            aria-label="Close PAW launch dialog"
            onClick={onCancel}
          >
            &times;
          </button>
        </div>

        <div className="sl-sheet-body sl-paw-launch-body">
          <section className="sl-paw-config-section">
            <div className="sl-paw-config-section-head">
              <div>
                <span className="sl-section-label">Presets</span>
                <p>Start from a known PAW shape, then tune the advanced fields below.</p>
              </div>
            </div>
            <div className="sl-paw-preset-grid">
              <button type="button" onClick={() => applyPreset(presetFinalPrOnly())}>
                <strong>Final PR only</strong>
                <span>Default continuous implementation, docs, and final PR path.</span>
              </button>
              <button type="button" onClick={() => applyPreset(presetFullLocalReviews())}>
                <strong>Full local reviews</strong>
                <span>Enable local reviews at every required PAW gate.</span>
              </button>
              <button type="button" onClick={() => applyPreset(presetPlanningOnly())}>
                <strong>Planning only</strong>
                <span>Stop after planning and planning-docs review.</span>
              </button>
              <button type="button" onClick={() => applyPreset(presetMinimalHandoff())}>
                <strong>Minimal handoff</strong>
                <span>Lean PAW context with one-model defaults and no review pauses.</span>
              </button>
              <button type="button" onClick={() => applyPreset(presetPawLite())}>
                <strong>PAW Lite</strong>
                <span>Plan, implement, final review, and final PR with lite artifacts.</span>
              </button>
            </div>
          </section>

          <section className="sl-paw-config-section">
            <div className="sl-paw-config-section-head">
              <div>
                <span className="sl-section-label">Identity and execution</span>
                <p>Fields written directly into the WorkflowContext header.</p>
              </div>
            </div>
            <div className="sl-paw-launch-grid three">
              <SelectField
                label="Workflow identity"
                ariaLabel="PAW workflow identity"
                value={paw.workflowIdentity}
                options={WORKFLOW_IDENTITY_OPTIONS}
                onChange={(value) => updatePaw("workflowIdentity", value)}
              />
              <TextField label="Work title" ariaLabel="PAW work title" value={workTitle} onChange={setWorkTitle} />
              <TextField label="Work ID" ariaLabel="PAW work ID" value={workId} onChange={setWorkId} />
              <TextField label="Base branch" ariaLabel="PAW base branch" value={baseBranch} onChange={setBaseBranch} />
              <TextField label="Target branch" ariaLabel="PAW target branch" value={targetBranch} onChange={setTargetBranch} />
              <SelectField label="Workflow mode" ariaLabel="PAW workflow mode" value={paw.workflowMode} options={WORKFLOW_MODE_OPTIONS} onChange={(value) => updatePaw("workflowMode", value)} />
              <SelectField label="Review strategy" ariaLabel="PAW review strategy" value={paw.reviewStrategy} options={REVIEW_STRATEGY_OPTIONS} onChange={(value) => updatePaw("reviewStrategy", value)} />
              <SelectField label="Review policy" ariaLabel="PAW review policy" value={paw.reviewPolicy} options={REVIEW_POLICY_OPTIONS} onChange={(value) => updatePaw("reviewPolicy", value)} />
              <SelectField label="Session policy" ariaLabel="PAW session policy" value={paw.sessionPolicy} options={SESSION_POLICY_OPTIONS} onChange={(value) => updatePaw("sessionPolicy", value)} />
              <SelectField
                label="Preferred terminal"
                ariaLabel="Preferred terminal"
                value={terminal.preferredTerminal}
                options={TERMINAL_OPTIONS}
                onChange={(value) => setTerminal((current) => ({ ...current, preferredTerminal: value }))}
              />
              <TextField
                label="Copilot CLI args"
                ariaLabel="Copilot CLI args"
                value={cliArgsText}
                onChange={setCliArgsText}
                placeholder="Leave empty for no CLI args"
              />
              <TextField label="Remote" ariaLabel="PAW remote" value={paw.remote} onChange={(value) => updatePaw("remote", value)} />
              <SelectField
                label="Artifact lifecycle"
                ariaLabel="PAW artifact lifecycle"
                value={paw.artifactLifecycle}
                options={ARTIFACT_LIFECYCLE_OPTIONS}
                onChange={(value) => updatePaw("artifactLifecycle", value)}
              />
            </div>
          </section>

          <section className="sl-paw-config-section">
            <div className="sl-paw-config-section-head">
              <div>
                <span className="sl-section-label">Planning and implementation</span>
                <p>Planning docs review and model choices for plan generation.</p>
              </div>
            </div>
            <div className="sl-paw-launch-grid">
              <SelectField label="Planning docs review" ariaLabel="Planning docs review" value={paw.planningDocsReview} options={ENABLEMENT_OPTIONS} onChange={(value) => updatePaw("planningDocsReview", value)} />
              <SelectField label="Planning review mode" ariaLabel="Planning review mode" value={paw.planningReviewMode} options={REVIEW_MODE_OPTIONS} onChange={(value) => updatePaw("planningReviewMode", value)} />
              <SelectField label="Planning review interactive" ariaLabel="Planning review interactive" value={paw.planningReviewInteractive} options={INTERACTIVE_OPTIONS} onChange={(value) => updatePaw("planningReviewInteractive", value)} />
              <TextField label="Planning review models" ariaLabel="Planning review models" value={paw.planningReviewModels} onChange={(value) => updatePaw("planningReviewModels", value)} />
              <SelectField label="Plan generation mode" ariaLabel="Plan generation mode" value={paw.planGenerationMode} options={PLAN_MODE_OPTIONS} onChange={(value) => updatePaw("planGenerationMode", value)} />
              <TextField label="Plan generation models" ariaLabel="Plan generation models" value={paw.planGenerationModels} onChange={(value) => updatePaw("planGenerationModels", value)} />
              <TextField label="Implementation model" ariaLabel="Implementation model" value={paw.implementationModel} onChange={(value) => updatePaw("implementationModel", value)} />
            </div>
            {paw.planningReviewMode === "society-of-thought" ? (
              <FieldNote>Planning Society of Thought ignores planning review models and uses specialist model routing.</FieldNote>
            ) : null}
          </section>

          <section className="sl-paw-config-section">
            <div className="sl-paw-config-section-head">
              <div>
                <span className="sl-section-label">Final review</span>
                <p>Controls final local agent review and final PR review behavior.</p>
              </div>
            </div>
            <div className="sl-paw-launch-grid">
              <SelectField label="Final agent review" ariaLabel="Final agent review" value={paw.finalAgentReview} options={ENABLEMENT_OPTIONS} onChange={(value) => updatePaw("finalAgentReview", value)} />
              <SelectField label="Final review mode" ariaLabel="Final review mode" value={paw.finalReviewMode} options={REVIEW_MODE_OPTIONS} onChange={(value) => updatePaw("finalReviewMode", value)} />
              <SelectField label="Final review interactive" ariaLabel="Final review interactive" value={paw.finalReviewInteractive} options={INTERACTIVE_OPTIONS} onChange={(value) => updatePaw("finalReviewInteractive", value)} />
              <TextField label="Final review models" ariaLabel="Final review models" value={paw.finalReviewModels} onChange={(value) => updatePaw("finalReviewModels", value)} />
            </div>
            {paw.finalReviewMode === "society-of-thought" ? (
              <FieldNote>Final Society of Thought requires final agent review and uses specialist model routing.</FieldNote>
            ) : null}
          </section>

          <details className="sl-paw-config-section sl-paw-advanced">
            <summary>Society of Thought and specialist routing</summary>
            <div className="sl-paw-review-columns">
              <div className="sl-paw-review-column">
                <h3>Planning review specialists</h3>
                <SelectField label="Interaction mode" ariaLabel="Planning review interaction mode" value={paw.planningReviewInteractionMode} options={INTERACTION_MODE_OPTIONS} onChange={(value) => updatePaw("planningReviewInteractionMode", value)} />
                <TextField label="Specialists" ariaLabel="Planning review specialists" value={paw.planningReviewSpecialists} onChange={(value) => updatePaw("planningReviewSpecialists", value)} />
                <TextField label="Specialist models" ariaLabel="Planning review specialist models" value={paw.planningReviewSpecialistModels} onChange={(value) => updatePaw("planningReviewSpecialistModels", value)} />
                <TextField label="Perspectives" ariaLabel="Planning review perspectives" value={paw.planningReviewPerspectives} onChange={(value) => updatePaw("planningReviewPerspectives", value)} />
                <NumberField label="Perspective cap" ariaLabel="Planning review perspective cap" value={paw.planningReviewPerspectiveCap} onChange={(value) => updatePaw("planningReviewPerspectiveCap", value)} />
              </div>
              <div className="sl-paw-review-column">
                <h3>Final review specialists</h3>
                <SelectField label="Interaction mode" ariaLabel="Final review interaction mode" value={paw.finalReviewInteractionMode} options={INTERACTION_MODE_OPTIONS} onChange={(value) => updatePaw("finalReviewInteractionMode", value)} />
                <TextField label="Specialists" ariaLabel="Final review specialists" value={paw.finalReviewSpecialists} onChange={(value) => updatePaw("finalReviewSpecialists", value)} />
                <TextField label="Specialist models" ariaLabel="Final review specialist models" value={paw.finalReviewSpecialistModels} onChange={(value) => updatePaw("finalReviewSpecialistModels", value)} />
                <TextField label="Perspectives" ariaLabel="Final review perspectives" value={paw.finalReviewPerspectives} onChange={(value) => updatePaw("finalReviewPerspectives", value)} />
                <NumberField label="Perspective cap" ariaLabel="Final review perspective cap" value={paw.finalReviewPerspectiveCap} onChange={(value) => updatePaw("finalReviewPerspectiveCap", value)} />
              </div>
            </div>
            <FieldNote>
              Specialists can be "all", comma-separated names, or adaptive:&lt;N&gt;.
              Specialist models support none, a model pool, or specialist:model pins.
            </FieldNote>
          </details>

          <section className="sl-paw-config-section">
            <div className="sl-paw-config-section-head">
              <div>
                <span className="sl-section-label">Instructions and context</span>
                <p>Custom WorkflowContext fields plus one-off builder guidance for the kickoff prompt.</p>
              </div>
            </div>
            <div className="sl-paw-launch-grid">
              <TextField label="Initial prompt marker" ariaLabel="Initial prompt marker" value={paw.initialPrompt} onChange={(value) => updatePaw("initialPrompt", value)} />
              <TextField label="Artifact paths" ariaLabel="PAW artifact paths" value={paw.artifactPaths} onChange={(value) => updatePaw("artifactPaths", value)} />
            </div>
            <TextAreaField
              label="Custom workflow instructions"
              ariaLabel="Custom workflow instructions"
              value={paw.customWorkflowInstructions}
              onChange={(value) => updatePaw("customWorkflowInstructions", value)}
              rows={3}
            />
            <TextAreaField
              label="Builder custom message"
              ariaLabel="Builder custom message"
              value={customMessage}
              onChange={setCustomMessage}
              placeholder="Optional guidance appended to the launched worker kickoff prompt."
              rows={4}
            />
          </section>

          <section className="sl-paw-launch-summary">
            <div>
              <span className="sl-section-label">WorkflowContext summary</span>
              <p>
                {paw.workflowMode} PAW &middot; {paw.reviewStrategy} strategy &middot;{" "}
                {paw.reviewPolicy} policy &middot; planning {paw.planningReviewMode} &middot; final{" "}
                {paw.finalReviewMode}
              </p>
            </div>
            <div>
              <span className="sl-section-label">Terminal</span>
              <p>{defaults.terminalPreference} ({terminal.preferredTerminal})</p>
            </div>
            <div>
              <span className="sl-section-label">Graph source</span>
              <p>{defaults.graphPath}</p>
            </div>
          </section>

          {validationErrors.length > 0 && (
            <div className="sl-action-error">
              <strong>Resolve PAW configuration before preparing:</strong>
              <ul>
                {validationErrors.map((validationError) => (
                  <li key={validationError}>{validationError}</li>
                ))}
              </ul>
            </div>
          )}

          {error && <div className="sl-action-error">{error}</div>}

          {handoff && (
            <section className="sl-paw-launch-result">
              <span className="sl-section-label">Prepared handoff</span>
              <dl>
                <div>
                  <dt>Branch</dt>
                  <dd>{handoff.branch}</dd>
                </div>
                <div>
                  <dt>PAW work dir</dt>
                  <dd>{handoff.pawWorkDir}</dd>
                </div>
                <div>
                  <dt>Workflow context</dt>
                  <dd>{handoff.workflowContextPath}</dd>
                </div>
                <div>
                  <dt>Streamliner context</dt>
                  <dd>{handoff.streamlinerContextPath}</dd>
                </div>
                <div>
                  <dt>CLI args</dt>
                  <dd>{handoff.cliArgs.join(" ") || "none"}</dd>
                </div>
              </dl>
              <details>
                <summary>Kickoff prompt</summary>
                <pre>{handoff.kickoffPrompt}</pre>
              </details>
            </section>
          )}
        </div>

        <div className="sl-sheet-foot">
          <button
            type="button"
            className="sl-action-btn"
            onClick={onCancel}
            disabled={preparing}
          >
            {handoff ? "Close" : "Cancel"}
          </button>
          <button
            type="submit"
            className="sl-action-btn primary"
            disabled={preparing || validationErrors.length > 0}
          >
            {preparing ? "Preparing..." : "Prepare launch"}
          </button>
        </div>
      </form>
    </>
  );
}
