import type { FormEvent } from "react";
import { useState } from "react";
import {
  type PawLaunchDialogConfiguration,
  type PawLaunchDialogDefaults,
  type PreferredTerminal,
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

function TextField({
  label,
  value,
  onChange,
  ariaLabel,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  return (
    <label className="sl-field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  ariaLabel,
  placeholder,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="sl-field">
      <span>{label}</span>
      <textarea
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        rows={rows ?? 4}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <label className="sl-field">
      <span>{label}</span>
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value as T)}
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
  const [workflowInstructions, setWorkflowInstructions] = useState(defaults.workflowInstructions);
  const [cliArgsText, setCliArgsText] = useState(defaults.cliArgsText);
  const [terminal, setTerminal] = useState(defaults.terminal);
  const trimmedInstructions = workflowInstructions.trim();
  const instructionError = trimmedInstructions.length === 0
    ? "PAW workflow instructions are required so paw-init can derive the workflow."
    : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (instructionError) {
      return;
    }
    onSubmit({
      workflowInstructions: trimmedInstructions,
      cliArgs: parseCliArgs(cliArgsText),
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
              <span className="sl-pill accent">PAW init</span>
              <span className="sl-pill muted">Text-guided workflow</span>
            </div>
            <h2 className="sl-sheet-title">Run PAW init</h2>
            <p className="sl-paw-launch-subtitle">
              Selected node: <strong>{nodeTitle}</strong>. Streamliner stages the
              launch context first, then runs the PAW init skill in a fully capable
              SDK session to derive the workflow and install that context into the
              PAW work directory.
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
          <section className="sl-paw-config-section sl-paw-instructions-section">
            <div className="sl-paw-config-section-head">
              <div>
                <span className="sl-section-label">Workflow instructions</span>
                <p>
                  Describe the PAW workflow in natural language. PAW init can read
                  repository files, inspect git/GitHub context, use shell tools,
                  and derive work title, work ID, target branch, review policy,
                  models, and WorkflowContext settings from this text.
                </p>
              </div>
            </div>
            <TextAreaField
              label="PAW workflow instructions"
              ariaLabel="PAW workflow instructions"
              value={workflowInstructions}
              onChange={setWorkflowInstructions}
              rows={8}
              placeholder="Example: Use paw-lite, final-pr-only, no intermediate pauses unless blocked..."
            />
            <p className="sl-field-note">
              Running PAW init may read or write local repo state. If PAW init
              cannot proceed without a question, Streamliner fails with that
              question instead of waiting indefinitely.
            </p>
          </section>

          <section className="sl-paw-config-section">
            <div className="sl-paw-config-section-head">
              <div>
                <span className="sl-section-label">Launch shell</span>
                <p>Terminal launch is still manual; these values are included in the handoff.</p>
              </div>
            </div>
            <div className="sl-paw-launch-grid">
              <TextField
                label="Copilot CLI args"
                ariaLabel="Copilot CLI args"
                value={cliArgsText}
                onChange={setCliArgsText}
                placeholder="Leave empty for no CLI args"
              />
              <SelectField
                label="Preferred terminal"
                ariaLabel="Preferred terminal"
                value={terminal.preferredTerminal}
                options={TERMINAL_OPTIONS}
                onChange={(value) => setTerminal((current) => ({ ...current, preferredTerminal: value }))}
              />
            </div>
          </section>

          <section className="sl-paw-launch-summary">
            <div>
              <span className="sl-section-label">Graph source</span>
              <p>{defaults.graphPath}</p>
            </div>
            <div>
              <span className="sl-section-label">Terminal</span>
              <p>{defaults.terminalPreference} ({terminal.preferredTerminal})</p>
            </div>
          </section>

          {instructionError && (
            <div className="sl-action-error">{instructionError}</div>
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
                  <dd>{handoff.cliArgs.length > 0 ? handoff.cliArgs.join(" ") : "(none)"}</dd>
                </div>
              </dl>
              <details>
                <summary>Kickoff prompt</summary>
                <pre>{handoff.kickoffPrompt}</pre>
              </details>
            </section>
          )}
        </div>

        <div className="sl-sheet-foot sl-paw-launch-actions">
          <button type="button" className="sl-action-btn" onClick={onCancel} disabled={preparing}>
            Cancel
          </button>
          <button type="submit" className="sl-action-btn primary" disabled={preparing || Boolean(instructionError)}>
            {preparing ? "Running PAW init..." : "Run PAW init"}
          </button>
        </div>
      </form>
    </>
  );
}
