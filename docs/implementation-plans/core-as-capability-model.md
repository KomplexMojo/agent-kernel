# Core-as Capability Model Plan

Goal: Introduce a canonical "capability model" inside core-as so the engine can reason about actor movement, stamina/mana usage, and regen deterministically. Capabilities should be a first-class concept in core-as while keeping economic costing in runtime.

Non-goals:
- Do not move token cost calculations into core-as.
- Do not add IO or external dependencies to core-as.
- Do not redesign the entire action system in one change.

## Current State
- core-as already stores vitals (health/mana/stamina/durability current/max/regen) per actor.
- Movement rules do not consult stamina or regen.
- Runtime is generating actors with vitals but core-as does not interpret capabilities.

## Capability Definition (Proposed)
Capabilities describe *what an actor can do* per tick given vitals and regen.
Minimum capability set for v1:
- **Vitals**: health, mana, stamina, durability (current/max/regen).
- **Movement**: stamina cost per tile (default 1).
- **Action costs**: optional per-action stamina/mana costs (default 0).
- **Regen policy**: regen applied per tick before/after actions (deterministic order).

Notes:
- Stamina governs movement (1 tile per 1 stamina by default).
- Mana is required for affinity-based actions (but affinity cost model remains outside core-as).
- Durability regen remains unsupported; durability only changes via effects.

## Plan

### 1) Define Core-as Capability Types
1. [complete] Add capability types in `packages/core-as/assembly/types/` or `packages/core-as/assembly/state/`.
   - Requirement: Define `Capability` and `ActionCost` shapes in core-as (no IO).
   - Proposed shape:
     - `Capability { movementCost: i32, actionCostMana: i32, actionCostStamina: i32 }`
     - Or per-action costs keyed by action kind (move/cast/etc).
   - Tests: Add a small core-as unit test for default values and validation.
   - Notes: Keep defaults deterministic; avoid heap allocations.

### 2) Store Capability Parameters in State
1. [complete] Extend `packages/core-as/assembly/state/world.ts` with capability parameters.
   - Requirement: Track per-actor movement cost and optional action costs.
   - Behavior: Defaults to movementCost = 1, actionCost = 0.
   - Tests: Add validation checks for non-negative values.

### 3) Apply Capabilities in Movement Rules
1. [planned] Update `packages/core-as/assembly/rules/move.ts` to use stamina.
   - Requirement: Movement should require `stamina >= movementCost` and deduct it.
   - New validation error: `InsufficientStamina` (add to `validate/inputs.ts`).
   - Determinism: Deduct stamina before position change; tick ordering consistent.
   - Tests: Add a fixture where stamina is insufficient and assert error.

### 4) Add Tick Regen Application
1. [complete] Add a deterministic tick-advance function (core-as).
   - Requirement: Apply regen each tick to current vitals (clamped to max).
   - Behavior: `current = min(max, current + regen)` for each vital.
   - Tests: Add a unit test for regen application and clamping.
   - Notes: Decide whether regen happens before or after actions and document it.

### 5) Expose Capabilities via Bindings
1. [complete] Expose capability getters in `packages/core-as/assembly/index.ts`.
   - Requirement: Provide `getActorMovementCost`, `getActorActionCost*`, etc.
   - Update bindings-ts to include these in observations if needed by runtime.
   - Tests: Extend bindings tests to assert capability values are surfaced.

### 6) Runtime Wiring (No Costing in Core)
1. [complete] Extend runtime actor config -> core-as initialization to include capabilities.
   - Requirement: Runtime sets vitals *and* movement/action costs in core-as.
   - Behavior: Defaults applied if not specified in config.
   - Tests: Add runtime test to confirm capabilities are passed into core-as.

### 7) Fixtures + Negative Cases
1. [complete] Add fixtures for capability inputs in `tests/fixtures/**`.
   - Include valid movement cost, invalid negative cost, and missing stamina.
   - Add invalid fixtures under `tests/fixtures/artifacts/invalid` when validation is added.
   - Tests: Ensure core-as rejects invalid capability fixtures deterministically.

### 8) Documentation + Diagram
1. [planned] Update `docs/README.md` and `docs/architecture/diagram.mmd` if capability concepts alter the architecture narrative.
   - Note that core-as owns the *capability semantics*, runtime owns the *cost model*.

## Acceptance Criteria
- core-as enforces stamina/mana constraints for movement and actions.
- Regen is applied deterministically on tick advance.
- Capabilities are part of the core-as state and exposed to bindings.
- Runtime can supply capability parameters without cost logic in core-as.
- Tests and fixtures cover valid/invalid capability configurations.

## ToDo
- Add a fixture-driven test case for insufficient stamina movement (fixture + assertion).
- Document regen ordering explicitly (pre-action vs post-action) in this plan or the architecture docs.
- Update `docs/architecture/diagram.mmd` to reflect capability semantics in core-as vs cost model in runtime (if the diagram narrative needs it).
- Enforce action cost (mana/stamina) constraints for non-move actions or clarify scope of action-cost enforcement in acceptance criteria.
