# Implementing Tick + Persona State Machines

Objective: introduce a tick-level “super” FSM that orchestrates persona sub-states per phase, with deterministic replay and clear docs/tests.

## Steps
1) Super FSM (tick phases)
   - Add `packages/runtime/src/personas/_shared/tick-state-machine.js` with a fixed phase enum/table (init → observe → decide → apply → emit → summarize → next_tick); guard illegal transitions.
   - API: `createTickStateMachine({ initialState, clock })` returning `{ advance(event, payload), view() }`; `advance` returns `{ state, context, phase, tick }` with no IO or randomness (clock injected).
   - Context should hold `tick`, `phase`, `lastEvent`, `updatedAt`, and optional `notes` for inspect/debug; keep everything serializable.
   - Add table-driven unit tests using fixtures under `tests/fixtures/personas/tick-fsm-*.json`:
     - Happy path: valid event sequence produces expected phases/ticks.
     - Guard path: invalid event for current phase throws/returns error marker.
   - Provide a minimal helper to reset/start a new tick (e.g., `advance("next_tick")` increments `tick` and returns to `observe`).
   - Document deterministic requirements (no Date.now/Math.random; clock injected) and exported phase list for persona subscriptions.

2) Persona phase registration
   - Extend persona contracts to accept `{ event, phase, tick, inputs, clock }` and return `{ state, context, actions, effects, telemetry }` (data-only).
   - Add `subscribePhases` metadata per persona (start with Director, then Actor/Annotator) so the tick orchestrator can route events.
   - Update Director FSM wrapper to honor phase events (e.g., `decide` triggers plan refinement; other phases are no-ops) and keep it pure/deterministic.
   - Add table-driven tests per persona to confirm:
     - Events for subscribed phases are handled and update state as expected.
     - Events for non-subscribed phases are ignored (state unchanged).
     - Guard errors still surface when required inputs (intent/plan) are missing.
   - Add fixtures under `tests/fixtures/personas/<persona>-phases-*.json` to drive phase/event tables.

3) Tick orchestrator
   - Create `packages/runtime/src/personas/_shared/tick-orchestrator.js`:
     - Holds `tickPhase` (via tick FSM) + `personaStates` map.
     - `registerPersona(name, persona)` with `persona.subscribePhases`.
     - `stepPhase(event, payload)`:
       - Advance tick FSM.
       - For current phase, call `advance({ phase, event, tick, inputs, clock })` on subscribed personas.
       - Collect `{ actions, effects, telemetry, personaViews }`.
     - Expose `view()` with current `tickPhase`, `tick`, and `personaStates`.
   - Action application hook:
     - Provide a hook (callback) for Moderator/runtime to apply actions emitted by personas; keep orchestrator pure (no direct IO).
     - Record accepted actions/effects per tick for inspect/replay.
   - Integration tests + fixtures under `tests/fixtures/personas/tick-orchestrator-*.json`:
     - Drive a phase sequence with dummy personas (e.g., stub persona returning actions on decide).
     - Assert persona state progression, action collection, and tick phase advancement.
     - Include guard test for calling `stepPhase` with an invalid event.
   - Determinism: inject clock; no Date.now/Math.random; persona state snapshots must be serializable.

4) Replay/inspect support
   - Persist `{ tick, phase, personaStates, actions, effects, telemetry }` per phase (or per tick) for replay; ensure determinism (inject clock, no Date.now/Math.random).
   - Add inspect helpers to summarize persona states per tick (e.g., counts of phases, state changes, deferred actions).
   - Fixtures under `tests/fixtures/personas/tick-inspect-*.json` to drive inspect tests; include sample personaStates and expected summary.
   - Update `packages/runtime/src/personas/_shared/tick-orchestrator.js` (or a sibling helper) with a pure `summarizeTick(history)` that returns a serializable report.
   - Integration tests to assert replay can consume persisted `{ tick, phase, personaStates }` and reproduce the same progression.

5) Documentation
   - Update `docs/architecture/persona-state-machines.md` to describe the super FSM + phase-to-persona mapping.
   - Update `docs/architecture/diagram.mmd` to show tick FSM driving persona FSMs.
   
6) Optional hardening
   - Add guard/error reporting for invalid phase transitions.
   - Provide debug flag to log state transitions (off by default).
