# Persona State Machine Rollout

Goal: implement deterministic, phase-aware FSMs for all personas consistent with the Director approach.

## Baseline (Director)
- State machine: `packages/runtime/src/personas/director/state-machine.js`.
- Persona wrapper: `packages/runtime/src/personas/director/persona.js` (phase-aware, subscribes to TickPhases.DECIDE).
- Fixtures/tests: `tests/fixtures/personas/director-*.json`, `tests/personas/director-*.test.js`.

## Steps per persona (repeatable template)
1) Define state machine:
   - File: `packages/runtime/src/personas/<persona>/state-machine.js`
   - Define state enum + transition table (`from`, `event`, `to`, optional `guard`).
   - Pure/deterministic: inject clock; no Date.now/Math.random/IO.
   - Guards validate required inputs/artifacts; throw on invalid transitions.
   - `create<Persona>StateMachine({ initialState, clock })` returns `{ advance(event, payload), view() }`, where `advance` returns `{ state, context }`.
   - Context holds lastEvent, updatedAt, and persona-specific refs (e.g., intentRef/planRef); keep serializable.

2) Add persona wrapper:
   - File: `packages/runtime/src/personas/<persona>/persona.js`
   - Expose `subscribePhases`, `advance({ phase, event, tick, inputs, clock })`, `view()`.
   - Handle non-subscribed phases as no-ops; return data-only outputs (state/context snapshot, empty actions/effects/telemetry).
   - Wrap the persona’s state machine: call `fsm.advance(event, payload)` only when `phase` is subscribed; otherwise return `fsm.view()`.
   - Keep outputs serializable; inject `clock` for timestamps; no IO or randomness.
   - Include persona-specific metadata if needed (e.g., proposed actions for Actor).

3) Fixtures:
   - Phase cases: `tests/fixtures/personas/<persona>-phases-happy.json`, `*-guards.json`.
   - Transition cases as needed: `tests/fixtures/personas/<persona>-transitions-*.json`.
   - Happy cases should include `{ phase, event, payload, expectState, expectMeta? }` per row; guard cases include `{ expectError }`.
   - Keep payload minimal and deterministic; avoid timestamps/randomness in fixtures.
   - Align file names with subscriptions: if a persona ignores phases, include a no-op entry to assert state unchanged.
   - Include persona-specific expected context fields (e.g., `expectProposalCount`, `expectConfigRef`, `expectObservationCount`) when relevant.

4) Tests:
   - Phase-driven tests: `tests/personas/<persona>-persona-phase.test.js`.
   - State-machine unit tests: `tests/personas/<persona>-state-machine.test.js` (if needed).
   - Use table-driven ESM tests via `tests/helpers/esm-runner.js`.
   - Happy path: iterate phase cases, assert state/context updates, and no-ops for unsubscribed phases.
   - Guard path: assert errors for missing required inputs or invalid events; include at least one invalid transition.
   - Keep assertions deterministic (fixed clock in factories).

5) Docs:
   - Update `docs/architecture/persona-state-machines.md` with states/subscriptions once stabilized.
   - Add per-persona README/state notes if missing.
   - Expand `docs/architecture/diagram.mmd`:
     - Add a stateDiagram-v2 block per persona (Actor, Allocator, Annotator, Configurator, Orchestrator, Moderator) mirroring the FSMs.
     - Keep the tick phase FSM block; ensure arrows from TickOrch to all personas are shown.
     - Note phase subscriptions in the diagram labels or adjacent comments (e.g., Actor: observe/decide).
   

## Persona-specific notes (proposed subscriptions)
- Orchestrator: subscribe to observe/decide/emit; orchestrates workflows.
- Moderator: drives tick orchestrator; subscribe to all phases for bookkeeping.
- Actor: subscribe to observe/decide; propose actions from observations/plan.
- Allocator: subscribe to observe/decide; adjust budgets/policies.
- Annotator: subscribe to emit/summarize; record telemetry.
- Configurator: subscribe to init/observe; manage config/state readiness.

## Determinism & replay
- Inject clock/seed; forbid Date.now/Math.random in persona FSMs.
- Keep persona state serializable; record `{ tick, phase, personaStates }` via tick-orchestrator history.

## Testing guidance
- Table-driven ESM tests using `tests/helpers/esm-runner.js`.
- Assert subscribed phases mutate state; non-subscribed phases leave state unchanged.
- Guard tests for missing inputs/invalid events.
