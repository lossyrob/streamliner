import type { FormEvent } from "react";
import { useState } from "react";

export interface PawLaunchDialogDefaults {
  workTitle: string;
  workId: string;
  targetBranch: string;
  cliArgsText: string;
  graphPath: string;
  terminalPreference: string;
}

export interface PawLaunchDialogConfiguration {
  workTitle: string;
  workId: string;
  targetBranch: string;
  cliArgs: string[];
  customMessage: string | null;
}

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

function parseCliArgs(value: string): string[] {
  return value
    .split(/\s+/g)
    .map((part) => part.trim())
    .filter(Boolean);
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
  const [targetBranch, setTargetBranch] = useState(defaults.targetBranch);
  const [cliArgsText, setCliArgsText] = useState(defaults.cliArgsText);
  const [customMessage, setCustomMessage] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      workTitle,
      workId,
      targetBranch,
      cliArgs: parseCliArgs(cliArgsText),
      customMessage: customMessage.trim().length > 0 ? customMessage : null,
    });
  };

  return (
    <>
      <div className="sl-sheet-backdrop open" onClick={onCancel} />
      <form className="sl-sheet sl-paw-launch-dialog open" onSubmit={handleSubmit}>
        <div className="sl-sheet-head">
          <div>
            <div className="sl-sheet-head-pills">
              <span className="sl-pill accent">PAW launch</span>
              <span className="sl-pill muted">preparation only</span>
            </div>
            <h2 className="sl-sheet-title">Launch {nodeTitle}</h2>
            <p className="sl-paw-launch-subtitle">
              Review the PAW worker defaults before Streamliner prepares the
              work area and kickoff prompt. No terminal starts in this step.
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
          <section className="sl-paw-launch-grid">
            <label className="sl-field">
              <span>Work title</span>
              <input
                aria-label="PAW work title"
                value={workTitle}
                onChange={(event) => setWorkTitle(event.currentTarget.value)}
              />
            </label>
            <label className="sl-field">
              <span>Work ID</span>
              <input
                aria-label="PAW work ID"
                value={workId}
                onChange={(event) => setWorkId(event.currentTarget.value)}
              />
            </label>
            <label className="sl-field">
              <span>Target branch</span>
              <input
                aria-label="PAW target branch"
                value={targetBranch}
                onChange={(event) => setTargetBranch(event.currentTarget.value)}
              />
            </label>
            <label className="sl-field">
              <span>Copilot CLI args</span>
              <input
                aria-label="Copilot CLI args"
                value={cliArgsText}
                onChange={(event) => setCliArgsText(event.currentTarget.value)}
                placeholder="Leave empty for no CLI args"
              />
            </label>
          </section>

          <section className="sl-paw-launch-summary">
            <div>
              <span className="sl-section-label">Workflow</span>
              <p>PAW full workflow &middot; local strategy &middot; final PR only</p>
            </div>
            <div>
              <span className="sl-section-label">Terminal</span>
              <p>{defaults.terminalPreference}</p>
            </div>
            <div>
              <span className="sl-section-label">Graph source</span>
              <p>{defaults.graphPath}</p>
            </div>
          </section>

          <label className="sl-field">
            <span>Builder custom message</span>
            <textarea
              aria-label="Builder custom message"
              value={customMessage}
              onChange={(event) => setCustomMessage(event.currentTarget.value)}
              placeholder="Optional guidance for the launched worker."
              rows={5}
            />
          </label>

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
          <button type="submit" className="sl-action-btn primary" disabled={preparing}>
            {preparing ? "Preparing..." : "Prepare launch"}
          </button>
        </div>
      </form>
    </>
  );
}
