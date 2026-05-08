import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  deletePromptProfile,
  savePromptProfile,
  type PawPromptProfile,
} from "./paw-prompt-profiles";

interface PawProfilesPageProps {
  profiles: PawPromptProfile[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void> | void;
  onProfilesChanged: (profiles: PawPromptProfile[]) => void;
  onProfileDeleted: (id: string) => void;
}

function profileNameKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueCopyName(profiles: PawPromptProfile[], name: string): string {
  const used = new Set(profiles.map((profile) => profileNameKey(profile.name)));
  const base = `${name} copy`;
  if (!used.has(profileNameKey(base))) {
    return base;
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!used.has(profileNameKey(candidate))) {
      return candidate;
    }
  }
  return `${base} ${Date.now()}`;
}

async function copyInstructions(profile: PawPromptProfile): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }
  await navigator.clipboard.writeText(profile.instructions);
}

export function PawProfilesPage({
  profiles,
  loading,
  error,
  onRefresh,
  onProfilesChanged,
  onProfileDeleted,
}: PawProfilesPageProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  useEffect(() => {
    void onRefresh();
  }, [onRefresh]);

  useEffect(() => {
    if (!selectedProfileId) {
      return;
    }
    const profile = profiles.find((candidate) => candidate.id === selectedProfileId);
    if (!profile) {
      setSelectedProfileId("");
      setName("");
      setInstructions("");
      return;
    }
    setName(profile.name);
    setInstructions(profile.instructions);
  }, [profiles, selectedProfileId]);

  const selectProfile = (profile: PawPromptProfile) => {
    setSelectedProfileId(profile.id);
    setName(profile.name);
    setInstructions(profile.instructions);
    setStatus(null);
    setActionError(null);
  };

  const startNewProfile = () => {
    setSelectedProfileId("");
    setName("");
    setInstructions("");
    setStatus(null);
    setActionError(null);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setActionError(null);
    try {
      const saved = await savePromptProfile({
        id: selectedProfile?.id,
        name: name.trim(),
        instructions: instructions.trim(),
      });
      onProfilesChanged([saved]);
      setSelectedProfileId(saved.id);
      setName(saved.name);
      setInstructions(saved.instructions);
      setStatus(`${selectedProfile ? "Updated" : "Created"} "${saved.name}".`);
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = async () => {
    if (!selectedProfile) {
      return;
    }
    setBusy(true);
    setStatus(null);
    setActionError(null);
    try {
      const saved = await savePromptProfile({
        name: uniqueCopyName(profiles, selectedProfile.name),
        instructions: selectedProfile.instructions,
      });
      onProfilesChanged([saved]);
      setSelectedProfileId(saved.id);
      setName(saved.name);
      setInstructions(saved.instructions);
      setStatus(`Duplicated "${selectedProfile.name}" as "${saved.name}".`);
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!selectedProfile) {
      return;
    }
    setStatus(null);
    setActionError(null);
    try {
      await copyInstructions(selectedProfile);
      setStatus(`Copied "${selectedProfile.name}" instructions.`);
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const handleDelete = async () => {
    if (!selectedProfile) {
      return;
    }
    const confirmed = window.confirm(
      `Delete "${selectedProfile.name}"? Workstreams configured to use this profile will fall back to custom launch instructions.`,
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setStatus(null);
    setActionError(null);
    try {
      await deletePromptProfile(selectedProfile.id);
      onProfileDeleted(selectedProfile.id);
      setSelectedProfileId("");
      setName("");
      setInstructions("");
      setStatus(`Deleted "${selectedProfile.name}".`);
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const canSave = !busy && name.trim().length > 0 && instructions.trim().length > 0;

  return (
    <div className="sl-shell-panel">
      <div className="sl-profiles-page">
        <header className="sl-profiles-header">
          <div>
            <span className="sl-eyebrow">PAW profiles</span>
            <h1 className="sl-title">Launch prompt profiles</h1>
            <p className="sl-summary">
              Manage reusable PAW launch instruction snippets without selecting a workstream node.
            </p>
          </div>
          <button className="sl-action-btn" type="button" onClick={() => void onRefresh()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        {(error || actionError || status) && (
          <div className={error || actionError ? "sl-action-error" : "sl-inline-status"} aria-live="polite">
            {actionError ?? error ?? status}
          </div>
        )}

        <div className="sl-profile-manager">
          <aside className="sl-profile-list-panel">
            <div className="sl-profile-list-head">
              <div>
                <span className="sl-section-label">Saved profiles</span>
                <p>{profiles.length === 1 ? "1 profile" : `${profiles.length} profiles`}</p>
              </div>
              <button className="sl-action-btn" type="button" onClick={startNewProfile} disabled={busy}>
                New profile
              </button>
            </div>
            {loading && profiles.length === 0 ? (
              <div className="sl-empty-state">Loading saved PAW launch profiles...</div>
            ) : profiles.length === 0 ? (
              <div className="sl-empty-state">
                No launch prompt profiles yet. Create one to reuse PAW launch instructions across workstreams.
              </div>
            ) : (
              <div className="sl-profile-list">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className={`sl-profile-list-item${profile.id === selectedProfileId ? " selected" : ""}`}
                    onClick={() => selectProfile(profile)}
                    disabled={busy}
                    aria-label={`Select profile ${profile.name}`}
                  >
                    <span className="sl-profile-list-title">{profile.name}</span>
                    <code>{profile.id}</code>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <form className="sl-profile-editor" onSubmit={handleSave} aria-label="PAW profile editor">
            <div className="sl-profile-editor-head">
              <div>
                <span className="sl-section-label">
                  {selectedProfile ? "Edit profile" : "Create profile"}
                </span>
                <h2>{selectedProfile?.name ?? "New launch profile"}</h2>
              </div>
              {selectedProfile && <code>{selectedProfile.id}</code>}
            </div>

            <label className="sl-field">
              <span>Profile name</span>
              <input
                aria-label="Profile name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Final PR only"
                disabled={busy}
              />
            </label>

            <label className="sl-field">
              <span>Profile instructions</span>
              <textarea
                aria-label="Profile instructions"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder="Use paw-lite with final-pr-only review mode..."
                rows={16}
                disabled={busy}
              />
            </label>

            <div className="sl-profile-editor-actions">
              <button className="sl-action-btn primary" type="submit" disabled={!canSave}>
                {selectedProfile ? "Save changes" : "Create profile"}
              </button>
              <button className="sl-action-btn" type="button" onClick={handleDuplicate} disabled={busy || !selectedProfile}>
                Duplicate profile
              </button>
              <button className="sl-action-btn" type="button" onClick={handleCopy} disabled={busy || !selectedProfile}>
                Copy instructions
              </button>
              <button className="sl-action-btn danger" type="button" onClick={handleDelete} disabled={busy || !selectedProfile}>
                Delete profile
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
