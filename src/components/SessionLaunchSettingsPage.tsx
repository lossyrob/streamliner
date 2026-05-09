import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import {
  formatSessionLaunchCliArgsText,
  parseSessionLaunchCliArgsText,
  saveSessionLaunchSettings,
  type SessionLaunchSettings,
} from "./session-launch-settings";

interface SessionLaunchSettingsPageProps {
  settings: SessionLaunchSettings | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void> | void;
  onSettingsChanged: (settings: SessionLaunchSettings) => void;
}

export function SessionLaunchSettingsPage({
  settings,
  loading,
  error,
  onRefresh,
  onSettingsChanged,
}: SessionLaunchSettingsPageProps) {
  const [cliArgsText, setCliArgsText] = useState(() =>
    settings ? formatSessionLaunchCliArgsText(settings.defaultCliArgs) : ""
  );
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void onRefresh();
  }, [onRefresh]);

  useEffect(() => {
    if (!busy && !dirty && settings) {
      setCliArgsText(formatSessionLaunchCliArgsText(settings.defaultCliArgs));
    }
  }, [busy, dirty, settings]);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setActionError(null);
    try {
      const defaultCliArgs = parseSessionLaunchCliArgsText(cliArgsText);
      const saved = await saveSessionLaunchSettings({ defaultCliArgs });
      setCliArgsText(formatSessionLaunchCliArgsText(saved.defaultCliArgs));
      setDirty(false);
      onSettingsChanged(saved);
      setStatus(
        saved.defaultCliArgs.length === 0
          ? "Saved empty defaults. Future default-based relaunches will not add --yolo."
          : "Saved default Copilot CLI launch args.",
      );
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const resetToYolo = () => {
    setCliArgsText("--yolo");
    setDirty(true);
    setStatus("Click Save defaults to persist --yolo.");
    setActionError(null);
  };

  const clearDefaults = () => {
    setCliArgsText("");
    setDirty(true);
    setStatus("Empty defaults are saved only after you click Save defaults.");
    setActionError(null);
  };

  return (
    <div className="sl-profiles-page">
      <header className="sl-profiles-header">
        <div>
          <span className="sl-eyebrow">Session launch</span>
          <p className="sl-summary">
            Configure default Copilot CLI option tokens for Streamliner terminal launches and relaunches.
          </p>
        </div>
        <button className="sl-action-btn" type="button" onClick={() => void onRefresh()} disabled={loading || busy}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {(error || actionError || status) && (
        <div className={error || actionError ? "sl-action-error" : "sl-inline-status"} aria-live="polite">
          {actionError ?? error ?? status}
        </div>
      )}

      <form className="sl-profile-editor" onSubmit={handleSave} aria-label="Session launch settings editor">
        <div className="sl-profile-editor-head">
          <div>
            <span className="sl-section-label">Default Copilot CLI args</span>
            <h2>Terminal launch defaults</h2>
          </div>
          <code>
            {settings
              ? settings.defaultCliArgs.length === 0 ? "empty" : settings.defaultCliArgs.join(" ")
              : "not loaded"}
          </code>
        </div>

        <label className="sl-field">
          <span>One option token per line</span>
          <textarea
            aria-label="Default Copilot CLI args"
            value={cliArgsText}
            onChange={(event) => {
              setCliArgsText(event.target.value);
              setDirty(true);
              setStatus(null);
              setActionError(null);
            }}
            placeholder={"--yolo\n--model=gpt-5.5"}
            rows={8}
            disabled={busy}
          />
        </label>

        <p className="sl-summary">
          Streamliner appends its own <code>--resume=&lt;session&gt;</code> argument during relaunch.
          Use <code>--flag=value</code> for values; kickoff prompts belong in launch instructions, not defaults.
        </p>

        <div className="sl-profile-editor-actions">
          <button className="sl-action-btn primary" type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save defaults"}
          </button>
          <button className="sl-action-btn" type="button" onClick={resetToYolo} disabled={busy}>
            Use --yolo
          </button>
          <button className="sl-action-btn" type="button" onClick={clearDefaults} disabled={busy}>
            Clear defaults
          </button>
        </div>
      </form>
    </div>
  );
}
