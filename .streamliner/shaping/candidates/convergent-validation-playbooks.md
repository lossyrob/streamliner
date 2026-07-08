# Convergent Validation Playbooks

## Stage

Shaping.

## Seed Idea

Add a general workstream wave pattern where Streamliner runs an executable validation playbook, turns blocking findings into repair work, drives those repairs through implementation/review/merge loops, and reruns the playbook until it passes or reaches a bounded stop condition.

This emerged from DB Agent scenario validation, but the candidate should not be DB Agent specific. DB Agent scenarios become one instance of a broader pattern: executable acceptance pressure applied to a workstream artifact, branch, environment, release, migration, dependency upgrade, or product surface.

## Naming Direction

Use the following vocabulary unless later shaping finds better names:

- **Validation Playbook**: the executable acceptance contract. It may be a markdown operator playbook, command, GitHub Actions workflow, test suite, benchmark harness, browser task, notebook, scanner, or custom runner.
- **Validation Run**: one execution attempt of a validation playbook, with logs, environment identifiers, input refs, output status, and findings.
- **Finding**: a structured blocker or observation emitted by a validation run.
- **Repair Task**: a bounded unit of implementation work created from a finding.
- **Validation Loop Wave**: the workstream wave pattern that runs the playbook, dispatches repairs, waits for repair PRs to merge, and reruns until passing.
- **Convergence Policy**: the budget and safety policy that decides whether the loop continues, retries, escalates, or stops.

The architectural pattern is **convergent validation**: use an executable evaluator to create repair pressure until the target converges on an accepted state.

## Why It Matters

Streamliner can already model planned work and can move toward autonomous implementation/review loops. But complex systems often fail only when exercised end to end: a realistic operator path, a migration rehearsal, a release smoke test, a docs quickstart from a clean machine, or a production-readiness drill.

Today the builder still acts as the outer loop:

1. Run the validation manually.
2. Notice where it blocks.
3. Write or update issues.
4. Launch implementation sessions.
5. Wait for review and merge.
6. Restart the validation from the new branch state.
7. Repeat until the thing is green.

That manual outer loop is high leverage and tedious. It is exactly the sort of orchestration Streamliner should own, provided the loop is bounded, observable, and honest when it is stuck.

## Candidate Scope

### In Scope

- Define `ValidationPlaybook`, `ValidationRun`, `Finding`, `RepairTask`, and `ConvergencePolicy` artifact concepts.
- Define a generic runner contract for validation playbooks.
- Support structured playbook output, especially machine-readable findings.
- Create or reuse GitHub issues for blocking findings, using dedupe fingerprints.
- Launch repair implementation work for findings.
- Integrate with review loops and merge sentry behavior before rerunning validation.
- Track the mapping from validation run to finding to issue to repair session to PR to merge to next validation run.
- Support an integration branch per validation loop so repair PRs can target the workstream state before promotion to main.
- Stop safely when the playbook passes, budgets are exhausted, findings repeat, confidence is low, or human judgment is required.
- Emit a final report showing attempts, findings, issues, PRs, merges, unresolved blockers, and remaining risks.

### Out of Scope

- Replacing CI.
- Assuming every validation can be fully automated.
- Automatic root-cause perfection from raw logs.
- Unbounded issue/PR/session creation.
- Cross-repo repair planning in the first slice.
- Multi-scenario optimization or scheduling in the first slice.

### Deferred

- LLM-only log mining when structured findings are unavailable.
- Multi-repository repair coordination.
- Scheduling many validation playbooks as a suite.
- Policy-driven waiver flows.
- Rich dashboards beyond the initial run report and workstream graph state.

## Diverse Applicability

### DB Agent scenario validation

Run a DB Agent operator playbook against a realistic environment. When blocked, emit structured findings, create issues, dispatch repair sessions, review/merge fixes into an integration branch, and rerun until the playbook completes green.

### Migration rehearsal

Run a database or service migration rehearsal. Validate schema/data parity, rollback, permissions, runtime behavior, and performance. Findings become repair tasks for mappings, backfills, indexes, scripts, or rollback gaps.

### Release readiness

Deploy a candidate branch to staging, run smoke tests, inspect logs, check dashboards, verify alerts, validate rollback, and confirm launch criteria. Findings become release-hardening work.

### Documentation quickstart validation

Execute docs or tutorial steps from a clean environment. Broken setup instructions, bad sample code, missing prerequisites, or outdated screenshots become docs/code repair tasks. This catches documentation rot before users find it with a shovel.

### Dependency upgrade campaign

Apply a runtime/package/framework upgrade, run the compatibility playbook, emit failures across tests or supported examples, repair, review, merge, and rerun until the upgrade branch passes.

### Compatibility matrix

Run a library or extension across supported operating systems, runtimes, database versions, cloud regions, or browser versions. Each compatibility failure becomes a targeted repair task.

### Security hardening

Run dependency scans, secret scans, permission audits, authz checks, threat-model probes, and policy checks. Findings become repair tasks, with escalation required for destructive or low-confidence decisions.

### Performance budget enforcement

Run representative benchmarks and telemetry checks. Findings identify latency regressions, memory growth, bad query plans, startup cost, or cache behavior. Repairs continue until budgets pass or tradeoffs are explicitly escalated.

### Data quality remediation

Run validators over a dataset or pipeline: schema drift, freshness, invalid geometries, missing values, reconciliation mismatches, or broken lineage. Findings spawn repair/backfill tasks, then the validator reruns.

### New environment bring-up

Provision a tenant, region, demo stack, devbox, or test environment. Run readiness checks and repair IaC, config, secrets, docs, or bootstrap scripts until the environment is usable.

## Workstream Shape

This should probably become a dedicated workstream after the review-loop and session-runtime substrate is far enough along to launch and monitor repair work reliably.

Likely waves:

1. **Artifact model and runner contract**: define validation playbooks, validation runs, findings, and output schema.
2. **Single-playbook validation loop**: run one playbook, capture structured output, dedupe findings, and produce a run report.
3. **Finding to issue dispatch**: create/reuse GitHub issues with reproduction context and stable fingerprints.
4. **Repair loop integration**: launch repair implementation sessions for findings and associate resulting PRs.
5. **Review and merge gating**: wait for review/CI/merge before rerunning the playbook.
6. **Integration branch and promotion**: target repairs to a workstream integration branch and optionally open a final promotion PR once validation passes.
7. **Safety, budgets, and escalation**: max iterations, max parallel repairs, repeated-fingerprint stops, flaky classification, human approval gates, and final reporting.
8. **Suite support**: run multiple validation playbooks with prioritization and shared repair batching.

## First Useful Slice

Build the smallest useful loop around one validation playbook, one repository, and one integration branch.

Input:

- validation playbook identity and runner type;
- target repo and integration branch;
- environment config;
- structured output path;
- max iterations and max findings per iteration;
- issue labels and repair-session launch policy.

Behavior:

1. Run the playbook against the integration branch.
2. Parse `.streamliner/validation-result.json` or equivalent structured output.
3. If passed, mark the wave complete and emit a final report.
4. If blocked, create or reuse GitHub issues for blocking findings.
5. Launch bounded repair work for each selected finding.
6. Wait for repair PRs to pass review, pass CI, and merge into the integration branch.
7. Rerun the playbook.
8. Stop on pass, budget exhaustion, repeated failure, low-confidence finding, destructive action, or explicit human-escalation signal.

## Example Playbook Output

```json
{
  "status": "blocked",
  "summary": "DB Agent failed during index creation flow.",
  "findings": [
    {
      "title": "DB Agent fails to infer schema before CREATE INDEX",
      "severity": "blocking",
      "fingerprint": "sha256:...",
      "confidence": "high",
      "repro_steps": [
        "Provision sample database",
        "Ask DB Agent to create an index for recent orders lookup",
        "Observe failure before schema inspection completes"
      ],
      "expected": "Agent inspects schema and proposes a valid CREATE INDEX statement.",
      "actual": "Agent attempts CREATE INDEX against an unknown column set.",
      "evidence": {
        "log_excerpt": "...",
        "artifact_paths": ["runs/vr_001/log.txt"]
      },
      "suggested_area": "schema inspection"
    }
  ]
}
```

## Example Wave Configuration

```yaml
kind: ValidationLoopWave
playbook: dbagent-scenarios-validation
runner:
  type: agent-playbook
  entrypoint: playbooks/dbagent/e2e/create-index.md
target:
  repo: lossyrob/dbagent
  integration_branch: workstream/dbagent-validation
outputs:
  result_file: .streamliner/validation-result.json
on_findings:
  create_issues: true
  dispatch_repairs: true
  require_review: true
  merge_when_green: true
convergence:
  max_iterations: 10
  max_findings_per_iteration: 5
  max_parallel_repairs: 3
  stop_on_repeated_fingerprint: 3
  require_human_for:
    - destructive_migration
    - security_sensitive_change
    - low_confidence
```

## Design Principles

- The playbook is the evaluator. It decides whether the target is acceptable.
- The validation loop owns convergence. Repair sessions do not decide global done-ness.
- **Convergence means independent confirmation, not self-confirmation.** Re-running the exact
  playbook that produced the repairs can pass simply because the fixes were patched to that test. The
  honest stop is when a *fresh* attempt to break the target — different inputs, a different path, or a
  second evaluator — finds nothing new. Passing the same lens that generated the fixes is the weakest
  green there is.
- **Whoever tries to break it is independent of whoever fixes it.** If the session that crafts the
  failing case is the one that implemented the repair, they share a blind spot and the loop converges
  on "looks fixed to us." Keep the break-it role separate from the fix-it role.
- **Pair pass/fail with an occasional check that the checks are right.** The playbook calls pass/fail
  against its contract; every so often something independent should confirm the contract is still
  testing the right thing, so a green playbook that quietly tests the wrong thing gets caught rather
  than trusted.
- **Budget the loop in validation runs.** The comparable unit of both cost and confidence is how many
  times the evaluator ran; express budgets primarily as a run count rather than wall-clock time.
- GitHub issues and PRs are durable coordination artifacts, not the canonical workstream state database.
- Streamliner should preserve the full chain: validation run, finding, issue, repair session, PR, review session, merge, next validation run.
- Findings need stable fingerprints or the system will make issue confetti.
- Structured findings should be preferred over clever log inference for the first version.
- A validation loop should default to an integration branch rather than landing half-healed repairs directly on main.
- The system must be able to say, clearly and early, "this is stuck."

## Dependencies

### Depends On

- Session launching and tracking primitives for launching and monitoring repair sessions.
- Automated review loop behavior for review and re-review of repair PRs.
- Merge sentry or equivalent behavior for CI, conflicts, approval, and merge readiness.
- GitHub issue/PR integration.
- Workstream state model capable of representing loop progress without rewriting committed artifacts on every pulse.

### Enables

- Autonomous hardening of complex features against realistic end-to-end validation.
- Release readiness workstreams that keep repairing until launch criteria pass.
- Migration and dependency-upgrade campaigns with repeatable acceptance evidence.
- Stronger checkpoint and closeout semantics, because closeout can be backed by executable validation evidence.
- Broader autonomous wave progression, where wave completion is based on validation rather than just PR creation.

### Related Candidates

- [Automated PAW Review Loop](automated-paw-review-loop.md), because repair PRs need review/re-review orchestration.
- [SDK-Managed Worker Runtime](sdk-managed-worker-runtime.md), because managed workers make repair dispatch and continuation more reliable.
- [Autonomous Wave Progression](autonomous-wave-progression.md), because convergent validation can become an acceptance gate for wave progression.
- [Checkpoint and Closeout Experience](checkpoint-closeout-experience.md), because validation playbooks can provide checkpoint evidence and closeout blockers.
- [External Dependency Tracking](external-dependency-tracking.md), because some findings will require approval, access, credentials, or product decisions outside Streamliner.

## Open Questions

- Should the user-facing pattern be called `Validation Loop Wave`, `Convergent Validation`, or something else?
- Should `Validation Playbook` be the only artifact name, or should Streamliner also expose an `Executable Acceptance Contract` concept internally?
- Should the first slice require structured finding output, or permit log summarization behind an explicit low-confidence mode?
- How should repeated flaky failures be distinguished from deterministic blockers?
- How independent must the confirming probe be, and who supplies it — a second playbook, a different
  environment, or a separate auditor session that checks the playbook itself is testing the right thing?
- What default iteration, cost, and parallelism budgets are safe?
- Should the first implementation target workstream integration branches only?
- How should waivers or accepted risks be represented when validation cannot fully pass?
- What UI makes loop state legible without turning the workstream graph into a bowl of spaghetti?

## Handoff Brief

Create a Convergent Validation Playbooks workstream that adds a first-class validation-loop wave pattern to Streamliner. The workstream should define a generic validation playbook runner contract, structured validation results, finding dedupe, GitHub issue dispatch, repair-session launch, review/merge gating, integration-branch reruns, convergence policy, and final reporting.

Use DB Agent scenario validation as the first concrete proving ground, but keep the abstraction broad enough for migration rehearsals, release readiness, docs validation, dependency upgrades, compatibility matrices, security hardening, performance budgets, data quality remediation, and environment bring-up.

The first useful slice should run one validation playbook against one repo and one integration branch, create or reuse issues for blocking findings, launch bounded repair work, wait for repair PRs to merge, rerun the playbook, and stop when the playbook passes or a safety condition requires human intervention.
