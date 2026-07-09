import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  deleteReviewPromptTemplate,
  saveReviewPromptTemplate,
  type PawReviewPromptTemplate,
} from "./paw-review-prompt-templates";

interface PawReviewTemplatesPageProps {
  templates: PawReviewPromptTemplate[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void> | void;
  onTemplatesChanged: (templates: PawReviewPromptTemplate[]) => void;
  onTemplateDeleted: (id: string) => void;
}

function templateNameKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueCopyName(templates: PawReviewPromptTemplate[], name: string): string {
  const used = new Set(templates.map((template) => templateNameKey(template.name)));
  const base = `${name} copy`;
  if (!used.has(templateNameKey(base))) {
    return base;
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!used.has(templateNameKey(candidate))) {
      return candidate;
    }
  }
  return `${base} ${Date.now()}`;
}

async function copyPrompt(template: PawReviewPromptTemplate): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }
  await navigator.clipboard.writeText(template.prompt);
}

export function PawReviewTemplatesPage({
  templates,
  loading,
  error,
  onRefresh,
  onTemplatesChanged,
  onTemplateDeleted,
}: PawReviewTemplatesPageProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    void onRefresh();
  }, [onRefresh]);

  useEffect(() => {
    if (!selectedTemplateId) {
      return;
    }
    if (!templates.some((candidate) => candidate.id === selectedTemplateId)) {
      setSelectedTemplateId("");
      setName("");
      setPrompt("");
    }
  }, [selectedTemplateId, templates]);

  const selectTemplate = (template: PawReviewPromptTemplate) => {
    setSelectedTemplateId(template.id);
    setName(template.name);
    setPrompt(template.prompt);
    setStatus(null);
    setActionError(null);
  };

  const startNewTemplate = () => {
    setSelectedTemplateId("");
    setName("");
    setPrompt("");
    setStatus(null);
    setActionError(null);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setActionError(null);
    try {
      const saved = await saveReviewPromptTemplate({
        id: selectedTemplate?.id,
        name: name.trim(),
        prompt: prompt.trim(),
      });
      onTemplatesChanged([saved]);
      setSelectedTemplateId(saved.id);
      setName(saved.name);
      setPrompt(saved.prompt);
      setStatus(`${selectedTemplate ? "Updated" : "Created"} "${saved.name}".`);
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = async () => {
    if (!selectedTemplate) {
      return;
    }
    setBusy(true);
    setStatus(null);
    setActionError(null);
    try {
      const saved = await saveReviewPromptTemplate({
        name: uniqueCopyName(templates, selectedTemplate.name),
        prompt: selectedTemplate.prompt,
      });
      onTemplatesChanged([saved]);
      setSelectedTemplateId(saved.id);
      setName(saved.name);
      setPrompt(saved.prompt);
      setStatus(`Duplicated "${selectedTemplate.name}" as "${saved.name}".`);
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!selectedTemplate) {
      return;
    }
    setStatus(null);
    setActionError(null);
    try {
      await copyPrompt(selectedTemplate);
      setStatus(`Copied "${selectedTemplate.name}" prompt.`);
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const handleDelete = async () => {
    if (!selectedTemplate) {
      return;
    }
    const confirmed = window.confirm(
      `Delete "${selectedTemplate.name}"? Workstreams configured to use this review template will fall back to custom PAW Review prompts.`,
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setStatus(null);
    setActionError(null);
    try {
      await deleteReviewPromptTemplate(selectedTemplate.id);
      onTemplateDeleted(selectedTemplate.id);
      setSelectedTemplateId("");
      setName("");
      setPrompt("");
      setStatus(`Deleted "${selectedTemplate.name}".`);
    } catch (nextError: unknown) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const canSave = !busy && name.trim().length > 0 && prompt.trim().length > 0;

  return (
    <div className="sl-profiles-page">
      <header className="sl-profiles-header">
        <div>
          <span className="sl-eyebrow">PAW Review templates</span>
          <p className="sl-summary">
            Manage reusable PAW Review companion prompts without opening a launch dialog.
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
              <span className="sl-section-label">Saved review templates</span>
              <p>{templates.length === 1 ? "1 template" : `${templates.length} templates`}</p>
            </div>
            <button className="sl-action-btn" type="button" onClick={startNewTemplate} disabled={busy}>
              New template
            </button>
          </div>
          {loading && templates.length === 0 ? (
            <div className="sl-empty-state">Loading saved PAW Review templates...</div>
          ) : templates.length === 0 ? (
            <div className="sl-empty-state">
              No PAW Review templates yet. Create one to reuse companion review prompts across workstreams.
            </div>
          ) : (
            <div className="sl-profile-list">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`sl-profile-list-item${template.id === selectedTemplateId ? " selected" : ""}`}
                  onClick={() => selectTemplate(template)}
                  disabled={busy}
                  aria-label={`Select review template ${template.name}`}
                >
                  <span className="sl-profile-list-title">{template.name}</span>
                  <code>{template.id}</code>
                </button>
              ))}
            </div>
          )}
        </aside>

        <form className="sl-profile-editor" onSubmit={handleSave} aria-label="PAW Review template editor">
          <div className="sl-profile-editor-head">
            <div>
              <span className="sl-section-label">
                {selectedTemplate ? "Edit review template" : "Create review template"}
              </span>
              <h2>{selectedTemplate?.name ?? "New review template"}</h2>
            </div>
            {selectedTemplate && <code>{selectedTemplate.id}</code>}
          </div>

          <label className="sl-field">
            <span>Template name</span>
            <input
              aria-label="Review template name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Heavy PAW Review"
              disabled={busy}
            />
          </label>

          <label className="sl-field">
            <span>Review prompt template</span>
            <textarea
              aria-label="Review template prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Review issue {{githubRepo}}#{{githubIssue}}..."
              rows={16}
              disabled={busy}
            />
          </label>

          <div className="sl-profile-editor-actions">
            <button className="sl-action-btn primary" type="submit" disabled={!canSave}>
              {selectedTemplate ? "Save changes" : "Create template"}
            </button>
            <button className="sl-action-btn" type="button" onClick={handleDuplicate} disabled={busy || !selectedTemplate}>
              Duplicate template
            </button>
            <button className="sl-action-btn" type="button" onClick={handleCopy} disabled={busy || !selectedTemplate}>
              Copy prompt
            </button>
            <button className="sl-action-btn danger" type="button" onClick={handleDelete} disabled={busy || !selectedTemplate}>
              Delete template
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
