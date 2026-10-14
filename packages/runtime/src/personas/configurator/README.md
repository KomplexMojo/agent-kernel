# Configurator Persona

The Configurator is the **simulation configuration and composition persona**.

It is responsible for translating high-level plans into **concrete, executable simulation configurations**. The Configurator turns intent into structure by setting parameters, assembling layouts, and enabling or disabling features required for a run.

This document defines the Configurator as a **runtime composition and validation role**. Simulation rules, legality, and state transitions remain the responsibility of the simulation core (`core-ts`).

---

## At a Glance

| Area | Configurator responsibility |
| --- | --- |
| Owns | Building coherent executable configuration artifacts |
| Does not own | Runtime conflict resolution, tick execution, or simulation rule outcomes |
| Primary inputs | Director plans, level-gen inputs, actor payloads, budget receipts |
| Primary outputs | `SimConfigArtifact`, `InitialStateArtifact`, resource bundles, `ConfigurationCandidate`s for the Allocator to price |
| Boundary | Prepares startup state; `core-ts` enforces rules after execution begins |

## Ownership status (A1–A5)

Ownership is not "the call goes through the controller". The charter defines it as **A1–A5**
(`docs/architecture-charter.md` → *Ownership — what "belongs to a persona" means*), and **a chartered
behavior with no G1 test is not owned**. The rows below mirror
`tests/architecture/persona-authority-registry.js`, which is the single origin for that status;
`tests/architecture/persona-readme-authority.test.js` fails if this table and the registry disagree.

<!-- A1-A5-STATUS:configurator -->

| Behavior | Criteria | Status | Proof |
|---|---|---|---|
| `configurator/validate-lock@build` — assembles, validates and locks configurations, BUILD plane | A2, A3 | ✅ owned (CR.2) | `tests/architecture/persona-authority.test.js` |
| `configurator/validate-lock@tick` — the same sentence on the TICK plane | A3 | ✅ owned (PX.5) | `tests/personas/dual-surface-shadowing.test.js` |
| `configurator/locked-config-is-the-input` — the config a build consumes is the one that was locked, unedited afterwards | A5 | ✅ owned (PX.6) | `tests/runtime/build-locked-input-immutability.test.js` |
| `configurator/feasibility-verdict` — layout feasibility is its verdict; the Director derives the geometry judged | A1, A2 | ✅ owned (CR.4 M5b.2f) | `tests/personas/orchestrator/orchestrator-llm-budget-loop.test.js` |
| `configurator/input-preparation` — grid sizing, hazard placement and resource mapping run behind the CONFIG-plane surface | A3 | ✅ owned (P2.2 / P2.3.1) | `tests/personas/configurator/configurator-input-prep.test.js` |
| `configurator/cards` — card configuration: assembling and validating candidate delver/room cards | A2 | ✅ owned (THE NINE, 2026-08-18) | `tests/architecture/configurator-cards-authority.test.js` |
| `configurator/actors` — actor configuration: defaulting, enum validation and assembly of a build/run request's delver roster entry | A2 | ✅ owned (2026-08-18) | `tests/architecture/configurator-actors-authority.test.js` |

<!-- /A1-A5-STATUS -->

⚠️ **One charter sentence, two ownership answers — which is why the first two rows exist separately.**
Validate/lock is genuinely owned on the build plane and was label-only on the tick plane, because
`advance()` reached the FSM without going through the service surface. PX.5 settled it by removing
the events rather than by implementing them twice: configuration is build-plane work, and the tick
plane consumes an already-built `SimConfig`.

`configurator/validate-lock@build` is the differential this project's G1 mechanism was proven on —
production and the standalone persona are handed the same config and their **verdicts** must agree,
which a façade cannot satisfy by producing identical output.

## Persona Scope

The Configurator persona is responsible for **deciding how a simulation is set up**, not for enforcing what happens once it runs.

At a high level, the Configurator:
- Consumes structured plans produced by the Director.
- Produces a fully specified simulation configuration.
- Ensures configurations are internally consistent before execution.
- Hands validated configuration artifacts to the runtime runner.

> **The Configurator does NOT author spend proposals** (corrected 2026-08-04, CR.9 M1). `spend-proposal.js`
> lived in this directory but was Allocator work throughout: every export prices or itemizes spend, it
> imported four Allocator modules, and **no Configurator file imported it**. It now lives at
> `personas/allocator/spend-proposal.js`. Charter law is "the Allocator alone owns pricing" — this persona
> assembles and validates structure, and the Allocator prices what it publishes.

> **It DOES publish room geometry for the Allocator to price** (CR.9 M2). `deriveRoomLayout(cardSet)` on
> the persona surface returns `{ floorTiles, connectorFloorTiles, billableFloorTiles }`. The SIZE → LAYOUT
> table (small 24 / medium 48 / large 96, `card-model.js`) is Configurator geometry and stays here; the
> Allocator receives this capability **injected at the composition root** and refuses to price a room card
> without it (`allocator_room_geometry_required`) rather than deriving a second answer. Same wiring shape as
> CR.6's `createActorPersona({ admitProposals: allocator.admitProposals })`, in the opposite direction.

> **And it publishes room SHAPE, for the DIRECTOR** (D8.3, 2026-08-08). `buildRoomDesign(cardSet)`
> returns `{ roomCount, roomMinSize, roomMaxSize, corridorWidth, rooms }` — the sibling of
> `deriveRoomLayout`, published one milestone later for the same reason and gated the same way (not at
> all: both are stateless reads of a card set the caller already holds). `director/summary-selections.js`
> used to import `card-model.js` for **both** and stamp the results into the summary it was resolving,
> which made the Director a second author of the same table. It now asks, and refuses without the
> capability (`director_room_geometry_required`). That import was the **last leg of the
> Director↔Configurator cycle**; with it gone, the persona graph is a DAG in fact as well as by decision.
>
> The two are published separately rather than bundled because they answer different questions for
> different consumers: the Allocator needs "how many tiles" to price, and never asks for shape.

> **And it publishes the FEASIBILITY VERDICT** (CR.4 M5b.2f, 2026-08-08).
> `assessFeasibility({ layout, levelGen, actorCount })` answers "can this level host these actors?",
> stateless and ungated like the two above. It came out of `orchestrator/llm-budget-loop.js`.
>
> ⚠️ **The two `validateLayout*` calls were never the point — the DISPATCH was.** Above
> `MAX_EXACT_LAYOUT_FEASIBILITY_TILES` (1,000,000 floor tiles) the exact check materializes a grid and
> becomes unaffordable, so feasibility is approximated from tile counts instead. That threshold and
> that approximation are this persona's law, and they were executing in the Orchestrator. Threading
> only the two calls would have cleared both allowlist rows and left the decision behind — M5b.2c's
> finding, in a new file. **Ask what a symbol DECIDES, not what it imports.**
>
> The caller supplies `levelGen` rather than a `roomCount`: deriving level geometry from an intent is
> the Director's translation, and asking the Director for it from here would be the reverse edge D8.1
> removed. The Director derives, then asks.
>
> `tests/personas/configurator/configurator-layout-feasibility.test.js` replays **185 cases** captured
> before the move. **If one fails, do not re-record it** — a drifted approximation still returns a
> well-formed `{ ok, errors }`, so nothing downstream could question it.

> **It AUTHORS the candidates the Allocator prices** (CR.9 M3). `candidate-authoring.js`, published as
> `authorCandidates` on the persona surface, owns card assembly (`readCardVitals`,
> `fillFlexibleDelverVitals`, `buildMinimumDelverCard`), structural validity (`assessDelverStructure`) and
> candidate enumeration (`proposeDelverCandidates` / `proposeRoomCandidates` / `reviseDelverCandidate`).
> It applies `ACTOR_VIABILITY_FLOOR` while authoring, and `reportActorViabilityFloor(initialState)` answers
> the same question for a level loaded as written (the play session asks it): each delver or warden vital
> below the floor, reported and never raised.
> All of it previously lived in `allocator/budget-fulfillment.js`, where the budget maximizer built its own
> cards and then priced them.
>
> **`maximizeActorBudget` joined `authorCandidates` in WP-5/D10, and it is the one member that DOES take
> prices — read the next paragraph's rule with this exception in mind.** Scaling authored actors to spend a
> leftover budget is assembly, so it is this persona's work, but it cannot be done without knowing what a
> vital point costs. The prices are **passed in** from `createAllocatorPersona().pricing` (`unitCosts()` and
> `priceMap()`); the Configurator neither derives nor stores them. Before this change the module imported
> `buildPriceMap`/`normalizePriceItems` straight out of `allocator/validate-spend.js` and built the maps
> itself — the Configurator holding the Allocator's pricing tools.
>
> It also carried its own fallback price of `1` for any vital the list did not price. **Every vital in the
> Allocator's default list costs exactly 1**, so that fallback and the real price agreed numerically and no
> test on output could ever tell them apart. It now **refuses** an unpriced vital by name instead. The
> distinction the charter draws is not "may a persona see a number" but "may a persona *decide* one" —
> taking a published price is consuming the Allocator's decision; defaulting when it is missing is making
> your own.
>
> The Configurator sees the **cap** (`BudgetEnvelope`) because its enumeration bounds are cap-derived and
> termination depends on that; during candidate enumeration it never sees **prices**, or it would be pricing
> again. Each candidate
> publishes a `priceable` projection — the only part the Allocator reads — plus an opaque `preference`
> tuple that carries this persona's ordering intent without exposing what the positions mean. Both personas
> read the protocol's schema strings and refusal vocabularies from `contracts/spend-protocol.js` (CR.9 M4);
> neither restates them locally, and `single-origin.test.js` fails if either does.
>
> **Decision (c), settled 2026-08-04:** a card whose motivations contradict each other (same exclusive
> group) is **never proposed**, so it is never priced and the maximizer will not grow it. Previously the
> pricing path called `normalizeMotivations`, discarded its `ok`/`errors`, and silently costed the coerced
> survivor. `normalizeMotivations` is also published on the persona surface for the legacy raw-data pricing
> paths, which **still coerce** — that residue is recorded in `allocator/spend-proposal.js` and is not
> closed by M3.

> **It AUTHORS a build/run request's delver roster entry** (`configurator/actors`, 2026-08-18).
> `actor-authoring.js`'s `authorDelverCandidate`, published on the persona surface, owns the
> defaulting (missing motivation → `attacking`), enum validation (affinity/motivation/setup-mode
> against the chartered vocabularies) and final assembly of one delver candidate. This was
> previously `ak-impl.mjs`'s `parseDelverSpec` doing all three inline — domain logic in adapter
> glue. The CLI keeps the `;`-delimited field splitting and the generic value-format tokenizers
> (`affinities`/`vitals`/`goals` tuples, shared with the still-unmigrated `parseWardenSpec`): those
> are DSL syntax, not configuration authoring, and moving them was out of this milestone's scope.
>
> `authorActorEquipment`, beside it, authors a delver or warden card's `slots=` and `equip=`
> (`ak create`) into core's `affinitySlots`, `activeAffinityKey`, `equippedAffinityKeys` and
> `equippedAffinityStacks`. It refuses only what core could not load: more equips than slots, an
> affinity the actor does not hold, a duplicate, more stacks than held, slots outside 1-6. Any mix,
> opposite emits included, is allowed. The preset slot counts are `PRESET_AFFINITY_SLOTS` in contracts.
>
> Not the same responsibility as the candidate-authoring block above: that one assembles **priced
> cards** for the Allocator to judge; this one assembles a request's **actor roster entry**
> directly, with no pricing involved. `actor-generator.js`'s `generateActorSet` was investigated
> as a possible fulfiller and ruled out — it is a real, separate grid-placement generator for
> scale/perf test fixtures (`tests/helpers/tier-generators.js`), untouched by this milestone.

The simulation core (`core-ts`) remains the sole authority on rule enforcement and state mutation.

---

## Responsibilities

### Configuration Assembly
The Configurator assembles:
- World and layout parameters (rooms, corridors, anchors, topology).
- Actor instantiation details (counts, traits, initial placement).
- Enabled systems and rule toggles.
- Initial limits and constraints supplied by upstream personas.

All configuration is explicit, serializable, and inspectable.

---

### Validation and Consistency Checks
Before execution, the Configurator performs:
- Structural validation (e.g. connectivity, reachability, containment).
- Constraint checks (e.g. required anchors present, queues sized correctly).
- Compatibility checks between enabled systems.

Validation ensures that the simulation starts from a **coherent state**, not that it will behave correctly at runtime.

---

### Logical Validation and Solver Boundary
The Z8.0 current-source benefit test rejects solver routing for actor logical validity. Motivation
exclusivity, mana/stamina prerequisites, configured-affinity slot count, and stack bounds are bounded
pair/count/threshold checks with no objective and no choice search. Authored values are hard; omitted
values already resolve to one approved default or floor. Z3 would only re-evaluate the same rules with
more machinery.

Z8.1 routes these checks through `logical-validation.js` while retaining the existing
`authorCandidates.assessDelverStructure(...)` public surface. Artifact-specific modules still own
shape normalization and adapt the shared issues to their established result shapes. The configured
affinity limit is `AFFINITY_KINDS.length`; it constrains authored loadout entries, not affinity kinds
gained later from resources. Stack limits remain preset-authored.

The exact diagnostic families are
`conflicting_kind`, `affinity_requires_mana`, `affinity_requires_mana_regen`,
`movement_requires_stamina_pool`, `movement_requires_stamina_regen`,
`affinity_slot_limit_exceeded`, and `stacks_exceed_max`.

The existing `configurator_satisfiability` constraint domain remains reserved for Z9 object-placement
assignment, which is a genuine combinatorial search. It uses
`context.problemKind: "object_placement"`. Core's live resource-affinity grant slots are runtime state,
not authored loadout slots, and are never variables in a Configurator problem.

---

## Determinism and Replay

To preserve determinism:
- Configuration output is a pure function of input plans and parameters.
- Validation decisions are deterministic and reproducible.
- The same inputs will always yield the same configuration artifact.

Once execution begins, the Configurator no longer participates in the simulation loop.

---

## Relationship to core-ts

The Configurator does **not**:
- Apply simulation rules.
- Resolve conflicts at runtime.
- Modify state during ticks.
- Interpret or emit simulation events.

Instead, it supplies:
- Initial world state descriptions.
- Configuration flags and constraints.
- Static artifacts consumed by the simulation core at startup.

## State machine & phases
- States: uninitialized → pending_config → configured → locked.
- Subscribed tick phases: init, observe — **but the tick plane does not drive the build round.**
  The runner used to inject `provide_config` → `validate` → `lock` on every run, walking the FSM
  without calling any service method: a run reached `locked` with `hasConfig: false` and no published
  snapshot, and nothing read the resulting state except the code choosing the next event (PX.5).
  Configuration assembly, validation and locking are **build-plane** concerns (charter rule 3), and
  the two planes did not even pass the same type — the build plane's `config` is
  `spec.configurator.inputs`, the tick plane's was the `SimConfigArtifact`. During a run the
  Configurator now correctly stays `uninitialized`. The subscriptions remain so a caller that
  genuinely wants a tick-plane round can still drive one via `personaEvents`.
- Outputs: configuration artifacts/refs (data-only); no IO or runtime mutation.

### CONFIG-plane service surface

Two planes, one persona: the tick plane drives the FSM via `advance()` in init/observe;
the CONFIG plane uses the service surface below. Both move the same state machine.

| Call | Requires state | Effect |
|---|---|---|
| `provideConfig(config, {configRef})` | uninitialized | Takes a **serializable copy** of the config → pending_config |
| `prepareLevelGen({existingLevelGen, rooms, floorTiles, hazards})` | pending_config \| configured | Sizes the grid, attaches hazards, records the result on the persona's config |
| `mapResources(resources)` | pending_config \| configured | Maps authored resources to the input shape, records the result |
| `validate()` | pending_config | Runs `config-validation.js`; **throws `ConfiguratorValidationError` (`code: "configurator_invalid"`, `.errors[]`) on a malformed config without moving the FSM** → configured |
| `lock()` | configured | Publishes a deep-frozen, versioned snapshot → locked; returns `{state, config, version}` |
| `lockedConfig()` | any | The published snapshot, or `null` before `lock()` |

`validate()` and `lock()` were label-only until CR.2 (2026-07-29): both were
`requireState` + `fsm.advance`, and the production authoring path
(`build/authoring-build.js`) called neither, so a malformed `levelGen` or resource
list reached `orchestrateBuild` untouched. `runAuthoringBuild` now validates and
locks before the build proceeds — a config the Configurator rejects fails the build.

Validation is **permissive on presence, strict on type**: production emits partial
shapes that are legitimate (the `resource-plan-g4` golden carries
`shape: { roomCount: 1 }` with no roomMinSize/roomMaxSize/corridorWidth), so every
field is optional and checked only when present. The one cross-field invariant is
`roomMinSize <= roomMaxSize`.

The locked snapshot is **not** what `orchestrateBuild` consumes. `orchestrateBuild`
still writes `affinityRules`, `motivationRules` and `actors` back into
`spec.configurator.inputs`, so the spec remains the mutable working document and the
snapshot is the record of what the Configurator approved. Making the locked artifact
the consumed input requires removing those write-backs — CR.3's scope, not CR.2's.

`core-ts` enforces all rules and transitions based on the provided configuration.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Configurator state-machine
inputs/outputs belong in `packages/runtime/src/personas/configurator/contracts.ts`.

This separation ensures that:
- Scenario setup complexity does not leak into the simulation core.
- Configuration logic can evolve independently of runtime mechanics.
- Invalid or incoherent scenarios are rejected early and explicitly.

The Configurator is therefore a **bridge between planning and execution**, responsible for preparing the simulation so that deterministic rules can operate without ambiguity.

### RB2.0 reachable build behavior lock (2026-08-30)

`tests/personas/configurator/configurator-mixed-room-composition.test.js` and
`configurator-actor-placement.test.js` characterize the configuration decisions that
`orchestrateBuild` actually reaches before those decisions move behind this persona's public surface.

- Room cards expand in authored card/count order, then a seed-shuffled room order receives the
  profiles cyclically. Each emitted affinity gets one deterministic unoccupied cell in its assigned
  room. Generated hazard ids include affinity plus room index; mana upkeep is `2 + stacks`, the pool
  is three upkeep ticks, regen equals upkeep, and durability is `5 * stacks`. A push or pull hazard's
  pool is exactly two casts at the price core charges for that kind and stack count, with no regen
  and durability `3 * stacks`. The price comes from the build's authored affinity rules when it has
  them (#247): `orchestrateBuild` passes them to object placement, which hands them to `mapHazards`.
- Cast prices (#232): a push or pull costs the kind's base times `s(s+1)/2`, with no cap. The base is
  the rules artifact's tier-1 `manaCost`; `resolveActorTurnCosts` sends it to core as
  `actionCosts.castManaBase`, and `resolveAffinityManaCost` returns the same curve. Push/pull tiers
  2-5 are no longer read. Every default push and pull costs at least 1.
- Actor placement uses explicit alignment, with category supplying its authoring default. External actors
  prefer the entry room; dungeon actors prefer a matching affinity room, then the exit room,
  then any room. Spawn, exit, hazards, and resources are occupied. The resolved build output preserves
  authored actor order and identity; `InitialStateArtifact` separately canonicalizes actors by id.
- Capacity failure identifies the delver or warden that exhausted placement and reports the available
  room-tile count plus the number already occupied.

The audit also found two dormant paths that RB2.1/RB2.2 must not accidentally activate. Default
affinity rules publish no `worldActorCostModel.mixedRoomAssembly.templates`, and the build call supplies
no alternate catalog, so template composition remains unreachable through `orchestrateBuild`.
Likewise, generated layouts always contain at least one viable room, so the private legacy group-anchor
fallback is not reached by this entry point. Its removal or preservation remains RB2.2's explicit
caller/residue decision—not part of the characterized contract.

### RB2.1 mixed-room capability (2026-08-31)

`composeMixedRooms({ layout, cardSet, seed, affinityRules })` is the single public Configurator
capability for room-profile expansion, seeded room assignment, room template metadata, candidate-cell
selection, and generated affinity-hazard vitals. It is stateless and pure: it returns a new layout and
does not mutate caller-owned data.

`orchestrateBuild` now passes plain layout/card/seed inputs and consumes the returned layout. It owns no
room-card filtering, affinity-expression default, stack default, cell choice, mana/upkeep, regen, or
durability formula. The A2 residue guard rejects restoring those named helpers in build glue.

The existing template-catalog branch moved behind the same capability without being activated: current
default rules still publish no templates and the production caller still supplies none. RB3.0's price
boundary is unchanged—Configurator structure contains no price hints or arithmetic. RB3.2 now has build
pass each published composition to the Allocator's `priceMixedRoomDesignSpend` capability and attach only
that answer as `designTokenSpend`; this persona neither imports the Allocator nor derives a component or
total. Actor role/group/placement policy remains outside this capability until RB2.2.

### RB2.2 actor-placement capability (2026-08-31)

`placeActors({ actors, layout, reservedActors })` is the single public Configurator capability for actor
power fallback, legacy leader/support grouping and distant anchors, alignment-aware room
placement, affinity-room preference, and occupancy. It is stateless and pure: it never mutates the
caller-owned actor list or layout and returns `{ actors, changed }` in authored actor order.

The strategic path reserves spawn/exit **wall portals**, hazards, and resources. Delvers seat on
the spawn approach (entry doorway floor), then prefer the entry room; the first dungeon-aligned
actor seats on the exit approach, then dungeon-aligned actors prefer affinity-matching rooms, the
exit room, and finally any room.
Spawn and exit tiles themselves are non-walkable perimeter portals — not seating cells. Layouts without a
viable room context retain the existing deterministic power-group/anchor fallback. `orchestrateBuild`
passes only actors, layout, and the delver-count hint through the public persona surface and consumes
the result; it owns no actor role, ranking, grouping, or placement decision.

### Z9.1 object-placement search (2026-09-02)

`prepareObjectPlacement({ layout, hazards, resources, actors })` authors the Configurator's
`configurator_satisfiability` problem with `problemKind: "object_placement"`.
`completeObjectPlacement(...)` validates the model and publishes a canonical layout plus placed
hazard/resource actors. Fixed coordinates,
room containment, unique walkable cells, spawn/exit/actor reservations, and a surviving
spawn-to-exit path are hard constraints.

The objective is deterministic: authored object order first, row-major cell order second. The
problem uses binary placement variables plus integer path-flow variables, allowing both platform Z3
adapters to compile it through their generic linear solver without learning Configurator policy.
`orchestrateBuild` only passes plain inputs and consumes the result; it holds no placement helpers.

When the domain is unavailable, deferred, or errors, completion uses the characterized
hazards-first row-major fallback. A solver `unsat` is final and reports one actionable family:
`capacity`, `containment`, `collision`, or `path_obstruction`. Both surfaces are stateless and pure;
neither mutates caller-owned layout or object data. Hazard affinities become owned equipment with
the authored pair active; category-specific hazard/resource collections do not enter SimConfig.

## Drift guardrails
- Canonical source: `controller.js` + `state-machine.js` + `contracts.ts`. The 1-line `.mts` re-export shims were deleted 2026-08-01; consumers import `persona.js` (the controller barrel), not the state machine.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.js`. There is no `.mts` twin (no `ts-node/esm` required).


## Unified actor normalization (rewrite in progress)

`normalizeActorDefinition(input)` is a pure authoring method on the public
Configurator controller. It accepts one of the five `category` presets plus
stable `id`, `position`, explicit `vitals`, and mechanical overrides. It returns
`{ actor, presentation: { category } }`. Labels are excluded from actor state.
Alignment, defeat vital, capabilities and affinity slots default from the
preset; explicit properties override them. Slots (how many affinities an actor
can equip at once) are delver 3, warden 2, hazard/resource/barrier 1; one slot
is core's default, so a one-slot record carries no `affinitySlots` field. An
authored `equippedAffinityKeys` is kept and checked by core, and so is an
authored `equippedAffinityStacks` (a slot run below the stacks it holds). Vital quantities and prices are never invented here.
All motivations and owned affinity/expression pairs are preserved. Core-owned
validators enforce common vital/inventory/holding shapes. Explicit null values
are rejected where the property requires a value; only omitted values default.

The existing artifact builders now use this normalized authoring seam. Director
and transport producers still need migration to the new input shape; this does
not yet establish CLI/MCP/UI equivalence or a working production runner.

`resolveActorTurnCosts({ rules?, movementStamina })` assembles the unified turn
window's vital costs. It reads all five authored mana tiers for all forty pairs,
including equipment acquired later. Omitted rules use the existing default rules;
invalid supplied rules fail. Movement stamina costs are explicit nonnegative safe
integers keyed by actor ID. Returned tables are detached. This does not price
Allocator tokens. `assembleMovementStamina({ actors, movementStamina? })` builds
that ID map from the placed roster: explicit entries win, then nonnegative
`capabilities.movementCost`, then the Configurator cardinal default for mobile
actors (category preset, `canMove`, or unmigrated `type: delver|warden`). Immobile
actors are omitted. Glue must call this helper rather than inventing costs.

`normalizeActorRoster({ actors, dimensions, terrain })` assembles normalized
`{ actors, presentation }` for artifact assembly. Entries use the single-actor
preset definition above. Core validates the whole roster against terrain and
capabilities, rejects duplicate IDs and blocking overlaps, and resolves initial
zero-vital defeat before occupancy. Results are detached and sorted by ordinal
actor ID; labels remain in the separate presentation map. No placement or defeat
rule is duplicated in Configurator. buildInitialStateArtifact uses this collection
method; its legacy authoring callers still require migration.


Production artifact assembly (unified cutover): `buildSimConfigArtifact` requires
`layout: {width,height,terrain}` and a valid `movementStamina` map; optional
`affinityRules` supply authored tuning. Production create assembles that map
through `assembleMovementStamina` from the placed roster when CLI input omits it. It emits `actionCosts` and normalized grid
data. Entity lists, numeric kinds and ASCII tiles are no longer accepted there.
`budgetScaffold` stays a levelGen/pricing flag on the working layout for
Allocator spend; locked SimConfig layout data drops it and still rejects other
extras. `buildInitialStateArtifact` requires `actors` as preset definitions, `dimensions`,
`terrain`, `meta` and `simConfigRef`. It emits one actor list and presentation map.
The resolved-effects/traits merge has been removed. Envelope versions stay fixed
by the approved clean-break decision. Current legacy producers fail until migrated.

Generated layouts now contain a row-major `terrain` array (`floor`, `wall`,
`spawn`, `exit`). Numeric kinds, glyph tile rows, legends and duplicate marker
coordinates are removed from the generated artifact data. Rendering hints remain
presentation metadata. Actor placement reads walkable cells and marker positions
from this terrain while retaining the existing strategic room placement policy.
Object placement and feasibility also read canonical terrain; previews project
that terrain to glyphs only at the rendering boundary. Generated hazard/resource
planning entries still await the common actor authoring migration. No historical layout reader is provided.
Room-affinity composition also derives reserved spawn/exit positions from canonical
terrain, preserving those cells when choosing emitter locations.

`mapResources` now authors resource presets through `normalizeActorDefinition`.
Requests require a stable ID and common vital records; rewards are explicit
`holdings` and owned affinity pairs. Capability/alignment/equipment overrides are
preserved. An omitted position stays omitted until placement. CLI V3
`permanenceMode` plus grant `vitals` becomes one unclaimed vital holding; source
durability uses the Configurator default rather than synthesizing loot from the
source pool. A `slotGrant` becomes one unclaimed `slot` holding (slot-unlock loot);
only the resource preset may carry a slot holding, so it is floor loot and no
defeated delver or warden drops one. Version-specific `tier`/`stat` shapes are still rejected.
`mapHazards` uses the same mechanical boundary: authored regen vitals keep their
quantities and drop the authoring `kind` field; one-time `{amount}` becomes
`{current:amount, max:amount, regen:0}`. Incomplete records are skipped so
computed expression defaults remain. CLI string `affinity` plus `expression` or
`affinityStacks[0]` is accepted; extra authoring fields are not spread into the
mechanical record.
