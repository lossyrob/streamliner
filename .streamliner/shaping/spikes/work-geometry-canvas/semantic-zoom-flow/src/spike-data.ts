// Real workstream data sourced from:
//   .streamliner/workstreams/session-status-signals/graph.json
//   .streamliner/workstreams/session-launching-and-tracking/graph.json
//
// We treat each `checkpoint` from the production schema as a wave swimlane
// (matches WorkstreamSwimlane in production). Cross-workstream edges connect
// a producing wave's checkpoint moment to the consuming wave on the other
// workstream. Tasks within a wave are derived from the checkpoint's nodeIds.

export type Availability =
  | "validated"
  | "mainline"
  | "preview"
  | "branch-local"
  | "proposed"
  | "superseded";

export type TaskStatus =
  | "completed"
  | "ready"
  | "in-progress"
  | "planned"
  | "blocked";

export type TaskType = "task" | "research" | "gate";

export type Attention = "focus" | "watch";

export interface SpikeTask {
  id: string;
  title: string;
  summary: string;
  type: TaskType;
  status: TaskStatus;
  attention: Attention;
  trackerLabel?: string;
}

export interface SpikeWave {
  id: string;
  index: number;
  title: string;
  summary: string;
  taskIds: string[];
  exports: string[];
}

export interface SpikeWorkstream {
  id: string;
  title: string;
  summary: string;
  repoLabel: string;
  waves: SpikeWave[];
  tasks: Record<string, SpikeTask>;
}

export interface DependencyEdge {
  id: string;
  fromWorkstream: string;
  fromWave: string;
  fromExport: string;
  toWorkstream: string;
  toWave: string;
  toImport: string;
  label: string;
  state: Availability;
  risk: string;
  action: string;
}

const sessionLaunchingTasks: Record<string, SpikeTask> = {
  "bootstrap-design-docs": {
    id: "bootstrap-design-docs",
    title: "Bootstrap design docs",
    summary:
      "Create Streamliner's repo-scoped docs/design set from the current root docs and switch this workstream to reference that design layer.",
    type: "task",
    status: "completed",
    attention: "focus",
    trackerLabel: "lossyrob/streamliner #4",
  },
  "make-workstream-design-explicit": {
    id: "make-workstream-design-explicit",
    title: "Make workstream design explicit",
    summary:
      "Run explicit design sessions for the full workstream so the launch contract, key design decisions, and downstream issue-graph adjustments are written down before more implementation issues are finalized.",
    type: "research",
    status: "completed",
    attention: "focus",
    trackerLabel: "#5",
  },
  "registry-first-reorientation": {
    id: "registry-first-reorientation",
    title: "Registry-first reorientation",
    summary:
      "Reorient the workstream so a manual session registry ships before the launch pipeline. Captures the shift to treating the registry as the primary session surface.",
    type: "research",
    status: "completed",
    attention: "focus",
    trackerLabel: "#9",
  },
  "session-registry-model": {
    id: "session-registry-model",
    title: "Session registry model",
    summary:
      "Define the local-first session registry: persisted record shape, storage layout, autosave semantics, and the observation hook that imports existing Copilot CLI sessions.",
    type: "research",
    status: "completed",
    attention: "focus",
    trackerLabel: "#11",
  },
  "manual-session-registry-ui": {
    id: "manual-session-registry-ui",
    title: "Manual session registry UI",
    summary:
      "Ship a graph-independent Sessions surface and registry-backed default view: list/create/edit/archive sessions and surface trusted Copilot/Agency sessions via local plugin signals.",
    type: "task",
    status: "completed",
    attention: "focus",
    trackerLabel: "#13",
  },
  "session-dashboard-sync": {
    id: "session-dashboard-sync",
    title: "Multi-instance sync",
    summary:
      "Standalone local Streamliner API process owns registry mutation, trusted signal ingestion, background observation, live session events, and optimistic builder-edit concurrency.",
    type: "task",
    status: "completed",
    attention: "focus",
    trackerLabel: "#17",
  },
  "session-relaunch": {
    id: "session-relaunch",
    title: "Session relaunch",
    summary:
      "Relaunch restores a tracked session at its recorded cwd through the local API. Copilot resume and Windows Terminal tab color remain best-effort enhancements.",
    type: "task",
    status: "completed",
    attention: "focus",
    trackerLabel: "#29",
  },
  "terminal-tab-color-spike": {
    id: "terminal-tab-color-spike",
    title: "Windows Terminal color bridge spike",
    summary:
      "Spike completed: terminal color is optional launch-time presentation metadata; relaunch continues uncolored whenever color application is unavailable or fails.",
    type: "research",
    status: "completed",
    attention: "watch",
    trackerLabel: "#15",
  },
  "backend-context-assembly": {
    id: "backend-context-assembly",
    title: "Backend context assembly",
    summary:
      "A selected ready graph node can produce a launch context package reference for downstream launch code, covering project design context, workstream intent/state, and node/tracker context.",
    type: "task",
    status: "completed",
    attention: "watch",
    trackerLabel: "#31",
  },
  "launch-claim-binding": {
    id: "launch-claim-binding",
    title: "Launch claim binding",
    summary:
      "Launch-claim subsystem for graph-launched sessions including reserved registry rows, Tier 1 prompt-nonce binding, Tier 2 trusted-hook binding, sweep/diagnostics, and graphBinding on registry rows.",
    type: "task",
    status: "completed",
    attention: "focus",
    trackerLabel: "#32",
  },
  "launch-prompt-profiles": {
    id: "launch-prompt-profiles",
    title: "PAW launch configuration",
    summary:
      "PAW-only launch preparation flow: graph action opens an Initialize PAW launch dialog, captures workflow instructions and prompt-profile snippets, runs paw-init, returns a structured terminal handoff.",
    type: "task",
    status: "completed",
    attention: "focus",
    trackerLabel: "#33",
  },
  "terminal-launch-integration": {
    id: "terminal-launch-integration",
    title: "Terminal launch integration",
    summary:
      "API-first node-launch path consumes the prepared PAW handoff, creates a launch claim before terminal spawn, injects the canonical nonce line, opens a visible Copilot CLI worker through the configured terminal.",
    type: "task",
    status: "completed",
    attention: "focus",
    trackerLabel: "#44",
  },
  "session-event-observation": {
    id: "session-event-observation",
    title: "Session event observation",
    summary:
      "Fill the remaining observation gaps not already covered by trusted hook signals: turn-boundary detail, unresolved input requests, and lifecycle diagnostics needed for graph overlay confidence.",
    type: "task",
    status: "ready",
    attention: "focus",
    trackerLabel: "#49",
  },
  "sessions-workstream-linkage-ui": {
    id: "sessions-workstream-linkage-ui",
    title: "Sessions view workstream linkage",
    summary:
      "Bound rows resolve graphBinding against tracked workstreams, show workstream/node chips, support Workstream grouping, and deep-link to selected graph nodes when unambiguous.",
    type: "task",
    status: "completed",
    attention: "focus",
    trackerLabel: "#48",
  },
  "graph-node-session-status-ui": {
    id: "graph-node-session-status-ui",
    title: "Graph node status indicators",
    summary:
      "Render bound session status directly on graph nodes using the same status pulse/pill language as My Sessions. Nodes with active launched sessions show the highest-attention session state.",
    type: "task",
    status: "planned",
    attention: "focus",
    trackerLabel: "#50",
  },
  "paw-artifact-status-observation": {
    id: "paw-artifact-status-observation",
    title: "PAW artifact status observation",
    summary:
      "Inspect the PAW work directory and derive coarse workflow status from durable artifacts: specs, plans, research, implementation, reviews, and PR/finalization artifacts.",
    type: "task",
    status: "planned",
    attention: "watch",
    trackerLabel: "#51",
  },
  "runtime-overlay-ui": {
    id: "runtime-overlay-ui",
    title: "Runtime overlay in UI",
    summary:
      "Compose the linked Sessions and graph-node status surfaces into the committed graph runtime overlay, combining committed node status, bound session status, tracker state, and PAW artifact status.",
    type: "task",
    status: "planned",
    attention: "watch",
    trackerLabel: "#52",
  },
  "launch-and-tracking-gate": {
    id: "launch-and-tracking-gate",
    title: "Launch and tracking usable on the graph",
    summary:
      "A node can launch a PAW-backed Copilot CLI session through an API-first launch pipeline; Streamliner binds the resulting registry entry back to the node and renders matching session status on the graph.",
    type: "gate",
    status: "planned",
    attention: "focus",
    trackerLabel: "#53",
  },
};

const sessionStatusTasks: Record<string, SpikeTask> = {
  "initial-shaping-capture": {
    id: "initial-shaping-capture",
    title: "Capture initial shaping",
    summary:
      "Preserve the session status brainstorming as a workstream support doc and distill it into the initial brief and graph without making the support doc the operational source of truth.",
    type: "research",
    status: "completed",
    attention: "focus",
  },
  "status-lane-design-contract": {
    id: "status-lane-design-contract",
    title: "Status lane design contract",
    summary:
      "Turn the shaping into a project design update that defines operational status versus informational signals, active versus quiet waiting, the neutral heat-index concept, UI hierarchy, and runtime status ownership.",
    type: "research",
    status: "ready",
    attention: "focus",
  },
  "status-summarizer-contract": {
    id: "status-summarizer-contract",
    title: "Status summarizer contract",
    summary:
      "Define the structured runtime summary emitted from session state, event history, process/heartbeat state, tracker/PR signals, and AI summary: operational status, waiting recency, reasons, suggested action.",
    type: "research",
    status: "planned",
    attention: "focus",
  },
  "operational-status-classifier": {
    id: "operational-status-classifier",
    title: "Operational status classifier",
    summary:
      "Classify sessions into action statuses such as working, needs-builder, quiet-waiting, ready-review, blocked, stale, and closed, with reasons that distinguish fresh from cooled-off conversation-needed.",
    type: "task",
    status: "planned",
    attention: "focus",
  },
  "heat-index-detection": {
    id: "heat-index-detection",
    title: "Heat index detection",
    summary:
      "Compute current, peak, and trend heat signals from builder-agent interaction density, recency, and iteration cues. Heat is not urgency, quality, or success/failure.",
    type: "task",
    status: "planned",
    attention: "focus",
  },
  "informational-signal-surface": {
    id: "informational-signal-surface",
    title: "Informational signal surface",
    summary:
      "Surface secondary interpretation signals such as needs-reconciliation, boundary pressure, design impact, attachment, environment, and confidence through the session status overlay.",
    type: "task",
    status: "planned",
    attention: "watch",
  },
  "session-card-status-lanes": {
    id: "session-card-status-lanes",
    title: "Session card status lanes",
    summary:
      "Update the session card UI so operational status is visually dominant, quiet-waiting sessions remain findable, and informational signals appear as secondary chips or thermal indicators.",
    type: "task",
    status: "planned",
    attention: "focus",
  },
  "graph-overlay-status-consumption": {
    id: "graph-overlay-status-consumption",
    title: "Graph overlay status consumption",
    summary:
      "Define the minimal way graph node overlays consume the same session operational-status and informational-signal contract without expanding into the whole runtime-overlay or portfolio-shell effort.",
    type: "task",
    status: "planned",
    attention: "watch",
  },
  "real-session-validation-gate": {
    id: "real-session-validation-gate",
    title: "Real session validation",
    summary:
      "Validate the status lanes, heat index, active-vs-quiet waiting, and waiting-vs-review classifier against real cool, warm, hot, blocked, needs-builder, quiet-waiting, and ready-review sessions.",
    type: "gate",
    status: "planned",
    attention: "focus",
  },
};

export const workstreams: SpikeWorkstream[] = [
  {
    id: "session-launching-and-tracking",
    title: "Session launching and tracking",
    summary:
      "API-first launch pipeline, registry-backed Sessions surface, and graph overlay for Copilot CLI sessions launched from a workstream node.",
    repoLabel: "lossyrob/streamliner",
    tasks: sessionLaunchingTasks,
    waves: [
      {
        id: "design-foundation",
        index: 0,
        title: "Design foundation aligned",
        summary:
          "Repo-scoped design docs exist and the workstream's explicit design direction is captured.",
        taskIds: ["bootstrap-design-docs", "make-workstream-design-explicit"],
        exports: ["docs/design layer"],
      },
      {
        id: "manual-registry-usable",
        index: 1,
        title: "Manual session registry usable",
        summary:
          "Streamliner persists a local, graph-independent registry of Copilot sessions with autosaved fields and can relaunch them after a restart.",
        taskIds: [
          "registry-first-reorientation",
          "session-registry-model",
          "manual-session-registry-ui",
          "session-dashboard-sync",
          "session-relaunch",
          "terminal-tab-color-spike",
        ],
        exports: ["session registry model", "relaunch contract"],
      },
      {
        id: "launch-from-graph",
        index: 2,
        title: "Launch from graph works",
        summary:
          "Streamliner assembles context, runs paw-init through Copilot SDK, creates and binds a launch claim, and launches a visible PAW-backed Copilot CLI session from a node.",
        taskIds: [
          "backend-context-assembly",
          "launch-claim-binding",
          "launch-prompt-profiles",
          "terminal-launch-integration",
        ],
        exports: ["launch pipeline", "launch claims"],
      },
      {
        id: "tracking-visible",
        index: 3,
        title: "Tracking visible on the graph",
        summary:
          "Streamliner links My Sessions and the graph through registry graphBinding metadata, overlays bound Copilot session status onto graph nodes with matching status pills/pulses.",
        taskIds: [
          "session-event-observation",
          "sessions-workstream-linkage-ui",
          "graph-node-session-status-ui",
          "paw-artifact-status-observation",
          "runtime-overlay-ui",
          "launch-and-tracking-gate",
        ],
        exports: ["session event observation", "graph status overlay"],
      },
    ],
  },
  {
    id: "session-status-signals",
    title: "Session status signals",
    summary:
      "Operational status lanes versus informational interpretation signals, neutral heat-index for hot-work detection, AI-backed session status summaries.",
    repoLabel: "lossyrob/streamliner",
    tasks: sessionStatusTasks,
    waves: [
      {
        id: "status-model-shaped",
        index: 0,
        title: "Status model shaped",
        summary:
          "Initial shaping is preserved and the project design contract for operational status lanes, informational signals, and heat index semantics is accepted.",
        taskIds: ["initial-shaping-capture", "status-lane-design-contract"],
        exports: ["status lane design"],
      },
      {
        id: "status-detection-contract",
        index: 1,
        title: "Status detection contract",
        summary:
          "The summarizer contract, operational classifier, waiting-recency model, heat index, and informational signal model are defined and usable by the session UI.",
        taskIds: [
          "status-summarizer-contract",
          "operational-status-classifier",
          "heat-index-detection",
          "informational-signal-surface",
        ],
        exports: ["status summarizer contract", "operational status model"],
      },
      {
        id: "status-ui-usable",
        index: 2,
        title: "Status UI usable",
        summary:
          "The Sessions surface separates action status from interpretation signals and graph overlays can consume the same contract without duplicating semantics.",
        taskIds: [
          "session-card-status-lanes",
          "graph-overlay-status-consumption",
        ],
        exports: ["session-card status overlay"],
      },
      {
        id: "session-status-signals-gate",
        index: 3,
        title: "Session status signals validated",
        summary:
          "Real sessions demonstrate that the status model distinguishes needs-builder, quiet-waiting, ready-review, working, blocked, stale, and heat states well enough.",
        taskIds: ["real-session-validation-gate"],
        exports: [],
      },
    ],
  },
];

export const dependencies: DependencyEdge[] = [
  {
    id: "events-to-summarizer",
    fromWorkstream: "session-launching-and-tracking",
    fromWave: "tracking-visible",
    fromExport: "session event observation",
    toWorkstream: "session-status-signals",
    toWave: "status-detection-contract",
    toImport: "session event stream",
    label: "session event observation",
    state: "branch-local",
    risk: "Observation is in-flight on tracking-visible wave; status signals depend on the contract landing before summarizer/heat-index work can finish.",
    action:
      "Land session-event-observation (#49) and freeze the event payload before status-summarizer-contract is signed off.",
  },
  {
    id: "status-contract-to-overlay",
    fromWorkstream: "session-status-signals",
    fromWave: "status-detection-contract",
    fromExport: "operational status model",
    toWorkstream: "session-launching-and-tracking",
    toWave: "tracking-visible",
    toImport: "graph node status pills",
    label: "operational status contract",
    state: "proposed",
    risk: "graph-node-session-status-ui (#50) needs the status pill/lane vocabulary; if the contract lags, the graph overlay ships stale or duplicated semantics.",
    action:
      "Hold graph-node-session-status-ui until status-detection-contract checkpoint exports the operational status model.",
  },
];

export const workstreamById = Object.fromEntries(
  workstreams.map((workstream) => [workstream.id, workstream]),
) as Record<string, SpikeWorkstream>;
