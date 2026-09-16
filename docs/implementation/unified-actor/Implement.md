# Implementation runbook
Run commands from the existing isolated unified-actor worktree root. Read Handoff.md and Plan.md for current status; cloud startup notes are retained for portability.

Leftover gameplay-view, inspector, and affinity-field-bridge read presentation
hazard/resource actors and terrain glyphs. Leave leftover JS-spread overlap
fixture collections and pool denials red.
Validation:
`pnpm run test:vitest -- tests/ui-web/gameplay-selection.test.mjs tests/ui-web/actor-inspector.test.mjs tests/ui-web/gameplay-flow.test.mjs tests/ui-web/gameplay-phaser-renderer.test.mjs tests/ui-web/tile-affinity-visuals.test.mjs tests/architecture/persona-boundary.test.js` and `pnpm run typecheck`.

Leftover sandbox-tick S1/S2/S3, MCP tick-control, tick-visualization,
10-tick ring, and cost-summary stubs now run. Leave proximityRadius,
spawn/exit occupancy, auto-place without radius, dry-run invalid
permanenceMode, VSR vault V1 resources, and pool denials red.
Validation:
`pnpm run test:vitest -- tests/adapters-cli/ak-mcp-sandbox-tick.test.mjs tests/integration/mcp/mcp-tick-control.test.js tests/integration/mcp/tick-visualization.test.js tests/integration/cli-verification.test.js tests/adapters-cli/ak-cost-summary.test.js tests/adapters-cli/ak-resource-affinity-spec.test.js tests/runtime/world-state-resources.test.js tests/architecture/adapters-cli-no-actor-authoring.test.js` and `pnpm run typecheck`.

Leftover `--tile-barrier` becomes Configurator barrier actors. Leftover CLI
V1 `tier`/`stat`/`dropRate` is rejected at parse. Leave llm-plan/warden-pool
0, t1-medium rooms pool, overlay string-affinity, and leftover MCP skipped
stubs red.
Validation:
`pnpm run test:vitest -- tests/adapters-cli/ak-errors.test.js tests/integration/ak-create-hazard-resource.test.js tests/integration/element-matrix-cli.test.mjs tests/architecture/adapters-cli-no-actor-authoring.test.js tests/architecture/persona-boundary.test.js` and `pnpm run typecheck`.

Leftover `--vital-default` uses Configurator DEFAULT_VITALS. Phaser/preview
draw presentation hazard/resource actors. Actor geometry and visualization
use terrain. Kernel affinity-summary does not read leftover layout.hazards.
Leave llm-plan/warden-pool 0, t1-medium rooms pool, overlay string-affinity,
leftover `--tile-barrier`, and leftover MCP skipped stubs red.
Validation:
`pnpm run test:vitest -- tests/ui-web/gameplay-phaser-renderer.test.mjs tests/runtime/affinity-aura-lifecycle.test.js tests/adapters-cli/ak-affinity-summary.test.js tests/personas/actor/actor-decision-inputs.test.js tests/architecture/persona-boundary.test.js tests/architecture/dependency-direction.test.js` and `pnpm run typecheck`.

Leftover sandbox MCP place rebuilds through Configurator terrain + roster.
No leftover tiles/legend/traits/loot. V1 dropRate stays rejected.
`ak run --tile-wall/--tile-floor` mutate terrain; leftover `--tile-barrier`
stays rejected. `--actor` requires a unified category.
Leave llm-plan/warden-pool 0, t1-medium rooms pool, overlay string-affinity,
and leftover `--vital-default` glue table red.
Validation:
`pnpm run test:vitest -- tests/adapters-cli/ak-mcp-sandbox-tick.test.mjs tests/integration/mcp/sandbox-entities.test.js tests/adapters-cli/ak-errors.test.js tests/architecture/adapters-cli-no-actor-authoring.test.js tests/architecture/persona-boundary.test.js tests/architecture/dependency-direction.test.js` and `pnpm run typecheck`.

Leftover affinity-summary and CLI/MCP 10-tick creates use Configurator
artifacts and V3 resources. Leave llm-plan/warden-pool 0, t1-medium rooms
pool, overlay string-affinity red.
Validation:
`pnpm run test:vitest -- tests/adapters-cli/ak-affinity-summary.test.js tests/integration/cli-verification.test.js tests/integration/mcp/mcp-tools.test.js` and `pnpm run typecheck`.
Session refresh ran with --no-pull to preserve the approved base. Serena activated on this worktree and CodeContext regenerated. The maintainer authorized committing and pushing the UA.1/UA.2 cloud handoff. Future commits/pushes follow the active cloud task instructions.

Contract test discovery used ak_test_discover_patterns(suite=contracts). Its scaffoldable recipe tests runtime validators; UA.1 tests TypeScript declarations, so use a compiler-backed positive/negative fixture instead. The MCP tool server is attached to the original repo: do not use its mutating scaffold/run tools for this worktree. Use local pnpm commands with explicit cwd.

UA.1 command: pnpm run test:vitest -- tests/contracts/unified-actor-contract.test.js
Owner gates: pnpm run test:vitest -- tests/contracts/ tests/architecture/schema-declaration-origin.test.js tests/architecture/schema-catalog-coverage.test.js
Type gate: pnpm run typecheck
Final program gates: LLM_INTERNAL_HOST=192.0.2.10 pnpm run test; pnpm run typecheck; pnpm run test:vitest -- tests/architecture/
The documentation-only host is for dry-run tests; never execute remote benchmarks.


UA.2 commands (completed):
- pnpm run test:vitest -- tests/core-ts/ tests/contracts/unified-actor-contract.test.js
- pnpm run test:vitest -- tests/architecture/dependency-direction.test.js tests/architecture/ports-and-adapters-boundary.test.js tests/architecture/core-behavior-wiring.test.js tests/architecture/schema-declaration-origin.test.js tests/architecture/schema-catalog-coverage.test.js
- pnpm run typecheck
- Restored perturbation check: pnpm run test:vitest -- tests/core-ts/actor-registry.test.mts tests/contracts/unified-actor-contract.test.js


## Local continuation commands — 2026-09-08
The maintainer continued locally after the published checkpoint. Session refresh
ran with --no-pull and LLM_INTERNAL_HOST=192.0.2.10. All source edits are confined
to this worktree. No additional commit/push or remote benchmark was performed.

For each component (UA.3, UA.4a, UA.6a, UA.7a, UA.5a, UA.8a, UA.5b1):
1. Run its new tests to prove red before implementation.
2. Run pnpm run test:vitest -- tests/core-ts/ plus the dependency-direction,
   ports-and-adapters-boundary and core-behavior-wiring test files.
3. Run pnpm run typecheck.
4. Apply its documented perturbation, observe failures, restore original bytes.
5. Continue at the next bounded milestone after green validation.

Final local verification uses the three final program gates listed above.
See Documentation.md for exact measured counts and pending integration.


September 10 continuation added focused casts, shared ActorAction declarations,
serializable action windows, once-only field/regeneration phases and Configurator
preset normalization. Core gates and owner-specific Configurator gates were run
per milestone, with restored affordability/action/single-pulse/category-invariance
perturbations. Full-suite logs for this continuation use /tmp/unified-actor-sep10-*,
but the measured evidence is recorded portably in Documentation.md.

### September 14 — receiver field forecast (M)

Owners dependency-direction then persona-actor. Core targets actor-affinity.ts,
actor-fields.ts and actor-fields.test.mts: extract the existing routing callback
and forecast a detached receiver's vital changes from observed local fields.
Forecast is receiver-local, before competition from other receivers, with bounded
source amounts; never applies world mutation. Reuse changeActorVital for caps and
terminal defeat. Actor targets controller.js and its field/objective fixtures:
consume unified fields, remove grant/vitalEffects scoring, retain tuple members.
Oracles: fire 5 into durability 3 removes 3 durability/2 health; draw restores only
mana capacity; absent vitals get no benefit or harm. Negative self/terminal tests.
Run core, Actor, owning guards and typecheck. Perturb overflow routing to require
red and restore. Stop when narrow gates pass; global legacy reachability remains
tracked, and equipment counterfactual projection is subsequent work.

### September 14 — reusable field exposure calculation (S)

Owner architecture-dependency-direction. Targets core rules/actor-fields.ts,
tests/core-ts/actor-fields.test.mts and execution documentation. Extract the
existing receiver exposure calculation as actorFieldExposureAmount(receiver,
cell, localCells); projection must call it. Preserve numerical formulas and
leave finite budget, absorption credit and vital routing with their resolvers.
Tests: inactive inventory does not alter exposure, self/terminal receivers have
zero exposure, and projected targets equal helper results over all active pairs.
Run core suite, typecheck and owner boundary guards. Perturb self-exposure check
and require red. Stop on green; Actor field scoring migration follows.

### September 14 — deterministic composed selection (S)

Owner persona-actor; targets controller.js, README.md, motivation-composition
and decision-objective tests. Rank each actor's deduplicated proposals through
the same composed objective as solver requests. Emit one selected action per
actor and derive its intention from the winning row. Preserve effect requests.
Failing oracle: adjacent hostile with patrol plus attacking emits exactly one
cast even when patrol is authored first. Validate Actor and its four skill
architecture guards, plus typecheck. Perturb by selecting the first candidate;
restore after the oracle fails. Stop when these gates pass.

### September 14 — composed solver ranking (S)

Owner: persona-actor. Targets: Actor controller.js, Actor README.md, and
tests/personas/actor/actor-decision-objective.test.js. Evaluate each candidate
against each authored motivation with the existing nine-member tuple; select
the lexicographically greatest complete row. Do not blend feature slots.
Failing oracle: attacking after stationary must rank its focused cast exactly
as attacking alone; reversing motivation order must preserve rank values.
Validation: Actor suite plus the four persona-actor skill architecture guards.
Perturbation: use only the first profile and require that oracle to fail.
Stop condition: those gates pass; deterministic selection and equipment utility
remain separate subsequent milestones.

### September 14 — equipment field reprojection (S)

Owner dependency-direction. Targets core actor-fields.ts and actor-fields.test.mts.
Expose projectActorFieldsAt(actors, position) and share its projection with the
existing full-grid path. Input is detached observed actors; no equipment mutation
or pulse. Oracle: replacing a receiver's active pair with owned fire/draw gives
mana benefit; water/emit cancels equal fire; originals stay unchanged. Compare cell
projection with the full grid, including opposite-source and input-order cases.
Run core, dependency/ports/reachability guards and typecheck. Perturb opposition
cancellation and require the water oracle to fail, then restore. Actor integration
is the next S milestone; do not claim candidate selection from core-only tests.

### September 15 — observed contributions and field-driven equip (two S)

Core owner dependency-direction: actor-fields.ts, actor-observation.ts and their
core tests. Preserve pre-cancellation contributions scoped to visible cells;
equipment reprojection replaces only the observer's contribution, keeping unseen
emitters. Share opposition code with execution. Negative test: offscreen cells
must not leak. Run core, dependency/ports guards, typecheck; perturb contribution
preservation and require red. Known reachability baseline stays unchanged.

Actor owner persona-actor: controller.js, README.md and new actor-equipment test.
Generate owned equip alternatives for strict improvement in existing fieldSafety/
fieldBenefit order relative to keeping equipment. Classify as a stationary turn
and score the resulting active pair through the same objective; ties retain current.
Test fire/draw, water/emit, disabled equip, same-tick-only equip output, unchanged
mana, and solver envelope parity. Field-driven candidates only in this milestone;
focused-target equipment evaluation remains next. Run Actor plus four owner guards.

### September 15 — taking candidates (S)

Owner persona-actor: controller.js, README.md and actor-taking.test.js. Emit take
for each named unclaimed holding on a defeated source within Chebyshev distance
one, for living canTake receivers. Distinct source/holding candidate IDs, deterministic
source/holding ordering, stationary intent class in existing tuple. Retain defeat
and holding facts in solver observations; terminal remnants are not combat targets.
Core alone claims rewards. Oracles: stack-8 source yields one stack, unchanged active
pair, same-turn second action rejected, stale competing claims rejected; invalid
lifecycle/range/capability/claim cases never proposed. Run Actor + four guards and
typecheck. Perturb lifecycle eligibility to require red; restore. Stop on green.

### September 15 — focused equipment readiness (S)

Owner persona-actor: controller.js, README.md, actor-equipment-fields.test.js.
Use the ordinary nearest-hostile cast proposal and existing intent classifier to
evaluate focused readiness for each owned pair. Compare readiness then existing
field safety/benefit against keeping equipment; equal outcomes keep current.
Do not invent damage multipliers or affordability policy. Equipment is still one
stationary action; next-tick casting follows normal core acceptance. Tests: an
out-of-range active pair switches to an owned in-range pair, no same-tick cast;
equal reach, canCast=false, absent/defeated/allied target and stationary motivation
do not trigger focused-only switches. Run Actor/four guards/typecheck, perturb
readiness contribution and require red; restore. Cost-aware and richer target
effect scoring require separate audited work if found necessary.

### September 15 — unified Actor solver records (S)

Owner persona-actor. Targets controller.js, README.md, actor-affinities-reach-
decision-envelope.test.js and actor-runtime-decision.test.js. Emit common live
mechanical properties for self and visible actors; preserve motivations, defeat,
equipment and holdings as detached facts. Remove Actor's hazard collector and
affinityGrants output, category kind dispatch and configured-alignment override.
Keep envelope conventions. Tests assert no legacy arrays, all live properties,
detached payloads and common stationary actor records. Run Actor/four guards plus
typecheck. Perturb a live vital alias and require red; restore. Shared envelope
reader/adapter cleanup is a later owner milestone.

### September 16 — remove conventional core combat

Owner architecture-dependency-direction. Targets core src/index.ts,
rules/combat.ts (delete), rules/affinity-damage.ts (stale comment), and
tests/core-ts/{combat-actions,affinity-damage,affinity-neutralization,
hazard-durability,hazard-regen,no-conventional-attack}.test.mts.
Failing oracle: createCore must not expose applyAttack. Delete its implementation
and conventional-only tests; preserve affinity, vitals, and turn rejection tests.
Validation: pnpm exec vitest run tests/core-ts; pnpm run typecheck;
pnpm exec vitest run tests/architecture. Stop when no production applyAttack
implementation remains and core tests pass; do not broaden into other legacy
state/API removals or relax the reachability ratchet.

### September 16 — shared runtime-decision reader (S)

Owner architecture-dependency-direction. Targets runtime-decision.mts,
runtime-decision-contract.test.js, actor-adapter-policy-residue.test.js,
Actor controller.js and README.
Failing oracle: pnpm exec vitest run tests/runtime/runtime-decision-contract.test.js
tests/architecture/actor-adapter-policy-residue.test.js
Validation:
pnpm exec vitest run tests/runtime/runtime-decision-contract.test.js tests/personas/actor/
pnpm exec vitest run tests/architecture/persona-boundary.test.js tests/architecture/actor-runtime-decisioning-authority.test.js tests/architecture/actor-adapter-policy-residue.test.js tests/architecture/adapters-cli-no-actor-authoring.test.js tests/architecture/dependency-direction.test.js tests/architecture/ports-and-adapters-boundary.test.js
pnpm run typecheck
Perturb by restoring envelope.hazards; the new contract test must fail; restore.
Stop when those gates pass. Do not start CLI producer or remaining core API removal.

### September 16 — hazard authoring vitals (S)

Owner persona-configurator. Targets input-preparation.js, configurator-hazard-vitals.test.js,
Configurator README.
Failing oracle: pnpm exec vitest run tests/personas/configurator/configurator-hazard-vitals.test.js
Validation:
pnpm exec vitest run tests/personas/configurator/
pnpm exec vitest run tests/architecture/persona-boundary.test.js tests/architecture/configurator-actors-authority.test.js tests/architecture/configurator-cards-authority.test.js tests/architecture/pricing-authority.test.js
pnpm run typecheck
Perturb by restoring raw authored vital spread; the mapHazards test must fail; restore.
Stop when those gates pass. Do not start movementStamina or remaining CLI fixture sweeps.

### September 16 — movement stamina from placed roster (S)

Owner persona-configurator, with a thin orchestrate-build.js call-site.
Targets unified-actors.js, configurator-services.js, controller.js,
configurator-movement-stamina.test.js, orchestrate-build.js, Configurator README.
Failing oracle: pnpm exec vitest run tests/personas/configurator/configurator-movement-stamina.test.js
Validation:
pnpm exec vitest run tests/personas/configurator/ tests/integration/unified-actor-production-build.test.mjs
pnpm exec vitest run tests/architecture/persona-boundary.test.js tests/architecture/configurator-actors-authority.test.js tests/architecture/configurator-cards-authority.test.js tests/architecture/pricing-authority.test.js
pnpm run typecheck
Perturb by skipping roster fill and returning only the explicit map; the new
omitted-map test must fail; restore.
Stop when those gates pass. Glue must call assembleMovementStamina rather than
invent ID costs. Do not start remaining CLI/card defaults or leftover core APIs.

### September 16 — one-time hazard vitals (S)

Owner persona-configurator. Targets input-preparation.js mechanicalVitals,
configurator-hazard-vitals.test.js, Configurator README.
Failing oracle: pnpm exec vitest run tests/personas/configurator/configurator-hazard-vitals.test.js
Validation:
pnpm exec vitest run tests/personas/configurator/
pnpm exec vitest run tests/architecture/persona-boundary.test.js tests/architecture/configurator-actors-authority.test.js tests/architecture/configurator-cards-authority.test.js tests/architecture/pricing-authority.test.js
pnpm run typecheck
Perturb by copying current/max/regen from one-time records; the new one-time test
must fail; restore.
Stop when those gates pass. Do not start leftover CLI parsers or core API removal.

### September 16 — CLI hazard affinity authoring (S)

Owner persona-configurator. Targets input-preparation.js mapHazards,
configurator-hazard-vitals.test.js, Configurator README.
Failing oracle: pnpm exec vitest run tests/personas/configurator/configurator-hazard-vitals.test.js
Validation:
pnpm exec vitest run tests/personas/configurator/
pnpm exec vitest run tests/architecture/persona-boundary.test.js tests/architecture/configurator-actors-authority.test.js tests/architecture/configurator-cards-authority.test.js tests/architecture/pricing-authority.test.js
pnpm run typecheck
Perturb by requiring affinity to be an object; the new CLI-shape test must fail; restore.
Stop when those gates pass. Do not start resource CLI extras or leftover core APIs.

### September 16 — CLI resource vital holdings (S)

Owner persona-configurator. Targets input-preparation.js mapResources,
configurator-resource-actors.test.mjs, Configurator README.
Failing oracle: pnpm exec vitest run tests/personas/configurator/configurator-resource-actors.test.mjs
Validation:
pnpm exec vitest run tests/personas/configurator/
pnpm exec vitest run tests/architecture/persona-boundary.test.js tests/architecture/configurator-actors-authority.test.js tests/architecture/configurator-cards-authority.test.js tests/architecture/pricing-authority.test.js
pnpm run typecheck
Perturb by spreading CLI extras into normalizeActorDefinition; the new V3 test
must fail; restore.
Stop when those gates pass. Do not convert V1 tier/stat or leftover core APIs.

### September 16 — budgetScaffold layout strip (S)

Owner persona-configurator. Targets artifact-builders.js cloneLayoutData,
configurator-artifact-builders.test.js, Configurator README.
Failing oracle: pnpm exec vitest run tests/personas/configurator/configurator-artifact-builders.test.js
Validation:
pnpm exec vitest run tests/personas/configurator/
pnpm exec vitest run tests/architecture/persona-boundary.test.js tests/architecture/configurator-actors-authority.test.js tests/architecture/configurator-cards-authority.test.js tests/architecture/pricing-authority.test.js
pnpm run typecheck
Perturb by treating budgetScaffold as a LAYOUT_FIELDS member; the new strip
test must fail; restore.
Stop when those gates pass. Do not convert V1 resource shapes or leftover core APIs.

### September 16 — autonomous completion queue (rows 1–5)

Row 1 skipped (Decide): no lossless V1 holdings map; would invent vital keys
and loot `dropRate`.
Row 2 landed three runtime.init families; remaining category-storage families
stay red.
Row 3 landed: visibility/mvp-movement omit hazards collection; keep
placeResourceAt / armStaticHazardAt.
Row 4 landed: ui-web Phaser reads hazard actors from observation.actors.
Row 5 stop: write Decide, do not implement. Tick policy vs core legality.

### September 16 — runtime observation hazards (S)

Owner architecture-dependency-direction. Targets runtime-fsm.mjs,
hazard-vitals-in-observation.test.js, observation-line-of-sight-per-actor.test.js.
Failing oracle: pnpm exec vitest run tests/runtime/hazard-vitals-in-observation.test.js tests/runtime/observation-line-of-sight-per-actor.test.js
Validation:
pnpm exec vitest run tests/runtime/hazard-vitals-in-observation.test.js tests/runtime/observation-line-of-sight-per-actor.test.js tests/runtime/runtime-unified-observation.test.mjs tests/runtime/affinity-aura-lifecycle.test.js tests/architecture/dependency-direction.test.js tests/architecture/ports-and-adapters-boundary.test.js
pnpm run typecheck
Perturb by reattaching hazards: [] on the registry observation; the vitals test
must fail; restore.
Stop when those gates pass. Do not convert V1 resource shapes or leftover core APIs.
