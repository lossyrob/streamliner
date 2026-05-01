import type { WorkstreamDocument } from "./workstream-schema";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface WorkstreamGraphSummary {
  projectKey: string;
  workstreamId: string;
  title: string;
  summary: string;
}

export function validateWorkstreamRouteSegment(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new Error(`Expected ${label} to be a kebab-case id.`);
  }
}

export function deriveWorkstreamProjectKey(workstream: WorkstreamDocument): string {
  if (workstream.projectKey) {
    return workstream.projectKey;
  }
  if (workstream.repos.length === 1) {
    return workstream.repos[0].id;
  }
  const primaryRepos = workstream.repos.filter((repo) => repo.role === "primary");
  if (primaryRepos.length === 1) {
    return primaryRepos[0].id;
  }
  return workstream.id;
}

export function summarizeWorkstreamDocument(
  workstream: WorkstreamDocument,
): WorkstreamGraphSummary {
  const projectKey = deriveWorkstreamProjectKey(workstream);
  validateWorkstreamRouteSegment(projectKey, "workstream projectKey");
  validateWorkstreamRouteSegment(workstream.id, "workstream id");
  return {
    projectKey,
    workstreamId: workstream.id,
    title: workstream.title,
    summary: workstream.summary,
  };
}
