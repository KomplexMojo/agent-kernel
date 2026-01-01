# Artifact Fixtures

These JSON files are minimal, schema-valid artifacts used by tests to validate
loading, serialization, and cross-artifact wiring. Each file contains a single
artifact and should stay stable unless the schema version changes.

General rules:
- Each file uses schemaVersion 1 and includes required meta where applicable.
- References (intent/plan/budget/simConfig) point to other fixture ids.
- Keep payloads minimal and deterministic.
- Invalid fixtures live under tests/fixtures/artifacts/invalid for negative tests.

## MVP actor movement
- sim-config-artifact-v1-mvp-grid.json: 5x5 grid layout with walls, spawn (1,1), and exit (3,2) plus render palette.
- initial-state-artifact-v1-mvp-actor.json: one ambulatory actor at spawn with vitals stub (hp/maxHp 10) and speed 1.
- action-sequence-v1-mvp-to-exit.json: ordered move actions (east, east, south) walking the actor from spawn to the exit.
- frame-buffer-log-v1-mvp.json: ASCII frame buffers per tick mirroring the action path, keyed by actor id and sharing the same run/config refs.

## Intent + Planning
- intent-envelope-v1-basic.json: intake boundary request; used to test intent parsing.
- plan-artifact-v1-basic.json: structured plan referencing the intent.

## Budgeting
- budget-request-v1-basic.json: allocator request derived from the plan.
- budget-receipt-v1-basic.json: allocator response referencing the request.
- price-list-v1-basic.json: price list artifact with at least one priced item.

## Execution Inputs
- execution-policy-v1-basic.json: Moderator ordering policy (round_robin).
- sim-config-artifact-v1-basic.json: executable configuration referencing plan/receipt.
- initial-state-artifact-v1-basic.json: initial state referencing the sim config.

## Solver
- solver-request-v1-basic.json: solver input referencing intent/plan.
- solver-result-v1-basic.json: solver output referencing the request.

## Runtime ↔ core-as
- action-v1-basic.json: action proposal for a single actor/tick.
- observation-v1-basic.json: minimal observation view for an actor/tick.
- event-v1-basic.json: emitted event fact for a tick.
- effect-v1-basic.json: emitted effect (deterministic) for a tick.
- snapshot-v1-basic.json: minimal inspector snapshot view.
- debug-dump-v1-basic.json: debug-only full dump with warning flag.
- tick-frame-v1-basic.json: Moderator execution frame with actions/effects.

## Telemetry
- telemetry-record-v1-basic.json: annotator telemetry record (run scope).
- run-summary-v1-basic.json: end-of-run summary with metrics and references.
