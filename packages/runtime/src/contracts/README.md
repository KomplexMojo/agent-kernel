# Runtime contracts

`artifacts.ts` is the declaration origin for boundary schemas. It declares data;
Configurator validates authoring and core validates simulation legality.

## Unified actor rewrite — declaration milestone

Mechanical actor types now live in `packages/core-ts/src/state/actor-types.ts`.
This module imports/re-exports them; core never imports runtime contracts. Artifact
envelopes and presentation metadata remain declared here.

The unified actor declarations replace the initial-state actor shape, simulation
action union, and world-state shape in place. Existing envelope selectors remain
unchanged by maintainer instruction: InitialState/Action use 1 and WorldState uses
2. No historical WorldState union is retained.

**This milestone declares the target contract; runtime producers and consumers
have not migrated yet.** Existing JavaScript can still emit the old shapes, so
passing declaration tests does not prove runtime conformance. Do not use this
branch as a completed engine migration. Subsequent core, Configurator, Actor,
Moderator, Annotator, and adapter milestones must wire the new contracts.

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

## Core registry component — UA.2

`createActorRegistry` in core's `state/actor-registry.ts` owns detached mechanical
records and row-major terrain. `getActor`, `getActorsAt`, movement/sight blocking
queries, and `snapshot` return no mutable internal references. Snapshots sort IDs
by ordinal UTF-16 comparison and survive JSON round trips. Invalid geometry,
duplicate IDs, conflicting living blockers, presentation fields, and non-JSON
state are rejected. Nonblocking actors can share an occupied cell; defeated and
exited actors do not block. Exited actors are absent from spatial queries.

This is the registry component, **not yet the replacement running engine**. It
has no action execution, tick advance, vital mutation, or public `createCore`
wiring. Those are the explicitly pending core milestones. Semantic vital,
equipment, and holding validation will be added with their respective mechanics.
