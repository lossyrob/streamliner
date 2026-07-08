import type { WorkstreamDocument, WorkstreamNode } from "./workstream-schema";

export const WORKSTREAM_TERMINAL_TITLE_TEMPLATE_HELP =
  "{githubIssue} = GitHub issue as #number; {nodeId} = graph node id; {nodeTitle} = graph node title; {workstreamShortName} = workstream short name or title.";

export function renderWorkstreamTerminalTitleTemplate(
  template: string | null | undefined,
  node: WorkstreamNode,
  workstream?: Pick<WorkstreamDocument, "title" | "presentation">,
): string | null {
  const trimmedTemplate = template?.trim();
  if (!trimmedTemplate) {
    return null;
  }

  const values: Record<string, string> = {
    githubIssue: node.tracker?.type === "github" ? `#${node.tracker.number}` : "",
    nodeId: node.id,
    nodeTitle: node.title,
    workstreamShortName: (workstream?.presentation?.shortName?.trim() || workstream?.title) ?? "",
  };
  const rendered = trimmedTemplate.replace(
    /\{(githubIssue|nodeId|nodeTitle|workstreamShortName)\}/g,
    (_match, key: string) => values[key] ?? "",
  ).trim();
  return rendered.length > 0 ? rendered : null;
}
