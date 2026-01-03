The Annotator is the steward of runtime truth. It actively “visits” actors and other personas each tick to collect telemetry, aggregates those raw signals into structured summaries, and emits the results so Orchestrator, the UI, and observability stacks (Prometheus/Grafana) can consume an accurate view of what happened.
# Annotator Persona

The Annotator is the **telemetry and observability persona** for the simulation.

It is responsible for capturing what occurred during execution, structuring that information into stable, queryable formats, and emitting it for downstream consumption. The Annotator does not influence simulation outcomes; it records them.

This document defines the Annotator as a **runtime observation and formatting role**. Simulation rules, state transitions, and event generation remain the responsibility of the simulation core (`core-as`).

---

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

## Relationship to core-as

The Annotator does **not**:
- Generate or alter simulation events.
- Interpret or enforce rules.
- Influence actor decisions or allocations.
- Access simulation internals beyond exposed events and snapshots.

## State machine & phases
- States: idle → recording → summarizing → idle.
- Subscribed tick phases: emit, summarize.
- Outputs: telemetry records/summaries (data-only); no IO or feedback into decisions.

`core-as` is the authoritative source of truth for what occurred.  
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
- Canonical entrypoints: `controller.mts` + `state-machine.mts` + `contracts.ts`; import controllers (not state machines) from consumers.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.mts`; use `ts-node/esm` or a build step before consuming outside the test harness.
