import type { ReactNode } from "react";

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

      <div className="sl-managed-console-current">
        <span aria-hidden="true">streamliner $</span>
        <strong>{latest}</strong>
      </div>

      <ol
        className="sl-managed-console-transcript"
        role="log"
        aria-live={live ? "polite" : "off"}
        aria-label={`${title} transcript`}
      >
        {events.length === 0 ? (
          <li className="empty">
            <span className="sl-managed-console-phase">waiting</span>
            <span>{emptyMessage}</span>
          </li>
        ) : (
          events.map((event, index) => (
            <li
              className={event.status ?? "info"}
              key={`${event.timestamp}-${event.phase}-${index}`}
            >
              <span className="sl-managed-console-time">
                {formatConsoleTimestamp(event.timestamp)}
              </span>
              <span className="sl-managed-console-phase">
                {formatManagedRuntimeLabel(event.phase)}
              </span>
              <span className="sl-managed-console-summary">
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
            </li>
          ))
        )}
      </ol>

      {replay && (
        <p className="sl-managed-console-replay-note">
          Replaying {replay.retainedEventCount} retained sanitized event
          {replay.retainedEventCount === 1 ? "" : "s"}
          {replay.truncated
            ? `; older activity was truncated at ${replay.retainedEventLimit} events.`
            : "."}
        </p>
      )}

      {waitingReason && <WaitingReasonPanel waitingReason={waitingReason} />}
      {prReady && <PrReadyPanel prReady={prReady} />}
      {footer && <div className="sl-managed-console-footer">{footer}</div>}
    </section>
  );
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
  return (
    <div className="sl-managed-console-callout success">
      <span className="sl-managed-console-callout-label">PR ready trust context</span>
      <dl className="sl-managed-console-trust-grid">
        <TrustRow label="PR" value={prReady.url} href={prReady.url} />
        <TrustRow label="Repo" value={prReady.repo} />
        <TrustRow label="Number" value={prReady.number ? `#${prReady.number}` : null} />
        <TrustRow label="Branch" value={prReady.branchName} />
        <TrustRow label="Base" value={prReady.baseBranch} />
        <TrustRow
          label="Branch diff"
          value={prReady.branchToBaseDiffUrl ? "Open diff" : null}
          href={prReady.branchToBaseDiffUrl}
        />
        <TrustRow label="Worktree" value={worktreeCleanLabel(prReady.worktreeClean)} />
        <TrustRow label="PR/head" value={headCheckLabel(prReady.prHeadMatchesBranch)} />
      </dl>
      {prReady.checks.length > 0 && (
        <ul className="sl-managed-console-checks">
          {prReady.checks.map((check) => (
            <li className={check.status} key={`${check.label}:${check.summary}`}>
              <strong>{check.label}</strong>
              <span>{check.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrustRow({
  label,
  value,
  href,
}: {
  label: string;
  value?: string | null;
  href?: string | null;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value
          ? href
            ? <a href={href} target="_blank" rel="noopener noreferrer">{value}</a>
            : value
          : "Not reported"}
      </dd>
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

function worktreeCleanLabel(value: boolean | null | undefined): string | null {
  if (value === true) {
    return "Clean";
  }
  if (value === false) {
    return "Dirty";
  }
  return null;
}

function headCheckLabel(value: boolean | null | undefined): string | null {
  if (value === true) {
    return "Matches";
  }
  if (value === false) {
    return "Mismatch";
  }
  return null;
}
