# Annotator Persona

The Annotator is the **telemetry and observability persona** for the simulation.

It is responsible for capturing what occurred during execution, structuring that information into stable, queryable formats, and emitting it for downstream consumption. The Annotator does not influence simulation outcomes; it records them.

In practice, the Annotator is the steward of runtime truth: it collects telemetry from actors and personas, aggregates raw signals into structured summaries, and emits accurate run views for the Orchestrator, UI, and observability stacks.

This document defines the Annotator as a **runtime observation and formatting role**. Simulation rules, state transitions, and event generation remain the responsibility of the simulation core (`core-ts`).

---

## At a Glance

| Area | Annotator responsibility |
| --- | --- |
| Owns | Telemetry collection, summarization, and inspection-ready records |
| Does not own | Decisions, rule enforcement, state mutation, or feedback into execution |
| Primary inputs | Events, effects, TickFrames, persona views, state snapshots |
| Primary outputs | Telemetry records, summaries, timeline/inspection artifacts |
| Boundary | Observes runtime truth; never changes it |

## Ownership status (A1–A5)

Ownership is not "the call goes through the controller". The charter defines it as **A1–A5**
(`docs/architecture-charter.md` → *Ownership — what "belongs to a persona" means*), and **a chartered
behavior with no G1 test is not owned**. The rows below mirror
`tests/architecture/persona-authority-registry.js`, which is the single origin for that status;
`tests/architecture/persona-readme-authority.test.js` fails if this table and the registry disagree.

<!-- A1-A5-STATUS:annotator -->

| Behavior | Criteria | Status | Proof |
|---|---|---|---|
| `annotator/run-summary-provenance` — the end-of-run RunSummary is produced by the instance that observed the run | A2, A5 | ✅ owned (CR.8) | `tests/architecture/persona-authority.test.js` |

<!-- /A1-A5-STATUS -->

⚠️ **Provenance is why this row exists, and why an output test could never have settled it.**
`summarizeRun` is a pure derivation, so a freshly constructed Annotator that observed nothing
produces a **byte-identical** summary — which is exactly how the violation survived a green suite.
The gate is therefore the refusal: a run that ticked cannot be summarized by an instance still in
`idle` (`annotator_did_not_observe`).

**Build-scope `telemetry.json` is deliberately absent from this table.** It is glue-owned by charter
rule 3 (the plane boundary): `build`/`llm-plan` run no tick, and the Annotator subscribes only to the
EMIT/SUMMARIZE tick phases. That is a structural consequence, not a missing G1 entry.

## Persona Scope

The Annotator persona is responsible for **recording and describing what happened**, not for deciding what should happen.

At a high level, the Annotator:
- Subscribes to events, effects, and state snapshots emitted during a run.
- Aggregates raw signals into structured telemetry.
- Emits summaries and streams suitable for inspection, debugging, and monitoring.

The Annotator never mutates simulation state and never feeds information back into decision-making loops.

---

## Responsibilities

### Telemetry Collection
The Annotator collects:
- Events emitted by the simulation core.
- Action decisions supplied by runtime personas.
- Budget or limit violations surfaced during execution.
- Effect fulfillment outcomes captured by the Moderator (fulfilled/deferred + results).
- TickFrame records emitted by the Moderator as the authoritative execution timeline.
- Timing and sequencing information relevant to replay and analysis.

Collection is passive and non-intrusive.

---

### Aggregation and Structuring
Raw signals are transformed into:
- Canonical event records.
- Per-tick or per-phase summaries.
- Persona-level and actor-level rollups.
- Run-level metadata suitable for comparison and audit.

All aggregation logic is deterministic and reproducible.

---

### Emission
The Annotator emits telemetry through ports to downstream systems, such as:
- Console or log output.
- UI timelines and inspectors.
- Metrics and traces for observability stacks.
- Persisted artifacts for replay or offline analysis.

Emission targets are provided via adapters; the Annotator does not perform IO directly.

---

## Determinism and Replay

To preserve determinism and replayability:

- Annotator behavior is a pure function of observed inputs.
- Telemetry formats are stable and versioned.
- The same inputs will always yield the same annotated output.

Telemetry generation must never affect simulation timing or outcomes.

---

## Relationship to core-ts

The Annotator does **not**:
- Generate or alter simulation events.
- Interpret or enforce rules.
- Influence actor decisions or allocations.
- Access simulation internals beyond exposed events and snapshots.

## State machine & phases
- States: idle → recording → summarizing → idle.
- Subscribed tick phases: emit, summarize.
- Outputs: telemetry records/summaries (data-only); no IO or feedback into decisions.

`core-ts` is the authoritative source of truth for what occurred.  
The Annotator is responsible only for **describing that truth**.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Annotator state-machine
inputs/outputs belong in `packages/runtime/src/personas/annotator/contracts.ts`.

This separation ensures that:
- Observability can evolve independently of simulation mechanics.
- Telemetry pipelines can change without affecting determinism.
- Multiple views of the same run (UI, logs, metrics) remain consistent.

The Annotator is therefore a **steward of recorded truth**, providing clarity and insight without altering the course of execution.

## Drift guardrails
- Canonical source: `controller.js` + `state-machine.js` + `contracts.ts`. The 1-line `.mts` re-export shims were deleted 2026-08-01; consumers import `persona.js` (the controller barrel), not the state machine.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.js`. There is no `.mts` twin (no `ts-node/esm` required).
