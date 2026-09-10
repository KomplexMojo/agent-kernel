# Unified Actor Rewrite — execution source
## START HERE
Branch codex/unified-actor in the current repository checkout, base 9a9168f8c63b07b1e9e789daa598a6edaa061cbd. Original worktree has unrelated uncommitted work. Do not stage, modify, or copy it.

Approved behavior is fully recorded in Prompt.md; no access to the original conversation is required. UA.1–UA.3 are complete. Core components UA.4a, UA.5a, UA.5b1, UA.6a,
UA.7a and UA.8a are implemented and verified in the local working tree. The
published checkpoint de2a932 contains only UA.1/UA.2. Focused casting and serializable one-action windows (UA.5b2a/UA.6b0–2), plus
Configurator preset normalization (UA.9a), are now implemented locally. Public core
replacement, area cast actions, exit dwell, producer migration and milestones
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
Continue in this worktree with its uncommitted changes, never from the old remote
checkpoint. Read rules/actor-turn.ts and its tests, plus Configurator's public
normalizeActorDefinition method. Component focused casts, action exclusivity,
field suppression and once-only field/regeneration phases now work and replay.
They are not wired to createCore or the old Moderator/runner.

Configurator now exposes resolveActorTurnCosts with all forty pairs/five tiers
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
closeActions -> resolveFields -> regenerate once. Its snapshot (accepted IDs,
phase flags and suppressions) must travel with registry state for replay. Area
cast actions currently reject at the focused cast primitive; establish their
single-pass integration without an extra pulse before switching production.
Exit dwell and complete public core export removal also remain outstanding.

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
