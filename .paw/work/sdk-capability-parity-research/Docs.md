# SDK Capability Parity Research

## Overview

This work produces the Wave 1 capability report for Streamliner's SDK-managed worker runtime workstream. The report evaluates whether a managed Copilot SDK worker can practically replace the current terminal-first Copilot CLI worker path for graph-node PAW work.

The implemented deliverable is `.streamliner/workstreams/sdk-managed-worker-runtime/docs/sdk-capability-parity.md`. It recommends a constrained-go path: the SDK appears capable enough for a first managed worker runtime, but the downstream runtime contract must explicitly handle hook substitution, browser-safe progress projection, cancellation semantics, one-way terminal takeover uncertainty, and deterministic cleanup-after-merge.

## Architecture and Design

### High-Level Architecture

The research treats SDK-managed execution as a new runtime mode layered beside the existing terminal-first launch path. The report maps current Streamliner launch and observation behavior onto the SDK surface:

- Current Streamliner launch preparation already uses Copilot SDK for context generation and PAW init.
- The existing visible worker runtime remains Copilot CLI, with launch-claim binding and trusted plugin hook evidence.
- SDK-managed workers would need first-class managed runtime state instead of pretending to be observed terminal sessions.
- Browser progress should be an allowlisted projection of SDK events, not a raw prompt, reasoning, tool-argument, or terminal stream.

### Design Decisions

The report stays workstream-local rather than editing project design docs. It identifies design impacts for the downstream `managed-worker-runtime-contract` node, which is the planned place to update `docs/design/session-system.md` or add a decision record.

The recommendation is constrained-go, not a full go, because the research found no proof yet that a visible Copilot CLI terminal can take over an SDK-created session state. It also found that the current Streamliner Copilot CLI plugin hooks should be replaced by SDK-owned lifecycle/progress plumbing for managed sessions.

### Integration Points

The report is intended for:

- `managed-worker-runtime-contract` (#61), which should turn findings into lifecycle, registry, progress, takeover, launch-selection, and cleanup contracts.
- `foundation-contract-gate` (#62), where the builder validates whether the constrained-go contract is acceptable.
- Later implementation nodes that should not need to rediscover SDK package capabilities, current hook behavior, or progress redaction constraints.

## User Guide

### Prerequisites

Readers should understand the existing Streamliner graph launch path, PAW Lite workflow artifacts, and the session registry/launch-claim design.

### Basic Usage

Read `.streamliner/workstreams/sdk-managed-worker-runtime/docs/sdk-capability-parity.md` before drafting the managed-worker runtime contract. Start with the executive recommendation, then use the constraints and unknowns section as the checklist for #61.

### Advanced Usage

Use the prototype checklist at the end of the report to plan the first implementation spike. In particular, do not promise true terminal takeover until a prototype proves that a visible Copilot CLI session can resume or foreground the SDK-created session state.

## API Reference

### Key Components

This work does not add production APIs. It documents expected future contract surfaces:

- Managed SDK lifecycle states.
- Registry metadata for SDK-managed sessions.
- Browser-facing progress event allowlist and redaction policy.
- One-way terminal takeover preconditions.
- Cleanup-after-merge lifecycle action.

### Configuration Options

No application configuration is changed. The report cites the currently locked `@github/copilot-sdk` package and existing Streamliner SDK launch configuration behavior as research evidence.

## Testing

### How to Test

The report was validated through source/design inspection and a no-prompt local SDK smoke probe that started the SDK-managed Copilot server, created a session, inspected metadata, and removed the throwaway session directory.

### Edge Cases

The report explicitly calls out unproven edge cases:

- Terminal takeover from SDK-created session state.
- Equivalence between SDK `abort()` and interactive Copilot CLI cancel.
- Hook behavior under SDK-managed sessions.
- Safe display of progress without leaking raw prompts, secrets, tool arguments, or model reasoning.

## Limitations and Future Work

The work is research-only and does not implement the managed SDK runtime, UI, registry schema, graph overlay, terminal takeover action, or cleanup action. The next node should convert the findings into an accepted runtime contract and run targeted prototypes before implementation hardens around SDK-managed execution.
