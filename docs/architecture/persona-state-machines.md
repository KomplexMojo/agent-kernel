# Persona State Machines (Runtime)

Personas are modeled as deterministic finite-state machines (FSMs) with explicit transitions, guards, and serializable state for replay and inspection.

## Rules
- States are string literals; transitions are pure (no IO) and validated by guards.
- Inputs are artifacts/events; outputs are proposed actions/effects/telemetry records (data-only).
- State must be serializable (no Date.now/Math.random); inject clocks/seeds when needed.
- Transitions live near persona code and are covered by table-driven tests + fixtures.
- Adapters remain the only IO boundary; persona FSM logic does not call IO directly.
- Super FSM (tick phases) lives in `packages/runtime/src/personas/_shared/tick-state-machine.js` and exports `TickPhases`; personas subscribe to these phases.
- Tick orchestrator (`packages/runtime/src/personas/_shared/tick-orchestrator.js`) advances phases, dispatches to subscribed personas, and records history (pure; Moderator owns IO).

## Shared scaffolding expectations
- Each persona exposes: `state`, `context/view()`, `advance(event, payload)` returning { state, actions, effects, telemetry }.
- Transition tables declare `from`, `to`, `event`, `guard`, optional `onTransition` to emit data.
- Per-persona README/state machine doc enumerates allowed states and required inputs.
- Module format: persona controllers/state machines ship as `.mts` entrypoints. Use `ts-node/esm` (or a TS-aware bundling step) when executing outside the test harness; consumers should import the `.mts` path or a compiled JS wrapper.

## Drift guardrails
- Canonical surface: `controller.mts` + `state-machine.mts` + `contracts.ts`; downstream code should import controllers, not state machines, to preserve the phase-aware wrapper.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change (update docs + tests in the same change set).
- Table-driven persona fixtures guard transitions/phases; enable type-checking in CI (disable `TS_NODE_TRANSPILE_ONLY`) for persona packages to catch signature drift early.

## Persona states and subscriptions (current)
- Orchestrator: idle → planning → running/replaying → completed/errored; subscribes: observe, decide, emit.
- Director: uninitialized → intake → draft_plan → refine → ready → stale; subscribes: decide.
- Configurator: uninitialized → pending_config → configured → locked; subscribes: init, observe.
- Actor: idle → observing → deciding → proposing → cooldown; subscribes: observe, decide.
- Allocator: idle → budgeting → allocating → monitoring → rebalancing; subscribes: observe, decide.
- Annotator: idle → recording → summarizing; subscribes: emit, summarize.
- Moderator: initializing → ticking → pausing → stopping; subscribes: all tick phases.
- Solver and fact interactions: personas emit data-only `solver_request` effects (with requestId/targetAdapter) and handle `need_external_fact` fulfill/defer loops; adapters/fixtures fulfill via ports (no core-as IO).

## Tick phases and persona mapping (current)
- Tick phases (ordered): init → observe → decide → apply → emit → summarize → next_tick (wraps to observe, tick++).
- Moderator drives the tick orchestrator; personas subscribe to phases (see above).
