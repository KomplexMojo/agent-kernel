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

> **It AUTHORS the candidates the Allocator prices** (CR.9 M3). `candidate-authoring.js`, published as
> `authorCandidates` on the persona surface, owns card assembly (`readCardVitals`,
> `fillFlexibleDelverVitals`, `buildMinimumDelverCard`), structural validity (`assessDelverStructure`) and
> candidate enumeration (`proposeDelverCandidates` / `proposeRoomCandidates` / `reviseDelverCandidate`).
> All of it previously lived in `allocator/budget-fulfillment.js`, where the budget maximizer built its own
> cards and then priced them.
>
> The Configurator sees the **cap** (`BudgetEnvelope`) because its enumeration bounds are cap-derived and
> termination depends on that; it never sees **prices**, or it would be pricing again. Each candidate
> publishes a `priceable` projection — the only part the Allocator reads — plus an opaque `preference`
> tuple that carries this persona's ordering intent without exposing what the positions mean.
>
> **Decision (c), settled 2026-08-04:** a card whose motivations contradict each other (same exclusive
> group) is **never proposed**, so it is never priced and the maximizer will not grow it. Previously the
> pricing path called `normalizeMotivations`, discarded its `ok`/`errors`, and silently costed the coerced
> survivor. `normalizeMotivations` is also published on the persona surface for the legacy raw-data pricing
> paths, which **still coerce** — that residue is recorded in `allocator/spend-proposal.js` and is not
> closed by M3.

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

### Solver-backed Validation (Optional)
Where constraints are complex, the Configurator may invoke solver-backed validation to:
- Verify layout feasibility.
- Confirm logical constraints are satisfiable.
- Reject or simplify configurations that cannot be made consistent.

Solver usage is bounded, deterministic, and treated as a configuration-time aid, not a runtime dependency.

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

## Drift guardrails
- Canonical source: `controller.js` + `state-machine.js` + `contracts.ts`. The 1-line `.mts` re-export shims were deleted 2026-08-01; consumers import `persona.js` (the controller barrel), not the state machine.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.js`. There is no `.mts` twin (no `ts-node/esm` required).
