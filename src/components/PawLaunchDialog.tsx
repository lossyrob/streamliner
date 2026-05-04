import type { FormEvent } from "react";
import { useEffect, useState } from "react";
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

export interface PawLaunchProgressEvent {
  type: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

interface PawLaunchDialogProps {
  nodeTitle: string;
  defaults: PawLaunchDialogDefaults;
  preparing: boolean;
  error: string | null;
  handoff: PawLaunchDialogHandoff | null;
  progressEvents: PawLaunchProgressEvent[];
  onCancel: () => void;
  onSubmit: (configuration: PawLaunchDialogConfiguration) => void;
}

interface PawPromptProfile {
  id: string;
  name: string;
  instructions: string;
  updatedAt: string;
}

interface WorkflowContextDocument {
  path: string;
  content: string;
  updatedAt: string;
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

function responseErrorMessage(response: Response, fallback: string): string {
  return `${fallback} (${response.status})`;
}

function progressLabel(type: string): string {
  return type
    .split(/[._-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function profileUpdatedAtMs(profile: PawPromptProfile): number {
  const parsed = Date.parse(profile.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortProfiles(profiles: PawPromptProfile[]): PawPromptProfile[] {
  return [...profiles].sort((left, right) => left.name.localeCompare(right.name));
}

function profileNameKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mergePromptProfiles(
  current: PawPromptProfile[],
  incoming: PawPromptProfile[],
): PawPromptProfile[] {
  const byId = new Map(current.map((profile) => [profile.id, profile]));
  for (const profile of incoming) {
    const existing = byId.get(profile.id);
    if (!existing || profileUpdatedAtMs(profile) >= profileUpdatedAtMs(existing)) {
      byId.set(profile.id, profile);
    }
  }
  return sortProfiles([...byId.values()]);
}

async function loadPromptProfiles(): Promise<PawPromptProfile[]> {
  const response = await fetch("/api/paw-launch-prompt-profiles");
  if (!response.ok) {
    throw new Error(responseErrorMessage(response, "Could not load prompt profiles."));
  }
  const body = await response.json() as { profiles?: PawPromptProfile[] };
  return Array.isArray(body.profiles) ? body.profiles : [];
}

async function savePromptProfile(input: {
  id?: string;
  name: string;
  instructions: string;
}): Promise<PawPromptProfile> {
  const response = await fetch(
    input.id
      ? `/api/paw-launch-prompt-profiles/${encodeURIComponent(input.id)}`
      : "/api/paw-launch-prompt-profiles",
    {
      method: input.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        instructions: input.instructions,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(responseErrorMessage(response, "Could not save prompt profile."));
  }
  const body = await response.json() as { profile?: PawPromptProfile };
  if (!body.profile) {
    throw new Error("Prompt profile response was missing the saved profile.");
  }
  return body.profile;
}

async function loadWorkflowContext(path: string): Promise<WorkflowContextDocument> {
  const response = await fetch(`/api/paw-workflow-context?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw new Error(responseErrorMessage(response, "Could not load WorkflowContext.md."));
  }
  return await response.json() as WorkflowContextDocument;
}

async function saveWorkflowContext(path: string, content: string): Promise<WorkflowContextDocument> {
  const response = await fetch("/api/paw-workflow-context", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  if (!response.ok) {
    throw new Error(responseErrorMessage(response, "Could not save WorkflowContext.md."));
  }
  return await response.json() as WorkflowContextDocument;
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
  progressEvents,
  onCancel,
  onSubmit,
}: PawLaunchDialogProps) {
  const [workflowInstructions, setWorkflowInstructions] = useState(defaults.workflowInstructions);
  const [cliArgsText, setCliArgsText] = useState(defaults.cliArgsText);
  const [terminal, setTerminal] = useState(defaults.terminal);
  const [profiles, setProfiles] = useState<PawPromptProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [workflowContext, setWorkflowContext] = useState<WorkflowContextDocument | null>(null);
  const [workflowContextText, setWorkflowContextText] = useState("");
  const [workflowContextLoading, setWorkflowContextLoading] = useState(false);
  const [workflowContextSaving, setWorkflowContextSaving] = useState(false);
  const [workflowContextStatus, setWorkflowContextStatus] = useState<string | null>(null);
  const [workflowContextError, setWorkflowContextError] = useState<string | null>(null);
  const trimmedInstructions = workflowInstructions.trim();
  const instructionError = trimmedInstructions.length === 0
    ? "Launch instructions are required so paw-init can derive the workflow setup and worker prompt."
    : null;
  const latestProgress = progressEvents.at(-1) ?? null;
  const recentProgress = progressEvents.slice(-8);
  const debugPath = progressEvents
    .map((event) => stringField(event.data?.workspacePath) ?? stringField(event.data?.sdkStateRoot))
    .find(Boolean) ?? null;

  useEffect(() => {
    let cancelled = false;
    setProfileError(null);
    loadPromptProfiles()
      .then((loadedProfiles) => {
        if (!cancelled) {
          setProfiles((current) => mergePromptProfiles(current, loadedProfiles));
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setProfileError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!handoff) {
      setWorkflowContext(null);
      setWorkflowContextText("");
      setWorkflowContextError(null);
      setWorkflowContextStatus(null);
      return;
    }
    let cancelled = false;
    setWorkflowContextLoading(true);
    setWorkflowContextError(null);
    setWorkflowContextStatus(null);
    loadWorkflowContext(handoff.workflowContextPath)
      .then((document) => {
        if (!cancelled) {
          setWorkflowContext(document);
          setWorkflowContextText(document.content);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setWorkflowContext(null);
          setWorkflowContextText("");
          setWorkflowContextError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWorkflowContextLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [handoff]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const trimmedProfileName = profileName.trim();
  const selectedProfileNameChanged = Boolean(
    selectedProfile &&
      trimmedProfileName &&
      profileNameKey(trimmedProfileName) !== profileNameKey(selectedProfile.name),
  );
  const duplicateProfile = trimmedProfileName
    ? profiles.find((profile) =>
        profileNameKey(profile.name) === profileNameKey(trimmedProfileName) &&
        profile.id !== selectedProfile?.id
      ) ?? null
    : null;
  const canSaveProfile = !profileBusy && !instructionError && Boolean(trimmedProfileName);
  const profileSaveLabel = selectedProfile && !selectedProfileNameChanged
    ? "Update profile"
    : "Save as new profile";
  const profileSaveHelp = selectedProfile
    ? selectedProfileNameChanged
      ? `Saving creates a new profile and leaves "${selectedProfile.name}" unchanged.`
      : `Saving updates "${selectedProfile.name}". Change the save name to create a new profile.`
    : "Choose a saved profile to update it, or enter a save name for a new profile.";

  const applyProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    setProfileStatus(null);
    setProfileError(null);
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (profile) {
      setWorkflowInstructions(profile.instructions);
      setProfileName(profile.name);
    }
  };

  const handleSaveProfile = async () => {
    setProfileBusy(true);
    setProfileStatus(null);
    setProfileError(null);
    try {
      if (!trimmedProfileName) {
        throw new Error("Profile name is required.");
      }
      if (selectedProfileNameChanged && duplicateProfile) {
        throw new Error(`A profile named "${duplicateProfile.name}" already exists. Select it to update it, or choose a different name.`);
      }

      const targetProfile = selectedProfile && !selectedProfileNameChanged
        ? selectedProfile
        : !selectedProfile
          ? duplicateProfile
          : null;
      const saved = await savePromptProfile({
        id: targetProfile?.id,
        name: trimmedProfileName,
        instructions: trimmedInstructions,
      });
      setProfiles((current) => mergePromptProfiles(current, [saved]));
      setSelectedProfileId(saved.id);
      setProfileName(saved.name);
      setProfileStatus(`${targetProfile ? "Updated" : "Saved"} "${saved.name}".`);
    } catch (saveError: unknown) {
      setProfileError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setProfileBusy(false);
    }
  };

  const handleSaveWorkflowContext = async () => {
    if (!handoff) {
      return;
    }
    setWorkflowContextSaving(true);
    setWorkflowContextStatus(null);
    setWorkflowContextError(null);
    try {
      const saved = await saveWorkflowContext(handoff.workflowContextPath, workflowContextText);
      setWorkflowContext(saved);
      setWorkflowContextText(saved.content);
      setWorkflowContextStatus("Saved WorkflowContext.md.");
    } catch (saveError: unknown) {
      setWorkflowContextError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setWorkflowContextSaving(false);
    }
  };

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
              Selected node: <strong>{nodeTitle}</strong>. Streamliner runs one
              fully capable SDK session to assemble launch context, run the PAW
              init skill, and install that context into the PAW work directory.
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
          {(preparing || progressEvents.length > 0) && !handoff && (
            <section className="sl-paw-launch-progress" aria-live="polite">
              <div className="sl-paw-config-section-head">
                <div>
                  <span className="sl-section-label">PAW init progress</span>
                  <p>
                    Streamliner is running one internal Copilot SDK session for
                    context assembly and PAW init.
                  </p>
                </div>
                <span className="sl-pill accent">
                  {latestProgress ? progressLabel(latestProgress.type) : "Starting"}
                </span>
              </div>
              <div className="sl-paw-progress-current">
                {latestProgress?.message ?? "Starting Streamliner PAW launch preparation..."}
              </div>
              {recentProgress.length > 0 && (
                <ol className="sl-paw-progress-list">
                  {recentProgress.map((event, index) => (
                    <li key={`${event.timestamp}-${event.type}-${index}`}>
                      <span>{progressLabel(event.type)}</span>
                      <p>{event.message}</p>
                    </li>
                  ))}
                </ol>
              )}
              {debugPath && (
                <p className="sl-field-note">
                  Debug session state: {debugPath}
                </p>
              )}
            </section>
          )}

          <section className="sl-paw-config-section sl-paw-instructions-section">
            <div className="sl-paw-config-section-head">
              <div>
                <span className="sl-section-label">Launch instructions</span>
                <p>
                  Describe how this launched PAW session should behave. PAW init
                  can derive setup fields from this text, and Streamliner includes
                  the guidance in the final worker kickoff prompt.
                </p>
              </div>
            </div>
            <div className="sl-paw-profile-tools">
              <label className="sl-field">
                <span>Load profile</span>
                <select
                  value={selectedProfileId}
                  aria-label="Load profile"
                  onChange={(event) => applyProfile(event.target.value)}
                >
                  <option value="">Custom launch instructions</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <TextField
                label="Save name"
                ariaLabel="Save name"
                value={profileName}
                onChange={setProfileName}
                placeholder="Name this reusable launch text"
              />
              <div className="sl-paw-profile-actions">
                <button
                  type="button"
                  className="sl-action-btn"
                  disabled={!canSaveProfile}
                  onClick={handleSaveProfile}
                >
                  {profileSaveLabel}
                </button>
              </div>
            </div>
            <p className="sl-field-note">{profileSaveHelp}</p>
            {(profileStatus || profileError) && (
              <p className={profileError ? "sl-action-error" : "sl-inline-status"}>
                {profileError ?? profileStatus}
              </p>
            )}
            <TextAreaField
              label="Launch instructions"
              ariaLabel="Launch instructions"
              value={workflowInstructions}
              onChange={setWorkflowInstructions}
              rows={8}
              placeholder="Example: Use paw-lite, final-pr-only, no intermediate pauses unless blocked..."
            />
            <p className="sl-field-note">
              Streamliner does not copy general pause/review/PR guidance into
              PAW custom workflow-stage settings unless you explicitly describe
              a custom PAW stage sequence.
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
              <div className="sl-paw-workflow-context-editor">
                <div className="sl-paw-config-section-head">
                  <div>
                    <span className="sl-section-label">Review WorkflowContext.md</span>
                    <p>
                      PAW init has created the workflow context. Review or make
                      last-minute edits before launching the terminal session.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="sl-action-btn"
                    disabled={workflowContextLoading || workflowContextSaving || !workflowContextText}
                    onClick={handleSaveWorkflowContext}
                  >
                    {workflowContextSaving ? "Saving..." : "Save WorkflowContext"}
                  </button>
                </div>
                {workflowContextLoading ? (
                  <p className="sl-field-note">Loading WorkflowContext.md...</p>
                ) : (
                  <textarea
                    value={workflowContextText}
                    aria-label="WorkflowContext content"
                    rows={14}
                    spellCheck={false}
                    onChange={(event) => {
                      setWorkflowContextText(event.target.value);
                      setWorkflowContextStatus(null);
                    }}
                  />
                )}
                {workflowContext && (
                  <p className="sl-field-note">
                    Loaded from {workflowContext.path}. Last saved {new Date(workflowContext.updatedAt).toLocaleString()}.
                  </p>
                )}
                {(workflowContextStatus || workflowContextError) && (
                  <p className={workflowContextError ? "sl-action-error" : "sl-inline-status"}>
                    {workflowContextError ?? workflowContextStatus}
                  </p>
                )}
              </div>
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
