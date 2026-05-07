import type { FormEvent } from "react";
import { useState } from "react";

import {
  WORKSTREAM_LAUNCH_TERMINAL_PREFERENCES,
  type WorkstreamDocument,
  type WorkstreamLaunchDefaults,
  type WorkstreamLaunchPolicy,
  type WorkstreamLaunchRequiredTracker,
  type WorkstreamLaunchTerminalPreference,
} from "../workstream-schema";
import { WORKSTREAM_TERMINAL_TITLE_TEMPLATE_HELP } from "../workstream-launch-templates";
import { TerminalColorQuickPicker } from "./SessionColorPicker";

export interface WorkstreamConfigurationValues {
  launchPolicy: WorkstreamLaunchPolicy | null;
  launchDefaults: WorkstreamLaunchDefaults | null;
}

interface WorkstreamConfigurationDialogProps {
  workstream: WorkstreamDocument;
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (configuration: WorkstreamConfigurationValues) => void | Promise<void>;
}

function terminalPreferenceLabel(preference: WorkstreamLaunchTerminalPreference): string {
  switch (preference) {
    case "windows-terminal":
      return "Windows Terminal";
    case "powershell":
      return "PowerShell";
    case "default":
      return "System default";
  }
}

function terminalPreferenceHelp(preference: WorkstreamLaunchTerminalPreference): string {
  switch (preference) {
    case "windows-terminal":
      return "Prefer Windows Terminal when it is available.";
    case "powershell":
      return "Launch worker sessions in a PowerShell window.";
    case "default":
      return "Let Streamliner choose the best available local terminal.";
  }
}

export function WorkstreamConfigurationDialog({
  workstream,
  saving,
  error,
  onCancel,
  onSave,
}: WorkstreamConfigurationDialogProps) {
  const [requiredTracker, setRequiredTracker] = useState<WorkstreamLaunchRequiredTracker | "">(
    workstream.launchPolicy?.requiredTracker ?? "",
  );
  const [preferredTerminal, setPreferredTerminal] = useState<WorkstreamLaunchTerminalPreference>(
    workstream.launchDefaults?.terminal?.preferredTerminal ?? "default",
  );
  const [titleTemplate, setTitleTemplate] = useState(
    workstream.launchDefaults?.terminal?.titleTemplate ?? "",
  );
  const [terminalColor, setTerminalColor] = useState(
    workstream.launchDefaults?.terminal?.tabColor ?? "",
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const color = terminalColor.trim();
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
      setValidationError("Terminal tab color must be a #RRGGBB color.");
      return;
    }
    setValidationError(null);

    const terminal = {
      ...(preferredTerminal !== "default" ? { preferredTerminal } : {}),
      ...(titleTemplate.trim() ? { titleTemplate: titleTemplate.trim() } : {}),
      ...(color ? { tabColor: color.toLowerCase() } : {}),
    };
    void onSave({
      launchPolicy: requiredTracker ? { requiredTracker } : null,
      launchDefaults: Object.keys(terminal).length > 0 ? { terminal } : null,
    });
  };

  return (
    <>
      <div className="sl-sheet-backdrop open" onClick={saving ? undefined : onCancel} />
      <form
        className="sl-sheet sl-workstream-config-dialog open"
        onSubmit={handleSubmit}
        aria-label="Workstream configuration"
      >
        <div className="sl-sheet-head">
          <div>
            <div className="sl-sheet-head-pills">
              <span className="sl-pill muted">graph.json</span>
              <span className="sl-pill accent">workstream config</span>
            </div>
            <h2 className="sl-sheet-title">Configure {workstream.title}</h2>
            <p className="sl-paw-launch-subtitle">
              Save durable launch policy and terminal defaults to this workstream graph.
              These settings apply to every graph-launch caller.
            </p>
          </div>
          <button
            className="sl-sheet-close"
            type="button"
            aria-label="Close workstream configuration"
            onClick={onCancel}
            disabled={saving}
          >
            ×
          </button>
        </div>

        <div className="sl-sheet-body sl-workstream-config-body">
          <section className="sl-workstream-config-section">
            <div>
              <span className="sl-section-label">LAUNCH POLICY</span>
              <h3 className="sl-workstream-config-title">Tracker requirement</h3>
              <p className="sl-field-note">
                Gate PAW initialization and terminal launch before any expensive or
                stateful launch work starts.
              </p>
            </div>
            <label className="sl-field">
              <span>Required tracker</span>
              <select
                aria-label="Required tracker"
                value={requiredTracker}
                onChange={(event) =>
                  setRequiredTracker(event.target.value as WorkstreamLaunchRequiredTracker | "")
                }
                disabled={saving}
              >
                <option value="">No tracker requirement</option>
                <option value="github-issue">Require GitHub issue tracker</option>
              </select>
              <span className="sl-field-note">
                GitHub issue requirement blocks ready nodes with local or missing trackers.
              </span>
            </label>
          </section>

          <section className="sl-workstream-config-section">
            <div>
              <span className="sl-section-label">TERMINAL DEFAULTS</span>
              <h3 className="sl-workstream-config-title">Presentation defaults</h3>
              <p className="sl-field-note">
                Pre-fill the PAW launch dialog for this workstream. Builders can still
                override these values per launch.
              </p>
            </div>
            <div className="sl-paw-launch-grid">
              <label className="sl-field">
                <span>Preferred terminal</span>
                <select
                  aria-label="Preferred terminal"
                  value={preferredTerminal}
                  onChange={(event) =>
                    setPreferredTerminal(event.target.value as WorkstreamLaunchTerminalPreference)
                  }
                  disabled={saving}
                >
                  {WORKSTREAM_LAUNCH_TERMINAL_PREFERENCES.map((preference) => (
                    <option key={preference} value={preference}>
                      {terminalPreferenceLabel(preference)}
                    </option>
                  ))}
                </select>
                <span className="sl-field-note">
                  {terminalPreferenceHelp(preferredTerminal)}
                </span>
              </label>
              <label className="sl-field">
                <span className="sl-field-label-with-help">
                  <span>Terminal tab title template</span>
                  <abbr
                    className="sl-inline-help"
                    title={WORKSTREAM_TERMINAL_TITLE_TEMPLATE_HELP}
                  >
                    ?
                  </abbr>
                </span>
                <input
                  aria-label="Terminal tab title template"
                  value={titleTemplate}
                  onChange={(event) => setTitleTemplate(event.target.value)}
                  placeholder="{githubIssue} - {nodeTitle}"
                  disabled={saving}
                />
                <span className="sl-field-note">
                  Use {"{githubIssue}"}, {"{nodeId}"}, or {"{nodeTitle}"}.
                  Leave empty to use each node title.
                </span>
              </label>
              <label className="sl-field sl-paw-launch-color-field">
                <span>Terminal tab color</span>
                <input
                  aria-label="Default terminal tab color"
                  value={terminalColor}
                  onChange={(event) => setTerminalColor(event.target.value)}
                  placeholder="#4891c8"
                  disabled={saving}
                />
                <TerminalColorQuickPicker
                  value={terminalColor}
                  onChange={setTerminalColor}
                />
              </label>
            </div>
          </section>

          {(validationError || error) && (
            <div className="sl-action-error">{validationError ?? error}</div>
          )}
        </div>

        <div className="sl-sheet-foot">
          <button className="sl-action-btn primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save configuration"}
          </button>
          <button className="sl-action-btn" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
