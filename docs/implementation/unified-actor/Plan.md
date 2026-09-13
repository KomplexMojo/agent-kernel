# Unified Actor Rewrite — execution source
## START HERE
**Production cutover is now active after 41d2c1df.** Existing artifact builders
and core-setup were replaced in the working tree. Legacy fresh authoring producers
and runtime/UI callers still need migration; full gates are temporarily red.
Read the production cutover section at the end. Do not add fallback readers or
reset to the previous green checkpoint to hide migration failures.
Branch codex/unified-actor in the current repository checkout, base 9a9168f8c63b07b1e9e789daa598a6edaa061cbd. Original worktree has unrelated uncommitted work. Do not stage, modify, or copy it.

Approved behavior is fully recorded in Prompt.md; no access to the original conversation is required. UA.1–UA.3 are complete. Core components UA.4a, UA.5a, UA.5b1, UA.6a,
UA.7a and UA.8a are implemented and verified in the local working tree. The
published checkpoint de2a932 contains only UA.1/UA.2. Focused casting and serializable one-action windows (UA.5b2a/UA.6b0–2), plus
Configurator preset normalization (UA.9a), are now implemented locally. Public core
replacement, area cast actions, producer migration and milestones
9b–20 remain pending. Do not
report component tests as proof of runtime integration.

## Ordered work
1. UA.1 contracts: unified actor/actions/snapshot declarations and compile-time positive/negative fixtures.
2. Core registry: stable string IDs, capabilities, terrain and generic occupancy.
3. Common vitals and terminal defeat.
4. Explicit affinity matrix; remove conventional combat.
5. Common targeted/field resolution, finite absorption, actual transfers.
6. Single active pair; tick-consuming equip; one actor mana pool.
7. Atomic take and once-only one-stack rewards.
8. Generic movement and core API replacement.
9. Configurator preset normalization/validation.
10. Director preset requests and overrides.
11. Allocator property pricing and new action costs.
12. Runtime startup/load/dispatch common actor list; remove index maps and patches.
13. Actor alignment and composed motivation candidates; no melee fallback.
14. Actor equip/take candidates and solver handoff.
15. Moderator ordering and one field pass after actions.
16. Annotator unified snapshots and equipment/defeat/claim events.
17. CLI/MCP/web/solver transport consumers.
18. Render/UI inspectors, inventory and controls.
19. Old producer/consumer and fixture removal; affected docs in each milestone.
20. Adversarial verification, complete gates, replay/cross-surface oracles.

Each owner reads its skill before edits. Keep each milestone bounded; the maintainer on 2026-09-08 authorized continuing locally across milestones until completion or token exhaustion. No generic ECS, new persona, unrelated cleanup, or legacy backend. Reuse spatial/balance helpers except explicitly replaced outcomes. Remaining runtime integration is expected after the declaration milestone; do not preserve deprecated declarations merely to disguise pending work.

## UA.1 exact scope — COMPLETE
Owner architecture-artifacts-contracts; supporting structured-test-authoring. Targets packages/runtime/src/contracts/artifacts.ts; tests/contracts/unified-actor-contract.test.js; tests/fixtures/contracts/unified-actor-contract.ts; packages/runtime/src/contracts/README.md; docs/readme-index.md. Add ActorRecord and its supporting shapes; use it for InitialStateArtifactV1.actors and WorldStateArtifactV2.actors. Presentation is an external ID map. Replace ActionV1 with a discriminated union of wait/move/cast_affinity/equip_affinity/take. Keep envelope selectors unchanged. Delete superseded world-state subtype declarations. Hazard/Resource authoring artifacts remain until producer migration; do not implement their compatibility handling.

Validation: new compiler-backed fixture test red before declarations, green after; contract suite + schema origin/catalog guards; pnpm run typecheck. Perturbation: permit attack in the action union and prove the negative fixture fails with an unused expected-error diagnostic, then restore. Stop after this bounded milestone and record remaining migration explicitly.

## Acceptance oracles for later milestones
Fire/earth 5 vs durability 3, health 10 => 0/8. Water/decay => 3/5. Corrode => 0/10. Life drain kills through durability and transfers actual removal. Defeat is terminal. Equip preserves mana and allows no second action. Finite field absorption. Stack-8 source grants one stack per pair once. Mobile resource/motivated barrier use common rules. Label-only changes do not affect behavior/price. Equal alignment allies regardless of preset. Composed motivation/equipment choices deterministic with no tie-switch churn. CLI/MCP/UI normalization equivalent. Core snapshots and tick frames replay identically.

## Next implementation seam (updated September 10)
Continue in this worktree at local checkpoint 4736f9ab plus its later changes,
never from the old remote checkpoint. Read rules/actor-turn.ts and its tests, plus Configurator's public
normalizeActorDefinition method. Component focused casts, action exclusivity,
field suppression and once-only field/regeneration phases now work and replay.
They are not wired to createCore or the old Moderator/runner.

Configurator now exposes normalizeActorRoster (UA.9b2), plus
resolveActorTurnCosts with all forty pairs/five tiers
and explicit per-ID movement costs (UA.9b1). Allocator exposes equip/take at the
default-action rate and no named attack charge (UA.11a); property pricing remains.
Component integration tests cover Configurator -> core combat/loot/equipment and
registry-plus-turn replay, including both fire-room alternatives (UA.20a).

Next bounded milestone should assemble normalized actor records in the existing
Configurator artifact builder (remaining UA.9b), then build the single-list core startup path
(UA.8b/UA.12) and replace callers. Inspect Configurator artifact-builders.js,
actor-authoring.js, runner/core-setup.mjs and runtime-fsm.mjs via Serena before
specifying exact files/tests. Do not put normalization or pricing decisions in
runner glue. Shared mana costs remain Configurator-authored stack-tier data;
Allocator token costs are separate. Existing core focused mana formula is zero
and must not substitute for the authored table.

The new turn window consumes ActorAction, a common registry, cast-tier prices and
per-ID movement stamina costs. Moderator must own tick ordering and invoke
closeActions -> resolveFields -> regenerate -> resolveExits once. Its snapshot (accepted IDs,
phase flags and suppressions) must travel with registry state for replay. Area
cast actions currently reject at the focused cast primitive; establish their
single-pass integration without an extra pulse before switching production.
Capability-driven exit dwell now works in the component turn window (UA.8c).
Complete public core export removal and production adoption remain outstanding.

File-backed InitialState fixtures now cover invalid active keys, duplicate pairs
and defeat vitals, with a valid control (UA.1b). They exercise core record loading.
Pending: invalid-action artifact fixtures and exercising the same fixtures through
actual Configurator/adapter consumers. This is not yet cross-surface artifact
validation. No benchmark or merge into main.

## UA.2 bounded specification — COMPLETE
Owner architecture-dependency-direction, with the UA.1 artifact re-export seam. Targets: packages/core-ts/src/state/actor-types.ts (mechanical types moved from artifacts.ts), packages/core-ts/src/state/actor-registry.ts (registry component), packages/runtime/src/contracts/artifacts.ts (type imports/re-exports only), tests/core-ts/actor-registry.test.mts, packages/runtime/src/contracts/README.md. No runtime action dispatch or public createCore API change in this milestone.

Exact component API: createActorRegistry(snapshot: ActorRegistrySnapshot), where snapshot = {dimensions:{width,height}, terrain: TerrainKind[] row-major, actors:ActorRecord[]}. TerrainKind = wall|floor|spawn|exit (barriers are actors). Methods getActor(id):ActorRecord|null, getActorsAt(point):ActorRecord[], isMovementBlocked(point):boolean, isSightBlocked(point):boolean, snapshot():ActorRegistrySnapshot. Actor results sorted by ordinal UTF-16 ID; all inputs/outputs detached. Unknown IDs return null. Out-of-bounds positions are blocked. Walls block movement and sight. Alive actor capabilities independently control movement/sight blocking. Defeated/exited actors do not block; exited actors are absent from spatial queries. At most one living movement blocker per cell; arbitrarily many nonblockers may share it. Reject duplicate/empty IDs, invalid geometry/positions, wall placement, non-JSON state, and extra top-level actor fields. Runtime semantic validation of vitals/inventory and state mutation belongs to later milestones.

Tests before code: multi-actor identity with __proto__ ID; blocker collision and nonblocker sharing; wall/boundary and independent sight blocking; inactive actors; input/read/snapshot alias isolation; JSON round-trip and insertion-order independence; invalid dimensions/terrain/positions/IDs. Perturbation removes blocker-collision rejection and must turn the collision test red. Gates: pnpm run test:vitest -- tests/core-ts/ tests/contracts/unified-actor-contract.test.js; owner architecture guards; pnpm run typecheck. Stop after UA.2 and update status, explicitly retaining runtime integration as pending.


## Owner routing and edit boundaries for remaining milestones

Read the named `.claude/skills/<owner>/SKILL.md` before coding and use its narrow
validation commands. Do not combine multiple persona policies in one milestone.
Split work exceeding one M (500 LOC / 8 files) or two S into explicit handoffs.

| Milestones | Owner | Allowed surfaces |
| --- | --- | --- |
| 3–8 | architecture-dependency-direction | packages/core-ts/ and tests/core-ts/; thin runtime contract type handoff only as required |
| 9 | persona-configurator | packages/runtime/src/personas/configurator/, tests/personas/configurator/, Configurator authority guards |
| 10 | persona-director | packages/runtime/src/personas/director/, tests/personas/director/ |
| 11 | persona-allocator | packages/runtime/src/personas/allocator/, tests/personas/allocator/, pricing and Allocator authority guards |
| 12 | architecture-dependency-direction | runtime build/runner glue and integration tests; no domain decisions in glue |
| 13–14 | persona-actor | packages/runtime/src/personas/actor/, tests/personas/actor/, Actor decisioning authority guards |
| 15 | persona-moderator | packages/runtime/src/personas/moderator/, tests/personas/moderator/, effect-port coordination when needed |
| 16 | persona-annotator | packages/runtime/src/personas/annotator/, tests/personas/annotator/ |
| 17 | architecture-adapter-io | adapter directories and necessary ports; CLI/MCP transport-only edits under dependency-direction ownership |
| 18 | architecture-dependency-direction | runtime render models, packages/ui-web/, fixture-based UI tests |
| 19 | affected consumer's owner | obsolete fixture/consumer removal and affected descriptive/normative docs |
| 20 | adversarial verification | tests, documented perturbations, replay and cross-surface acceptance; fix failures under the owning skill |

For every core milestone run `pnpm run test:vitest -- tests/core-ts/` and
`pnpm run typecheck`. Persona milestones run their behavior suite and their
skill's exact authority guards. Final program gates are full `pnpm run test`,
`pnpm run typecheck`, and `pnpm run test:vitest -- tests/architecture/`.
Each milestone needs exact target files, failing tests, validation command,
explicit stop condition, and an updated tracked Documentation.md before handoff.

The original planning estimate was 20–30 bounded implementation milestones and
50–90 engineering hours. It is a provisional estimate, not a performance claim or
permission to stop before the selected milestone's acceptance criteria pass.

## Local continuation — 2026-09-08
The maintainer did not move to cloud. Continue locally in the isolated worktree;
the prior one-milestone stopping limit is superseded. Preserve the published base.

### UA.3 exact specification
Owner architecture-dependency-direction; targets state/actor-registry.ts,
state/actor-vitals.ts, tests/core-ts/actor-registry.test.mts,
tests/core-ts/actor-vitals.test.mts, contracts/README.md, and these execution records.
Add changeVital(id, vital, delta): number returning signed actual change and
regenerate(): void for one caller-scheduled regeneration pass. Missing actor/vital
or inactive actor returns zero. Nonfinite delta/invalid vital is rejected before
mutation. Validate optional vital records, finite nonnegative bounds, current <=
max, selected health/durability presence, alignment, lifecycle and capabilities.
Normalize loaded alive actors with selected vital zero to defeated before occupancy;
reject defeated snapshots with positive selected vital. Defeat is terminal and
immediately removes blocking through common queries. No action/tick API yet.
Tests: invalid vital tables; selected-vital depletion vs other depletion; clipped
actual deltas; missing vital; terminal restoration/regen; zero-at-load and replay.
Red command: pnpm run test:vitest -- tests/core-ts/actor-vitals.test.mts.
Validation: core-ts suite, typecheck, and all three owner boundary guards.
Perturbation: bypass inactive-actor vital guard; terminal restoration test must fail.
Stop condition: these gates pass and evidence is recorded, then proceed to UA.4.

### UA.4a exact specification — affinity vital routing component
Split UA.4: implement routing now; deletion of conventional combat is UA.4b,
coordinated with UA.8/12 callers so no broken production dispatch is hidden.
Owner architecture-dependency-direction. Targets core rules/actor-affinity.ts,
tests/core-ts/actor-affinity.test.mts, and contracts README/execution records.
One explicit matrix maps kind and expression to damage/restore/drain/neutralize.
A common resolver consumes a validated finite nonnegative magnitude supplied by
spatial/scaling callers. Fire/earth first remove durability, overflow to health;
water/decay bypass; corrode has no overflow. Transfer only actual removal, cap
receiver, reject self-drain before mutation. Missing vitals receive no effect.
Neutralization routes make no vital changes; active exposure suppression is UA.5.
Tests first: all ten kinds × four expressions, three numeric durability oracles,
missing pools, actual transfer/clamping, terminal source/target and invalid amounts.
Validation: core-ts suite, typecheck and three owner boundary guards.
Perturbation: skip durability consumption, numeric fire/earth oracle must fail.
Stop condition: routing gates pass, limitations recorded; proceed to UA.5.

### UA.6a prerequisite — inventory validation and active-slot mutation
Implement this prerequisite before UA.5, which needs validated active equipment.
UA.6b remains action exclusivity in the tick executor. Owner dependency-direction;
read its skill. Targets core state/actor-inventory.ts, state/actor-registry.ts,
tests/core-ts/actor-inventory.test.mts, and descriptive/execution docs.
Validate kinds/expressions, unique pairs, positive safe integer stacks, active key
membership, and motivation list. Add registry equipAffinity(id,key): boolean;
only living canEquip actors may select an owned key; reject same-key/no-op. Do not
change mana or inventory. Action charging/scheduling is explicitly UA.6b.
Tests first: owned alternative switch, no mana reset, invalid/missing active keys,
duplicate pairs, malformed stacks, inactive/incapable/nonowner rejection.
Core suite/typecheck/three owner guards. Perturbation bypasses ownership check;
unowned-pair test must fail. Stop when gates pass, then continue field resolution.

### UA.7a — defeat rewards and atomic claim component
Owner dependency-direction. Targets core state/actor-holdings.ts,
state/actor-registry.ts, tests/core-ts/actor-holdings.test.mts, docs.
Generate canonical holding IDs affinity:<kind>:<expression> once on defeat;
validate unique holdings/claims and explicit vital grants. Add registry
 takeHolding(receiverId,sourceId,holdingId): boolean. Require living canTake,
defeated source and Chebyshev <=1. Clone receiver before grant evaluation;
commit receiver inventory/vitals and claim together only after validating bounds.
One stack per pair independent of source stacks; no auto-equip. Preserve grant
modes from rules/move.ts applyResourceCaptureAt: consumable clips current, others
add to current/max, regen adds independently of mode. Missing pools are unaffected.
No source-vital loot. Action consumption remains the tick-executor milestone.
Tests first: stack8 =>1, repeated/competing claim, distinct pairs, invalid source,
range/capability/lifecycle, grants/modes, replay, malformed/overflow atomicity.
Core/typecheck/three boundary guards; perturbation bypasses claimedBy guard and
must fail the repeated-claim test. Stop when gates pass, then resume UA.5.

### UA.5a — bounded active-exposure resolution component
Owner dependency-direction. Targets rules/actor-exposure.ts,
tests/core-ts/actor-exposure.test.mts, docs. This component consumes core-computed
source budgets and per-target projected magnitudes; UA.5b supplies projection,
range/occlusion/opposition and tick wiring using existing spatial helpers.
API resolveActorExposures(registry, sources), where each source is
{sourceId,budget,targets:[{targetId,amount}]}. Read kind/expression from active
owned equipment. Prevalidate finite nonnegative budgets/magnitudes and duplicate
source/target IDs before mutation. Preserve supplied source order (ordered action
then field caller), sort targets by stable ID. Spend each source budget at most
once, including absorbed exposure; record actual mana credit separately.
Matching draw absorbs into mana; neutralizing pull/draw suppresses only remaining
matching emit/push exposure in this batch, never restores damage. Drain/restore/
damage use the single UA.4a resolver. No self-drain, inactive sources/targets, or
inactive equipment effects. Tests cover finite competing receivers, cap/no heal,
neutralization before/after exposure, mixed matrix outcomes, malformed atomicity.
Core/typecheck/three owner guards. Perturbation stops decrementing emission budget;
competing-receiver test must fail. Stop at passed component gates, then UA.5b.

### UA.8a — generic registry movement prerequisite
Owner dependency-direction. Targets state/actor-registry.ts and
 tests/core-ts/actor-registry.test.mts plus docs. Add moveActor(id,target):boolean
as an internal geometry/occupancy primitive, not a priced or tick-scheduled action.
Require live canMove, safe in-bounds coordinates, nonwall destination and Chebyshev
adjacency exactly 1. Enforce the same at-most-one-live-blocker invariant as load;
nonblockers may share cells. Update both common position and occupancy atomically,
with detached coordinates and stable query order. Never collect holdings on move.
Stamina/action charging, exit dwell and core API replacement remain later steps.
Tests first: movement rejects wall/invalid/same/out-of-range/conflicting blocker,
capabilities/lifecycle gates, nonblocking sharing, old/new position queries,
no pickup, alias protection, snapshot reload. Core/typecheck/owner guards.
Perturbation skips removal from old occupancy and must fail spatial query test.
Stop when gates pass, then resume projection/action integration.

### UA.5b1 — passive projection and opposition component
Owner dependency-direction. Targets core rules/actor-fields.ts,
state/affinity-spatial.ts, state/world.ts (extract existing overlap arithmetic only),
tests/core-ts/actor-fields.test.mts and docs. Project active live canCast emit/draw
pairs using existing Manhattan radius/intensity helpers (origin intensity 1),
base magnitude 1 × stacks and a finite per-source budget of that base magnitude.
Return net per-cell fields for illumination/concealment and exposure inputs for
UA.5a. Preserve strongest same-kind emit at a cell with stable-ID tie-breaking;
draw is a separate neutralizing/draining field, not a replacement emitting source.
Extract and reuse existing projected-intensity opposition subtraction and residual
stack formula. Opposed emit fields cancel locally; inventory is never destroyed.
Only active equipment contributes; fields use current positions. Sources/receivers
use stable ID order. Field projection historically does not test terrain opacity;
do not silently add a new wall rule. Visibility occlusion and focused-cast legality
remain their own later integration seams. Runtime once-per-tick scheduling pending.
Tests first: exact origin budget, finite fire absorption, equal water/fire overlap,
strong/weak residual formula, owned inactive alternatives, movement/defeat removes
projection, light/dark observations and range. Core/typecheck/owner guards.
Perturbation disables opposition cancellation; fire/water test must fail. Stop at
component gates; UA.5b2 handles focused casting and tick integration.

### UA.5b2a — focused cast primitive (September 10)
Owner dependency-direction; target files core rules/actor-cast.ts,
rules/actor-affinity.ts, state/affinity.ts, tests/core-ts/actor-cast.test.mts,
contracts README and execution records. Add castFocusedActorAffinity(registry,
sourceId,targetId,manaCosts). manaCosts maps owned pair keys to five authored tier
prices, matching Configurator's existing clamp-to-tier-5 reader. Validate the data;
missing price rejects. Only living canCast with active push/pull and living target,
Chebyshev <= stacks; reject self-drain. Affordability checked before any write.
Charge only common mana, then route magnitude 2*stacks using existing core scaling.
Extract an expression-base magnitude helper from affinity.ts rather than deriving
magnitude from its legacy sign-reversing matrix. Neutralizing pull returns a
bounded target/pair suppression record for the upcoming tick executor; no healing
or equipment loss. It cannot yet suppress future effects until that executor lands.
Tests first: invalid/no price, unaffordable atomicity, shared mana, tier clamp,
range, inactive/incapable/nonfocused casts, self-drain, overflow and suppression.
Core/typecheck/three owner guards. Perturbation removes affordability guard and
must fail no-mutation test. Stop at passed component gates; next one-action ticks.

### UA.6b0 — shared mechanical action declaration
Owner artifacts-contracts with dependency-direction type handoff. Targets core
state/actor-types.ts, runtime contracts/artifacts.ts, compiler fixture
 tests/fixtures/contracts/unified-actor-contract.ts and docs. Move the existing
five-kind mechanical action union to core as ActorAction (actorId,tick,kind,params).
ActionV1 intersects it with the unchanged runtime artifact envelope. No schema
selectors or action shapes change. Compile fixture imports ActorAction and rejects
attack there too. Guards: compiler-backed contract test, schema-origin/catalog,
core/typecheck. Perturbation permits attack in ActorAction, negative fixture fails.
Stop after verified type handoff, proceed to UA.6b1 turn execution.

### UA.6b1 — serializable ordered action window
Owner dependency-direction. Targets core rules/actor-turn.ts, rules/move.ts
(extract current movement-cost arithmetic), rules/actor-cast.ts (bounded suppression
input), tests/core-ts/actor-turn.test.mts and docs. Factory takes registry, tick,
authored cast-price table and per-ID cardinal stamina costs, plus optional saved
window {tick,acceptedActorIds,closed,suppressions}. apply(ActorAction):boolean
checks exact tick and records only accepted actions; one accepted action per ID.
Dispatch wait/equip/take/move/focused cast to common primitives. Movement uses
existing cardinal/diagonal formula and requires stamina when cost >0. Failed
moves/casts neither spend pools nor occupy the action. Missing movement price
rejects rather than inventing one. Record focused suppression for later casts and
passive fields. closeActions() ends the window; no fields/regeneration yet.
Snapshot/restore must preserve action exclusivity and suppressions with detached
state. Field pass/regen is UA.6b2. Tests first cover equip->cast rejection, take->move,
failed affordability then wait, wrong tick, unsupported attack, snapshot replay,
movement stamina/invalid destination atomicity, and suppression of a later cast.
Core/typecheck/owner guards. Perturbation skips accepted-ID guard; equip->cast test
must fail. Stop on green component gates, continue one field pass integration.

### UA.6b2 — once-only fields/regeneration and suppression replay
Owner dependency-direction. Targets core rules/actor-turn.ts, actor-fields.ts,
actor-cast.ts (suppression provenance), tests/core-ts/actor-turn.test.mts and
actor-cast.test.mts, docs. Add fieldsResolved/regenerated to saved turn state.
resolveFields() requires closed actions, runs once using current equipment,
and applies recorded focused suppression to matching source budgets. Preserve
caster ID on suppression records. regenerate() requires resolved fields and runs
once. Both flags survive snapshot restoration; invalid phase combinations reject.
A post-field observation does not apply another pulse. Suppression never changes
owned equipment or heals. Tests first: equip activates draw before exactly one
pass, focused pull suppresses pending emit, restored closed/resolved windows
cannot pulse/regenerate again, terminal actors never revive. Field observations
omit fully suppressed sources. Core/typecheck/owner guards. Perturbation removes
fieldsResolved guard; duplicate pass test must fail. Stop on green component gates.

### UA.9a prerequisite — five editable authoring presets
Pull this Configurator prerequisite forward to enable the eventual single-list
loader; do not switch the old runtime piecemeal. Owner persona-configurator.
Targets configurator/unified-actors.js (new), configurator-services.js, controller.js,
Configurator README, tests/personas/configurator/configurator-unified-actors.test.mjs,
execution records. Publish pure normalizeActorDefinition(input) through controller.
Input is {category,id,position,vitals,...mechanicalOverrides}; category required,
id/position/vitals authored. Output {actor,presentation:{category}}. No category in
actor. Apply locked alignment/defeat/move/block defaults, default other capabilities
explicitly (mobile presets canEquip/canTake; delver canExit; barrier blocksSight;
canCast true); preserve overrides, all motivations and owned pairs. Never invent
vital quantities or prices. Require chosen vital and delegate mechanical shape
validation to core's existing validators. Reject unknown input fields/legacy role.
Tests first: five defaults, overrideable mobile resource/motivated barrier,
mechanically identical category-only variants, invalid keys/duplicates/vitals,
input/output detachment and preserved motivations. Run Configurator suite and
persona-boundary/configurator-actors/configurator-cards/pricing authority guards,
typecheck. Perturbation forces alignment by label after overrides; category-only
invariance test must fail. Stop at green helper gates; producer migration is UA.9b.

### UA.9b1 — authored turn-cost assembly (S)
Owner persona-configurator. Targets affinity-rules.js, configurator-services.js,
controller.js, README.md, and configurator-unified-turn-costs.test.mjs. Expose
resolveActorTurnCosts({rules?, movementStamina}) returning core ActorTurnCosts.
Read all five tiers for all forty pairs so newly acquired equipment has authored
costs too. Omitted rules use the existing authored defaults; malformed explicitly
supplied rules fail, never silently default. Movement costs must be explicit
nonnegative safe integers keyed by stable IDs, with no label dispatch. No token
pricing. Tests cover custom tiers, missing/invalid rules/costs, all pairs and
input/output detachment. Perturbation replaces authored tier mana with zero.
Run Configurator suite, four owner guards and typecheck; stop at green gates.
Artifact producer migration follows separately. Existing reader trace, Sep 10:
fire/push tiers 1..5 returned [3,6,9,12,15] through the public controller.

### UA.1b — reusable invalid actor artifacts (S)
Owner architecture-artifacts-contracts. Target existing unified-actor-contract.test.js
and four initial-state-artifact-v1-unified JSON fixtures (one valid, three under
invalid/: active-key, duplicate-pair, defeat-vital). Read records into the common
registry; valid control round-trips, invalid records throw specific validation
errors. No claim of full envelope/transport validation. Run contract test, schema
origin/catalog guards, core suite, typecheck. Perturb active-key fixture to valid:
its rejection assertion must fail. Restore. Stop at green fixtures/gates.

### UA.20a — composed component acceptance (S, verification only)
Owner architecture-dependency-direction with public Configurator inputs. Target
new tests/integration/unified-actor-components.test.mjs and execution records.
Normalize authored actors and costs through Configurator, then execute the common
registry/turn primitives: lethal cast, no defeated pulse/regeneration, one-stack
reward, competing claim rejection, equip turn exclusivity and serialized replay.
Second scenario equips both fire/draw and water/emit in a fire room. No claim of
live runner/Moderator/transport adoption. Narrow test then full gates. Perturb
once-only claim guard: competing-claim assertion must turn red. Restore before
gates. Stop at green component integration evidence.

### UA.11a — unified runtime action charges (S)
Owner persona-allocator. Targets allocator-services.js, contracts.ts,
base-costs.json, Allocator README, allocator-action-budget-costs.test.js.
Remove action_attack and named attack schedule property/receipt branch. Expose
schedule equipAffinity and take, each referencing existing action_default (no new
number or independent rate). Receipt maps equip_affinity/take to these rates;
rejected outcomes remain zero and aggregate ledger is not charged twice. Update
exact schedule test and add receipt acceptance/rejection cases. Perturb take rate
to zero; schedule and receipt assertions must fail. Run Allocator suite,
pricing/single-origin/base-costs/receipt authority guards, typecheck and full gates.
Stop at green action accounting. Legacy attack execution and unified spawn pricing
remain separate pending milestones.

### UA.8c — capability-driven exit dwell (M)
Prerequisite pulled forward before runtime replacement. Owner dependency-direction,
with shared mechanical contract extension. Targets core state/actor-types.ts,
state/actor-registry.ts, state/world.ts, new rules/actor-exit.ts, rules/actor-turn.ts,
new tests/core-ts/actor-exit.test.mts, contracts README and execution records.
Expose optional actor exitDwell (omitted = zero), validate integer 0..2, and share
existing EXIT_DWELL_TICKS constant between old world and new rule. A living canExit
actor standing on exit terrain for two consecutive end-of-tick passes exits.
Leaving resets progress. Defeated/exited actors do not advance. Exiting removes
spatial occupancy but retains terminal record. No category/alignment dispatch.
Turn resolveExits() runs once after regeneration, recording exitsResolved in its
snapshot. Return newly exited IDs, null when phase disallows the pass. Replay
must preserve counter and phase guard. No exit action or extra field pulse.
Baseline trace: legacy advanceTick calls regeneration then exit dwell; six legacy
exit-dwell tests passed, including two-tick threshold and vacated occupancy.
Tests first: threshold, capability override, departure/reset, terminal no-revive,
mid-turn JSON replay, duplicate pass rejection and invalid counters. Perturbation
omits spatial removal, occupancy assertion must fail. Validate core, typecheck,
owner architecture guards and schema origin/catalog; stop at green component.

### UA.9b2 — normalized roster assembly (S)
Owner persona-configurator. Targets unified-actors.js, configurator-services.js,
controller.js, Configurator README, new configurator-unified-roster.test.mjs.
Expose normalizeActorRoster({actors,dimensions,terrain}) -> {actors,presentation}.
Normalize authored presets with normalizeActorDefinition; ask a fresh core registry
to validate geometry, duplicate identities, capability-based occupancy and initial
terminal state. Return ordinal-ID records and a separate ID-keyed category map.
Use core's existing path, not Configurator placement/defeat rules or a new engine.
Input/output detached; prototype-like IDs work; duplicate ID rejection precedes
map construction; no category collections. Tests reject overlaps/walls/out-of-bounds,
retain nonblocking co-occupants and terminal rewards, and are order-invariant.
Perturb by skipping registry validation: collision test must fail. Run Configurator
suite + four owner guards and typecheck. This prepares the existing artifact builder
replacement; no parallel artifact builder or historical reader is introduced.

### UA.20b — use roster assembly in component scenarios (XS)
Owner dependency-direction, target tests/integration/unified-actor-components.test.mjs.
Replace per-actor normalization in its setup with Configurator.normalizeActorRoster;
feed its actors to core. Finish the newly added exit phase after regeneration.
Retain the same combat/claim/replay/fire-room assertions. This is component wiring,
not production runner adoption. Run the integration test and final gates. Existing
UA.9b2 bypass-registry perturbation establishes roster validation teeth; additionally
bypass the turn exit phase guard and verify the repeated-pass assertion turns red.

#### Remaining producer scope after UA.9b2 (inspection, not completed)
Director buildspec-assembler.js buildActorsAndGroups currently constructs legacy
kind/archetype, vitals, and [inst.motivation] (called by buildspec assembly around
line 397). Include this producer and its mapped selection source in the next
Director-owned request migration; do not teach the new builder to read historical
legacy state. Configurator then assembles authored definitions via normalizeActorRoster.
commands/kernel.js also reads an actors file directly; replace its affected input
fixtures in place. Existing artifact-builders.js resolved-effects/traits merge must
be removed when producers provide common owned equipment and explicit vitals.
This is a multi-owner sequence, not a single oversized builder edit.

## Production cutover — approved September 10 continuation
The maintainer approved the coordinated artifact/loader migration after discussion
of temporary failures. Replace the existing paths; do not add alternate builders,
legacy readers or compatibility dispatch. Full-suite failures during cutover are
migration work, not a reason to retain obsolete representations. Do not claim the
cutover complete until producers, runtime/personas and surfaces pass their gates.

### UA.9c — replace existing artifact assembly (M)
Owner Configurator with artifacts-contracts for the thin schema handoff. Targets
artifact-builders.js, artifacts.ts, existing configurator-artifact-builders.test.js,
its configurator-artifacts-v1-basic.json fixture, and contract/Configurator READMEs.
SimConfig grid data becomes explicit width/height/terrain, with authored actionCosts
from resolveActorTurnCosts({rules:affinityRules,movementStamina}). Initial builder
accepts authored definitions plus dimensions/terrain and existing meta/simConfigRef;
normalizes via normalizeActorRoster and emits actors/presentation. Remove traits,
resolved-effects merging and legacy entity collections. Keep schema selectors.
Tests: deterministic/detached assembly, known mana tiers, duplicate IDs, rejection
of legacy input, all motivations and pairs preserved. Perturb omission of
presentation and prove assertion red. Narrow Configurator/schema/typecheck gates;
record unmigrated producer failures explicitly and continue to UA.12a.

### UA.12a — replace existing artifact loader (M)
Owner dependency-direction. Targets runner/core-setup.mjs and new
runtime/core-setup-unified.test.mjs, with runner/contract docs. Replace category
placement, actor numeric-index mapping and primary fallback with one loader:
initializeCoreFromArtifacts({simConfig,initialState}) -> {registry,costs,presentation}.
Require normalized grid terrain, matching artifact references, complete presentation
IDs/categories, owned authored records, and explicit movement cost for mobile
actors. Use createActorRegistry and core turn validation; do not supply defaults
or authoring conversions. No startup field pulse. Test real Configurator artifacts
serialized to JSON then loaded, focused cast and take, detached snapshots, invalid
references, missing prices, duplicate/blocking placement and legacy shape rejection.
Perturb reference equality check: test must fail. Remove superseded setup exports;
callers are migrated next, without compatibility aliases. Record full failure
census to guide remaining work; passing this slice is not whole-runtime completion.

### UA.10a — Director actor request handoff (M)
Targets Director buildspec-assembler.js, summary-selections.js, pool-mapper.js,
README.md and tests/personas/director/director-unified-requests.test.mjs.
Replace buildActorsAndGroups legacy kind/archetype/traits/tokenCost output with
category plus authored common properties. Preserve explicit overrides, null active
key and complete motivation lists through summary and catalog selection paths.
Retain planning prices in selections; Configurator owns defaults and placement.
Tests first: five categories relay equal properties; requests pass existing
Configurator normalization; summary motivations survive; catalog motivations survive.
Validation: Director suite, persona-boundary/persona-authority guards, typecheck.
Stop at the production Director handoff, recording downstream legacy failures.
Perturbation: truncate the emitted motivation list; composed-motivation test must fail.
Card hazard/resource conversion and generator placement remain subsequent slices.

UA.10a follow-through migrated existing Director assertions in
director-pool-buildspec.test.js and director-build-spec-card-set-roundtrip.test.js
(category replaces archetype; planning prices/setup stay in selections; owned pairs
replace traits). See September 11 Documentation for red/green and remaining work.

### UA.9d — canonical terrain from the production generator (M)
Owner persona-configurator. Targets level-layout.js, Configurator README,
configurator-level-layout.test.js and new configurator-generated-terrain.test.mjs.
Replace generated tiles/kinds/legend and duplicate spawn/exit coordinates with a
row-major TerrainKind array. Keep room geometry, connectivity and rendering hints.
Build terrain from the existing generation mask: hazard positions are floor, not
walls or terrain hazards. Adapt generator validation/counting to terrain directly;
retain existing blocking-hazard floor-budget policy until actor planning migration.
Tests: fixed seeded geometry, seeded determinism, direct public generation ->
SimConfig builder acceptance, core terrain validation and no obsolete properties.
Migrate existing geometry tests using a test-only glyph projection for their graph
oracles, without providing a production legacy view. Perturb floor routing to wall
and prove seeded geometry test red, restore. Run generator suites, Configurator
owner gates and typecheck; record remaining consumer failures. Stop at the terrain
producer; pending hazard/resource actor authoring is not silently dropped.

### UA.9e — Configurator placement reads canonical terrain (S)
Targets new terrain-layout.js, actor-placement.js, Configurator README and new
configurator-terrain-placement.test.mjs. Replace numeric/glyph walkability readers
and duplicate marker coordinates with canonical terrain queries. Preserve strategic
room selection and existing placement ordering in this slice. No legacy fallback
reader; no live actor mutation. Tests use public generated layout -> placeActors ->
InitialState builder, prove valid unique placements and marker-derived entry anchor.
Validate narrow tests and Configurator owner gates. Perturb spawn lookup to missing,
show marker-anchor regression red, restore. Capability/occupant placement policy
migration remains separate and must use core registry validation.

UA.9d/e fixture follow-through (XS): migrate
configurator-level-layout-rooms.test.js and
configurator-actor-placement-capability.test.js to canonical terrain, retaining
all existing room connectivity and placement coordinates. Both suites pass (3 tests).
Next: object-placement.js, feasibility.js, guidance-level-builder.js still consume
old generated layout fields. Complete these readers and hazard/resource actor
requests before rewiring build/kernel assembly. See Documentation for evidence.

### UA.9f — feasibility and preview terrain readers (S)
Owner Configurator. Targets feasibility.js, guidance-level-builder.js, Configurator
README and existing feasibility/layout-feasibility/guidance tests. Replace glyph/
numeric terrain readers with terrainPositions/terrainMarker. Preserve walkable
counts excluding blocking planned occupants; floor-capacity counts exclude all
planned hazard cells, matching the prior generated kinds=0 path (including markers).
Project canonical terrain to glyphs only at the existing preview rendering boundary.
Failing tests: configurator-feasibility, configurator-layout-feasibility and
configurator-guidance-level-builder. Run those suites and the Configurator owner
gates/typecheck. Perturb walkability to empty; feasibility test must fail; restore.
Stop when these consumers pass without a historical layout reader.

### UA.9g — object-placement terrain readers (M)
Owner Configurator. Targets object-placement.js, existing object-placement-problem
test and object-placement-greedy-counterexample.json fixture, README. Replace both
numeric/glyph candidate collectors and marker readers with canonical terrain queries.
Preserve solver constraints, fallback ordering and existing planned occupancy filters.
Migrate the fixture and independent exhaustive-search oracle in place; preserve its
expected assignments and unsat cases. Run object-placement suite and owner gates;
full-build case can remain red at the next unmigrated builder seam. Perturb marker
reservation and require the collision/assignment oracle to fail, then restore.
No actor identity/preset/pricing policy changes in this terrain-reader milestone.

UA.9f/g completed reader migration; latest Configurator gates are 199 passed,
4 failed,1 skipped. All four remaining failures now reach unsupported
hazards/resources in artifact assembly. Next migrate those authoring outputs and
explicit turn costs, not another terrain reader. See Documentation for evidence.

### UA.9h — room-composition marker reader (S)
Configurator owner: mixed-room-composition.js, existing mixed-room-capability test,
new configurator-room-terrain-markers.test.mjs and README. Diagnosis before change:
0..29 seeds did not expose it, but 0..999 produced164 emitters on spawn/exit in
9x9 single3x3-room generation. composeMixedRooms reads removed layout.spawn/exit.
Replace only marker lookup with terrainMarker, preserving random draw sequence,
profiles and candidate ordering. Migrate existing inline geometry fixture to
canonical terrain with unchanged expected positions. New test spans all1000 seeds
and verifies no generated hazard on either marker and one emitter per room.
Run narrow tests, Configurator owner gates and typecheck. Perturb lookup back to
missing: test must fail; restore. Stop at marker correctness before actor outputs.

UA.9h completed September12:1000-seed marker oracle red/green/perturbation verified.
Configurator owner result200 passed/4 failed/1 skipped; four failures still require
hazard/resource authoring conversion. See Documentation for actual producer seams.

### UA.9i — resource preset request authoring (S)
Owner Configurator. Targets input-preparation.js, existing configurator-input-prep
suite and new configurator-resource-actors.test.mjs, README. Replace mapResources'
version-specific and tier/stat projections with normalizeActorDefinition using
resource as the omitted category default. Require common vitals and stable ID;
preserve explicit category/property overrides, motivation list, owned pairs,
active key and named holdings. For unpositioned authoring validate with temporary
0,0 then omit position in the returned request, so placement remains required.
Reject superseded fields rather than reading historical shapes. Existing public
FSM gate remains. Tests prove mapped positioned request builds InitialState and
source vitals do not become loot; invalid active key/legacy fields reject.
Run owner gates/typecheck; perturb holdings omission -> test red; restore.
Stop at resource request output; placement/CLI producers and pricing remain pending.

UA.9i completed: mapResources now emits common resource actor requests; narrow
mapping/InitialState tests pass. Existing input-prep and validate-lock fixtures
migrated (the latter now rejects missing ID during mapping). Configurator final
203 pass/4 fail/1 skipped; same remaining layout collection failures. Remain local
for the session per maintainer. Next move placed resource output into actor-list
handoff with preserved holdings; migrate hazard authoring and old CLI/card inputs.

### UA.9j — resource placement actor output (M)
Configurator owner: object-placement.js, resource-actors test, existing object-placement
suite/fixture and README. Both solver and fallback output placed resource requests
as result.actors, normalized by mapResources after removing placement-only metadata
(kind, roomId, x/y, blocking). Do not write layout.resources. Preserve position,
holdings, equipment and capabilities. Keep hazard output pending its own migration.
Tests run mapped resource -> fallback placement -> InitialState builder; migrate
solver fixture's resource inputs to explicit durability and inspect result.actors.
Run owner gates/typecheck; perturb omit result.actors -> new test red, restore.
Next dependency-direction step consumes result.actors in build glue; no claim of
full-build completion before pricing and remaining hazard pipeline are migrated.

### UA.12b — consume placed resource actors in production build (M)
Owner dependency-direction for orchestrate-build.js and new integration test;
Configurator substep actor-placement.js accepts reservedActors, preserving prior
resource-cell reservations while their records move out of layout. Pass placement
result.actors separately, append them to final authored actor definitions, and
build InitialState with actual dimensions/terrain (remove obsolete refs/effects
arguments). Build SimConfig with explicit configurator.inputs.movementStamina and
affinityRules; no cost defaults in glue. Publish final actors as resolvedActors.
Test budgetless canonical resource request through orchestrateBuild -> JSON ->
production loader, retaining vitals/holdings/category and authored costs.
Run narrow integration, owner boundaries, Configurator suite/typecheck. Perturb
resource-list append omission -> integration red; restore. Budgeted property
pricing, hazard authoring and runtime FSM remain pending; do not claim those work.

### Execution assignment policy — Luna
Bounded implementation milestones may be assigned to GPT-5.6 Luna at high
reasoning effort when their target files, API, tests, validation and stop
condition are explicit. Before any PR, a more capable model must review the
complete accumulated diff and verify architecture, mechanics, tests and gates.
This review is a release prerequisite, not an optional follow-up.

### UA.9k/UA.12c — hazard actor production handoff (completed September 12)
Configurator converts all hazards reaching object-placement completion into
common actors, removes the layout collection, assigns the authored affinity pair
as active equipment, and derives default mana/durability through the existing
balance helper. Strategic actor placement reserves these actor coordinates and
uses alignment instead of words in ids, roles, or motivations. Production build
merges the reserved actors after strategic placement. Next migrate property-based
Allocator pricing and remove the remaining legacy affinity-summary/effect path.

### UA.12d — runtime constructor cutover (next, split before implementation)
The production loader now returns an actor registry and authored action costs,
but runtime-fsm still requires the legacy mutable core API at construction and
imports two deleted setup functions. Split the cutover by call family: startup
and snapshots first, then action execution, observations/effects, and budget
ports. Do not restore the deleted setup exports as aliases. Each submilestone
must replace its legacy core calls with registry/turn operations and migrate the
corresponding runtime tests before proceeding to the next family.
