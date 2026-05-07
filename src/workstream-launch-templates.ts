import type { WorkstreamNode } from "./workstream-schema";
import { issueLabel } from "./workstream-links";

export const WORKSTREAM_TERMINAL_TITLE_TEMPLATE_HELP =
  "{githubIssue} = GitHub issue as owner/repo#number; {nodeId} = graph node id; {nodeTitle} = graph node title.";

export function renderWorkstreamTerminalTitleTemplate(
  template: string | null | undefined,
  node: WorkstreamNode,
): string | null {
  const trimmedTemplate = template?.trim();
  if (!trimmedTemplate) {
    return null;
  }

  const values: Record<string, string> = {
    githubIssue: node.tracker?.type === "github" ? issueLabel(node.tracker) ?? "" : "",
    nodeId: node.id,
    nodeTitle: node.title,
  };
  const rendered = trimmedTemplate.replace(
    /\{(githubIssue|nodeId|nodeTitle)\}/g,
    (_match, key: string) => values[key] ?? "",
  ).trim();
  return rendered.length > 0 ? rendered : null;
}
