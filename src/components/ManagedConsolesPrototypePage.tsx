import { useMemo, useState } from "react";

import type { ManagedRuntimeProjection } from "../managed-runtime-contract";
import { formatManagedRuntimeLabel } from "../managed-runtime-contract";
import { ManagedSessionConsole } from "./ManagedSessionConsole";
import {
  isManagedRuntimeConsoleLive,
  managedRuntimeConsoleEvents,
  managedRuntimeStateTone,
} from "./ManagedSessionConsoleEvents";

type PrototypeLayout = "overlay" | "sessions-tab" | "monitor";

interface PrototypeConsoleSession {
  id: string;
  title: string;
  workstream: string;
  node: string;
  repo: string;
  branch: string;
  lastActivity: string;
  runtime: ManagedRuntimeProjection;
}

const PROTOTYPE_SESSIONS: PrototypeConsoleSession[] = [
  {
    id: "proto-running",
    title: "Managed Session Console",
    workstream: "sdk-managed-worker-runtime",
    node: "managed-session-console",
    repo: "lossyrob/streamliner",
    branch: "feature/managed-session-console",
    lastActivity: "Active now",
    runtime: {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      permissionProfile: "managed-autonomous",
      lifecycleState: "running",
      lifecycleUpdatedAt: "2026-05-10T17:18:00.000Z",
      summary: "Running targeted UI validation and preparing the console prototype.",
      replay: {
        retainedEventCount: 18,
        retainedEventLimit: 50,
        truncated: false,
      },
      actions: [
        { action: "interrupt", label: "Interrupt", available: true },
        { action: "cancel", label: "Cancel", available: true },
        { action: "terminal-takeover", label: "Terminal takeover", available: true },
        { action: "cleanup", label: "Cleanup", available: false, reason: "Cleanup is unavailable until PR cleanup is ready." },
      ],
      progress: [
        event("17:10:01", "lifecycle", "Background SDK session started.", "lifecycle", "success", {
          count: 1,
        }),
        event("17:10:04", "mcp_status", "MCP status updated.", "mcp", "info"),
        event("17:10:24", "skill_status", "Invoked iterative-ui.", "skill", "info", {
          detail: "iterative-ui",
        }),
        event("17:10:40", "assistant_status", "Thinking...", "assistant-status", "info"),
        event("17:11:08", "assistant_status", "The first pass is implemented: hidden hooks/MCP/usage/permission approvals, assistant status rows are styled as italic narrative, and tool rows render as compact steps. I am validating and capturing the revised prototype.", "assistant-status", "info"),
        event("17:11:52", "tool_started", "Run console tests (shell)", "tool", "info", {
          detail: "npm test -- --run src\\components\\ManagedSessionConsole.test.tsx src\\managed-runtime-contract.test.ts",
        }),
        event("17:12:31", "tool_completed", "Run console tests (shell)", "tool", "success", {
          detail: "npm test -- --run src\\components\\ManagedSessionConsole.test.tsx src\\managed-runtime-contract.test.ts",
          count: 87,
        }),
        event("17:13:11", "evidence", "Hook event observed.", "summary", "success"),
        event("17:14:10", "assistant_status", "The first screenshot makes the remaining noise obvious: the row density is too tall for a monitor-style console. I am tightening that pass before handing it back.", "assistant-status", "info"),
        event("17:15:08", "tool_completed", "Edit", "tool", "success", {
          detail: [
            "Edit src/components/ManagedSessionConsoleEvents.ts",
            "Edit src/components/ManagedSessionConsole.test.tsx",
            "Edit src/streamliner-theme.css",
          ].join("\n"),
          count: 3,
        }),
        event("17:17:42", "tool_completed", "Capture refined output (shell)", "tool", "success", {
          detail: [
            "node scripts\\screenshot.mjs --graph",
            "C:\\Users\\robemanuele\\proj\\streamliner\\streamliner-managed-session-console\\.streamliner\\workstreams\\sdk-managed-worker-runtime\\graph.json --path",
            "/__prototype/managed-consoles --selector .sl-prototype-page --viewport 1600x1000 --out",
            "C:\\Users\\robemanuele\\proj\\streamliner\\streamliner-managed-session-console\\.screenshots\\prototype-managed-consoles-agent-output-v2.png --delay-ms 900",
          ].join("\n"),
          count: 14,
        }),
        event("17:18:00", "assistant_status", "The screenshot is now much closer to the TUI-style transcript: internal rows are gone, assistant status is italic narrative, and tool steps are compact with indented details.", "assistant-status", "info"),
      ],
    },
  },
  {
    id: "proto-waiting",
    title: "Startup Reconciliation",
    workstream: "sdk-managed-worker-runtime",
    node: "managed-runtime-startup-reconciliation",
    repo: "lossyrob/streamliner",
    branch: "feature/startup-reconciliation",
    lastActivity: "Waiting 4 min",
    runtime: {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      permissionProfile: "managed-autonomous",
      lifecycleState: "waiting_for_builder",
      lifecycleUpdatedAt: "2026-05-10T17:08:00.000Z",
      summary: "Cleanup is blocked because the worktree has uncommitted changes.",
      blockerSummary: "Cleanup is blocked because the worktree has uncommitted changes.",
      waitingReason: {
        code: "cleanup_blocked",
        label: "Cleanup blocked",
        detail: "Cleanup guardrails found an uncommitted screenshot artifact in the worktree.",
        blockerCode: "dirty-worktree",
        suggestedAction: "Review the cleanup blocker, fix the local state, then retry cleanup.",
      },
      replay: {
        retainedEventCount: 50,
        retainedEventLimit: 50,
        truncated: true,
      },
      actions: [
        { action: "interrupt", label: "Interrupt", available: true },
        { action: "cancel", label: "Cancel", available: true },
        { action: "terminal-takeover", label: "Terminal takeover", available: true },
        { action: "cleanup", label: "Cleanup", available: false, reason: "Dirty worktree blocks cleanup." },
      ],
      progress: [
        event("17:02:00", "lifecycle", "Session reached cleanup-ready state.", "lifecycle", "success"),
        event("17:03:15", "tool_started", "Checking cleanup guardrails.", "tool", "info"),
        event("17:03:22", "error", "Cleanup is blocked because the worktree has uncommitted changes.", "cleanup", "error"),
        event("17:08:00", "assistant_status", "Waiting for builder cleanup decision.", "assistant-status", "warning"),
      ],
    },
  },
  {
    id: "proto-pr-ready",
    title: "Terminal Takeover Cleanup Actions",
    workstream: "sdk-managed-worker-runtime",
    node: "terminal-takeover-cleanup-actions",
    repo: "lossyrob/streamliner",
    branch: "feature/terminal-takeover-cleanup",
    lastActivity: "PR ready 18 min",
    runtime: {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      permissionProfile: "managed-autonomous",
      lifecycleState: "pr_ready",
      lifecycleUpdatedAt: "2026-05-10T16:58:00.000Z",
      summary: "PR #86 is ready with a clean worktree and matching head state.",
      prReady: {
        url: "https://github.com/lossyrob/streamliner/pull/86",
        repo: "lossyrob/streamliner",
        number: 86,
        branchName: "feature/terminal-takeover-cleanup",
        baseBranch: "main",
        branchToBaseDiffUrl:
          "https://github.com/lossyrob/streamliner/compare/main...feature%2Fterminal-takeover-cleanup",
        worktreeClean: true,
        headSha: "abc123",
        prHeadSha: "abc123",
        prHeadMatchesBranch: true,
        checks: [
          { label: "Branch-to-base diff", status: "pass", summary: "A branch-to-base diff link is available." },
          { label: "Worktree cleanliness", status: "pass", summary: "Worktree is clean." },
          { label: "PR/head-state check", status: "pass", summary: "Recorded PR head matches the branch head." },
        ],
      },
      replay: {
        retainedEventCount: 31,
        retainedEventLimit: 50,
        truncated: false,
      },
      actions: [
        { action: "interrupt", label: "Interrupt", available: false, reason: "Interrupt is unavailable while PR is ready." },
        { action: "cancel", label: "Cancel", available: false, reason: "Cancel is unavailable while PR is ready." },
        { action: "terminal-takeover", label: "Terminal takeover", available: true },
        { action: "cleanup", label: "Cleanup", available: false, reason: "Cleanup is unavailable until PR is merged." },
      ],
      progress: [
        event("16:43:10", "tool_completed", "Implementation validation completed.", "tool", "success"),
        event("16:47:34", "review", "Final review approved after applying two fixes.", "review", "success"),
        event("16:54:41", "pull-request", "Created PR #86 for terminal takeover cleanup actions.", "pull-request", "success", {
          link: {
            label: "PR #86",
            url: "https://github.com/lossyrob/streamliner/pull/86",
          },
        }),
        event("16:58:00", "assistant_status", "PR #86 is ready with a clean worktree and matching head state.", "assistant-status", "success"),
      ],
    },
  },
  {
    id: "proto-takeover",
    title: "Launch Flags Compatibility",
    workstream: "session-launching-and-tracking",
    node: "copilot-launch-flags",
    repo: "lossyrob/streamliner",
    branch: "feature/issue-88-launch-flags",
    lastActivity: "Takeover yesterday",
    runtime: {
      runtimeKind: "managed-sdk",
      runtimeOwner: "builder-terminal",
      permissionProfile: "managed-autonomous",
      lifecycleState: "terminal_takeover",
      lifecycleUpdatedAt: "2026-05-09T22:10:00.000Z",
      summary: "Terminal takeover completed; SDK streaming is closed and retained activity is replay-only.",
      replay: {
        retainedEventCount: 42,
        retainedEventLimit: 50,
        truncated: false,
      },
      actions: [
        { action: "interrupt", label: "Interrupt", available: false, reason: "Terminal owns this session after takeover." },
        { action: "cancel", label: "Cancel", available: false, reason: "Terminal owns this session after takeover." },
        { action: "terminal-takeover", label: "Terminal takeover", available: false, reason: "Terminal takeover already completed." },
        { action: "cleanup", label: "Cleanup", available: false, reason: "Cleanup is unavailable until merged PR cleanup is ready." },
      ],
      progress: [
        event("21:58:12", "lifecycle", "Managed session interrupted at builder request.", "lifecycle", "warning"),
        event("22:00:04", "terminal_takeover", "Opened Copilot CLI with resume command for SDK session.", "summary", "success"),
        event("22:10:00", "assistant_status", "Terminal takeover completed; retained managed activity is now replay-only.", "assistant-status", "info"),
      ],
    },
  },
  {
    id: "proto-completed",
    title: "Managed SDK Contract",
    workstream: "sdk-managed-worker-runtime",
    node: "managed-worker-contract",
    repo: "lossyrob/streamliner",
    branch: "feature/managed-worker-contract",
    lastActivity: "Completed 2 days ago",
    runtime: {
      runtimeKind: "managed-sdk",
      runtimeOwner: "streamliner-sdk",
      permissionProfile: "managed-autonomous",
      lifecycleState: "completed",
      lifecycleUpdatedAt: "2026-05-08T19:42:00.000Z",
      summary: "Implementation completed; final PR merged and cleanup evidence retained.",
      replay: {
        retainedEventCount: 28,
        retainedEventLimit: 50,
        truncated: false,
      },
      actions: [
        { action: "interrupt", label: "Interrupt", available: false, reason: "Completed sessions cannot be interrupted." },
        { action: "cancel", label: "Cancel", available: false, reason: "Completed sessions cannot be canceled." },
        { action: "terminal-takeover", label: "Terminal takeover", available: false, reason: "Terminal takeover is unavailable after completion." },
        { action: "cleanup", label: "Cleanup", available: true },
      ],
      progress: [
        event("19:20:16", "tool_completed", "Build and focused runtime tests passed.", "tool", "success"),
        event("19:32:02", "pull-request", "PR merged to main.", "pull-request", "success"),
        event("19:42:00", "cleanup", "Cleanup-ready evidence retained for worktree removal.", "cleanup", "success"),
      ],
    },
  },
];

function event(
  time: string,
  phase: string,
  summary: string,
  kind: NonNullable<ManagedRuntimeProjection["progress"]>[number]["kind"],
  status: NonNullable<ManagedRuntimeProjection["progress"]>[number]["status"],
  options: {
    link?: NonNullable<ManagedRuntimeProjection["progress"]>[number]["link"];
    detail?: string;
    count?: number;
  } = {},
): NonNullable<ManagedRuntimeProjection["progress"]>[number] {
  return {
    timestamp: `2026-05-10T${time}.000Z`,
    phase,
    summary,
    kind,
    status,
    link: options.link,
    detail: options.detail,
    count: options.count,
  };
}

export function ManagedConsolesPrototypePage() {
  const [layout, setLayout] = useState<PrototypeLayout>("overlay");
  const [selectedId, setSelectedId] = useState(PROTOTYPE_SESSIONS[0].id);
  const [includeHistory, setIncludeHistory] = useState(true);
  const selected = useMemo(
    () => PROTOTYPE_SESSIONS.find((session) => session.id === selectedId) ?? PROTOTYPE_SESSIONS[0],
    [selectedId],
  );
  const visibleSessions = includeHistory
    ? PROTOTYPE_SESSIONS
    : PROTOTYPE_SESSIONS.filter((session) => isManagedRuntimeConsoleLive(session.runtime));

  return (
    <div className="sl-shell-panel">
      <main className="sl-prototype-page">
        <header className="sl-prototype-hero">
          <div>
            <span className="sl-eyebrow">Prototype</span>
            <h1>Managed runtime consoles</h1>
            <p>
              High-fidelity mock using production console components, fake managed
              runtime data, and real Streamliner styling.
            </p>
          </div>
          <div className="sl-prototype-actions">
            <PrototypeSegment
              label="Layout"
              value={layout}
              options={[
                ["overlay", "Workstream overlay"],
                ["sessions-tab", "Sessions tab"],
                ["monitor", "Tabbed monitor"],
              ]}
              onChange={setLayout}
            />
            <button
              className={`sl-action-btn${includeHistory ? " active" : ""}`}
              type="button"
              onClick={() => setIncludeHistory((value) => !value)}
            >
              {includeHistory ? "Including history" : "Active only"}
            </button>
          </div>
        </header>

        {layout === "overlay" && (
          <PrototypeWorkstreamOverlay
            sessions={visibleSessions}
            selected={selected}
            onSelect={setSelectedId}
          />
        )}
        {layout === "sessions-tab" && (
          <PrototypeSessionsTab
            sessions={visibleSessions}
            selected={selected}
            onSelect={setSelectedId}
            includeHistory={includeHistory}
          />
        )}
        {layout === "monitor" && (
          <PrototypeTabbedMonitor
            sessions={visibleSessions}
            selected={selected}
            onSelect={setSelectedId}
          />
        )}
      </main>
    </div>
  );
}

function PrototypeSegment<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="sl-prototype-segment" aria-label={label}>
      {options.map(([option, optionLabel]) => (
        <button
          className={option === value ? "active" : ""}
          key={option}
          type="button"
          onClick={() => onChange(option)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

function PrototypeWorkstreamOverlay({
  sessions,
  selected,
  onSelect,
}: {
  sessions: PrototypeConsoleSession[];
  selected: PrototypeConsoleSession;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="sl-prototype-workstream">
      <div className="sl-prototype-workstream-canvas">
        <div className="sl-prototype-graph-grid" aria-hidden="true" />
        <div className="sl-prototype-node-stack">
          {sessions.slice(0, 4).map((session, index) => (
            <button
              className={`sl-prototype-node-card${session.id === selected.id ? " selected" : ""}`}
              key={session.id}
              style={{ transform: `translate(${index * 34}px, ${index * 56}px)` }}
              type="button"
              onClick={() => onSelect(session.id)}
            >
              <span>{session.node}</span>
              <strong>{session.title}</strong>
              <small>{formatManagedRuntimeLabel(session.runtime.lifecycleState)}</small>
            </button>
          ))}
        </div>
        <div className="sl-prototype-inspector-peek">
          <span className="sl-section-label">Runtime details</span>
          <strong>{selected.title}</strong>
          <p>{selected.runtime.summary}</p>
          <div className="sl-prototype-inline-actions">
            <button className="sl-action-btn primary" type="button">Open console</button>
            <button className="sl-action-btn" type="button">Open in Sessions</button>
          </div>
        </div>
        <PrototypeConsoleOverlay session={selected} />
      </div>
    </section>
  );
}

function PrototypeConsoleOverlay({ session }: { session: PrototypeConsoleSession }) {
  return (
    <aside className="sl-prototype-console-overlay" aria-label="Managed runtime console overlay">
      <div className="sl-prototype-console-overlay-head">
        <div>
          <span className="sl-eyebrow">Managed runtime console</span>
          <h2>{session.title}</h2>
          <p>
            {session.workstream} / {session.node}
          </p>
        </div>
        <div className="sl-prototype-inline-actions">
          <button className="sl-action-btn" type="button">Open in Sessions</button>
          <button className="sl-sheet-close" type="button" aria-label="Close console">x</button>
        </div>
      </div>
      <PrototypeConsole session={session} />
    </aside>
  );
}

function PrototypeSessionsTab({
  sessions,
  selected,
  onSelect,
  includeHistory,
}: {
  sessions: PrototypeConsoleSession[];
  selected: PrototypeConsoleSession;
  onSelect: (id: string) => void;
  includeHistory: boolean;
}) {
  return (
    <section className="sl-prototype-sessions-frame">
      <div className="sl-prototype-session-tabs" role="tablist" aria-label="Sessions tabs">
        <button type="button" role="tab" aria-selected="false">All Sessions</button>
        <button type="button" role="tab" aria-selected="true" className="active">Background Consoles</button>
      </div>
      <div className="sl-sessions-header">
        <div>
          <h2 className="sl-status-title">Background Consoles</h2>
          <p className="sl-sessions-filter-note">
            Active managed sessions first, with retained replay for completed,
            failed, and takeover sessions.
          </p>
        </div>
        <div className="sl-sessions-filters">
          <input className="sl-text-field" value="sdk managed" readOnly aria-label="Prototype search" />
          <button className="sl-action-btn active" type="button">
            {includeHistory ? "History visible" : "Active only"}
          </button>
          <button className="sl-action-btn" type="button">Group: Recency</button>
        </div>
      </div>
      <div className="sl-prototype-console-grid">
        <div className="sl-prototype-console-list">
          {sessions.map((session) => (
            <PrototypeConsoleListItem
              key={session.id}
              session={session}
              selected={session.id === selected.id}
              onSelect={() => onSelect(session.id)}
            />
          ))}
        </div>
        <div className="sl-prototype-console-detail">
          <PrototypeConsole session={selected} />
        </div>
      </div>
    </section>
  );
}

function PrototypeTabbedMonitor({
  sessions,
  selected,
  onSelect,
}: {
  sessions: PrototypeConsoleSession[];
  selected: PrototypeConsoleSession;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="sl-prototype-monitor">
      <aside className="sl-prototype-monitor-rail" aria-label="Managed console tabs">
        <span className="sl-eyebrow">Managed consoles</span>
        {sessions.map((session) => (
          <button
            className={session.id === selected.id ? "active" : ""}
            key={session.id}
            type="button"
            onClick={() => onSelect(session.id)}
          >
            <strong>{session.title}</strong>
            <span>{formatManagedRuntimeLabel(session.runtime.lifecycleState)}</span>
          </button>
        ))}
      </aside>
      <div className="sl-prototype-monitor-main">
        <div className="sl-prototype-monitor-toolbar">
          <div>
            <span className="sl-eyebrow">Focused console</span>
            <h2>{selected.title}</h2>
          </div>
          <div className="sl-prototype-inline-actions">
            <button className="sl-action-btn" type="button">Open node</button>
            <button className="sl-action-btn primary" type="button">Pin console</button>
          </div>
        </div>
        <PrototypeConsole session={selected} />
      </div>
    </section>
  );
}

function PrototypeConsoleListItem({
  session,
  selected,
  onSelect,
}: {
  session: PrototypeConsoleSession;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`sl-prototype-console-row${selected ? " selected" : ""}`}
      type="button"
      onClick={onSelect}
    >
      <span className={`sl-managed-runtime-state ${managedRuntimeStateTone(session.runtime)}`}>
        {formatManagedRuntimeLabel(session.runtime.lifecycleState)}
      </span>
      <strong>{session.title}</strong>
      <span>{session.workstream}</span>
      <small>{session.lastActivity}</small>
    </button>
  );
}

function PrototypeConsole({ session }: { session: PrototypeConsoleSession }) {
  return (
    <ManagedSessionConsole
      title="Runtime transcript"
      subtitle={`${session.repo} / ${session.branch}; sanitized Streamliner activity only.`}
      stateLabel={formatManagedRuntimeLabel(session.runtime.lifecycleState)}
      stateTone={managedRuntimeStateTone(session.runtime)}
      currentMessage={session.runtime.summary ?? session.runtime.blockerSummary ?? session.runtime.errorSummary ?? undefined}
      showCurrentMessage={false}
      events={managedRuntimeConsoleEvents(session.runtime, 50)}
      emptyMessage="No retained managed runtime activity yet."
      waitingReason={session.runtime.waitingReason}
      prReady={session.runtime.prReady}
      replay={session.runtime.replay}
      live={isManagedRuntimeConsoleLive(session.runtime)}
      footer={<PrototypeActionFooter runtime={session.runtime} />}
    />
  );
}

function PrototypeActionFooter({ runtime }: { runtime: ManagedRuntimeProjection }) {
  return (
    <div className="sl-prototype-runtime-actions">
      {(runtime.actions ?? []).map((action) => (
        <button
          className={`sl-action-btn${action.available ? " primary" : ""}`}
          disabled={!action.available}
          key={action.action}
          title={action.reason ?? undefined}
          type="button"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
