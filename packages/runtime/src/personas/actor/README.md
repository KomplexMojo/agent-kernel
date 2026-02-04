# Actor Persona

Actors are the foundational building blocks of the simulation.

An **actor** represents any entity that exists in the world. One concept, with clear subtypes:

- **Static actors** (walls, floors, tiles, barriers): durability only, no other vitals, typically `canMove=false`. These build rooms/layout and can optionally gain duration/mobility if you want dynamic restructuring.
- **Dynamic actors** (dungeon-controlled interactors): anything the dungeon spawns that can act—monsters and traps.
  - Monsters: may have all vitals, one or more affinities, and multiple motivations (including movement).
  - Traps: durability + mana; may have motivations like `attacking`/`defending` but no movement motivations; `canMove=false`.
- **Player-controlled dynamic actors** (introduced later): configured by the player and directly controlled. These will require streamed simulation playback—regenerating one step at a time based on user actions—to keep determinism and replay intact.

This document focuses on the **Actor persona** as a decision-making and behavior construct. Detailed simulation rules and physics are documented separately in the `core-as` README.

---

## Persona Scope

The Actor persona is responsible for **deciding what to do**, not for enforcing what happens.

At a high level, the Actor persona:
- Consumes observations produced by the simulation.
- Determines intent and selects actions.
- Submits chosen actions to the simulation runner.

The simulation core (`core-as`) remains the sole authority on legality, state transitions, and outcomes.

---

## Motivations

Dynamic actors express behavior through **stackable motivations**. Motivations are atomic (e.g., `random`, `stationary`, `exploring`, `attacking`, `defending`, `patrolling`) and can be combined (e.g., `stationary_attacking`). Boss status is a tier/cost outcome, not a motivation.

Motivations are:
- Ordered and composable.
- Evaluated outside the simulation core.
- Explicit and inspectable, enabling debugging and experimentation.

---

## Decision-Making Model

The Actor persona follows a simple loop:

1. Receive an observation.
2. Evaluate active motivations.
3. Resolve motivations into a proposed action.
4. Submit the action to the simulation runner.

How motivations are resolved (priority, scoring, veto, etc.) is an implementation detail of the Actor persona and may evolve over time.

---

## Determinism and Replay

To support deterministic replay and analysis:

- Actor decisions are treated as explicit artifacts.
- Chosen actions can be recorded independently of how they were produced.
- The same sequence of actions applied to the same simulation state will always yield the same outcome.

This allows actors driven by humans, scripts, heuristics, or AI models to be replayed and compared on equal footing.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Actor state-machine
inputs/outputs belong in `packages/runtime/src/personas/actor/contracts.ts`.

Persona controllers/state machines are authored as `.mts` sources, with `.js` runtime entrypoints
checked in for consumers. Use the `.js` entrypoints directly (no `ts-node/esm` required).

This separation ensures that:

- Actor behavior can evolve rapidly without destabilizing the simulation core.
- Advanced decision-making (including AI-driven policies) can be introduced without violating architectural boundaries.
- The Actor persona remains focused on **intent and choice**, not simulation mechanics.

Actors are therefore modeled as **decision-makers layered on top of a deterministic simulation**, with responsibilities placed deliberately to support long-term evolution and experimentation.

## State machine & phases
- States: idle → observing → deciding → proposing → cooldown.
- Subscribed tick phases: observe, decide (ignores others).
- Outputs: proposed actions only (data); no IO or simulation mutation.

## Drift guardrails
- Canonical source: `controller.mts` + `state-machine.mts` + `contracts.ts`; runtime entrypoints are `.js`. Import controllers (not state machines) from consumers.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.js`; `.mts` sources remain for TS-aware tooling (no `ts-node/esm` required).
