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

## Initial persona state sets (proposed)
- Orchestrator: idle → planning → running → replaying → completed/errored.
- Director: uninitialized → intake → draft_plan → refine → ready → stale.
- Configurator: uninitialized → pending_config → configured → locked.
- Actor: idle → observing → deciding → proposing → cooldown.
- Allocator: idle → budgeting → allocating → monitoring → rebalancing.
- Annotator: idle → recording → summarizing.
- Moderator: initializing → ticking → pausing → stopping.

## Tick phases and persona mapping (current)
- Tick phases (ordered): init → observe → decide → apply → emit → summarize → next_tick (wraps to observe, tick++).
- Moderator drives the tick orchestrator; personas subscribe to phases.
- Subscriptions:
  - Director: decide (ignored on other phases).
  - Others: pending (wire as personas become phase-aware).
