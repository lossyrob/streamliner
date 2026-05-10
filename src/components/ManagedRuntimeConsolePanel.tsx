import type { ReactNode } from "react";

import {
  formatManagedRuntimeLabel,
  resolveManagedRuntimeActions,
  type ManagedRuntimeProjection,
} from "../managed-runtime-contract";
import { ManagedRuntimeActionButton } from "./ManagedRuntimeActionButton";
import { ManagedSessionConsole } from "./ManagedSessionConsole";
import {
  isManagedRuntimeConsoleLive,
  managedRuntimeConsoleEvents,
  managedRuntimeStateTone,
} from "./ManagedSessionConsoleEvents";

interface ManagedRuntimeConsolePanelProps {
  runtime: ManagedRuntimeProjection;
  sessionId?: string | null;
  title: string;
  subtitle?: string;
  showCurrentMessage?: boolean;
  compact?: boolean;
  eventLimit?: number;
  extraFooter?: ReactNode;
  onActionComplete?: () => void | Promise<void>;
}

export function ManagedRuntimeConsolePanel({
  runtime,
  sessionId = null,
  title,
  subtitle,
  showCurrentMessage = true,
  compact = false,
  eventLimit,
  extraFooter,
  onActionComplete,
}: ManagedRuntimeConsolePanelProps) {
  return (
    <ManagedSessionConsole
      title={title}
      subtitle={subtitle}
      stateLabel={formatManagedRuntimeLabel(runtime.lifecycleState)}
      stateTone={managedRuntimeStateTone(runtime)}
      currentMessage={managedRuntimeSummaryText(runtime)}
      showCurrentMessage={showCurrentMessage}
      events={managedRuntimeConsoleEvents(runtime, eventLimit)}
      emptyMessage="No retained managed runtime activity yet."
      waitingReason={runtime.waitingReason}
      prReady={runtime.prReady}
      replay={runtime.replay}
      live={isManagedRuntimeConsoleLive(runtime)}
      compact={compact}
      footer={
        <div className="sl-session-managed-actions">
          <ManagedRuntimeConsoleActions
            runtime={runtime}
            sessionId={sessionId}
            onActionComplete={onActionComplete}
          />
          {extraFooter}
        </div>
      }
    />
  );
}

export function ManagedRuntimeConsoleActions({
  runtime,
  sessionId,
  onActionComplete,
}: {
  runtime: ManagedRuntimeProjection;
  sessionId?: string | null;
  onActionComplete?: () => void | Promise<void>;
}) {
  const actions = resolveManagedRuntimeActions(runtime).map((action) =>
    sessionId
      ? action
      : {
          ...action,
          available: false,
          reason: "Managed runtime actions require a tracked session row.",
        }
  );
  return (
    <>
      {actions.map((action) => (
        <ManagedRuntimeActionButton
          key={action.action}
          sessionId={sessionId ?? "__missing-session__"}
          action={action}
          onComplete={onActionComplete}
        />
      ))}
    </>
  );
}

function managedRuntimeSummaryText(runtime: ManagedRuntimeProjection): string {
  return runtime.summary ??
    runtime.blockerSummary ??
    runtime.errorSummary ??
    `Background session is ${formatManagedRuntimeLabel(runtime.lifecycleState)}.`;
}
