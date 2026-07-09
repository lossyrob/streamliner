import { useEffect, useState } from "react";

/**
 * Returns `true` while `document.visibilityState === "visible"` and `false`
 * while the tab is hidden (backgrounded, minimised, or otherwise not the
 * foreground tab).
 *
 * Used to gate long-lived SSE `EventSource` subscriptions so a hidden tab
 * stops holding browser-side HTTP/1.1 connections. The browser caps at six
 * concurrent connections per origin; with multiple Streamliner tabs each
 * holding a session-events stream plus per-preparation streams, the cap
 * gets exhausted quickly and even a hard-refresh of a foreground tab will
 * queue indefinitely because there are no free connection slots.
 *
 * When the tab becomes hidden, effects that depend on this value should let
 * their cleanup fire (close the EventSource). When the tab becomes visible
 * again, the effect re-runs and reopens the SSE — the server replays a
 * snapshot for session events on connect, so no data is lost.
 */
export function useIsDocumentVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof document === "undefined") {
      return true;
    }
    return document.visibilityState !== "hidden";
  });

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const handleChange = () => {
      setVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", handleChange);
    return () => {
      document.removeEventListener("visibilitychange", handleChange);
    };
  }, []);

  return visible;
}
