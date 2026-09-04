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
| `actor/motivation-to-proposal` — turning motivations and an observation into proposed actions | A2 | ✅ owned (P5.4) | `tests/personas/actor/actor-proposes-or-nothing-does.test.js` |
| `actor/runtime-decisioning` — solver/LLM-routed proposals: posing and resolving a runtime-decision problem | A2 | ✅ owned (THE NINE, 2026-08-18) | `tests/architecture/actor-runtime-decisioning-authority.test.js` |

<!-- /A1-A5-STATUS -->

⚠️ **The third row is the one the persona exists for, and it was the last to get a proof.** The
other two cover what the Actor must *not* do — hold state outside `view()`, decide budget
admissibility. Neither asks whether production could produce an action stream without it, and the
movement and filter tests below cannot: they drive the persona and check its output, which
demonstrates the function works.

P5.4 answered it with an **ablation**: two runs of the same fixture through the same registry,
differing only in whether the Actor proposes anything. The control emits three `move` actions across
three ticks; the neutered run emits **none**, so nothing else in the tick makes up the difference.
Both runs use the same registry shape on purpose — a caller-supplied persona registry replaces the
defaults, so building one from defaults and one by hand would have varied two things at once.

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

Each actor receives its own perception-scoped observation. Core starts with the actor's light/dark-adjusted
sight radius, then applies deterministic line of sight: walls and barriers block actors and hazards behind
them, including diagonal corner peeking. Surviving dark at a target conceals that target beyond one tile;
light affects concealment only through core's existing light/dark cancellation. The shared world snapshot is
never mutated, and resources remain absent because actor observations do not currently expose them.

When runtime decisioning is enabled for an actor or boss, the Actor persona now constructs a `runtime-decision-v1`
envelope from live observation plus candidate-action context and emits it through the existing `solver_request`
pipeline. Solver-selected decisions are normalized back into executable `Action` records on the same runtime rail.

Each entry in the envelope's `visibleActors` carries a boolean `hostile`, which is **this persona's ruling and not a
raw fact about the other actor**: delvers ally with delvers, wardens with wardens, and an unknown role is always
hostile. Solvers and other consumers must read that field rather than compare `role` themselves — allegiance has one
authority here, and a consumer that re-derives it is free to disagree with the deterministic path. Absent means
hostile, so an envelope built before this field existed keeps its previous behavior instead of quietly pacifying.

The envelope's self-actor also carries two separate affinity views. `affinities` is the configured
ability list used to express candidate casts. `affinityGrants` is the live resource-grant list read from core,
including each grant's independent `stacks`, `mana`, `manaMax`, and `manaRegen` pool. Both are copied at the
boundary so a solver request cannot alias mutable observation state. Z6.1 uses the matching live grant, or the
actor mana pool when no grant matches, to author a cast-reserve tie-break. This describes scarcity only: the
Configurator still owns cast cost and the runner still owns affordability enforcement.

The self-actor's `motivationProfile` exposes AM.9's core-derived mobility, combat, and cognition tiers together
with its reasoning class and default flag mask. Human-readable reasoning and flag names are derived directly from
core's enums, so the runtime does not maintain a competing vocabulary. An unknown motivation kind omits the
profile but still receives an Actor-authored compatibility objective. That tuple preserves the former deterministic
attack, hostile-progress, exit-progress, fallback-move, and wait ordering without asking an adapter to infer policy.

For known profiles, the `objectives.actorDecision` contract carries one Actor-authored eight-integer rank
per candidate, ordered by intent class, target finish, **cover alignment, stealth alignment**, field safety, field
benefit, cast reserve, then input order.

Stage B (contract v3) split the former single `profileAlignment` member in two. v2 summed them — cover a flat 1000,
stealth 1000 x a distance delta — so `1000 + 0` and `0 + 1000` were the same number and a lexicographic sort could
not tell a sheltering actor from a retreating one. Separate members also removed the scaling constants, which existed
only to stop one signal swamping the other inside a shared slot. Cover precedes stealth deliberately: cover pays off
this tick, a stealth gain pays off next tick — revisit that ordering when there is a next tick to reason about.
Cover is now a **count** of adjacent opaque cells rather than a boolean, so a corner outranks a single wall; it used
to be true for any one neighbour, which meant "prefers cover" could not prefer better cover. `cognitionTier` and
`reasoningClass` remain diagnostic and deliberately hold no rank slot: they describe planning depth, and a one-step
choice gives them nothing to modulate. A move evaluates the perceived canonical post-cancellation affinity field at its destination;
every other action evaluates the current cell. Harm is penalized before beneficial effects, and a benefit is capped
at its matching vital's missing capacity.

Field exposure is resolved **against the observing actor**, not per tile. Core's field readers report one effect per
tile, so before Stage A an actor's own element was exactly as lethal to it as anyone else's. The Actor now matches the
field's kind against its live `affinityGrants` — preferring a grant of the field's own kind over one of its opposite,
since immunity is the more specific claim — and asks core's `resolveExposureVitalEffect` to modulate the field's own
number. The relationship rule is derived from the 48-cell interaction matrix rather than restated here. A neutral
relationship deliberately keeps the previous effect: the matrix answers what happens when two affinities *meet*, and
for unrelated kinds that is correctly nothing, but exposure is not interaction — a corrode field still corrodes an
actor that has no relationship to it. An actor with no grants observes no change at all.

Resolution returns a **set of vital deltas**, not one number, because the matrix contains genuine cross-vital
outcomes. A `draw`-expression actor standing in a same-kind field converts it into mana rather than taking the hit:
the harmed vital is spared and mana rises by the same magnitude, capped like any benefit at that vital's missing
capacity — so an actor with no mana vital, or none missing, ranks no benefit from the conversion. The distinction is
per **expression**, not per kind: a same-kind `emit` actor is immune but gains nothing, while only `draw` converts.
Light and Dark already target mana, so for those the conversion lands on the same vital and simply reverses its sign. These remain tie-breakers after intent, target, and profile alignment.
Mobility/combat tiers and `PrefersCover`/`PrefersStealth` affect those ranks; cognition and reasoning remain
diagnostic because this is a one-step choice, while `AggroRangeBoost` remains perception/candidate policy. The
shared envelope code validates row identity and deep-copies the contract but does not interpret the ranks. The CLI
and web Actor lexicographic adapters validate and compare the tuples without re-deriving their meaning, accepting
valid v1 envelopes for compatibility. The old `createRealZ3SolverAdapter` factory and `AK_SOLVER_ENGINE=z3-real`
selector remain compatibility aliases; `z3-real` now names the default engine rather than enabling it, and neither
initializes Z3 on this path. Measured over 819 candidate/rank permutations, this adapter's selection diverges from a
plain lexicographic sort on 0.0% of them and initializes Z3 zero times — the domain performs no search. Missing or malformed objectives defer with typed
reasons; runtime then follows its deterministic Actor fallback. Old envelopes remain readable but adapters do not
manufacture ranked diagnostics.

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
