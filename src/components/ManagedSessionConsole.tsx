import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

import {
  formatManagedRuntimeLabel,
  type ManagedRuntimePrReadyTrustContext,
  type ManagedRuntimeReplayWindow,
  type ManagedRuntimeWaitingReason,
} from "../managed-runtime-contract";
import type { ManagedSessionConsoleEvent } from "./ManagedSessionConsoleEvents";

interface ManagedSessionConsoleProps {
  title: string;
  subtitle?: string;
  stateLabel?: string;
  stateTone?: "green" | "amber" | "red" | "muted" | "accent";
  currentMessage?: string;
  showCurrentMessage?: boolean;
  events: readonly ManagedSessionConsoleEvent[];
  emptyMessage: string;
  live?: boolean;
  compact?: boolean;
  waitingReason?: ManagedRuntimeWaitingReason | null;
  prReady?: ManagedRuntimePrReadyTrustContext | null;
  replay?: ManagedRuntimeReplayWindow | null;
  footer?: ReactNode;
}

export function ManagedSessionConsole({
  title,
  subtitle,
  stateLabel,
  stateTone = "accent",
  currentMessage,
  showCurrentMessage = true,
  events,
  emptyMessage,
  live = false,
  compact = false,
  waitingReason,
  prReady,
  replay,
  footer,
}: ManagedSessionConsoleProps) {
  const latest = currentMessage ?? events.at(-1)?.summary ?? emptyMessage;
  const transcriptRef = useRef<HTMLOListElement | null>(null);
  const followScrollRef = useRef(true);
  const scrollTranscriptToBottom = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      return;
    }
    transcript.scrollTop = transcript.scrollHeight;
  }, []);
  const handleTranscriptScroll = useCallback(() => {
    const transcript = transcriptRef.current;
    if (!transcript) {
      return;
    }
    followScrollRef.current = isScrolledNearBottom(transcript);
  }, []);

  useLayoutEffect(() => {
    if (followScrollRef.current) {
      scrollTranscriptToBottom();
    }
  }, [events, emptyMessage, currentMessage, scrollTranscriptToBottom]);

  return (
    <section className={`sl-managed-console${compact ? " compact" : ""}`}>
      <div className="sl-managed-console-head">
        <div>
          <span className="sl-section-label">{title}</span>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="sl-managed-console-head-pills">
          <span className={`sl-managed-runtime-state ${stateTone}`}>
            {stateLabel ?? "read only"}
          </span>
          <span className="sl-managed-console-readonly">read-only</span>
        </div>
      </div>

      {showCurrentMessage && (
        <div className="sl-managed-console-current">
          <span className="sl-managed-console-activity-dot" aria-hidden="true">•</span>
          <em>{latest}</em>
        </div>
      )}

      <ol
        ref={transcriptRef}
        className="sl-managed-console-transcript"
        role="log"
        aria-live={live ? "polite" : "off"}
        aria-label={`${title} transcript`}
        onScroll={handleTranscriptScroll}
      >
        {events.length === 0 ? (
          <li className="empty">
            <span className="sl-managed-console-entry-mark" aria-hidden="true">•</span>
            <div className="sl-managed-console-entry-body">
              <div className="sl-managed-console-entry-head">
                <span className="sl-managed-console-phase">waiting</span>
              </div>
              <span className="sl-managed-console-summary">{emptyMessage}</span>
            </div>
          </li>
        ) : (
          events.map((event, index) => (
            <li
              className={`${event.status ?? "info"} ${event.kind ? `kind-${event.kind}` : ""}`}
              key={`${event.timestamp}-${event.phase}-${index}`}
            >
              <span
                className={consoleEventMarkClass(event)}
                aria-hidden="true"
              />
              <div className="sl-managed-console-entry-body">
                <div className="sl-managed-console-entry-head">
                  <span className="sl-managed-console-entry-title">
                    {event.summary}
                    {event.link?.url ? (
                      <>
                        {" "}
                        <a href={event.link.url} target="_blank" rel="noopener noreferrer">
                          {event.link.label}
                        </a>
                      </>
                    ) : null}
                  </span>
                  <span className="sl-managed-console-time">
                    {formatConsoleTimestamp(event.timestamp)}
                  </span>
                </div>
                <ConsoleEventDetails event={event} />
              </div>
            </li>
          ))
        )}
      </ol>

      {replay && (
        <p className="sl-managed-console-replay-note">
          Latest {replay.retainedEventCount} sanitized event
          {replay.retainedEventCount === 1 ? "" : "s"} shown
          {replay.truncated ? `; older activity is outside this preview.` : "."}
        </p>
      )}

      {waitingReason && <WaitingReasonPanel waitingReason={waitingReason} />}
      {prReady && <PrReadyPanel prReady={prReady} />}
      {footer && <div className="sl-managed-console-footer">{footer}</div>}
    </section>
  );
}

function ConsoleEventDetails({ event }: { event: ManagedSessionConsoleEvent }) {
  const detailLines = event.detail?.split(/\r?\n/).filter((line) => line.length > 0) ?? [];
  const outputSummary = event.count !== null && event.count !== undefined
    ? formatOutputSummary(event.count)
    : null;
  if (detailLines.length === 0 && !outputSummary) {
    return null;
  }

  const [firstDetail, ...remainingDetails] = detailLines;
  return (
    <details className="sl-managed-console-step-details" open>
      <summary>
        <span className="sl-managed-console-step-rail" aria-hidden="true">
          {firstDetail ? "│" : "└"}
        </span>
        <span>{firstDetail ?? outputSummary}</span>
      </summary>
      {remainingDetails.map((line, index) => (
        <div className="sl-managed-console-step-line" key={`${line}-${index}`}>
          <span className="sl-managed-console-step-rail" aria-hidden="true">│</span>
          <span>{line}</span>
        </div>
      ))}
      {firstDetail && outputSummary ? (
        <div className="sl-managed-console-step-line">
          <span className="sl-managed-console-step-rail" aria-hidden="true">└</span>
          <span>{outputSummary}</span>
        </div>
      ) : null}
    </details>
  );
}

function isScrolledNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 8;
}

function consoleEventMarkClass(event: ManagedSessionConsoleEvent): string {
  const base = "sl-managed-console-entry-mark";
  if (event.status === "error") {
    return `${base} error`;
  }
  if (event.kind === "assistant-status") {
    return `${base} agent`;
  }
  if (event.kind === "tool") {
    return `${base} tool`;
  }
  if (event.phase === "lifecycle") {
    return `${base} background`;
  }
  return `${base} background`;
}

function formatOutputSummary(count: number): string {
  return count === 1 ? "1 line..." : `${count} lines...`;
}

function WaitingReasonPanel({
  waitingReason,
}: {
  waitingReason: ManagedRuntimeWaitingReason;
}) {
  return (
    <div className="sl-managed-console-callout warning">
      <span className="sl-managed-console-callout-label">{waitingReason.label}</span>
      {waitingReason.detail && <p>{waitingReason.detail}</p>}
      {waitingReason.blockerCode && (
        <p>
          Blocker: <code>{formatManagedRuntimeLabel(waitingReason.blockerCode)}</code>
        </p>
      )}
      <p>{waitingReason.suggestedAction}</p>
    </div>
  );
}

function PrReadyPanel({
  prReady,
}: {
  prReady: ManagedRuntimePrReadyTrustContext;
}) {
  const prTitle = prReady.summary && !prReady.summary.toLowerCase().includes("detected")
    ? prReady.summary
    : prReady.number
      ? `Pull request #${prReady.number}`
      : "Pull request created";
  const prMeta = [prReady.repo, prReady.number ? `#${prReady.number}` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="sl-managed-console-callout success">
      <span className="sl-managed-console-callout-label">PR Created</span>
      <div className="sl-managed-console-pr-card">
        {prReady.url ? (
          <a href={prReady.url} target="_blank" rel="noopener noreferrer">
            {prTitle}
          </a>
        ) : (
          <strong>{prTitle}</strong>
        )}
        {prMeta && <span>{prMeta}</span>}
      </div>
      {(prReady.branchName || prReady.baseBranch || prReady.branchToBaseDiffUrl) && (
        <p className="sl-managed-console-pr-meta">
          {branchSummary(prReady)}
          {prReady.branchToBaseDiffUrl ? (
            <>
              {" "}
              <a href={prReady.branchToBaseDiffUrl} target="_blank" rel="noopener noreferrer">
                View diff
              </a>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

function formatConsoleTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return timestamp;
  }
  return new Date(parsed).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function branchSummary(prReady: ManagedRuntimePrReadyTrustContext): string {
  if (prReady.branchName && prReady.baseBranch) {
    return `${prReady.branchName} into ${prReady.baseBranch}.`;
  }
  if (prReady.branchName) {
    return `${prReady.branchName}.`;
  }
  if (prReady.baseBranch) {
    return `Target ${prReady.baseBranch}.`;
  }
  return "";
}
