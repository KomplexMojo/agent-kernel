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
- sim-config-artifact-v1-mvp-grid.json: 9x9 grid layout with internal walls, spawn (1,1), and exit (7,7) plus render palette.
- initial-state-artifact-v1-mvp-actor.json: one ambulatory actor at spawn with vitals stub (hp/maxHp 10) and speed 1.
- action-sequence-v1-mvp-to-exit.json: ordered move actions (east, east, south) walking the actor from spawn to the exit.
- frame-buffer-log-v1-mvp.json: ASCII frame buffers per tick mirroring the action path, keyed by actor id and sharing the same run/config refs.
- frame-buffer-log-v1-mvp-barrier.json: ASCII frame buffer for barrier grid with base tiles and actor overlay at spawn.

## Intent + Planning
- intent-envelope-v1-basic.json: intake boundary request; used to test intent parsing.
- plan-artifact-v1-basic.json: structured plan referencing the intent.

## Build spec
- build-spec-v1-basic.json: agent-facing build spec with intent, typed hints/inputs, budget refs, and adapter capture requests.
- build-spec-v1-adapters.json: build spec with adapter capture requests using fixture-backed ipfs/blockchain/llm.
- build-spec-v1-budget-inline.json: build spec with inline budget/price list plus refs for mapping precedence tests.
- build-spec-v1-budget-inline-only.json: build spec with inline budget/price list only for CLI emission tests.
- build-spec-v1-configurator.json: build spec with configurator inputs for layout + actors.
- build-spec-v1-solver.json: build spec with solver hints referencing a fixture.

## Captured inputs
- captured-input-artifact-v1-json.json: captured adapter payload stored inline as JSON.
- captured-input-artifact-v1-ref.json: captured adapter payload stored via payloadRef path.

## Budgeting
- budget-request-v1-basic.json: allocator request derived from the plan.
- budget-receipt-v1-basic.json: allocator response referencing the request.
- price-list-v1-basic.json: price list artifact with at least one priced item.

## Execution Inputs
- execution-policy-v1-basic.json: Moderator ordering policy (round_robin).
- sim-config-artifact-v1-basic.json: executable configuration referencing plan/receipt.
- initial-state-artifact-v1-basic.json: initial state referencing the sim config.

## Configurator (Affinities + Layouts)
- affinity-presets-artifact-v1-basic.json: affinity preset catalog with kind/expression effects.
- actor-loadouts-artifact-v1-basic.json: actor loadouts referencing affinity presets and stacks.
- sim-config-artifact-v1-configurator-trap.json: grid layout with kinds and trap metadata.
- initial-state-artifact-v1-affinity-base.json: base vitals for affinity resolution before applying presets.
- initial-state-artifact-v1-configurator-affinity.json: actors seeded with affinity traits and abilities.

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
- actor-state-v1-mvp.json: canonical actor state with vitals for core-as actor model tests.
- actor-state-v1-barrier.json: barrier actor state with durability initialized for collision tests.

## Telemetry
- telemetry-record-v1-basic.json: annotator telemetry record (run scope).
- run-summary-v1-basic.json: end-of-run summary with metrics and references.
