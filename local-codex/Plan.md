# Plan

## Summary
This work verifies and enforces a single actor-configuration foundation across room tiles, delvers, wardens, hazards, and resources, with the CLI as the canonical validation layer and the UI reflecting those same rules. The implementation sequence starts by codifying shared contracts, then hardens CLI enforcement, propagates the unified model through runtime build-spec plumbing, adds deterministic resource capture/permanence behavior, and finally converges the card builder into one constrained JSON editing surface.

## Milestones

### M1 - Shared Actor Contract
- Size band: M
- Assigned agent: Claude Sonnet/high
- Target files:
  - `packages/runtime/src/contracts/artifacts.ts`
  - `packages/runtime/src/contracts/build-spec.js`
  - `packages/runtime/src/contracts/domain-constants.js`
  - `tests/contracts/build-spec.test.js`
  - `tests/contracts/hazard-artifact.test.js`
  - `tests/contracts/resource-artifact.test.js`
- Tests:
  - Update contract coverage so one shared actor surface is asserted for room tiles, delvers, wardens, hazards, and resources.
  - Add assertions that room tiles allow affinities, motivations, and durability only; hazards allow exactly one room-matched affinity plus mana and mana regen only; resources expose the full delver/warden surface plus three permanence modes.
- Success criteria:
  1. Write failing contract assertions for the shared actor surface and forbidden per-type fields -> verify: `node --test tests/contracts/build-spec.test.js tests/contracts/hazard-artifact.test.js tests/contracts/resource-artifact.test.js` exits non-zero before production edits.
  2. Update schema/constants so the common actor base and per-type constraints are expressible through versioned runtime contracts -> verify: `node --test tests/contracts/build-spec.test.js tests/contracts/hazard-artifact.test.js tests/contracts/resource-artifact.test.js`.
  3. Prove room tile token cost stays derived rather than stored on the authoring artifact surface -> verify: `node --test tests/contracts/build-spec.test.js`.
- Validation command: `node --test tests/contracts/build-spec.test.js tests/contracts/hazard-artifact.test.js tests/contracts/resource-artifact.test.js`
- Stop condition: Shared contract tests pass, room-tile cost remains computed input rather than stored artifact state, and no additional contract files are required to represent the prompt's five actor types.
- Assumptions:
  - "Common actor base class" means one shared contract and normalization model, not mandatory JavaScript or TypeScript class inheritance.
  - Mana regeneration is represented through the existing vital regen shape, not a separate top-level field.
  - Room tiles continue to be represented as authored tile or room-card inputs, but their allowed configuration surface must be defined alongside the other actor types.

### M2 - CLI Enforcement Layer
- Size band: S
- Assigned agent: Claude Sonnet/high
- Target files:
  - `packages/adapters-cli/src/cli/ak-impl.mjs`
  - `packages/adapters-cli/src/cli/ak.mjs`
  - `tests/adapters-cli/ak-actor-flags.test.js`
  - `tests/integration/ak-create-hazard-resource.test.js`
- Tests:
  - Extend CLI tests so invalid room-tile, hazard, and resource configurations fail in `create` and `configure` before artifact write.
  - Add coverage that valid hazard/resource authoring emits only the canonical fields allowed by M1.
- Success criteria:
  1. Add failing CLI and integration assertions for invalid hazard durability, missing room-match enforcement, and unsupported resource permanence/input combinations -> verify: `node --test tests/adapters-cli/ak-actor-flags.test.js tests/integration/ak-create-hazard-resource.test.js` exits non-zero before implementation.
  2. Update CLI parsing and validation so `create`, `configure`, and dry-run paths reject invalid actor configurations and emit canonical valid artifacts -> verify: `node --test tests/adapters-cli/ak-actor-flags.test.js tests/integration/ak-create-hazard-resource.test.js`.
  3. Confirm the CLI remains the source-of-truth validator for hazard vitality restrictions -> verify: `node packages/adapters-cli/src/cli/ak.mjs create --dry-run --hazard "affinity=fire;expression=emit;proximityRadius=1;durability=one-time:1"` exits non-zero.
- Validation command: `node --test tests/adapters-cli/ak-actor-flags.test.js tests/integration/ak-create-hazard-resource.test.js`
- Stop condition: The CLI rejects every prompt-defined invalid configuration before writing artifacts, and valid authoring commands serialize only the allowed actor fields.
- Assumptions:
  - `create` and `configure` share the same validation path and should not diverge semantically.
  - Existing public flags remain the user-facing authoring surface unless M1 makes a field invalid.
  - Room-affinity matching for hazards is enforced from authoring inputs already available to the CLI, not by a later UI-only check.

### M3 - Runtime Build-Spec Propagation
- Size band: M
- Assigned agent: Claude Sonnet/high
- Target files:
  - `packages/runtime/src/personas/director/summary-selections.js`
  - `packages/runtime/src/personas/director/buildspec-assembler.js`
  - `packages/runtime/src/commands/ui-flow.js`
  - `packages/runtime/src/personas/configurator/card-model.js`
  - `tests/runtime/build-spec-card-set-roundtrip.test.js`
  - `tests/runtime/e2e-build-artifacts.test.js`
- Tests:
  - Add a round-trip test proving room tiles, hazards, delvers, wardens, and resources survive card-set -> summary -> build-spec -> UI-normalization without losing required fields.
  - Extend build-artifact coverage so resources are not dropped from `plan.hints` or `configurator.inputs`, and room-tile budget contribution stays computed at runtime.
- Success criteria:
  1. Add failing round-trip coverage for resource retention, room-tile config subset retention, and hazard normalization -> verify: `node --test tests/runtime/build-spec-card-set-roundtrip.test.js tests/runtime/e2e-build-artifacts.test.js` exits non-zero before implementation.
  2. Update runtime summary/build-spec plumbing so canonical actor cards flow through `cardSet`, `plan.hints`, and `configurator.inputs` without UI-only shadow schema -> verify: `node --test tests/runtime/build-spec-card-set-roundtrip.test.js tests/runtime/e2e-build-artifacts.test.js`.
  3. Confirm runtime build outputs still validate with the unified actor surface -> verify: `node --test tests/runtime/e2e-build-artifacts.test.js`.
- Validation command: `node --test tests/runtime/build-spec-card-set-roundtrip.test.js tests/runtime/e2e-build-artifacts.test.js`
- Stop condition: Runtime build-spec assembly preserves all five actor types with prompt-compliant fields, and resources are no longer silently dropped from summary or build-spec output.
- Assumptions:
  - `cardSet` remains the canonical interchange format shared by CLI and UI flows.
  - Room-tile token cost remains a runtime spend-ledger computation derived from authored configuration plus tile counts.
  - Resource authoring must be carried through the build-spec pipeline even if capture/permanence execution lands in a later milestone.

### M4 - Resource Capture And Permanence
- Size band: M
- Assigned agent: Claude Sonnet/high
- Target files:
  - `packages/core-as/assembly/rules/move.ts`
  - `packages/core-as/assembly/state/world.ts`
  - `packages/core-as/assembly/index.ts`
  - `packages/runtime/src/contracts/artifacts.ts`
  - `tests/core-as/actor-state.test.js`
  - `tests/core-as/actor-placement.test.js`
  - `tests/runtime/resource-capture-permanence.test.js`
- Tests:
  - Add deterministic execution tests for a delver or warden capturing a resource and receiving the correct current-stat or base-config effect.
  - Cover all three permanence modes: level-only, consumable/current-stat-only, and permanent/base-config mutation.
- Success criteria:
  1. Add failing simulation tests for resource pickup, current-stat application, and permanent/base-config mutation -> verify: `node --test tests/core-as/actor-state.test.js tests/core-as/actor-placement.test.js tests/runtime/resource-capture-permanence.test.js` exits non-zero before implementation.
  2. Implement deterministic resource capture in the execution path without introducing IO or non-serializable state -> verify: `node --test tests/core-as/actor-state.test.js tests/core-as/actor-placement.test.js tests/runtime/resource-capture-permanence.test.js`.
  3. Confirm permanence state is replay-safe and distinguishable by mode -> verify: `node --test tests/runtime/resource-capture-permanence.test.js`.
- Validation command: `node --test tests/core-as/actor-state.test.js tests/core-as/actor-placement.test.js tests/runtime/resource-capture-permanence.test.js`
- Stop condition: Actors can capture resources deterministically, each permanence mode applies the correct effect, and the resulting state remains valid for replay and serialization.
- Assumptions:
  - Capture is resolved inside the existing deterministic move or occupancy flow rather than via adapter-side logic.
  - Permanent mode mutates actor base configuration in serializable state, not external persistence.
  - NFT or blockchain persistence remains fully out of scope and must not leak into execution contracts.

### M5 - Unified JSON Builder UI
- Size band: M
- Assigned agent: Claude Sonnet/high
- Target files:
  - `packages/ui-web/src/design-guidance.js`
  - `packages/ui-web/src/views/design-view.js`
  - `packages/ui-web/src/build-spec-ui.js`
  - `packages/ui-web/src/actor-inspector.js`
  - `packages/ui-web/src/budget-panels.js`
  - `tests/ui-web/design-view.test.mjs`
  - `tests/ui-web/actor-inspector.test.mjs`
  - `tests/ui-web/budget-panels.test.mjs`
- Tests:
  - Add UI tests that assert one editor surface handles room tiles, delvers, wardens, hazards, and resources with per-type gated controls.
  - Add coverage that invalid configurations raise inline notifications and budget panels reflect the same constraints enforced by the CLI.
- Success criteria:
  1. Add failing UI assertions for a single editor surface, inline invalid-state messaging, and visual budget/configuration constraints per actor type -> verify: `node --test tests/ui-web/design-view.test.mjs tests/ui-web/actor-inspector.test.mjs tests/ui-web/budget-panels.test.mjs` exits non-zero before implementation.
  2. Refactor the card builder so resource, hazard, room-tile, delver, and warden editing all route through one JSON-builder surface backed by shared runtime constraints -> verify: `node --test tests/ui-web/design-view.test.mjs tests/ui-web/actor-inspector.test.mjs tests/ui-web/budget-panels.test.mjs`.
  3. Confirm the served UI shows a single editor with type-specific gated controls instead of separate screens -> verify: observable check after `pnpm run serve:ui` at `/packages/ui-web/index.html`.
- Validation command: `node --test tests/ui-web/design-view.test.mjs tests/ui-web/actor-inspector.test.mjs tests/ui-web/budget-panels.test.mjs`
- Stop condition: The UI exposes one JSON-builder surface that mirrors CLI-available fields and constraints, shows budget/configuration feedback inline, and no longer relies on a separate resource or hazard-specific editing model.
- Assumptions:
  - A unified builder may still show type-specific controls, but all editing must happen inside one surface and one serialized card model.
  - Inline notification can reuse existing status and inspector affordances rather than adding a second validation system.
  - UI logic should consume shared runtime helpers for constraint shaping and must not reintroduce a shadow schema that diverges from the CLI.

## Dependency Graph
- `M1 -> M2`
- `M2 -> M3`
- `M3 -> M4`
- `M2 -> M5`
- `M3 -> M5`
- `M4 -> M5`

## Architecture Flags
- `M2` requires Claude escalation because it changes the `adapters-cli -> runtime` contract boundary and must preserve the charter rule `adapters-* -> runtime -> bindings-ts -> core-as`.
- `M4` requires Claude escalation because it changes the `runtime -> core-as` execution boundary and must obey the charter rules `core-as` is pure logic and runtime personas own workflow or IO concerns.
- `M5` requires Claude escalation because it changes the `ui-web -> runtime` boundary and must keep UI constraint logic derived from shared runtime contracts rather than UI-only policy drift.

## Open Items
- None from `local-codex/Prompt.md`. All prompt-era open questions were resolved before planning, and remaining uncertainty is captured as milestone assumptions rather than blockers.
