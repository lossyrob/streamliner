export interface PawReviewPromptTemplate {
  id: string;
  name: string;
  prompt: string;
  updatedAt: string;
}

export function responseErrorMessage(response: Response, fallback: string): string {
  return `${fallback} (${response.status})`;
}

function templateUpdatedAtMs(template: PawReviewPromptTemplate): number {
  const parsed = Date.parse(template.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortTemplates(templates: PawReviewPromptTemplate[]): PawReviewPromptTemplate[] {
  return [...templates].sort((left, right) => left.name.localeCompare(right.name));
}

export function mergeReviewPromptTemplates(
  current: PawReviewPromptTemplate[],
  incoming: PawReviewPromptTemplate[],
): PawReviewPromptTemplate[] {
  const byId = new Map(current.map((template) => [template.id, template]));
  for (const template of incoming) {
    const existing = byId.get(template.id);
    if (!existing || templateUpdatedAtMs(template) >= templateUpdatedAtMs(existing)) {
      byId.set(template.id, template);
    }
  }
  return sortTemplates([...byId.values()]);
}

export function renderReviewPromptTemplate(
  template: string,
  values: { githubIssue: string; githubRepo: string },
): string {
  return template.replace(
    /\{\{(githubIssue|githubRepo)\}\}/g,
    (_match, key: string) => values[key as keyof typeof values],
  );
}

export async function loadReviewPromptTemplates(): Promise<PawReviewPromptTemplate[]> {
  const response = await fetch("/api/paw-review-prompt-templates", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(responseErrorMessage(response, "Could not load review prompt templates."));
  }
  const body = await response.json() as { templates?: PawReviewPromptTemplate[] };
  return Array.isArray(body.templates) ? body.templates : [];
}

export async function saveReviewPromptTemplate(input: {
  id?: string;
  name: string;
  prompt: string;
}): Promise<PawReviewPromptTemplate> {
  const response = await fetch(
    input.id
      ? `/api/paw-review-prompt-templates/${encodeURIComponent(input.id)}`
      : "/api/paw-review-prompt-templates",
    {
      method: input.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        prompt: input.prompt,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(responseErrorMessage(response, "Could not save review prompt template."));
  }
  const body = await response.json() as { template?: PawReviewPromptTemplate };
  if (!body.template) {
    throw new Error("Review prompt template response was missing the saved template.");
  }
  return body.template;
}
