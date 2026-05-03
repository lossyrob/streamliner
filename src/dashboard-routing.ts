import type { MouseEvent } from "react";

export type DashboardRoute =
  | { view: "landing"; message?: string }
  | { view: "workstreams"; message?: string }
  | { view: "sessions" }
  | { view: "workstream"; projectKey: string; workstreamId: string };

export function encodeRouteSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export function workstreamRoutePath(entry: {
  projectKey: string;
  workstreamId: string;
}): string {
  return `/workstreams/${encodeRouteSegment(entry.projectKey)}/${encodeRouteSegment(entry.workstreamId)}`;
}

export function routePath(route: DashboardRoute): string {
  switch (route.view) {
    case "sessions":
      return "/sessions";
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
