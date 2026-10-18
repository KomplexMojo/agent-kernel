# Runtime contracts

`artifacts.ts` is the declaration origin for boundary schemas. It declares data;
Configurator validates authoring and core validates simulation legality.

`persona-stamps.js` (#275) names the persona whose `meta.producedBy` stamp each level
artifact must carry (`REQUIRED_PERSONA_STAMPS`) and reports artifacts stamped otherwise
(`personaStampViolations`). Personas stamp their own output through
`personas/_shared/persona-stamp.js`.

## Unified actor rewrite — declaration milestone

Mechanical actor types now live in `packages/core-ts/src/state/actor-types.ts`.
This module imports/re-exports them; core never imports runtime contracts. Artifact
envelopes and presentation metadata remain declared here.

The unified actor declarations replace the initial-state actor shape, simulation
action union, and world-state shape in place. Existing envelope selectors remain
unchanged by maintainer instruction: InitialState/Action use 1 and WorldState uses
2. No historical WorldState union is retained.

**Production cutover is in progress.** The existing Configurator builders and
artifact loader now require/produce normalized state. Legacy authoring producers
and runner/UI callers have not yet migrated, so the full application is not
currently functional on this branch. Passing the builder/loader tests is not
whole-runtime completion. No historical reader or fallback loader is retained.

- `ActorRecord` uses a stable string ID, explicit alignment/capabilities, optional
  vitals with a required defeat vital, lifecycle, motivation list, inventory,
  active affinity key, and holdings. It contains no category or core-array index.
- Initial state and WorldState each contain one `actors` collection and a separate
  `presentation` map keyed by actor ID. Labels never choose mechanical rules.
- `ActorAffinityEntry` is `{kind, expression, stacks}`. `ActorAffinityKey` is
  `kind:expression`. No loadout contains mana; it belongs in actor vitals.
- `ActorAffinityHolding` names one pair and records `claimedBy`. It has no stacks
  field: one successful claim must add exactly one stack, not the source quantity.
- `ActorVitalHolding` contains explicitly authored grants and their permanence
  mode; it does not expose a defeated actor's remaining vital pools.

`ActionV1` is a discriminated union. All actions carry schema, schemaVersion,
actorId, and tick. Parameters are:

| Kind | Parameters |
| --- | --- |
| `wait` | None |
| `move` | `target: {x, y}` |
| `cast_affinity` | `targetId` (core reads the active pair and stacks) |
| `equip_affinity` | `affinityKey` |
| `take` | `targetId`, `holdingId` |

Telemetry and external requests belong to effect protocols. Conventional attacks
and category-specific simulation actions are absent from the new union.

The compiler-backed fixture in `tests/fixtures/contracts/unified-actor-contract.ts`
checks accepted records and rejected shapes. Numeric bounds, duplicate pairs,
active-key membership, terminal lifecycle behavior, and atomic claim legality
require runtime tests in the implementation milestones; types cannot prove them.

## Implemented unified actor components

`createActorRegistry` owns detached mechanical records and row-major terrain.
Queries and snapshots expose no mutable references and sort IDs by ordinal UTF-16
order. Loading rejects invalid geometry, duplicate IDs, conflicting live blockers,
presentation fields, non-JSON state, invalid vitals, capabilities, inventory and
holdings. Exited actors are absent from spatial queries; inactive actors never block.

The registry exposes these internal mutation primitives:

| Method | Guarantee |
| --- | --- |
| `changeVital(id, vital, delta)` | Returns actual signed change; selected-vital zero causes immediate terminal defeat |
| `regenerate()` | One caller-scheduled pass; inactive actors cannot regenerate or revive |
| `equipAffinity(id, key)` | Living capable actor selects one owned alternative without changing mana |
| `takeHolding(receiverId, sourceId, holdingId)` | Adjacent living receiver atomically claims one defeated-source holding once |
| `moveActor(id, target)` | Adjacent capable movement updates common occupancy and never auto-collects |

Every owned pair exposes one canonical defeat reward regardless of source stacks.
Claimed entries remain in snapshots. New pairs are not auto-equipped. Explicit
vital grants retain their authored modes; source vital pools are not loot.

`rules/actor-affinity.ts` supplies the explicit effect matrix, durability overflow,
direct vital effects and actual-amount transfers. `actor-exposure.ts` applies
preprojected effects with a per-slot strength that caps what each receiver takes
(every receiver in range takes its own exposure, never a share consumed in id order,
#347), capped mana absorption and pending-effect suppression. `actor-fields.ts` uses existing radius, intensity and
local opposition arithmetic to project active living equipment. It retains
light/dark field observations and re-observes defeat without another pulse.

`castFocusedActorAffinity` checks focused range and the authored mana price before
writes, spends one actor pool and returns suppression with caster provenance. A run's
`actionCosts` carries `castManaBase` (per-kind base; a cast costs `base * s(s+1)/2`,
uncapped, #232); core has no other cast price model. An artifact written before #232
with five-tier `castMana` tables loads on the same curve: `runner/core-setup.mjs` takes
each table's tier-1 price as the base.

`createActorTurn` dispatches ordered common actions and permits one accepted action
per actor. Its detached snapshot includes tick, accepted IDs, suppression and phase
flags. Moderator closes actions before one field pass and one regeneration pass.
Restoration preserves these limits. Movement reuses existing diagonal stamina
costs; primitive registry methods alone do not enforce turn economy.

Configurator's public `normalizeActorDefinition` produces `{actor,presentation}`
from editable presets and explicit vital data, sharing core shape validators.
It preserves all authored motivations and owned pairs.

**The running pipeline has not adopted these components.** Area cast actions,
public core replacement, artifact producers/consumers, pricing and
UI/CLI/MCP equivalence remain outstanding. Runtime frames do not yet carry turn
state. Existing JavaScript still runs the legacy engine; passing these component
tests is not proof of completed gameplay migration.

The `initial-state-artifact-v1-unified` fixture supplies a file-backed valid actor
control. Invalid siblings cover unowned active equipment, duplicate pairs and an
invalid defeat vital. Contract tests pass their actor records through the common
registry; full envelope and transport validation remain part of loader migration.

Unified actors may carry `exitDwell`, a consecutive end-of-tick counter (omitted
means zero). A living actor with `canExit` exits after two completed ticks on exit
terrain, independently of alignment or preset. Exiting releases occupancy and is
terminal. Leaving the exit resets progress. The turn window's `resolveExits()`
phase follows regeneration exactly once and snapshots `exitsResolved`; registry
snapshots preserve actor counters. Production Moderator adoption remains pending.


SimConfig now carries `actionCosts` (core ActorTurnCosts) and grid data with required
`width`, `height`, `terrain`. InitialState contains `actors` and a complete
`presentation` map. `initializeCoreFromArtifacts({simConfig,initialState})` validates
reference identity and returns `{registry,costs,presentation}` with detached data.
It performs no startup field pulse or authoring conversion. Old setup exports
`applySimConfigToCore` and `applyInitialStateToCore` were removed; their callers are
remaining migration work, not supported compatibility entry points.
