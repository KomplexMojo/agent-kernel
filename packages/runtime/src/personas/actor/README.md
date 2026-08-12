# Actor Persona

Actors are the foundational building blocks of the simulation.

An **actor** represents any entity that exists in the world. One concept, with clear subtypes:

- **Static actors** (walls, floors, tiles, barriers): durability only, no other vitals, typically `canMove=false`. These build rooms/layout and can optionally gain duration/mobility if you want dynamic restructuring.
- **Dynamic actors** (dungeon-controlled interactors): anything the dungeon spawns that can act—monsters and hazards.
  - Monsters: may have all vitals, one or more affinities, and multiple motivations (including movement).
  - Hazards: durability + mana; may have motivations like `attacking`/`defending` but no movement motivations; `canMove=false`.
- **Player-controlled dynamic actors** (introduced later): configured by the player and directly controlled. These will require streamed simulation playback—regenerating one step at a time based on user actions—to keep determinism and replay intact.

This document focuses on the **Actor persona** as a decision-making and behavior construct. Detailed simulation rules and physics are documented separately in the `core-ts` README.

---

## At a Glance

| Area | Actor responsibility |
| --- | --- |
| Owns | Intent selection and action proposals for actors |
| Does not own | Rule legality, state mutation, IO, or artifact persistence |
| Primary inputs | Observations, motivations, candidate actions, runtime-decision context |
| Primary outputs | Proposed actions and runtime-decision request artifacts |
| Boundary | `core-ts` remains authoritative for accepted/rejected outcomes |

## Ownership status (A1–A5)

Ownership is not "the call goes through the controller". The charter defines it as **A1–A5**
(`docs/architecture-charter.md` → *Ownership — what "belongs to a persona" means*), and **a chartered
behavior with no G1 test is not owned**. The rows below mirror
`tests/architecture/persona-authority-registry.js`, which is the single origin for that status;
`tests/architecture/persona-readme-authority.test.js` fails if this table and the registry disagree.

<!-- A1-A5-STATUS:actor -->

| Behavior | Criteria | Status | Proof |
|---|---|---|---|
| `actor/serializable-decision` — the decision is a pure function of serialized state | A4 | ✅ owned (CR.6) | `tests/architecture/persona-authority.test.js` |
| `actor/no-budget-policy` — the Actor proposes; budget admissibility is not its call | A1 | ✅ owned (CR.6) | `tests/architecture/persona-authority.test.js` |
| `actor/motivation-to-proposal` — turning motivations and an observation into proposed actions | A2 | 🔴 blocked — P5.4 | none yet; the ablation has to be built |

<!-- /A1-A5-STATUS -->

⚠️ **Read the third row carefully: the thing this persona exists for is the one that is unproven.**
The two owned rows both cover what the Actor must *not* do — hold state outside `view()`, decide
budget admissibility. Neither asks whether production could produce an action stream without it.
The runtime always supplies an Actor, so that ablation has to be built rather than observed: a
registry with a stub Actor that proposes nothing, asserting production then emits no actor actions.
Until it exists, the movement and filter tests below demonstrate routing, not authority.

## Persona Scope

The Actor persona is responsible for **deciding what to do**, not for enforcing what happens.

At a high level, the Actor persona:
- Consumes observations produced by the simulation.
- Determines intent and selects actions.
- Submits chosen actions to the simulation runner.

The simulation core (`core-ts`) remains the sole authority on legality, state transitions, and outcomes.

---

## Motivations

Dynamic actors express behavior through **stackable motivations** organised into three canonical families. Motivations within the same family are mutually exclusive; motivations from different families compose freely (e.g. `random + attacking + reflexive`). Boss status is a tier/cost outcome, not a motivation.

### Motivation Families

| Family | Kinds | Purpose |
|---|---|---|
| **Mobility** | `random`, `stationary`, `exploring`, `patrolling` | How the actor moves |
| **Posture** | `attacking`, `defending`, `stealthy`, `friendly` | How the actor engages |
| **Cognition** | `reflexive`, `goal_oriented`, `strategy_focused` | How the actor thinks |

Intelligence is represented through Cognition motivations — there is no separate parallel system for "smartness". A `reflexive` actor reacts instantly; a `strategy_focused` actor plans ahead.

Conflicting motivations within the same family are rejected (e.g. `attacking + defending`, `stealthy + friendly`, `random + patrolling`, `reflexive + goal_oriented`). Compatible cross-family combinations are allowed (e.g. `random + attacking`, `goal_oriented + stealthy`).

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

When runtime decisioning is enabled for an actor or boss, the Actor persona now constructs a `runtime-decision-v1`
envelope from live observation plus candidate-action context and emits it through the existing `solver_request`
pipeline. Solver-selected decisions are normalized back into executable `Action` records on the same runtime rail.

Live LLM-backed runtime decisions are not implicit. Default execution remains deterministic and replay-safe:
- solver-first during execution
- LLM only from pre-captured/deferred structured responses
- live local Ollama allowed only in an explicit manual non-deterministic mode

That explicit manual mode now runs on the same `solver_request` transport:
- the actor still emits a `runtime-decision-v1` request envelope
- the tick orchestrator fulfills it through the configured local LLM adapter
- the prompt/response is captured as `CapturedInputArtifact`
- the chosen action is normalized and enacted on the same runtime rail

---

## Determinism and Replay

To support deterministic replay and analysis:

- Actor decisions are treated as explicit artifacts.
- Chosen actions can be recorded independently of how they were produced.
- The same sequence of actions applied to the same simulation state will always yield the same outcome.

This allows actors driven by humans, scripts, heuristics, or AI models to be replayed and compared on equal footing.

**Every decision input arrives in the payload (CR.6).** This persona holds **no state outside its FSM**.
It used to cache the last observation, base tiles, simConfig, affinity effects and hazards in its
controller closure, and none of them appeared in `view()` — so two Actors with identical serialized state
could propose different actions, which is an A4 violation and defeats the replay guarantee above.

Practical consequence for **direct callers**: `observation` and `baseTiles` must be supplied on *every*
`advance()` that needs them, not just on the `observe` call. The runner has always done this; only
in-process callers were relying on the carry-over. A `propose` with no observation in its payload now
proposes nothing rather than deciding from a remembered one.

**Restoration is supported (PX.4 / HANDOFF-4).** Pass a JSON-round-tripped `view()` as `{ from }` when
creating an Actor persona. The shared restore boundary validates the Actor state and object context;
the G4 gate then advances the original and restored instances with the same next event and requires
identical state, actions, effects, and telemetry.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Actor state-machine
inputs/outputs belong in `packages/runtime/src/personas/actor/contracts.ts`.

Persona controllers and state machines are authored as `.js` — that is the only implementation.
Consumers import `persona.js`, the controller barrel.

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
- Canonical source: `controller.js` + `state-machine.js` + `contracts.ts`. The 1-line `.mts` re-export shims were deleted 2026-08-01; consumers import `persona.js` (the controller barrel), not the state machine.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.js`. There is no `.mts` twin (no `ts-node/esm` required).
