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
import type { PawPromptProfile } from "./paw-prompt-profiles";
import type { PawReviewPromptTemplate } from "./paw-review-prompt-templates";
import { TerminalColorQuickPicker } from "./SessionColorPicker";

export interface WorkstreamConfigurationValues {
  launchPolicy: WorkstreamLaunchPolicy | null;
  launchDefaults: WorkstreamLaunchDefaults | null;
}

interface WorkstreamConfigurationDialogProps {
  workstream: WorkstreamDocument;
  promptProfiles?: PawPromptProfile[];
  promptProfilesLoading?: boolean;
  promptProfilesError?: string | null;
  reviewPromptTemplates?: PawReviewPromptTemplate[];
  reviewPromptTemplatesLoading?: boolean;
  reviewPromptTemplatesError?: string | null;
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
  promptProfiles = [],
  promptProfilesLoading = false,
  promptProfilesError = null,
  reviewPromptTemplates = [],
  reviewPromptTemplatesLoading = false,
  reviewPromptTemplatesError = null,
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
  const [defaultPromptProfileId, setDefaultPromptProfileId] = useState(
    workstream.launchDefaults?.promptProfileId ?? "",
  );
  const [defaultLaunchAfterInit, setDefaultLaunchAfterInit] = useState(
    workstream.launchDefaults?.launchAfterInit ?? false,
  );
  const [defaultReviewCompanion, setDefaultReviewCompanion] = useState(
    workstream.launchDefaults?.reviewCompanion ?? false,
  );
  const [defaultReviewPromptTemplateId, setDefaultReviewPromptTemplateId] = useState(
    workstream.launchDefaults?.reviewPromptTemplateId ?? "",
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const promptProfilesInitialLoadPending = promptProfilesLoading && promptProfiles.length === 0;
  const reviewPromptTemplatesInitialLoadPending =
    reviewPromptTemplatesLoading && reviewPromptTemplates.length === 0;
  const selectedDefaultMissing = Boolean(
    defaultPromptProfileId &&
      !promptProfilesInitialLoadPending &&
      !promptProfiles.some((profile) => profile.id === defaultPromptProfileId),
  );
  const selectedDefaultTemplateMissing = Boolean(
    defaultReviewPromptTemplateId &&
      !reviewPromptTemplatesInitialLoadPending &&
      !reviewPromptTemplates.some((template) => template.id === defaultReviewPromptTemplateId),
  );

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
    const launchDefaults: WorkstreamLaunchDefaults = {
      ...(defaultPromptProfileId ? { promptProfileId: defaultPromptProfileId } : {}),
      ...(Object.keys(terminal).length > 0 ? { terminal } : {}),
      ...(defaultLaunchAfterInit ? { launchAfterInit: true } : {}),
      ...(defaultReviewCompanion ? { reviewCompanion: true } : {}),
      ...(defaultReviewPromptTemplateId
        ? { reviewPromptTemplateId: defaultReviewPromptTemplateId }
        : {}),
    };
    void onSave({
      launchPolicy: requiredTracker ? { requiredTracker } : null,
      launchDefaults: Object.keys(launchDefaults).length > 0 ? launchDefaults : null,
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
              <span className="sl-section-label">PAW PROFILE DEFAULT</span>
              <h3 className="sl-workstream-config-title">Launch instructions</h3>
              <p className="sl-field-note">
                Preselect a local PAW launch prompt profile when launching nodes from this workstream.
                Missing profiles fall back to custom launch instructions.
              </p>
            </div>
            <label className="sl-field">
              <span>Default load profile</span>
              <select
                aria-label="Default load profile"
                value={defaultPromptProfileId}
                onChange={(event) => setDefaultPromptProfileId(event.target.value)}
                disabled={saving}
              >
                <option value="">Custom launch instructions</option>
                {defaultPromptProfileId && promptProfilesInitialLoadPending && (
                  <option value={defaultPromptProfileId}>
                    Loading profile: {defaultPromptProfileId}
                  </option>
                )}
                {selectedDefaultMissing && (
                  <option value={defaultPromptProfileId}>
                    Missing profile: {defaultPromptProfileId}
                  </option>
                )}
                {promptProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.id})
                  </option>
                ))}
              </select>
              {promptProfilesInitialLoadPending && (
                <span className="sl-inline-status">Loading saved profiles...</span>
              )}
              <span className="sl-field-note">
                Profile IDs are local hints stored in graph.json. Rename keeps the same id;
                deleted or unavailable profiles do not block launch.
              </span>
              {promptProfilesError && (
                <span className="sl-action-error">{promptProfilesError}</span>
              )}
            </label>
          </section>

          <section className="sl-workstream-config-section">
            <div>
              <span className="sl-section-label">LAUNCH BEHAVIOR DEFAULTS</span>
              <h3 className="sl-workstream-config-title">Per-launch checkboxes &amp; review template</h3>
              <p className="sl-field-note">
                Preselect the PAW launch dialog's "Launch after init", "Launch PAW Review
                companion", and review prompt template. Builders can still override per launch.
              </p>
            </div>
            <label className="sl-checkbox-row">
              <input
                type="checkbox"
                aria-label="Default to launch terminal after PAW init"
                checked={defaultLaunchAfterInit}
                onChange={(event) => setDefaultLaunchAfterInit(event.target.checked)}
                disabled={saving}
              />
              <span>
                <strong>Default to "Launch after init"</strong>
                <small>
                  When checked, the terminal launches automatically when PAW init finishes
                  instead of pausing for prompt review.
                </small>
              </span>
            </label>
            <label className="sl-checkbox-row">
              <input
                type="checkbox"
                aria-label="Default to launch PAW Review companion terminal"
                checked={defaultReviewCompanion}
                onChange={(event) => setDefaultReviewCompanion(event.target.checked)}
                disabled={saving}
              />
              <span>
                <strong>Default to "Launch PAW Review companion terminal"</strong>
                <small>
                  When checked, a second REVIEW terminal opens alongside the main launch
                  using the review prompt template below.
                </small>
              </span>
            </label>
            <label className="sl-field">
              <span>Default review prompt template</span>
              <select
                aria-label="Default review prompt template"
                value={defaultReviewPromptTemplateId}
                onChange={(event) => setDefaultReviewPromptTemplateId(event.target.value)}
                disabled={saving}
              >
                <option value="">Custom PAW Review prompt</option>
                {defaultReviewPromptTemplateId && reviewPromptTemplatesInitialLoadPending && (
                  <option value={defaultReviewPromptTemplateId}>
                    Loading template: {defaultReviewPromptTemplateId}
                  </option>
                )}
                {selectedDefaultTemplateMissing && (
                  <option value={defaultReviewPromptTemplateId}>
                    Missing template: {defaultReviewPromptTemplateId}
                  </option>
                )}
                {reviewPromptTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.id})
                  </option>
                ))}
              </select>
              {reviewPromptTemplatesInitialLoadPending && (
                <span className="sl-inline-status">Loading saved templates...</span>
              )}
              <span className="sl-field-note">
                Template IDs are local hints stored in graph.json. Deleted or unavailable
                templates do not block launch.
              </span>
              {reviewPromptTemplatesError && (
                <span className="sl-action-error">{reviewPromptTemplatesError}</span>
              )}
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
