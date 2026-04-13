# Plan — Explicit Workstream Design

## Problem

Issue #5 asks us to make the session-launching-and-tracking workstream design
explicit. The design is currently implicit in the brief and graph. We need to
externalize it into durable design docs, record key decisions, and refine the
downstream issue graph.

## Approach

This is a research/design node — the output is design documents, not code. We
produce the end-to-end session system design as a living design doc, record key
decisions, update the workstream artifacts to reference the new design surface,
and refine the graph based on what the design work makes clear.

## Work Items

### 1. session-system-design — Draft session system design doc
Create `docs/design/session-system.md` covering:
- Launch contract: what triggers a launch, what inputs it needs, what outputs
  it produces
- Context assembly: how Layer 0-3 context is assembled and delivered to the
  worker session
- Session lifecycle: launch → active → complete/crash/timeout
- Session tracking model: discovery, heartbeats, status mapping
- Runtime overlay: how live session state projects onto the committed graph
  without writing back into graph.json
- Terminal integration: how the operator sees and joins sessions

### 2. decision-records — Record key design decisions
Create decision records under `docs/design/decisions/` for architecturally
significant choices made during the design session. Candidates:
- Session discovery mechanism (file-based heartbeat vs. process scanning)
- Context package delivery strategy (file injection vs. skill context)
- Launch orchestration model (SDK-driven vs. terminal command)

### 3. update-design-index — Update design index
Add the new session-system.md to `docs/design/index.md` satellite documents
table and reading order. Add decision records to the decision log.

### 4. update-workstream — Update workstream artifacts
- Update `brief.md`: switch design references to new docs/design/* paths,
  update Current State to reflect completed design work
- Update `graph.json`: refine downstream nodes (backend-context-assembly,
  copilot-sdk-paw-init, terminal-launch-integration, session-tracking-model,
  runtime-overlay-ui) based on what the design made explicit. Update designRefs
  to point at docs/design/* paths.

### 5. process-learnings — Capture process learnings
Add a note on how Streamliner should handle design-session nodes and workstream
parent issues when shaping a GitHub-backed workstream (per issue success criteria).
