# Initial shaping: Session status signals

## Problem framing

The session surface needs to answer two different questions that currently blur
together:

1. What action, if any, does the builder need to take?
2. How should the builder interpret what happened in this session?

Those questions are related but not the same. A session can be actively hot but
not waiting on the builder. It can be waiting on the builder without being hot.
It can be done and ready for review while also carrying a "had hot work" signal
that makes reconciliation more important.

The workstream should make those distinctions first-class in the runtime status
model and in the UI.

## Status lanes

The proposed model has two lanes.

### Operational status

Operational status answers: **What do I need to do next?**

Candidate values:

| Status | Meaning | Builder action |
|---|---|---|
| **Working** | The agent is actively executing or recently active. | None. |
| **Needs you** | The session is freshly waiting for builder input, confirmation, or a decision in an active conversation. | Reply, decide, or unblock. |
| **Quiet waiting** | The session is technically waiting on the builder, but the conversation has cooled off after hours or days without activity. | Keep findable; respond when intentionally returning to it. |
| **Ready to review** | Work appears complete or PR/artifacts are ready. | Inspect output. |
| **Blocked** | The agent cannot proceed because of an error, missing dependency, missing permission, or external condition. | Fix the blocker or redirect. |
| **Stale** | The session stopped updating and the status is unclear. | Inspect or clean up. |
| **Closed** | The session is done, archived, or intentionally removed from active operation. | None. |

Operational status should drive sorting, attention, filters, and notification.
Recency should modulate urgency: an assistant question from a just-active
conversation should be much louder than an old open session the builder may
return to later.

### Informational signals

Informational signals answer: **How should I understand this session?**

Candidate signals:

| Signal | Meaning |
|---|---|
| **Heat index** | Degree of active builder-agent co-shaping. |
| **Needs reconciliation** | The session likely changed enough that brief, graph, specs, or design refs may need review. |
| **Boundary pressure** | The session may have touched a shared contract, public checkpoint, or another workstream's dependency assumptions. |
| **Design impact** | `none`, `updated-docs`, or `decision-needed` when known. |
| **Attachment** | Whether the session is attached to a project, workstream, or node. |
| **Environment** | Local Windows, WSL, devbox, or another runtime location. |
| **Confidence** | How confident Streamliner is in the summary/status classification. |

Informational signals should be visually secondary: chips, small icons, rings,
tooltips, or secondary text. They should not collapse into the primary action
status badge.

## Heat index

The original thought was to show a fire emoji for hot work. That was rejected as
the primary design direction because fire can read as good, bad, urgent, or
celebratory depending on context. Heat is also not binary.

A better model is a scalar heat index:

- **Cool** - mostly autonomous execution with little builder interaction
- **Warm** - some builder steering, review, or follow-up
- **Hot** - high interaction density and active co-shaping
- **Cooling** - was hot recently, now idle, done, or lower-intensity

Possible visual treatment:

- thermal dot or ring
- inner fill for current heat
- outer ring for recent peak heat
- muted ring for cooling / had hot-work episode
- tooltip explaining reason and confidence

Heat should mean:

> How much active builder-agent co-shaping is happening in this session?

It should not mean importance, urgency, quality, success, failure, or whether the
work was inspired vs. recovery.

## Heat detection ideas

Potential first-pass signals:

- recent user-message count
- rapid user/assistant alternation
- user token share
- user messages after tool/test/build output
- correction or iteration language such as "change", "try", "actually", "no",
  "make it", "let's", "that feels wrong"
- short-cycle code/tool changes following user turns
- recency decay since last user turn or last activity
- optional explicit builder mark later

The score should probably produce:

```json
{
  "currentHeat": 64,
  "peakHeat": 88,
  "heatState": "hot",
  "heatTrend": "cooling",
  "reason": "High user-agent turn density during UI iteration."
}
```

The exact numeric thresholds are work for the status design/summarizer nodes.

## Waiting on builder vs. ready for review

A core operational-status distinction:

> **Waiting on builder** means the next action is conversation.
> **Ready to review** means the next action is inspection.
> **Blocked** means the next action is unblocking a condition.

### Waiting on builder signals

- Last assistant message asks an explicit question
- Assistant presents options and asks for a choice
- Assistant says it needs confirmation, approval, clarification, credentials, or
  a decision
- Session is idle after that assistant message
- No tool is currently running

### Active waiting vs. quiet waiting

Not every waiting session should compete equally for attention. Some sessions are
mid-conversation: the builder and agent were recently iterating, the agent asked
a question, and the next useful action is probably a quick reply. Other sessions
have been open for hours or days after an assistant question; they are still
conversations the builder may intentionally return to, but they should not look
as urgent as fresh interruptions.

The status model should distinguish:

- **Active waiting** - a recent assistant question or decision point in a
  conversation with recent activity. This should appear as the normal high-
  priority `Needs you` state.
- **Quiet waiting** - an unanswered assistant question or pending conversation
  that has cooled off. This should remain visible and searchable, but visually
  de-emphasized and sorted below active waiting.
- **Stale / unclear** - no reliable pending question or completion signal, and
  the session stopped updating long enough that Streamliner is unsure what
  action is needed.

Quiet waiting is not the same as `Ready to review`: the next action is still
conversation, not artifact inspection. It is also not the same as heat `Cooling`:
a session can be quiet-waiting without having been hot, and a hot session can be
cooling while ready for review.

### Ready to review signals

- Last assistant message contains completion language
- The session references artifacts produced: PR, commit, tests, files changed,
  summary, or design-doc updates
- No explicit question is pending
- Associated tracker/PR/node state changed

### Blocked signals

- Assistant says it cannot proceed
- Tool/build/test failure has no automatic next step underway
- Missing dependency, auth, permission, dirty repo state, or external condition
- Assistant explicitly says "blocked"

## Status summarizer shape

The AI/status summary mechanism can read session state files, event history,
process/heartbeat state, tool activity, git/PR/tracker signals, and node
attachment. It should emit structured runtime overlay data:

```json
{
  "operationalStatus": {
    "kind": "needs-builder",
    "label": "Needs you",
    "priority": "high",
    "recency": "active",
    "reason": "Assistant asked for a decision about whether to change the shared session attachment contract.",
    "suggestedAction": "Reply in the session with a decision."
  },
  "informationalSignals": {
    "heat": {
      "current": 78,
      "peak": 91,
      "trend": "hot",
      "reason": "High user-agent turn density in the last 30 minutes."
    },
    "reconciliation": {
      "needed": true,
      "reason": "Session changed node behavior and design docs after multiple user-directed iterations."
    },
    "boundary": {
      "state": "pressure",
      "reason": "Session discussed changing a shared attachment contract."
    },
    "designImpact": "updated-docs",
    "attachment": {
      "state": "attached",
      "target": "graph-overlays/session-attach"
    },
    "confidence": 0.82
  }
}
```

This shape is an idea, not yet a contract.

## UI sketches

Example session cards:

```text
Session title / node
Last activity: 12m ago

[Needs you]
Assistant is asking for a decision about the attachment boundary.

Signals: thermal-ring Hot | Boundary pressure | Attached to graph-overlay/session-attach
```

```text
Session title / node
Last activity: 8h ago

[Quiet waiting]
Assistant asked a follow-up, but the conversation has cooled off.

Signals: thermal-dot Cool | Unbound | local Windows
```

```text
Session title / node
Last activity: 1h ago

[Ready to review]
PR created and tests passed.

Signals: thermal-ring Cooling | Needs reconciliation | updated-docs
```

```text
Session title / node
Last activity: 3m ago

[Working]
Running implementation plan.

Signals: thermal-dot Cool | Attached | local Windows
```

The UI should make operational status visually dominant and informational
signals secondary but easy to inspect.

## Boundaries and non-goals

This workstream is about session status legibility and signal extraction. It
should not become:

- a full reconciliation automation workstream
- a portfolio-shell redesign
- a replacement session registry
- a graph-launch workstream
- a productivity analytics feature
- a judgment of whether hot work was good or bad

The status system can feed reconciliation and builder learning, but it should not
automatically rewrite workstream artifacts.

## Candidate workstream nodes

Candidate nodes from shaping:

1. Capture initial shaping as a workstream support doc.
2. Define the status-lane design contract.
3. Define the status summarizer schema and runtime overlay contract.
4. Classify operational status: working, needs-builder, quiet-waiting,
   ready-review, blocked, stale, closed.
5. Detect heat index: current, peak, trend, reason, confidence.
6. Surface informational signals: reconciliation need, boundary pressure, design
   impact, attachment, environment, confidence.
7. Update the session card/subcard UI to separate action status from
   interpretation signals.
8. Validate against real sessions and tune the first heuristics.

## Open design questions

- Which status facts can be derived deterministically from state files and which
  require AI summary?
- Does the heat index need manual overrides in V1?
- What score thresholds and decay rules avoid false "hot" labeling?
- How should the UI display low confidence?
- How should graph-node overlays consume the same status model without expanding
  this workstream into the whole graph overlay effort?
- Which reconciliation signals are reliable enough to surface before the
  orchestration inbox/reconciler model is implemented?
