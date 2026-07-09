import { useEffect } from "react";

import type { ManagedRuntimeProjection } from "../managed-runtime-contract";
import { ManagedRuntimeConsolePanel } from "./ManagedRuntimeConsolePanel";

interface ManagedRuntimeConsoleOverlayProps {
  title: string;
  subtitle?: string;
  runtime: ManagedRuntimeProjection;
  sessionId?: string | null;
  onClose: () => void;
  onOpenInSessions?: () => void | Promise<void>;
  onActionComplete?: () => void | Promise<void>;
}

export function ManagedRuntimeConsoleOverlay({
  title,
  subtitle,
  runtime,
  sessionId = null,
  onClose,
  onOpenInSessions,
  onActionComplete,
}: ManagedRuntimeConsoleOverlayProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="sl-managed-console-overlay-backdrop" onClick={onClose} />
      <aside className="sl-managed-console-overlay" aria-label="Managed runtime console">
        <div className="sl-managed-console-overlay-head">
          <div>
            <span className="sl-eyebrow">Managed runtime console</span>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="sl-managed-console-overlay-actions">
            {onOpenInSessions && (
              <button className="sl-action-btn" type="button" onClick={() => void onOpenInSessions()}>
                Open in Sessions
              </button>
            )}
            <button className="sl-sheet-close" type="button" aria-label="Close console" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <ManagedRuntimeConsolePanel
          runtime={runtime}
          sessionId={sessionId}
          title="Runtime transcript"
          subtitle="Sanitized Streamliner activity."
          showCurrentMessage={false}
          eventLimit={50}
          onActionComplete={onActionComplete}
        />
      </aside>
    </>
  );
}
