# Actor Persona

## Unified rewrite status — September 14

The active implementation reads one actor registry: alignment governs hostility,
capabilities govern movement/exit/casting, and terminal actors stop deciding.
Movement actions contain `params.target`; focused casts contain `params.targetId`, and casts at a tile (#413) contain `params.target`.
Only active push/pull equipment supplies focused casting and its range. Cast
ranking reads shared actor mana. Ordinary walls and floors remain terrain.
When other actors plug every route to the exit (wardens seated around it), the
exit walk follows the terrain route as far as it is free instead of waiting, so
the actor closes in on whoever holds the way.

Runtime observations now project independent movement and sight grids, active
fields, and live actor records from core. Observing applies no field effects.
The Actor suite passes including production movement and the Actor ablation.

Each motivation contributes proposals without vetoing other motivations;
`canMove: false` filters movement across the union. Solver objective rows evaluate
every authored motivation and retain the greatest complete nine-member tuple
for each candidate, preserving the features that produced it.

Deterministic execution ranks the deduplicated proposals with that same objective,
emits one winning action per actor, and reports its intention from the winning row.
Equal evaluations retain input order. Solver candidate expansion remains specific
to the solver request path.

Field scoring now consumes unified projected cells through core's receiver forecast.
It uses the active pair, common vital routing, actual vital capacity, and terminal
defeat. The forecast is local to this receiver and uses residual source stacks as
a conservative budget; it does not predict competing receivers. Observations retain
pre-cancellation contributions for visible cells, including unseen emitters.
Field-driven equip candidates replace the actor's contribution and reuse core's
opposition projection. Equipment comparison uses focused-cast readiness, then field
safety and benefit, in existing tuple order. Readiness uses the ordinary nearest
hostile proposal and motivation intent classifier. Only strict improvement over
the current pair creates a candidate; ties retain equipment. Equip competes in the common
tuple as a stationary action, and core consumes the turn when it is accepted.
Taking candidates enumerate unclaimed holdings on the sources core keeps open (`actorHoldingsOpen`:
a defeated actor, or an intact one that cannot move, #435) in the same
or an adjacent cell for living actors with `canTake`. They use the stationary
intent class and existing tuple. Source and holding IDs determine stable ordering;
solver candidate IDs distinguish separate holdings. Core owns atomic claims,
one-stack affinity rewards and authored vital grants. Newly acquired pairs remain
unequipped. Defeated/exited sources are excluded from combat targeting, and solver
observations retain lifecycle and holding claims.
Focused readiness includes range, casting capability, combat motivation and live
hostility. It preserves existing cast evaluation; it is not a new damage-efficiency
or mana-cost optimizer. Core still decides cast affordability and effect outcomes.
The subtype, role, and independent-grant descriptions below are historical
material awaiting replacement as those paths are removed; they are superseded by
the approved unified-actor Prompt.md and this status for the changed paths.

Actors are the foundational building blocks of the simulation.

An **actor** represents any entity that exists in the world. One concept, with clear subtypes:

- **Static actors** (walls, floors, tiles, barriers): durability only, no other vitals, typically `canMove=false`. These build rooms/layout and can optionally gain duration/mobility if you want dynamic restructuring.
- **Dynamic actors** (dungeon-controlled interactors): anything the dungeon spawns that can act—monsters and hazards.
  - Monsters: may have all vitals, one or more affinities, and multiple motivations (including movement).
  - Hazards: durability + mana; may have motivations like `attacking`/`defending` but no movement motivations; `canMove=false`.
- **Player-controlled dynamic actors**: directly controlled, one tick at a time. The runner routes a command to one actor with `runtime.step({ actorCommands: { [actorId]: command } })`; every other actor decides normally in the same tick. See *Commanded actors* below.

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
| **Mobility** | `random`, `stationary`, `exploring`, `patrolling`, `escorting` | How the actor moves |
| **Posture** | `attacking`, `defending`, `stealthy`, `friendly` | How the actor engages |
| **Cognition** | `reflexive`, `goal_oriented`, `strategy_focused` | How the actor thinks |

`escorting` (#251) keeps near one ally: the one named in `initialState.escorts`, else the playable delver (the first `user_controlled` actor). It runs the `follow` goal on that ally whatever the actor's thinking, before motivations are asked: further than its distance (default 2 tiles, `ESCORT_DEFAULT_DISTANCE`) it steps toward the ally; within it, it holds, and any other motivation's moves are kept within reach. Out of sight it walks to where it last saw the ally; with no ally, or the ally gone, the turn goes to its other motivations. Its affinities play no part. Bare sight in an unlit level is one tile, so an escort keeps sight of an ally further off only where the ally stands in light.

**Yielding in a crowd (#457).** The Actor keeps, per actor, where it last proposed a move from (`context.moves`). If the actor still stands there next turn, core refused the move (another actor took the cell first); on a seeded coin (`deterministicRandom`, salt 457) it waits this turn instead of trying again, so a crowd sorts itself out and two actors yielding to each other don't fall in step. A commanded actor never yields.

Intelligence is represented through Cognition motivations — there is no separate parallel system for "smartness". They change play with or without a strategy (#308):

- `reflexive` reacts to what touches it this tick. Standing in a field that harms it, it steps to the adjacent free cell that harms it least, or holds when no step is better; unharmed, it plays its other motivations.
- `goal_oriented` with no order or strategy adopts a goal from its other motivations (`attacking` with a hostile in sight: defeat the nearest; `exploring`: reach the exit) and follows it as a planned route until it is done or stalled, then adopts again.
- `strategy_focused` adopts the same way but re-plans every turn, so it switches goal when the situation changes (an explorer that spots a hostile while attacking turns on it).
- With nothing to adopt, or as a `user_controlled` actor, it plays its motivations as before. The adopted goal is kept per actor in `context.cognition[actorId]` (`{ adopted, goal, status, ... }`), apart from `context.strategies`, which holds only what was ordered or authored.

With a strategy, cognition sets how much of it the actor follows (see *Strategies* below).

Motivations are plain members of a stack: there is no motivation intensity (#309). An `intensity` (or `stacks`) on an older motivation entry still loads and is ignored by validation, evaluation, proposals and pricing alike.

Posture kinds that move differ from `exploring` (#311). `stealthy` takes, of the steps on a shortest route to the exit, the one furthest from the nearest hostile, then the one with the most wall within two tiles. `friendly` keeps with its side: an ally in sight further than two tiles (`FRIENDLY_REACH`) is gone back to first, otherwise it takes the exit step that keeps within reach of that ally and waits when none does; with no ally in sight it walks like `exploring`. `friendly` is also what makes an actor a **companion**: only a `friendly` actor on the seated actor's side takes orders in a play session (party members, authored `user_controlled`, take them anyway). Allegiance is one rule, `alignmentsAreAllied` in `proposal-helpers.js`, used by proposals and the decision rows alike.

**Ambushers are `defending` actors (#399).** `defending` holds position and casts at a hostile that is in its observation and in reach; observation is sight-scoped by core, so a guard the ambush tactic (#398) hides from a room's doorways waits unseen and strikes once a delver comes into sight. `stationary` alone has no combat role and never casts, by design; `attacking` pursues, so `stationary + attacking` does not hold still. `tests/personas/actor/actor-ambusher-holds.test.js` pins this for every kind; a guard whose only kind restores holds still too (a support role).

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

Each actor receives its own perception-scoped observation. Levels are unlit: core starts with a sight radius
of one tile, extended by the stacks of the actor's own light that survive at its tile. Which kinds light a cell and
which hide one are columns of the affinity table (`illuminates`: fire and light; `conceals`: dark; #416), and sight
reads those columns; below, "light" means any illuminating kind and "dark" any concealing one. Light and dark come from
the affinity field, the same projection every vital effect and floor shading read (#288): per cell the field
cancels the strongest emitted light against the strongest emitted dark, stack for stack, so more light and the cell
is lit, seen from any distance; more dark and the cell, and anyone in it, is hidden beyond one tile; a tie is
neither. An emit of s stacks reaches s tiles. Dark from other sources that still survives on the actor's own tile
by two or more stacks, with its own dark left out, blinds it: it sees only its own tile, plus lit cells in line of
sight (#284); an actor's own dark never blinds it, and never hides a cell from it either: each actor sees the field
re-resolved without its own dark, while everyone else sees that dark (#409). Light and dark switch on and off like every lasting affinity:
full strength while on, dark once a drained source switches off until its mana is full again (and stays off while its upkeep exceeds max mana, #441). Core then applies deterministic line of sight: walls and barriers block actors and hazards behind
them, including diagonal corner peeking. Seeing an actor is not knowing it: a `reveals` kind (light) on its cell, net of
concealing intensity there, reveals its properties up to that intensity (`readActorRegistryRevealLevels`); the observer's
own dark is left out. At level 0 only its glyph, colour and role show (#416). The shared world snapshot is
never mutated, and resources remain absent because actor observations do not currently expose them.

When runtime decisioning is enabled for an actor or boss, the Actor persona now constructs a `runtime-decision-v1`
envelope from live observation plus candidate-action context and emits it through the existing `solver_request`
pipeline. Solver-selected decisions are normalized back into executable `Action` records on the same runtime rail.

The envelope's self actor and `visibleActors` carry the same detached mechanical
fields: stable ID, live alignment, position, lifecycle, defeat vital, optional
vitals, capabilities, motivations, owned affinities, active key and holdings.
`hostile` on visible actors is Actor's ruling from live alignment and lifecycle;
terminal remnants remain inspectable but are not combat targets. Configured
alignment cannot override observed alignment.

Actor does not emit category `kind`, `affinityGrants`, or a separate `hazards`
collection. All owned pairs share the actor's mana vital, which supplies the
cast-reserve tuple member. Distinct UI categories remain presentation concerns.
The shared envelope reader now projects the same live mechanical keys, keeps
`motivationProfile` and `hostile`, and drops injected hazards plus grant aliases
before adapters see the payload. Solver adapters still rank opaque tuples only.

The self-actor's `motivationProfile` exposes AM.9's core-derived mobility, combat, and cognition tiers together
with its reasoning class and default flag mask. Human-readable reasoning and flag names are derived directly from
core's enums, so the runtime does not maintain a competing vocabulary. An unknown motivation kind omits the
profile but still receives an Actor-authored compatibility objective. That tuple preserves the former deterministic
focused-cast, hostile-progress, exit-progress, fallback-move, and wait ordering without asking an adapter to infer policy.

For known profiles, the `objectives.actorDecision` contract carries one Actor-authored nine-integer rank
per candidate, ordered by intent class, target finish, **cover alignment, stealth alignment**, field safety, field
benefit, cast reserve, **actor proposal**, then input order.

v4 demoted `actorProposal` from an intent class of 600 to that second-to-last tiebreak, and it is the change that
made every other member of this tuple matter. A candidate matching the Actor's own deterministic proposal used to
outrank every alternative outright: measured over 3,942 decision steps that was 100% of them, and in 495 of the 498
steps that walked into harm a harm-free candidate had been ranked and lost to the stamp. The ranking was computed,
validated, carried across the solver port, sorted, and discarded. Demoting it cut suboptimal decisions from 46.3%
to 16.0% of a 936-board sweep with no new failure to reach the exit. The preference is kept rather than deleted because an Actor's own
suggestion is real information, and a genuine tie through all eight preceding members is better settled in the
Actor's favour than by raw input order. ⚠️ An earlier version of this paragraph justified it instead by claiming
deletion would drop an out-of-range cast to intent class 0; that was false — `intentClass` never reads
`actorProposal`, so such a cast lands at 0 either way — and adversarial review caught it.

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

Field scoring calls core's `previewActorFieldChanges` with the cells at the
candidate destination (or current cell for non-moves). This forecasts a detached
receiver using the same damage/restore/drain routing and vital mutation primitive
as execution. Each harmful kind hits its own vital first (see `docs/affinity-table.md`) and
spills the rest into the receiver's defeat vital (#353). Only active equipment supplies protection or draw absorption.
Owned inactive alternatives confer neither. Matching draw credits mana up to its
capacity; it never heals health. Missing vitals produce no changes, and terminal
defeat stops subsequent changes. Field inputs no longer carry legacy `vitalEffects`.

The forecast follows stable source-ID order, bounds each source by its observed
residual stacks, and prevents repeated source credit. This is a receiver-local
estimate before other receivers compete for exposure, not a full future tick.
Equipment candidates reproject from observed contributions, replacing only the
actor's own source. This preserves unseen emitters and reveals contributions that
the previous equipment canceled. Harm and benefit remain tuple members after
intent and alignment. Focused readiness can also propose equipment in a field-free
room when an owned alternative brings the ordinary target into range.
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

## Commanded actors

A `propose` payload may carry `command`, the decision of whoever controls that actor (a player, a
script). The command vocabulary is this persona's (`ACTOR_COMMAND_KINDS`):

- `{ kind: "move", params: { direction, sprint? } }` with an eight-way direction name; `sprint: true`
  proposes two steps that way (`params: { target, via }`), which core checks and prices as a sprint (#437)
- `{ kind: "wait" }`
- `{ kind: "equip_affinity", params: { affinityKey, replaceKey?, stacks? } }` with `"<kind>:<expression>"` keys;
  `replaceKey` names the equipped slot to swap out, otherwise core fills a free slot or replaces the oldest;
  `stacks` (a positive integer) runs it below what is held, and re-equipping an equipped key re-levels it.
  The Actor reads a slot's running level (`equippedAffinityStacks`) when it judges cast reach
- `{ kind: "unequip_affinity", params: { affinityKey } }`
- `{ kind: "cast_affinity", params: { targetId, affinityKey? } }`; `affinityKey` names the equipped slot,
  otherwise core casts the first equipped push or pull. On its own turns the Actor proposes a cast
  only from a slot that reaches the target and whose price (the authored `castManaBase` on core's
  `actorCastManaPrice` curve) the actor's mana covers, so it never wastes a turn on a refused cast (#367)
- `{ kind: "cast_affinity", params: { target: { x, y }, affinityKey? } }` at a tile (#413, #461): it travels
  the line sight uses and hits the first actor on it or stops at a wall; a push that meets nobody leaves
  core's one-turn field (`castTrails`) on its path. `{ kind: "raise_barrier", params: { target: { x, y },
  affinityKey? } }` (#460) is how a push raises a line of barriers of its kind into empty tiles. The
  Actor never proposes one on its own turns. Pathing treats a raised barrier (movement kind 2 in the
  observation, core's `RAISED_BARRIER_TILE_KIND`) as temporary: `findPath` goes round it when it can and
  through it only when there is no other way, so the actor waits at it rather than giving up; its owner's
  scoped observation shows it open, since the owner walks through
- `{ kind: "take", params: { targetId, holdingId } }`
- `{ kind: "watch", params: { targetId } }` (#519): keep watching that actor for 1 mana a turn, or stop; core charges it

Only the shape is checked. Anything else throws, so a controlled actor never falls back to autonomous
play by accident.

- The command becomes the actor's **only** proposal. Motivations are not consulted and the actor is
  not posed to the solver, even with runtime decisioning enabled — the decision has already been made.
  (`payload.proposals` is different: under runtime decisioning it only feeds the `actorProposal` tiebreak.)
- A move's `from`/`to` are filled from the actor's observed position. The Actor does **not** check
  legality: a move into a wall is proposed and core rejects it. Likewise an equip of an unknown
  affinity, a cast out of range or without mana, or a take with nothing to claim is proposed, and core
  rejects it with a ValidationError name the play session reports.
- The actor still surfaces an intention, so the Moderator orders it among the others as usual.

The runner only routes `actorCommands` to the named actor's payload (an unknown id throws); it does not
interpret them; it does call this persona's exported `normalizeActorCommand` first, so a malformed command
is refused before the tick starts. `runner/play-session.js` wraps this into `act` / `view` / `status` for a
playable UI.
Proof: `tests/personas/actor/actor-player-command.test.js`, `tests/runtime/runtime-actor-commands.test.js`.

## Strategies (Phase 2b)

A strategy is standing orders an actor follows on its own turns: an ordered list of **goals**
and, optionally, conditional **tactics**. The vocabulary is this persona's (`strategy.js`,
checked by the exported `normalizeActorStrategy`), like the command vocabulary.

| Goal | Does | Finishes |
|---|---|---|
| `reach {place}` | walks to `{x,y}`, or onto the exit and waits there until it leaves | on arrival; for the exit, on the turn it leaves |
| `defeat {target}` | closes in and casts | when the target is defeated |
| `take {target}` | defeats it first unless core already lets it be taken (an intact resource, #435), then takes each unclaimed holding | when nothing is left |
| `guard {target, radius=2}` | engages hostiles near the target, else stays within `radius` | never |
| `follow {target, distance=1}` | stays within `distance`; its motivations play inside that. Out of sight, it walks to where it last saw the target | never |
| `lead {target, place="exit", distance=3}` | walks to the place, waiting for an ally that falls behind. An ally out of sight gets one turn to catch up, then the leader goes back toward where it last saw it | on arrival; for the exit, on the turn it leaves |
| `hold {place, ticks}` | goes there and stays `ticks` ticks | after the ticks |
| `survive {distance=3}` | steps away from a hostile that close | never |

Tactics are `{ when, do }`, checked before goals each turn, first match wins. `when` is
`{vital, below}` (percent), `{hostileWithin}`, `{defeated}` or `{tickAtLeast}`; `do` is a command,
`{ kind: "retreat" }`, or a cast at `"nearest_hostile"`.

**How deep an actor follows is its thinking motivation** (`actorStrategyDepth`): none or
`reflexive` ignores the strategy, `goal_oriented` follows the goals, `strategy_focused` and
`user_controlled` (on turns it is not commanded) follow the goals and the tactics. What an actor
does not follow is ignored and reported (`actorStrategyIgnoredParts`), never refused.

**Sight bounds it.** A goal whose target the actor cannot see is `searching` and hands the turn to
its motivations (a `follow` that saw its target first walks to the last-seen spot instead); one that cannot be met is `stalled` with a reason (`unknown_target`, `no_route`,
`target_gone`). Strategy proposals replace the motivated candidates for that turn; the decision
tuple still picks among them, and core still judges legality.

**Where it lives.** A level's strategies are `InitialState.strategies`, keyed by actor id (core
owns every actor-record field, so they sit beside the roster). A mid-game order arrives as
`runtime.step({ actorStrategies: { [actorId]: strategy } })` and is kept in this persona's
context. Progress, per actor, is `context.strategies[actorId]`: `{ goal, status, reason?,
heldSince?, tactic?, ignored?, order? }`. The decision stays a pure function of (FSM view,
event, payload).
Proof: `tests/personas/actor/actor-strategy.test.js`, `tests/runtime/play-session-orders.test.js`.

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
