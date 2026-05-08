import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  type PawLaunchDialogConfiguration,
  type PawLaunchDialogDefaults,
  type PreferredTerminal,
} from "./paw-launch-config";
import type {
  NodeLaunchHandoff,
  NodeTerminalLaunchResponse,
} from "../node-launch-record-contract";
import { humanizeLaunchClaim } from "./launch-claim-display";
import {
  mergePromptProfiles,
  responseErrorMessage,
  savePromptProfile,
  type PawPromptProfile,
} from "./paw-prompt-profiles";
import { TerminalColorQuickPicker } from "./SessionColorPicker";

export type PawLaunchDialogHandoff = NodeLaunchHandoff;

export type PawTerminalLaunchResult = NodeTerminalLaunchResponse;

export interface PawTerminalLaunchInput {
  kickoffPrompt: string;
  terminalTitle: string;
  terminalColor: string | null;
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
  defaultPromptProfileId?: string | null;
  promptProfiles?: PawPromptProfile[];
  promptProfilesLoading?: boolean;
  promptProfilesError?: string | null;
  preparing: boolean;
  launching: boolean;
  error: string | null;
  handoff: PawLaunchDialogHandoff | null;
  terminalLaunchResult: PawTerminalLaunchResult | null;
  progressEvents: PawLaunchProgressEvent[];
  actionDisabledReason?: string | null;
  releasingLaunch?: boolean;
  releaseError?: string | null;
  releaseStatus?: string | null;
  onCancel: () => void;
  onSubmit: (configuration: PawLaunchDialogConfiguration) => void;
  onLaunchTerminal: (input: PawTerminalLaunchInput) => void;
  onPromptProfilesChanged?: (profiles: PawPromptProfile[]) => void;
  onReleaseLaunch?: () => void;
}

interface WorkflowContextDocument {
  path: string;
  content: string;
  updatedAt: string;
}

interface DebugPath {
  label: string;
  path: string;
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

function progressLabel(type: string): string {
  return type
    .split(/[._-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function collectDebugPaths(events: PawLaunchProgressEvent[]): DebugPath[] {
  const fields: Array<{ key: string; label: string }> = [
    { key: "workspacePath", label: "SDK workspace" },
    { key: "sdkStateRoot", label: "SDK state root" },
    { key: "stateRoot", label: "SDK state root" },
    { key: "sessionStateRoot", label: "Session state root" },
    { key: "contextFilePath", label: "Generated context" },
    { key: "contextPackagePath", label: "Context package" },
  ];
  const paths: DebugPath[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    for (const event of events) {
      const path = stringField(event.data?.[field.key]);
      if (!path) {
        continue;
      }
      const dedupeKey = `${field.label}\0${path}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        paths.push({ label: field.label, path });
      }
    }
  }
  return paths;
}

function PawLaunchDebugPaths({ paths }: { paths: DebugPath[] }) {
  if (paths.length === 0) {
    return null;
  }
  return (
    <div className="sl-paw-debug-paths">
      <span className="sl-section-label">Debug session files</span>
      <dl>
        {paths.map((entry) => (
          <div key={`${entry.label}:${entry.path}`}>
            <dt>{entry.label}</dt>
            <dd>
              <code>{entry.path}</code>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function profileNameKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
  defaultPromptProfileId = null,
  promptProfiles = [],
  promptProfilesLoading = false,
  promptProfilesError = null,
  preparing,
  launching,
  error,
  handoff,
  terminalLaunchResult,
  progressEvents,
  actionDisabledReason,
  releasingLaunch = false,
  releaseError,
  releaseStatus,
  onCancel,
  onSubmit,
  onLaunchTerminal,
  onPromptProfilesChanged,
  onReleaseLaunch,
}: PawLaunchDialogProps) {
  const [workflowInstructions, setWorkflowInstructions] = useState(defaults.workflowInstructions);
  const [cliArgsText, setCliArgsText] = useState(defaults.cliArgsText);
  const [cwd, setCwd] = useState(defaults.cwd);
  const [terminal, setTerminal] = useState(defaults.terminal);
  const [terminalTitle, setTerminalTitle] = useState(defaults.terminal.title || nodeTitle);
  const [terminalColor, setTerminalColor] = useState(defaults.terminal.tabColor ?? "");
  const [terminalTitleEdited, setTerminalTitleEdited] = useState(false);
  const [terminalColorEdited, setTerminalColorEdited] = useState(false);
  const [launchAfterInit, setLaunchAfterInit] = useState(false);
  const [profiles, setProfiles] = useState<PawPromptProfile[]>(() =>
    mergePromptProfiles([], promptProfiles)
  );
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
  const [kickoffPromptText, setKickoffPromptText] = useState("");
  const defaultProfileAppliedRef = useRef(false);
  const profileSelectionTouchedRef = useRef(false);
  const terminalLaunchClaimDisplay = terminalLaunchResult
    ? humanizeLaunchClaim(terminalLaunchResult.launchClaim)
    : null;
  const trimmedInstructions = workflowInstructions.trim();
  const instructionError = trimmedInstructions.length === 0
    ? "Launch instructions are required so paw-init can derive the workflow setup and worker prompt."
    : null;
  const trimmedKickoffPrompt = kickoffPromptText.trim();
  const kickoffPromptError = handoff && trimmedKickoffPrompt.length === 0
    ? "Kickoff prompt is required before launching the terminal."
    : null;
  const trimmedTerminalTitle = terminalTitle.trim();
  const terminalTitleError = handoff && trimmedTerminalTitle.length === 0
    ? "Terminal tab title is required before launching the terminal."
    : null;
  const terminalColorValue = terminalColor.trim();
  const terminalTabColor = terminalColorValue.length > 0 ? terminalColorValue : null;
  const latestProgress = progressEvents.at(-1) ?? null;
  const recentProgress = progressEvents.slice(-8);
  const debugPaths = collectDebugPaths(progressEvents);

  useEffect(() => {
    setProfiles((current) => mergePromptProfiles(current, promptProfiles));
  }, [promptProfiles]);

  useEffect(() => {
    if (
      defaultProfileAppliedRef.current ||
      profileSelectionTouchedRef.current ||
      !defaultPromptProfileId
    ) {
      return;
    }
    const defaultProfile = profiles.find((profile) => profile.id === defaultPromptProfileId);
    if (!defaultProfile) {
      return;
    }
    defaultProfileAppliedRef.current = true;
    setSelectedProfileId(defaultProfile.id);
    setProfileName(defaultProfile.name);
    setWorkflowInstructions(defaultProfile.instructions);
  }, [defaultPromptProfileId, profiles]);

  useEffect(() => {
    if (!handoff) {
      setKickoffPromptText("");
      setWorkflowContext(null);
      setWorkflowContextText("");
      setWorkflowContextError(null);
      setWorkflowContextStatus(null);
      return;
    }
    setKickoffPromptText(handoff.kickoffPrompt);
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

  useEffect(() => {
    if (!handoff) {
      return;
    }
    if (!terminalTitleEdited) {
      setTerminalTitle(handoff.terminal.title ?? handoff.launchMetadata.workTitle);
    }
    if (!terminalColorEdited) {
      setTerminalColor(handoff.terminal.tabColor ?? "");
    }
  }, [handoff, terminalColorEdited, terminalTitleEdited]);

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
    profileSelectionTouchedRef.current = true;
    setSelectedProfileId(profileId);
    setProfileStatus(null);
    setProfileError(null);
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (profile) {
      setWorkflowInstructions(profile.instructions);
      setProfileName(profile.name);
    }
  };

  const handleProfileNameChange = (value: string) => {
    profileSelectionTouchedRef.current = true;
    setProfileName(value);
  };

  const handleWorkflowInstructionsChange = (value: string) => {
    profileSelectionTouchedRef.current = true;
    setWorkflowInstructions(value);
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
      onPromptProfilesChanged?.([saved]);
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
    if (preparing || launching || instructionError || actionDisabledReason) {
      return;
    }
    onSubmit({
      cwd,
      workflowInstructions: trimmedInstructions,
      cliArgs: parseCliArgs(cliArgsText),
      terminal: {
        ...terminal,
        title: trimmedTerminalTitle,
        tabColor: terminalTabColor,
      },
      launchAfterInit,
    });
  };

  const handleTerminalTitleChange = (value: string) => {
    setTerminalTitle(value);
    setTerminalTitleEdited(true);
  };

  const handleTerminalColorChange = (value: string) => {
    setTerminalColor(value);
    setTerminalColorEdited(true);
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
            <h2 className="sl-sheet-title">Launch PAW session</h2>
            <p className="sl-paw-launch-subtitle">
              Selected node: <strong>{nodeTitle}</strong>. Streamliner runs one
              fully capable SDK session to assemble launch context, run the PAW
              init skill, install that context into the PAW work directory, and
              then starts a visible Copilot CLI worker terminal.
            </p>
            {defaults.githubIssueLabel && (
              <p className="sl-paw-launch-tracker">
                GitHub Issue:{" "}
                {defaults.githubIssueUrl ? (
                  <a
                    href={defaults.githubIssueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sl-inline-link"
                  >
                    {defaults.githubIssueLabel}
                  </a>
                ) : (
                  <span>{defaults.githubIssueLabel}</span>
                )}
              </p>
            )}
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
              {!error && <PawLaunchDebugPaths paths={debugPaths} />}
            </section>
          )}

          {error && (
            <section className="sl-paw-launch-failure" aria-live="polite">
              <div className="sl-action-error">{error}</div>
              <PawLaunchDebugPaths paths={debugPaths} />
            </section>
          )}

          {(actionDisabledReason || releaseError || releaseStatus) && !terminalLaunchResult && (
            <div className="sl-action-warning" aria-live="polite">
              {actionDisabledReason && <p>{actionDisabledReason}</p>}
              {releaseError && <p className="sl-action-error">{releaseError}</p>}
              {releaseStatus && <p className="sl-inline-status">{releaseStatus}</p>}
              {actionDisabledReason && onReleaseLaunch && (
                <button
                  type="button"
                  className="sl-action-btn"
                  disabled={releasingLaunch || preparing || launching}
                  onClick={onReleaseLaunch}
                >
                  {releasingLaunch ? "Releasing launch..." : "Release stuck launch"}
                </button>
              )}
            </div>
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
                  {promptProfilesLoading && profiles.length === 0 && (
                    <option value="" disabled>
                      Loading saved profiles...
                    </option>
                  )}
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
                onChange={handleProfileNameChange}
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
            {(promptProfilesLoading || profileStatus || profileError || promptProfilesError) && (
              <p className={profileError || promptProfilesError ? "sl-action-error" : "sl-inline-status"}>
                {profileError ?? promptProfilesError ?? profileStatus ?? "Loading saved profiles..."}
              </p>
            )}
            <TextAreaField
              label="Launch instructions"
              ariaLabel="Launch instructions"
              value={workflowInstructions}
              onChange={handleWorkflowInstructionsChange}
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
                <p>These values are used when Streamliner starts the visible Copilot CLI worker terminal.</p>
              </div>
            </div>
            <div className="sl-paw-launch-grid">
              <label className="sl-field sl-paw-cwd-field">
                <span>Working directory</span>
                <input
                  type="text"
                  value={cwd}
                  aria-label="Working directory"
                  placeholder={defaults.inferredCwd || "Resolve from selected repo config"}
                  onChange={(event) => setCwd(event.target.value)}
                />
                <p className="sl-field-note">
                  Leave blank to resolve from the selected node's repo config. Changes are saved for{" "}
                  {defaults.cwdPreferenceKey ?? "this repo"}.
                </p>
              </label>
              <TextField
                label="Terminal tab title"
                ariaLabel="Terminal tab title"
                value={terminalTitle}
                onChange={handleTerminalTitleChange}
                placeholder="Name the launched session"
              />
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
              <div className="sl-field sl-paw-launch-color-field">
                <span>Terminal tab color</span>
                <TerminalColorQuickPicker
                  value={terminalColor}
                  onChange={handleTerminalColorChange}
                />
                <p className="sl-field-note">
                  {terminalTabColor ? `Selected ${terminalTabColor}` : "Default terminal color"}
                </p>
              </div>
            </div>
            <label className="sl-checkbox-row sl-paw-launch-after-init">
              <input
                type="checkbox"
                checked={launchAfterInit}
                disabled={preparing || Boolean(handoff)}
                aria-label="Launch after init"
                onChange={(event) => setLaunchAfterInit(event.target.checked)}
              />
              <span>
                <strong>Launch after init</strong>
                <small>
                  Start the terminal immediately when PAW init finishes instead of stopping for prompt and WorkflowContext review.
                </small>
              </span>
            </label>
            {terminalTitleError && (
              <div className="sl-action-error">{terminalTitleError}</div>
            )}
          </section>

          <section className="sl-paw-launch-summary">
            <div>
              <span className="sl-section-label">Graph source</span>
              <p>{defaults.graphPath}</p>
            </div>
            {defaults.githubIssueLabel && (
              <div>
                <span className="sl-section-label">GitHub Issue</span>
                <p>
                  {defaults.githubIssueUrl ? (
                    <a
                      href={defaults.githubIssueUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sl-inline-link"
                    >
                      {defaults.githubIssueLabel}
                    </a>
                  ) : (
                    defaults.githubIssueLabel
                  )}
                </p>
              </div>
            )}
            <div>
              <span className="sl-section-label">Working directory</span>
              <p>{cwd.trim() || defaults.inferredCwd || "Backend resolves selected repo"}</p>
            </div>
            <div>
              <span className="sl-section-label">Terminal</span>
              <p>{defaults.terminalPreference} ({terminal.preferredTerminal})</p>
            </div>
            <div>
              <span className="sl-section-label">Session display</span>
              <p>{trimmedTerminalTitle || "Untitled"}{terminalTabColor ? ` · ${terminalTabColor}` : ""}</p>
            </div>
            <div>
              <span className="sl-section-label">Launch mode</span>
              <p>{launchAfterInit ? "Launch terminal after PAW init" : "Review before terminal launch"}</p>
            </div>
          </section>

          {instructionError && (
            <div className="sl-action-error">{instructionError}</div>
          )}

          {handoff && (
            <section className="sl-paw-launch-result">
              <span className="sl-section-label">Prepared handoff</span>
              <dl>
                <div>
                  <dt>CWD</dt>
                  <dd>{handoff.cwd}</dd>
                </div>
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
                <div>
                  <dt>Terminal title</dt>
                  <dd>{trimmedTerminalTitle}</dd>
                </div>
                <div>
                  <dt>Terminal color</dt>
                  <dd>{terminalTabColor ?? "(default)"}</dd>
                </div>
              </dl>
              <div className="sl-paw-workflow-context-editor">
                <div className="sl-paw-config-section-head">
                  <div>
                    <span className="sl-section-label">Review kickoff prompt</span>
                    <p>
                      This is the prompt Streamliner will send to the visible
                      Copilot CLI worker. Edit it here before launching the
                      terminal.
                    </p>
                  </div>
                </div>
                <textarea
                  value={kickoffPromptText}
                  aria-label="Kickoff prompt"
                  rows={14}
                  spellCheck={false}
                  disabled={Boolean(terminalLaunchResult)}
                  onChange={(event) => setKickoffPromptText(event.target.value)}
                />
                {kickoffPromptError && (
                  <p className="sl-action-error">{kickoffPromptError}</p>
                )}
              </div>
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
              {terminalLaunchResult && (
                <div className="sl-paw-launch-summary">
                  <div>
                    <span className="sl-section-label">Terminal launch</span>
                    <p>
                      Started with {terminalLaunchResult.terminal.method}
                      {terminalLaunchResult.terminal.pid ? ` (PID ${terminalLaunchResult.terminal.pid})` : ""}.
                    </p>
                  </div>
                  <div>
                    <span className="sl-section-label">Launch claim</span>
                    <p>{terminalLaunchClaimDisplay?.label}</p>
                    {terminalLaunchClaimDisplay?.detail && (
                      <p className="sl-field-note">{terminalLaunchClaimDisplay.detail}</p>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="sl-sheet-foot sl-paw-launch-actions">
          <button type="button" className="sl-action-btn" onClick={onCancel} disabled={releasingLaunch}>
            {preparing || launching || handoff || terminalLaunchResult ? "Close" : "Cancel"}
          </button>
          {handoff ? (
            <button
              type="button"
              className="sl-action-btn primary"
              disabled={
                launching ||
                workflowContextSaving ||
                Boolean(kickoffPromptError) ||
                Boolean(terminalTitleError) ||
                Boolean(terminalLaunchResult?.launchClaim.blocksLaunch) ||
                Boolean(actionDisabledReason) ||
                releasingLaunch
              }
              onClick={() =>
                onLaunchTerminal({
                  kickoffPrompt: trimmedKickoffPrompt,
                  terminalTitle: trimmedTerminalTitle,
                  terminalColor: terminalTabColor,
                })
              }
            >
              {launching ? "Launching terminal..." : terminalLaunchResult ? "Terminal launched" : "Launch terminal"}
            </button>
          ) : (
            <button
              type="submit"
              className="sl-action-btn primary"
              disabled={preparing || releasingLaunch || Boolean(instructionError) || Boolean(actionDisabledReason)}
            >
              {preparing
                ? "Running PAW init..."
                : launchAfterInit
                  ? "Run PAW init and launch"
                  : "Run PAW init"}
            </button>
          )}
        </div>
      </form>
    </>
  );
}
