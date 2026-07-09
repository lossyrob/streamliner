import type { MouseEvent } from "react";

export type DashboardRoute =
  | { view: "landing"; message?: string }
  | { view: "workstreams"; message?: string }
  | { view: "settings"; section?: "profiles" | "review-templates" | "session-launch" }
  | { view: "prototype"; prototype: "managed-consoles" }
  | {
      view: "sessions";
      workstreamId?: string | null;
      nodeId?: string | null;
      tab?: "list" | "consoles" | null;
    }
  | {
      view: "workstream";
      projectKey: string;
      workstreamId: string;
      nodeId?: string | null;
    };

export function encodeRouteSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export function workstreamRoutePath(entry: {
  projectKey: string;
  workstreamId: string;
  nodeId?: string | null;
}): string {
  const base = `/workstreams/${encodeRouteSegment(entry.projectKey)}/${encodeRouteSegment(entry.workstreamId)}`;
  return entry.nodeId
    ? `${base}/nodes/${encodeRouteSegment(entry.nodeId)}`
    : base;
}

function sessionsRoutePath(route: Extract<DashboardRoute, { view: "sessions" }>): string {
  const search = new URLSearchParams();
  if (route.workstreamId) {
    search.set("workstreamId", route.workstreamId);
  }
  if (route.nodeId) {
    search.set("nodeId", route.nodeId);
  }
  if (route.tab === "consoles") {
    search.set("tab", "consoles");
  }
  const suffix = search.toString();
  return suffix.length > 0 ? `/sessions?${suffix}` : "/sessions";
}

export function routePath(route: DashboardRoute): string {
  switch (route.view) {
    case "sessions":
      return sessionsRoutePath(route);
    case "settings":
      return route.section === "profiles"
        ? "/settings/profiles"
        : route.section === "review-templates"
          ? "/settings/review-templates"
          : "/settings/session-launch";
    case "prototype":
      return "/__prototype/managed-consoles";
    case "workstream":
      return workstreamRoutePath(route);
    case "workstreams":
      return "/workstreams";
    case "landing":
      return "/";
  }
}

function shouldHandleInAppLinkClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

export function handleInAppLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  action: () => void | Promise<void>,
): void {
  if (!shouldHandleInAppLinkClick(event)) {
    return;
  }
  event.preventDefault();
  void action();
}
