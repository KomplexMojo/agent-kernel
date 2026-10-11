# Historical milestone evidence

## October 11 — origin/main merged

Five conflicted files were resolved, keeping both sides. Commanded player
turns, own-light sight, and the shared glyphs come from main. The registry,
params.target, and presentation categories come from the rewrite. Player
command moves now emit params.target. `hasExited` was hoisted and reads the
registry lifecycle. The two calls to `resolveObservation` that carried
`layoutHazards` were dropped, and `readObservation` uses the registry.
`scopeActorRegistryObservation` applies `resolveOwnSightLight`. A
perturbation check confirmed it: with the cap removed, the own-light test
fails. The bundled ASCII levels were regenerated. Unlit fixtures were fixed in
the observation, scoping, and hazard-vitals tests.

#200 (mana-powered light) then landed too. The lit-cell visibility test now
models the lamp as an actor. The suite, run unsandboxed, has 4321 tests and
64 failures:

- 8 known: #206, #208, #209, #210, #211
- 52 from the ASCII game, including the #200 lit-cell and upkeep port: #217
- 4 from armed actors seeing one tile: #218

## October 11 — lossless queue exhausted

adaptActionToCore and runMvpMovement both record params.target. The
shared maze log matches. No further producer converts without inventing
loot, rewriting the catalog hash, or raising the wiring baseline. The
10-minute loop stopped.

## October 11 — adaptActionToCore reads params.target

The non-registry move path packs from the core actor position and
params.target. Direction is the step between those cells. The FSM loop
oracle proposes only target {2,0} from actor position {1,1} and records
a northeast step. Restoring the from/to reader applied nothing; restored.

## October 11 — MVP movement records params.target

runMvpMovement still packs the core step from the actor position and the
next cell, and the action it records is params.target only. The shared
mvp-to-exit sequence stores those targets. Replay and the bindings
movement oracle derive from and direction when they pack. Restoring
from/to/direction failed the golden action compare; restored.
adaptActionToCore still requires from and to on the non-registry path.

## October 10 — decision 3 closed

Counted `tier=` resource strings in the content-gen catalogs: 16, and
each includes `dropRate`. The only `tier=` spec without `dropRate` is
`ak-create-hazard-resource` "rejects missing dropRate", which expects
failure. Mapping those strings onto V3 holdings would drop loot or
invent a quantity. Row 1 stays skipped. The 15-minute loop stopped.

## October 10 — maximizer reserves actor spawn

The maximizer filled the configuration to the whole budget, and the receipt
then added actor_spawn at 5. Reserving that price before the fill makes the
receipt land on the cap: configuration 195, spawn 5, total 200, mana max 104.
Prices were not changed. Dropping the reserve denied 205/200; restored.
Scenario 91 stays at its catalog budget of 92.

## October 10 — decision 2 split

Budget-only create now uses 103, the measured cost, and that test passes.
The maximize create and delver-plan paths denied at 205/200. Raising the
budget to 205 denied at 210/205. The short stays 5 tokens above whatever
budget is set, so it is the maximizer overshooting the cap. Scenario 91's
exact minimum run succeeds only at 102, and scenarios 90/91 were edited to
that pair and then restored: the new catalog hash would have to be written
through generated routes, the abstract-plan pin, and every bf fixture.
Those stay at 92/91.

## October 10 — unfunded wardens

Accepted decision 1. A selection with motivation attacking and no actor type
is a delver. A warden selection is omitted when summary.poolWeights is
explicit and has no positive wardens weight. Restoring the warden default
failed the attacking oracle; restored. llm-plan 14 passed, including the
canonical handoff that was short 96 on the warden pool. Allocator prices
were not changed. Next is the four measured delver budgets.

## October 10 — suite recount, loop stop

Full suite: 4206 tests, 4003 passed, 22 failed, 181 pending. The 22 failures
are pool shorts (warden-pool 0, delver shorts), wiring 36 vs 13, V1
tier/stat/dropRate, unset LLM_INTERNAL_HOST, and bf-036's recorded denial
that now succeeds. No further lossless S remains outside that list. The
10-minute loop stopped. Shared mvp-to-exit and adaptActionToCore stay
leftover. Row 9 later reviewer.

## October 10 — runtime-decision move target

Runtime-decision candidates, tick-orchestrator selections, Z3 move fixtures,
and inspect/run-helper frames now store params.target. The envelope copies
the action through, so the contract oracle fails when the candidate still
uses params.to. Restored after that perturb. The attack candidate in the Z3
conformance fixture was left as-is. Shared mvp-to-exit and adaptActionToCore
stay leftover. Leave invent-required reds. Row 9 later reviewer.

## October 10 — tick-session replay target

resolveActorPositionsAtTick reads params.target only. A frame whose move
stores only params.to leaves the actor on its starting cell. Restoring the
fallback moved the glyph onto that leftover cell; restored. Sandbox-tick and
tick-rewind fixtures now store target. The shared mvp-to-exit movement
fixture stays leftover. Leave invent-required reds. Row 9 later reviewer.

## October 10 — visualization replay target

computeActorPositions reads params.target only. The visualization fixtures
that supplied params.to now supply params.target. Restoring a params.to
reader left the actor at spawn on the #147 accumulation oracle; restored.
tick-session still falls back to params.to. Leave invent-required reds.
Row 9 later reviewer.

## October 10 — loader call, playback target, sandbox move params

The e2e pool trace called initializeCoreFromArtifacts with a stub core and
expected layout.ok. The loader takes `{ simConfig, initialState }` and
returns a registry. Tick playback now reads params.target. Sandbox move and
manual move record `{ target }`; the sandbox command result still returns
direction/from/to. Restoring params.to left the actor at tick 0; the two-arg
loader threw an invalid envelope; from/to/direction failed the action-file
and manual-move oracles; restored. Leave invent-required pool denials,
occupancy, proximityRadius, V1, tools/benchmark env, loadMvpScenario, and
delver-warden-battle melee red. Row 9 later reviewer.

## October 10 — leftover MCP artifacts and motivation oracles

MCP replay/narrate/run write Configurator boxed terrain plus a delver instead
of pairing leftover hazard tiles with the affinity initial state. Preview
summary counts the hazard actor (Actors 3). Mixed-motivation and random-scenario
oracles read motivations and presentation.category. Sandbox planRef imports
PLAN_ARTIFACT_SCHEMA. The V1 resource rejection is one interpolated throw;
drift allowlist lines follow orchestrate-build. Stationary explicit stamina
still denies; exploring is refilled by the existing movement floor, so the
free-move oracle expects that diagonal spend. Restoring Actors 2, the schema
literal, motivation.kind, the old allowlist line, and exploring stamina 0
failed; restored. Typecheck 0. Wiring 36 vs 13. Leave invent-required pool
denials, occupancy, proximityRadius, V1, tools/benchmark env,
loadMvpScenario, and delver-warden-battle melee red. Row 9 later reviewer.

## September 22 — leftover demo-cli / resource-plan / catalog oracles

demo-cli writes Configurator boxed terrain plus delver artifacts instead of
leftover basic stationary fixtures. resource-plan low-budget denial uses budget
5 (measured totalCost 6). content-gen catalog oracle reads unified resource
affinities/vitals. Restoring basic demo fixtures failed invalid JSON state;
restored. Typecheck 0. Wiring 36 vs 13. Leave invent-required pool denials
red. Row 9 later reviewer.

## September 22 — leftover ActionV1 / affinity / floor oracles

actor-proposal-replay asserts ActionV1 params.target and defeated eligibility
(not leftover from/to or tile kinds); loadMvpScenario stays for
observation/render. delver/warden plan oracles read actor.affinities.
configurator tile_floor quantity is terrain floors (9), not width×height.
Restoring from/to expect failed; restored. Typecheck 0. Wiring 36 vs 13.
Leave delver-plan maximize pool short 5 and invent-required reds. Row 9
later reviewer.

## September 22 — leftover gameplay-surface-ingestion artifacts

gameplay-surface-ingestion builds Configurator boxed terrain plus delver run
bundles instead of compiling leftover delver-warden-battle tiles. Restoring
leftover scenario compile failed category storage; restored. Shared battle
scenario stays leftover-red for melee. Typecheck 0. Wiring 36 vs 13. Leave
invent-required pool denials (llm-plan/authoring), occupancy, proximityRadius,
V1, tools/benchmark env red. Queue exhausted for lossless S; row 9 adversarial
is later reviewer.

## September 22 — leftover ak-golden Configurator artifacts

ak-golden run/replay/inspect writes Configurator boxed terrain plus delver with
health vitals; leftover basic stationary fixtures stay off the CLI path.
Restoring basic fixtures failed invalid JSON state; restored. Typecheck 0.
Wiring 36 vs 13. Leave llm-plan/pool denials, occupancy, proximityRadius, V1,
and tools/benchmark env red. Row 9 adversarial is later reviewer.

## September 22 — row 8 suite recount

Full suite: 4202 tests, 3935 passed, 86 failed, 181 pending (prior
4198/3808/162/228). Typecheck 0. Wiring 36 vs 13. Remaining red includes
invent-required pool denials (llm-plan warden-pool 0), tools/benchmark env,
occupancy, proximityRadius, V1 — not a license to restore legacy APIs. Row 9
adversarial is later reviewer. No commit/push/PR.

## September 22 — leftover JS-spread overlap artifacts

tile-affinity water/fire hazard-spread path builds tiles and hazard visuals from
Configurator terrain plus presentation hazard actors (affinity-field-bridge
mapping). Orphan affinity-overlap fixture removed. Empty hazards failed origin
visual; restored. emitStrength-from-stacks stays skipped. Typecheck 0. Wiring
36 vs 13. Leave llm-plan/t1-medium/pool denials, occupancy, proximityRadius,
V1 red.

## September 22 — leftover e2e-annotator categories

e2e-annotator stamps lossless delver/warden categories on ambulatory fixture
actors (no leftoverCategory invention for bare ambulatory). AffinitySummary.hazards
is [] because hazards map to actors; authored-actor viability stamina floor
applied. Dropping categories failed prepareAuthoredActor; restored. Typecheck
0. Wiring 36 vs 13. Leave leftover JS-spread overlap fixture collections and
pool denials red.

## September 22 — leftover configurator-startup artifacts

configurator-startup rebuilds the hazard-grid oracle through Configurator
terrain plus actor_mvp (health 11/12, mana max 2, fire/push + life/pull).
Asserts registry vitals and terrain glyphs; leftover tiles/kinds/hazards stay
off SimConfig. Restoring leftover hazard fixtures failed; restored. Typecheck
0. Wiring 36 vs 13. Leave leftover e2e-annotator ambulatory actors, JS-spread
overlap, and pool denials red.

## September 21 — leftover Allocator reconciles artifacts

G1 reconcilation ablation and leftover runtime-persona-schedule use
Configurator boxed terrain plus actor_mvp delver. Shared leftover mvp-grid
tiles stay on the movement fixture. reconciles 2; schedule 1. Restoring
leftover tiles failed; restored. Typecheck 0. Wiring 36 vs 13. Leave leftover
configurator-startup hazard tiles, JS-spread overlap, and pool denials red.

## September 20 — leftover generator terrain and floor billing

generateTierLayout oracles read terrain spawn/exit cells; leftover
tiles/spawn/exit stay off generated layouts. countFloorTiles bills terrain
floors instead of leftover width×height. I4 carving 7; terrain-floor-spend 1;
g1 goldens tile_floor 25 / total 170 (was 81 / 226). Pool-denial remaining
snapshot 188; warden 186/176 short 10 unchanged. Restoring leftover tiles
or skipping the terrain branch failed their oracles; restored. Typecheck 0.
Wiring 36 vs 13. Leave leftover mvp-grid tiles, JS-spread overlap, and pool
denials red.

## September 16 — leftover UI layout.hazards consumers dropped

Gameplay-view selection, inspector lists, and affinity-field-bridge fallback
read presentation hazard/resource actors and terrain glyphs. Leftover
layout.hazards/tiles collections are unused there. Overlap selection prefers
the mobile actor. gameplay-selection 47; actor-inspector 16; gameplay-flow 29/2;
phaser 98/4; tile-affinity 28/1. Leave leftover JS-spread overlap fixture
collections and pool denials red. Typecheck 0. Wiring 36 vs 13.

## September 16 — leftover sandbox tick, MCP, ring, and cost stubs

Sandbox-tick S1 budget-artifact/zero-token/malformed, S2 upsert/wall-rim,
S3 northeast/stamina/append now run. MCP tick unknown-run/maxTick-1/state-0
and visualization tick-0/boundary cases run. 10-tick ring boundary/state-0/
replay cases run; auto-place without proximityRadius stays skipped. Cost
show/list/dry-run/approved run; leftover partial denial stays skipped.
Resource-plan grant regen snapshots equal measured 6 vs 6. sandbox-tick
45 passed / 8 skipped; mcp-tick-control 15/2; tick-visualization 10/2;
cli-verification 12/2; cost-summary 8/1; create-hazard-resource 30/3.
Leave proximityRadius, spawn/exit occupancy, pools, and VSR vault V1 red.
Typecheck 0. Wiring 36 vs 13.

## September 16 — leftover tile-barrier and V1 loot parse

`--tile-barrier` places Configurator barrier actors (`blocksMovement`).
Leftover CLI `tier`/`stat`/`dropRate` is rejected at parse. ak-errors 20;
create-hazard-resource 31/3 skipped; element-matrix 38. Leave
llm-plan/warden-pool 0, overlay string-affinity, and MCP skipped stubs red.
Typecheck 0. Wiring 36 vs 13.

## September 16 — leftover hazards/tiles consumers dropped

`--vital-default` clones Configurator DEFAULT_VITALS, not a glue health-10
table. Kernel affinity-summary passes empty leftover hazards. Phaser and
preview draw presentation hazard/resource actors. Actor `resolveBaseTiles`
and visualization snapshots use terrain. Phaser 94 passed / 4 skipped;
affinity-aura 2; affinity-summary 3; actor-decision-inputs 5. Leave pool
denials, overlay string-affinity, leftover `--tile-barrier`, and MCP skipped
stubs red. Typecheck 0. Wiring 36 vs 13.

## September 16 — leftover sandbox MCP through Configurator

Sandbox place rebuilds SimConfig/InitialState via Configurator boxed terrain
and a unified roster. Leftover `tiles`/`legend`/`traits`/V1 loot are gone.
Resource specs use V3 permanence. Wall-rim occupancy is rejected, so leftover
x=0 OOB setup cannot stand on a wall. sandbox-tick 37 passed / 16 skipped;
sandbox-entities 14 passed / 16 skipped including create→place→ak_run.
`ak run --tile-wall/--tile-floor` mutate `layout.data.terrain`; leftover
`--tile-barrier` still rejects category storage. `--actor` requires
delver/warden/hazard/resource/barrier and rebuilds through Configurator.
ak-errors 20 passed. Leave leftover `--vital-default` glue table red.
Typecheck 0. Wiring 36 vs 13.

## September 16 — leftover affinity-summary and 10-tick V3 resources

Affinity-summary run writes Configurator artifacts; `summary.hazards` is empty
because unified layout has no leftover hazards collection. CLI verification
and MCP tick-session creates use V3 permanence resources. V1 loot stays
rejected. Leave leftover sandbox `tiles`/`traits` and pool denials red.
Typecheck 0. Wiring 36 vs 13.

## September 16 — leftover UI/CLI run and V3 resource creates

Run/replay/inspect write Configurator artifacts to tmp and drop leftover
`--actor`/`--tile-barrier` flags. t2-stress, hazard-free rooms, and leftover
create-resource success cases use V3 permanence payloads. Receipts filter
`category === "resources"`. V1 loot stays rejected. Perturb leftover
simConfigRef failed; restored. Leave llm-plan warden-pool 0 and t1-medium
room-pool red. Typecheck 0. Wiring 36 vs 13.

## September 16 — leftover placement invariant uses terrain spawn/exit

Walkable tiles come from `layout.data.terrain`. Spawn/exit are terrain cells,
not leftover layout.spawn objects. Shrine resources use V3 permanence/affinity
payloads; V1 loot stays rejected. llm-plan/ui-cli warden-pool 0 left red.
Typecheck 0. Wiring 36 vs 13.

## September 16 — leftover CLI hazard oracles read presentation actors

element-matrix (38), room-size hazard capacity (7), and authoring bundle/configure
now read `initial-state.presentation` hazard/delver categories. V3 resource
holdings carry permanenceMode. V1 loot keys stay rejected. Delver-pool denials
left red. Perturb using actor.category failed; restored. Typecheck 0.
Wiring 36 vs 13.

## September 16 — omitted actor vitals seed from Configurator defaults

`applyViabilityDerivedVitalRequirements` fills missing vitals from
`cloneVitals`/`DEFAULT_VITALS` then applies `ACTOR_VIABILITY_FLOOR`. Motivation
floor seeds stamina the same way when omitted. Does not invent quantities
beyond those tables. `orchestrateBuild aligns actors` now places walkable
actors off spawn/exit terrain cells. Perturb dropping omitted-vitals fill
failed; restored. Typecheck 0. Wiring 36 vs 13. Leave room-pool denials and
V1 loot/string-affinity red.

## September 16 — leftover kind/role/motivation to category

`prepareAuthoredActor` maps leftover ambulatory attacking→delver and
defending/patrolling→warden, strips kind/role/tokenCost, and still throws when
no lossless category exists. Does not invent vitals. spawn-distinct and
room-affinity tests read terrain + hazard actors. Perturb dropping
attacking→delver failed; restored. Typecheck 0. Wiring 36 vs 13.

## September 16 — leftover create hazards become actors

`mapHazards` assigns `hazard_N` when generated occupants omit id and still
rejects missing affinity. cloneLayoutData strips leftover
tiles/hazards/kinds/actors. CLI configurator runs object-placement then
unified builders. Create-blocking (8), ak-build (15), ak-configurator (3)
passed. Perturb requiring ids failed the new oracle; restored. Typecheck 0.
Wiring 36 vs 13. Leave orchestrateBuild budget/category leftovers red.

## September 16 — row 8 full suite + leftover attack conversion

Combat/receipt/battle tests use Configurator artifacts. Adjacent combat is
`cast_affinity`; conventional `attack` is `unsupported_action_kind`. Receipt
units are Allocator `actionBudget` (wait 1, solver 2, move 0, attack 0).
Perturb restoring attack-accepted units failed; restored. Pool-denial remaining
measured 132. Scenario compose left red (wardens:57/0). Full suite 4198 tests:
3808 passed, 162 failed, 228 pending; typecheck 0. Wiring 36 vs 13.

## September 16 — row 7 goldens / CLI V3 affinity resources

`mapResources` converts CLI `affinity:{kind,expression,stacks,mana,manaRegen}`
into pairs + mechanical mana, strips undefined Director leftovers, and ignores
`permanent: false`. Spreading `affinity` onto normalizeActorDefinition failed
the new oracle; restored. Create/resource-plan goldens regenerated from live
output (g2 total 126, shared affinity payload 120). Dual-surface SimConfig
keys now include `actionCosts`. Configurator + golden + owner guards: 7 files,
33 passed; typecheck 0.

## September 16 — row 2 leftover runtime.init families

Configurator `buildUnifiedArtifacts` plus registry snapshots replaced
`layout.tiles` / `getMotivatedActor*` in affinity-field-per-tick,
multi-tick-world-state, cast-affinity-action, affinity-interactions-per-tick,
multi-actor-initial-state, and multi-actor-random-run. Field overlap oracles
read projected nets vs contributions; ActorTurn regen covers hazard mana.
21 + 13 tests passed. Typecheck 0. Wiring 36 vs 13 expected-red. Perturb not
needed: restoring world.ts readers would fail these files immediately.
Leave `attack` combat/receipt tests and delver-warden-battle melee red.

## September 16 — row 7 affinity e2e / rewind / kernel budget

`readCoreAffinityFieldRecordsFromArtifacts` now projects registry
contributions (not layout.hazards or core cell arrays) so cancelled overlap
tiles stay visible. Affinity pipeline e2e, tick-rewind-parity, and
command-kernel budget receipts use Configurator `buildUnifiedArtifacts`.
Typecheck 0. Wiring remains 36 vs 13; do not raise the baseline.
Perturb: fields-only records lost the (2,2) overlap visual; contributions
restored it.

## September 16 — autonomous queue row 7 CLI/MCP producers

Run, tick, and MCP scaffolds now call Configurator `buildUnifiedArtifacts`
instead of writing `layout.data.tiles` / `kind: stationary`. Visualization
ASCII layout glyphs come from row-major `terrain`; hazard/resource layers
come from presentation-category actors. Dropping the terrain path failed the
wall-glyph oracle; restored. CLI `--actor`/`--tile-*` leftover flags are not
used on the happy path. Adapter-io guards + converted CLI/MCP/viz files
passed; typecheck 0. Remaining producers: goldens, affinity e2e tiles,
`runtime-combat-application` / budget-receipt `attack`, scenario budget
denials, vault V1 actor payloads.

## September 16 — autonomous queue rows 5–6

Row 5: `persistOrSpawnHazardAt` overwrites an existing immobile caster's pair
and mana from the directive and keeps durability; spawn requires caller-supplied
durability on floor and uses id `hazard:x:y`. Persist is allowed on spawn/exit
occupants. Runner maps `arm_static_hazard` onto that method when a registry
exists and does not invent durability. Perturb restoring `armStaticHazardAt`
failed the unified oracle; restored. Moderator plans unchanged.
Core registry + runtime mapping + moderator suite: 13 files, 52 passed;
typecheck 0.

Row 6: Annotator `buildWorldState` copies the live registry snapshot
(equipment, defeat, holdings) and presentation. No hazards/resources
collections. Runtime capture supplies registry/presentation/tick.
Reattaching `hazards: []` failed the new oracle; restored. Annotator +
world-state + owner guards: 11 files, 45 passed, 2 skipped; typecheck 0.

Row 7 partial: `ak run` world-state checkpoints now consume Configurator
unified artifacts and read hazard actors from `actors`, not `hazards[0]`.
File-backed CLI/MCP fixtures with layout tiles/hazards remain. Checkpoints
+ no-authoring guard: 2 files, 8 passed.

Row 8 recorded, not green: full suite 4235 tests, 3725 passed, 274 failed,
236 pending; 756 files, 652 passed, 104 failed. Typecheck 0. Remaining red
is leftover producers/fixtures (layout category storage, invalid unified
actor definitions, budget denials). Do not restore legacy APIs.

No commit, push, PR, or benchmark.

## September 16 — autonomous queue rows 1–5


Row 1 skipped: CLI V1 `tier`/`stat` vital grants cannot map onto holdings
without inventing `health|mana|stamina` and always carry `dropRate`. No code.

Row 2: `observation-scoping-per-actor`, `actor-faction-reaches-observation`,
and `multi-actor-orchestration` now init from Configurator terrain plus
unified actors. Remaining runtime.init category-storage families are still
red. Narrow gates for those three plus observation/LOS/dependency/ports:
7 files, 27 passed; typecheck 0.

Row 3: `scopeObservation` omits `hazards` even when injected.
`mvp-movement.readObservation` no longer merges a hazards collection.
`placeResourceAt` and `armStaticHazardAt` stay exported. Narrow gates
7 files, 40 passed; typecheck 0.

Row 4: Phaser renderer draws hazard actors via
`initialState.presentation[id].category` or actor `category`, skips them in
the mobile loop, and still draws leftover `observation.hazards`. New oracle
failed under hazards-only draw; restored. UI renderer + adapter-io guards:
5 files, 106 passed, 4 skipped; typecheck 0.

Row 5 escalate: Moderator `arm_static_hazard` vs hazard-as-actor blurs tick
policy and core legality. Queue stopped. No commit, push, PR, or benchmark.

## September 16 — runtime observation hazards

Runtime observations from the actor registry now treat hazards as ordinary
actors. The vitals and LOS oracles no longer feed layout.hazards or glyph tiles.
Glue stopped copying layout hazard vitals into a separate collection. Reattaching
`hazards: []` failed the new vitals oracle; restored. Observation tests plus
dependency/ports: 6 files, 14 passed. Typecheck and diff check pass. V1 resource
shapes and leftover core category APIs are not in this slice. No full-app green
claim, commit, push, PR or benchmark.

## September 16 — budgetScaffold layout strip

`cloneLayoutData` now drops `budgetScaffold` from locked SimConfig layout data
and still rejects other extras. The flag remains a levelGen/pricing signal on
the working layout for Allocator spend; it is not authored geometry. Treating it
as a LAYOUT_FIELDS member failed the new oracle; restored. Configurator + four
owner guards: 47 files, 220 passed, 1 skipped. Typecheck and diff check pass.
Production orchestrateBuild with V3 resources and the flag now emits geometry
only. No full-app green claim, commit, push, PR or benchmark.

## September 16 — CLI resource vital holdings

`mapResources` now converts CLI V3 `permanenceMode` plus grant `vitals` into one
unclaimed vital holding and default source durability. Mechanical requests still
pass through. Unknown extras still throw. V1 `tier`/`stat` remains rejected so
loot keys are not invented. Spreading CLI extras failed the new V3 oracle;
restored. Configurator + four owner guards: 47 files, 219 passed, 1 skipped.
Typecheck and diff check pass. Resource-only `ak create` now fails next on
layout `budgetScaffold`. No full-app green claim, commit, push, PR or benchmark.

## September 16 — CLI hazard affinity authoring

`mapHazards` now reads CLI string `affinity` plus `expression`, or
`affinityStacks[0]`, in addition to the object pair already used by placed
unified hazards. Extra authoring fields are not spread into the mechanical
record. Unpositioned `--hazard` create now succeeds.

The new CLI-shape oracle failed while affinity was required to be an object.
Restoring that guard failed the test; restored. Configurator + four owner
guards: 47 files, 218 passed, 1 skipped. Typecheck and diff check pass.
Resource CLI extras and leftover core state/API are not in this slice. No
full-app green claim, commit, push, PR or benchmark run.

## September 16 — one-time hazard vitals

`mapHazards` now converts CLI/Director one-time `{kind, amount}` vitals into
`{current:amount, max:amount, regen:0}` and skips incomplete records so
expression defaults are not overwritten with `undefined`. Regen quantities stay
mechanical three-field records. CLI still stamps authoring `kind`; conversion
happens at the Configurator boundary rather than in glue.

The new one-time oracle failed before conversion existed. Copying
current/max/regen from one-time records failed that test; restored. Configurator
+ four owner guards: 47 files, 217 passed, 1 skipped. Typecheck and diff check
pass. Remaining CLI/card defaults and leftover core state/API are not in this
slice. No full-app green claim, commit, push, PR or benchmark run.

## September 16 — movement stamina from placed roster

Configurator now assembles the ID-keyed cardinal movement map from the placed
roster. Explicit `configurator.inputs.movementStamina` wins, then nonnegative
`capabilities.movementCost`, then the existing cardinal default for mobile
actors. Immobile actors stay omitted. Production glue calls
`assembleMovementStamina` rather than inventing costs. `buildSimConfigArtifact`
still requires a valid map; omitted CLI input is no longer `undefined`.

The new omitted-map oracle failed before the assembler existed. Skipping roster
fill failed that test and the production-build loader check; restored.
Configurator + production-build + four owner guards: 48 files, 219 passed, 1
skipped. Typecheck and diff check pass. Remaining CLI/card defaults and leftover
core state/API are not in this slice. No full-app green claim, commit, push, PR
or benchmark run.

## September 16 — hazard authoring vitals

`mapHazards` now projects authored regen vitals onto `{current,max,regen}` before
core validation. CLI placed-hazard specs still stamp `kind: "regen"`; spreading
that record made Object.keys length 4 and failed `invalid vital record`.
Quantities are preserved; the authoring kind is dropped. One-time amount shapes
and ID-keyed movementStamina are not in this slice.

The new mapHazards oracle failed before the projector existed. Restoring the raw
spread failed that test; restored. Configurator + four owner guards: 46 files,
214 passed, 1 skipped. Typecheck and diff check pass. Production `ak create`
now fails next on missing movementStamina (`undefined` rather than an ID map).
No full-app green claim, commit, push, PR or benchmark run.

## September 16 — shared runtime-decision reader

The shared envelope builder now projects self and visible actors onto the same
live mechanical keys as the Actor producer. Injected role, category kind,
affinityGrants and vitalEffects are dropped. A separate hazards collection is
no longer copied into the envelope or the LLM prompt. Solver adapters already
ranked opaque tuples only; a residue guard now forbids those legacy tokens in
the adapters and shared glue. Actor uses the shared projector instead of a
second allowlist. This does not migrate CLI producers, remaining core category
APIs, or runtime observation.hazards.

The new contract test failed before the projector existed. Copying hazards
through the envelope failed both that test and the adapter-residue guard;
restored. Actor + four owner guards + contract/observation/orchestrator/solver
adapters: 34 files, 185 passed, 5 skipped. Typecheck and diff check pass.
No full-app green claim, commit, push, PR or benchmark run.

## September 15 — unified Actor solver records

Replaced separate self/visible record construction with one detached mechanical
projection. Preserves stable IDs, live alignment, position, lifecycle, defeat vital,
vitals, capabilities, motivations, inventory, active key and claims. Removed
Actor's hazard collector and affinityGrants/category output. Observed alignment
is authoritative over configured alignment. Existing artifact envelope retained.
Shared runtime-decision helpers now project the same mechanical keys and drop
legacy collections; remaining producer/CLI fixtures and runtime observation
hazards are later owner work. This change only removed the Actor producer path.

Tests reject legacy output despite injected old fields, verify common stationary
actors, all motivations, shared-mana ranks and detached self/opponent records.
Removing record copies failed the alias test; restored. Actor/four guards/production
observation: 27 files, 149 passed, 5 skipped. Typecheck and diff pass. Logs
/tmp/ua-solver-records-{red,green,perturbation,gates,typecheck}.log. No full-app green
claim, commit, push, PR or benchmark run.

## September 15 — focused equipment readiness

Equipment candidate comparison now reuses the ordinary nearest-hostile focused
cast proposal and Actor's motivation intent classifier. Readiness precedes field
safety/benefit as in the existing tuple. Holding target/position fixed leaves
these as the varying equipment dimensions; no new damage multiplier, price policy
or strategy engine. Strict improvement only; actual equip remains a stationary
action. This preserves the existing cast evaluation, not a damage/cost optimizer.

Tests demonstrate an out-of-range pair switching to owned water/push, unchanged
mana on equip, rejected same-turn cast, and accepted later-turn damage. Equal reach,
canCast=false, allied/absent/defeated targets, and stationary motivation produce no
focused-only switches, including in solver envelopes. Bypassing readiness failed
the positive deterministic and solver tests; restored. Actor + four guards +
production observation: 27 files, 149 passed, 5 skipped. Typecheck and diff check
pass. Logs /tmp/ua-focused-equip-{red,gates,perturbation,restored,typecheck}.log.
No full-suite green claim, commit, push or benchmark run.

## September 15 — taking candidates

Actor proposes named unclaimed holdings from defeated adjacent sources to living
canTake receivers. Stable source/holding ordering and encoded candidate IDs keep
separate rewards distinct. Take uses the existing stationary intent class; core
owns all claim mutation. Solver observations carry lifecycle and detached holdings.
The pre-change trace emitted cast_affinity at the defeated source instead of take;
terminal sources are now excluded in both combat proposal and visible-hostility
paths. This is necessary to make the claim candidates reachable for attackers.

Oracles: stack-8 reward creates one stack, owned stack-4 increases to five, active
pair remains unchanged, a second same-tick action fails, stale competing claim
fails, next named reward remains claimable, authored permanent health grant keeps
its max/current semantics. Negative eligibility checks cover both deterministic
output and solver candidates so a higher-ranked cast cannot mask an invalid claim.
Removing the defeated-source requirement failed the living-source solver test;
restored. Actor + four guards + production observation: 27 files, 141 passed,
5 skipped. Typecheck and diff check passed. Logs /tmp/ua-take-{red,perturbation,
gates-final,typecheck}.log. No full-app green claim, commit, push or benchmark.

## September 15 — field-driven equipment candidates

Core observation retains pre-cancellation contributions at visible cells. The
same visibility rule filters contributions and resolved fields, without exposing
offscreen cells or requiring the source actor to be visible. Equipment projection
replaces only self contributions and shares live opposition arithmetic.
Actor generates owned alternatives only on strict improvement in its existing
fieldSafety/fieldBenefit order. Common objective ranks the equipped receiver;
stationary intent class consumes a turn without inventing a new priority scale.
Both deterministic and solver paths receive the candidates. Focused-target
equipment utility and take candidates remain pending.

Oracles exercise fire/draw mana, water/emit cancellation, same-outcome retention,
canEquip=false, unchanged observation/mana during decisions, core action consumption,
solver field ranks and an unseen emitter. Pre-implementation tests failed. Dropping
external contributions and permitting ties each failed the intended regression;
both restored. Logs /tmp/ua-equip-observation-red.log, /tmp/ua-equip-actor-red.log,
/tmp/ua-equip-perturbation-{sources,ties}.log, /tmp/ua-equip-gates-final.log,
/tmp/ua-equip-typecheck.log. No full-suite green claim or benchmark run.

Final validation: 65 files, 769 passed, 6 skipped across core, Actor, production
observation and six owner guards. Initial typecheck exposed field-interface
assignability at the visibility boundary; detached object projections fixed it.
Final typecheck (/tmp/ua-equip-typecheck-final.log) and diff check passed. Focused
post-fix tests passed; reachability guard remains unchanged at 37 vs baseline 13
(/tmp/ua-equip-restored.log). No baseline relaxation, commit or push.

## September 14 — equipment field reprojection

Core exposes projectActorFieldsAt(actors, position), sharing projection with the
live grid path. It orders sources by stable ID, preserves opposition and dominant
source rules, and returns detached positions. A fire-room oracle compares owned
fire/draw and water/emit alternatives: the first forecasts mana, the second
cancels equal fire. Input actors are unchanged and no pulse occurs. Cell results
equal full-grid results and are invariant to actor input order.

The new oracle failed before the helper existed. Bypassing opposition cancellation
failed three tests including the equipment water oracle; restored. Typecheck and
diff checks pass. The reachability guard remains at 37 vs baseline 13, unchanged.
Restored core + dependency/ports guards: 39 files, 637 passed, 1 skipped.
Logs: /tmp/ua-equipment-projection-{red,gates,perturbation,restored,typecheck}.log.
Actor integration remains pending: preserve field observations from unseen sources
instead of projecting visible actors alone. No equip-selection claim from these
core tests. No commit, push, PR, or benchmark performed.

## September 14 — Actor field scoring cutover

Removed Actor's legacy numeric vitalEffects and affinityGrants scoring. Unified
field cells now reach core previewActorFieldChanges. Core extracts shared affinity
routing used by both execution and forecast; detached changes use changeActorVital
for optional vitals, caps and terminal defeat. Source-ID ordering matches registry
projection. Repeated-source exposure is bounded. Actor retains its tuple slots
and aggregates actual negative/positive changes into safety/benefit.

Forecast limitation: receiver-local, bounded by residual observed stacks, before
competition from other receivers; no hypothetical equipment reprojection yet.
It is not a predicted full tick. Tests compare forecast to actual resolution over
all 20 area affinity/expression combinations with a single receiver and cover
overflow, terminal defeat, capped draw mana, missing mana, source order and budget.

Validation: 64 files, 762 passed, 6 skipped (core, Actor, production observation,
dependency/ports and four Actor guards). Overflow-removal perturbation failed
two core oracles; bypassing Actor evaluation failed five Actor oracles. Restored.
Final typecheck and git diff --check passed.
Logs: /tmp/ua-field-preview-gates-final.log, /tmp/ua-field-preview-perturbation-core.log,
/tmp/ua-field-preview-perturbation-actor.log. No full-app green claim; known legacy
reachability failure remains tracked. No commit, push, PR or benchmark performed.

## September 14 — reusable field exposure

Extracted actorFieldExposureAmount into core actor-fields.ts and wired field
projection through it. Receiver-local magnitude preserves the existing active
pair, immunity and opposition calculation; self and terminal actors receive zero.
No finite-budget or vital-routing behavior moved into runtime. Tests cover
inactive inventory and projection agreement over 40 owned active pairs.
New tests failed before extraction. Removing self-exclusion produced exposure 3
instead of 0 and failed the intended regression; restored.
Restored validation: core + dependency/ports guards 39 files, 631 passed, 1 skipped.
Typecheck and diff checks passed. The broader owner gate includes the known
core-behavior-wiring failure at 37 vs baseline 13; count unchanged, no ratchet edit.
Logs: /tmp/ua-field-exposure-{red,green,perturbation,restored,typecheck}.log.
Actor field utility is still pending: raw unified fields lack the vitalEffects
that the old utility loop expects. This extraction prepares shared evaluation;
it does not claim to repair scoring yet. No commit, push or benchmark performed.

## September 14 — deterministic selection

Actor ranks deduplicated proposals separately per actor with the same composed
objective as solver requests. It emits the greatest row's action and reports
intention from that row. No new tuple members or scoring policy. Regression
coverage includes patrol-first casts, stationary-first combat intentions, stable
input-order ties, and separate selections/intentions for two actors.
The initial test exposed two emitted actions. Perturbing the winner to the first
candidate changed cast to move and failed two regression tests; restored.
Restored validation: Actor, four ownership guards, and production observation:
25 files, 126 passed, 5 skipped. Typecheck and git diff --check passed.
Logs: /tmp/ua-selection-red.log,
/tmp/ua-selection-perturbation.log, /tmp/ua-selection-typecheck.log,
/tmp/ua-selection-restored.log. Full application gates not run here.
Candidate expansion parity, active-field utility, equip/take proposals remain
subsequent work. No commit, push, PR, or benchmark performed.

## September 14 — motivation composition continuation

Actor motivation composition now preserves mobile candidates alongside stationary
preferences, while the movement capability restricts the full union. Removing
the premature stationary return also preserves explicit wait proposals for an
immobile exploring actor. Solver objective construction evaluates each authored
motivation with the existing nine-member tuple and keeps each candidate's greatest
complete row, without mixing feature slots or changing adapter policy.

Evidence: Actor suite plus four owning architecture guards passed: 24 files,
122 passed, 5 skipped. The new ranking test was red before implementation.
Changing every stationary check back to some made the patrol test fail;
restricting ranking to the first profile made the composed-cast test fail
(intent class 0 instead of 500). Both mutations were restored. Logs:
/tmp/ua-motivation-perturbation.log, /tmp/ua-composed-rank-red.log,
/tmp/ua-composed-rank-green.log, /tmp/ua-composed-rank-perturbation.log.
The full application gate was not rerun for these Actor-only changes. Deterministic
selection, intention reporting across motivations, field utility, and equipment/
take candidates remain pending. No commit, push, PR, or benchmark was performed.

These entries record validation at each milestone. Any `/tmp/` log references are machine-local historical evidence, not files required by cloud execution. See Handoff.md for current startup and the final publication validation entry below.

# Execution record
## Isolation and baseline
Created codex/unified-actor worktree from 9a9168f8c63b07b1e9e789daa598a6edaa061cbd. Original checkout unchanged by this task.
Session refresh: source intentionally not pulled; tools refreshed; suite 486 passed files / 1 failed file, 3772 passed / 2 failed / 242 skipped tests. Both failures are hardware dry-run tests needing LLM_INTERNAL_HOST in a new worktree. Typecheck passed before code changes. Narrow environment-only recheck uses 192.0.2.10 (documentation address). No production defect inferred and no benchmark code modified.
Logs: /tmp/unified-actor-session-refresh.log, /tmp/unified-actor-baseline-typecheck.log, /tmp/unified-actor-baseline-recheck.log.

## UA.1
Completed the bounded declaration milestone in five tracked/untracked source/test/doc files (not committed): artifacts.ts, contracts/README.md, docs/readme-index.md, the compiler-backed test, and its TypeScript fixture. No runtime mechanics delivered yet.

- Baseline narrow recheck: 28/28 tooling dry-run tests pass with LLM_INTERNAL_HOST=192.0.2.10. No host config or benchmark source change.
- Red: new fixture rejected the old declarations (missing ActorRecord etc., incompatible actions/snapshot).
- Green: compiler checks positive actors/actions/snapshot and 12 deliberately invalid shapes; test passes.
- Owner gates: tests/contracts plus schema origin/catalog — 16 files, 151 passed, 1 skipped.
- Typecheck: exit 0 after change.
- Perturbation: temporarily added attack to ActionV1; fixture failed specifically with unused @ts-expect-error. Original bytes restored in finally.
- Final architecture plus fixture: 33 files, 119 passed. Includes persona-boundary allowlist guards and the strict typecheck guard.
- git diff --check: clean.

Logs: /tmp/unified-actor-contract-red.log, /tmp/unified-actor-contract-green.log, /tmp/unified-actor-contract-gates.log, /tmp/unified-actor-typecheck.log, /tmp/unified-actor-perturbation.log, /tmp/unified-actor-final-guards.log.

Judgment calls: UA.1 is declaration-only, with migration status explicitly documented; old JS producers are not silently represented as conforming. Historical world-state union removed, current envelope selectors retained, simulation actions separated from effect/telemetry protocols. No new schema constant, version, runtime compatibility path, commit, or push. Public authoring Hazard/Resource artifact producer migration remains in later owner milestones.

Full suite was run only at baseline, before declarations; do not report it as post-change full-suite green. The plan's one-M handoff limit applies; remaining implementation is pending. The MCP test connector is rooted in the original checkout, so only read-only pattern discovery used it. All test execution and edits used the isolated worktree.


## UA.2 — registry component complete
Implemented core-owned mechanical types and a detached, stable-ID actor registry. Runtime artifacts re-export the mechanical types rather than redefining them. Artifact envelopes and presentation remain in runtime. Registry exposes getActor/getActorsAt, independent movement/sight blocking queries, and deterministic JSON snapshots. Rejects malformed geometry, duplicate IDs, conflicting living blockers, presentation leakage, nonfinite/circular/non-JSON state, getters and hidden JSON serialization hooks. Defeated actors remain spatially visible but never block; exited actors remain in snapshots but not spatial queries.

This is a read-only registry component, not a second engine and not yet wired into createCore or runtime. Vital mutation/legality, equipment/claim legality, tick/action execution and consumer migration remain pending. The existing engine and its old tests still run. No runtime behavior claim is made from component tests.

Validation:
- Red: new registry test failed to import the not-yet-created module.
- Green: 12 registry tests plus UA.1 compiler fixture passed.
- Full core-ts plus contract fixture: 27 files, 514 passed, 1 skipped.
- Boundary/schema guards: 5 files, 16 passed.
- pnpm run typecheck: exit 0.
- Perturbation: removing conflicting-blocker rejection turned the collision test red; original bytes restored.
- Full app suite not rerun for this internal component; the unchanged baseline and current narrow domains are distinguished intentionally.

Logs: /tmp/unified-actor-ua2-red.log, /tmp/unified-actor-ua2-green.log, /tmp/unified-actor-ua2-core.log, /tmp/unified-actor-ua2-guards.log, /tmp/unified-actor-ua2-typecheck.log, /tmp/unified-actor-ua2-perturbation.log, /tmp/unified-actor-ua2-restored.log.

Files in this milestone: core state/actor-types.ts and actor-registry.ts; runtime contracts/artifacts.ts and README.md; tests/core-ts/actor-registry.test.mts. No public core export, schema version, benchmark, original checkout, commit or push changed. Stop at the approved one-M handoff limit; milestone 3 is next.


## Cloud publication validation — 2026-09-07

The maintainer authorized preparing the portable handoff, committing, and pushing
this branch. The five tracked files in this directory now replace local vault
records as the execution source of truth for this rewrite.

A fresh full-suite run exposed one missed UA.2 test consumer:
`tests/runtime/domain-constants-parity.test.js` parsed affinity type unions from
`artifacts.ts`, where they are now re-exports, and obtained null. The test now reads
those two unions from core `state/actor-types.ts`; all assertions are preserved.
The focused parity/compiler run passed 3 tests. No gameplay code changed in this
publication pass.

Final pre-commit validation of the complete UA.1/UA.2 source tree:
- `LLM_INTERNAL_HOST=192.0.2.10 pnpm run test`: **489 files passed; 3787 tests passed,
  242 skipped, zero failures**. The domain includes all 32 architecture suites.
- `pnpm run typecheck`: exit 0.
- `git diff --cached --check`: clean.
- UA.1 and UA.2 perturbations were previously executed and restored, as recorded
  above. No tests were disabled to obtain this result.

The documentation host value serves existing dry-run tests only; no remote
benchmark was run. Full-suite green verifies this partial branch's current
contracts/components and existing engine, not the still-pending rewritten
runtime. Resume with UA.3; do not merge into main as a completed rewrite.

## Local continuation 2026-09-08 — UA.3 complete, UA.4a routing complete
The maintainer continued locally and superseded the earlier milestone stopping cap.
Session refresh preserved HEAD (--no-pull), refreshed dependencies/tools/context,
and passed the baseline full suite. Serena responded on the isolated worktree.

UA.3 adds validated optional vitals, actual signed deltas, regeneration, and
terminal defeat to the registry. Alive-at-zero load normalizes to defeated before
occupancy. Positive-vital defeated snapshots are rejected. Inactive actors cannot
be restored or regenerated. Tests first: 13 failing tests. Green core plus three
boundary guards: 30 files, 533 passed, 1 skipped. Typecheck passed. Removing the
inactive mutation guard caused two failures; restored narrow tests passed.

UA.4 is split: UA.4a adds the explicit matrix and common vital resolver; UA.4b
removes conventional combat with the later public API/runtime migration. Both
focused and area expression routing are tested across all ten affinities, including
actual transfer, missing pools, health overflow and no healing on neutralization.
Core + boundary guards: 31 files, 576 passed, 1 skipped. Initial typecheck caught
three test-only optional-health accesses; non-null assertions corrected them and
typecheck passed. Bypassing durability consumption caused four routing-oracle
failures. Original code restored; subsequent core gate covers restoration.

Limitations: these remain internal components, not runtime adoption. Neutralize
currently identifies routing without active-exposure suppression. Fields, action
scheduling, inventory/claims and old engine replacement remain outstanding.
Logs are /tmp/unified-actor-ua3-{red,green,typecheck,perturbation,restored}.log and
/tmp/unified-actor-ua4a-{red,green,typecheck,perturbation}.log on the local machine.

## UA.6a — active inventory component complete
Implemented validated unique affinity/expression pairs, positive safe stacks,
active-key membership, preserved motivation lists and guarded slot selection.
The slot mutator preserves mana/inventory; tick consumption remains UA.6b.
Core plus boundary guards: 32 files, 581 passed, 1 skipped. Typecheck passed.
Removing ownership rejection caused one test failure; implementation restored.
UA.5 needs active inventory, so this prerequisite was pulled forward explicitly.

## UA.7a — defeat holdings and claims component complete
Every owned pair exposes one canonical affinity holding on defeat. Claims check
living receiver/canTake, defeated source, proximity and remaining claim state.
Draft evaluation prevents overflowing rewards from partially mutating either side.
One stack is granted, new equipment is not auto-selected, and source vital pools
are never enumerated as holdings. Explicit grants retain consumable vs max/current
and independent regen behavior traced at rules/move.ts applyResourceCaptureAt.
Core plus boundary guards: 33 files, 588 passed, 1 skipped; typecheck passed.
Bypassing the claimedBy check caused one failure; original code restored.
Tick action consumption and runtime claim events remain pending.

## UA.5a — bounded active-exposure component complete
Added a shared batch resolver for preprojected exposure. Budgets are per source;
actual absorbed amount and capped mana credit are recorded separately. Neutralizing
pull/draw consumes only still-pending matching active exposure and never repairs
prior loss. The same explicit matrix handles every applied vital outcome.
Core plus boundary guards: 34 files, 593 passed, 1 skipped; typecheck passed.
Projection/range/opposition/occlusion and caller scheduling are UA.5b, not claims
made from these tests. Source ordering remains caller-supplied, target order uses
stable IDs. The completed batch does not expose a second runnable engine.

## September 8 final verification and September 10 resume
UA.8a common movement passed 34 core/boundary files (595 tests, 1 skipped);
removing old-cell cleanup caused one failing occupancy test and was restored.
UA.5a budget perturbation caused two failures and was restored. An additional
red/green check prevented draw harvesting from a casting-disabled source.
UA.5b1 projects active passive fields with existing radius/intensity and extracted
opposition arithmetic. Both fire-room alternatives pass. Red/green refinements
prevent harvesting canceled emission and remove defeated sources from final field
observations. Disabling opposition caused two failures and was restored.
Final core/boundary domain: 35 files, 603 passed, 1 skipped. Typecheck passed.
Full restored tree: 495 files passed, 3870 tests passed, 242 skipped. Separate
architecture run: 32 files, 118 tests passed. git diff --check passed.
All changes remain uncommitted; no additional push or benchmark occurred.

On September 10 the maintainer requested continuation. Session refresh again
preserved HEAD, refreshed tools/context/deps and passed tests. Next is focused
casting. Runtime trace: resolveCastManaCost delegates to Configurator's
resolveAffinityManaCost, reading authored stackTiers at min(stacks,5); core's old
computeAffinityManaCost returns zero for focused casts and must not replace it.

## September 10 — focused casts and turn mechanics
UA.5b2a focused casting passes authored tier-price, affordability, range, lifecycle,
overflow, actual-transfer and pending-suppression tests. Price lookup clamps tiers
at five exactly as Configurator already does; strength does not clamp. Removing
affordability caused one failure and was restored. Core/owner run: 610 passed,
1 skipped; typecheck passed.
UA.6b0 moved the existing mechanical action union to core ActorAction; runtime
ActionV1 adds its unchanged artifact envelope. Compiler fixture imports both and
rejects attacks in both. Allowing attack caused the negative fixture to fail;
restored. Core/compiler/schema run: 613 passed, 1 skipped; typecheck passed.
UA.6b1 action windows persist accepted IDs, tick, closed state and suppression.
Only accepted actions consume the window; geometry and affordability failures are
atomic. Existing diagonal stamina arithmetic was extracted and reused. Removing
accepted-ID checking caused three failures; restored.
UA.6b2 adds once-only field and regeneration phases, including restoration mid-tick.
Focused suppression carries caster provenance and affects a later matching cast
or field without changing equipment. Duplicate field-pass perturbation caused one
failure; restored. Latest core/owner run: 37 files, 619 passed, 1 skipped; typecheck
passed. Runtime/Moderator wiring, area cast actions, exit dwell and global tick
ownership are not yet migrated. These are component/window guarantees.


## UA.9a — Configurator preset normalization
Added normalizeActorDefinition through the public Configurator controller and
service surface. All five labels produce one core-owned mechanical shape with
editable defaults; vital quantities remain required authoring data. Core's
validators are reused, not reimplemented. All motivations and owned pairs survive.
Tests prove category-only mechanical equality under explicit properties, mobile
resource overrides, invalid inventory/vitals and detached input/output. An extra
red/green fixture-in-code rejects explicit null alignment/defeat/motivations instead
of silently treating them as omitted. Forcing alignment after overrides caused
three failures (including category independence); restored.
Configurator + owner authority gates: 39 files, 191 passed, 1 skipped. Typecheck
passed. The restored normalizer suite passed 9 tests. No artifact builder or
transport currently calls this new normalization method; UA.9b remains pending.


### Full-suite guard diagnosis
The first September 10 full run passed 497 files and failed one architecture
honesty check: its lexical census dropped from 14 to 13 unwired legacy APIs. Trace:
core-behavior-wiring.test.js scans production identifier text; the new Configurator
import named validateActorVitals collided with the unrelated legacy CORE_API_KEYS
entry of that name. The old API had not actually become wired. Renamed the new
record validator to validateActorRecordVitals in its three source consumers.
The guard baseline was not changed. The focused wiring/normalizer/vitals rerun
passed. A complete restored-tree rerun follows below.

### September 10 restored-tree final gates
- LLM_INTERNAL_HOST=192.0.2.10 pnpm run test: 498 files passed; 3895 tests passed,
  242 skipped; zero failures.
- pnpm run typecheck: exit 0.
- pnpm run test:vitest -- tests/architecture/: 32 files, 118 tests passed.
- git diff --check: clean.
- All milestone perturbations were restored before this full run. No tests or
  architecture baselines were weakened. No live model or remote benchmark ran.

State at this checkpoint: branch codex/unified-actor, published HEAD still
 de2a9325, current work uncommitted. Original/benchmark worktrees were not edited.
The new components and Configurator normalization pass their oracles, but the
legacy engine remains the production path. Next: Configurator normalized artifact
assembly, single-list startup, public core/runner replacement, then remaining
persona/pricing/adapter/UI migration. Standalone negative artifact fixtures,
complete end-to-end/replay equivalence, area cast actions and exit dwell are still
required before declaring the rewrite complete.

Benchmark attribution for a future commit: ActorAction's declaration now lives
in core and is wrapped by the unchanged runtime action envelope. Configurator's
new normalizeActorDefinition method changes the available entity normalization
surface. ak_create schema, buildArgv and CLI argument mapping have not been
migrated in this continuation. No benchmark execution is needed for these gates.

### September 10 continuation — UA.9b1 authored turn costs
Public Configurator resolveActorTurnCosts now assembles all forty pairs/five tiers
and detached per-ID movement costs. Explicit malformed rules fail instead of the
legacy reader's default fallback. Existing default fire/push reader was traced at
[3,6,9,12,15]. New tests initially failed (3 failures due to absent API), then four
passed. Replacing all returned mana prices with zero produced two failures;
restored immediately. Configurator plus four owner guards: 40 files, 195 passed,
1 skipped. Typecheck passed. Artifacts and runtime startup are still pending.

### September 10 continuation — UA.1b artifact fixtures
Added one valid unified InitialState artifact and three invalid siblings for
unowned active key, duplicate pair and invalid defeat vital. Contract tests load
actor records through the common registry with explicit floor terrain; they do
not claim full envelope/transport validation. Missing fixtures first made the new
test fail. Contract + schema guards: 3 files, 11 tests passed. Perturbing the
unowned active key back to an owned key made the expected-rejection assertion
fail; original invalid fixture restored.

### September 10 continuation — UA.20a component integration
Two integrated tests normalize actors and all-pair costs via Configurator, then
exercise registry/turn mechanics. Covered lethal durability overflow, immediate
nonblocking defeat with no emission/regeneration, stack-8 source yielding one
stack, competing claims, no auto-equip, equip action exclusivity, and JSON replay
of registry plus mid-turn state. Fire-room variants equip either owned fire/draw
(absorbs 3 into mana) or water/emit (local opposition cancellation). Both passed.
Removing the once-only holding guard caused the competing claim assertion to
fail; restored. Full suite before the later Allocator edit: 500 files, 3902 passed,
242 skipped. These are component integration tests, not production runner proof.

### September 10 continuation — UA.11a action charge schedule
Removed action_attack from Allocator base costs, the attack schedule property and
its named receipt branch. Added equipAffinity/take schedule properties, both
referencing action_default, plus explicit receipt branches. No new numeric rate.
The pre-change receipt test already passed because these actions fell through
the generic default; this changes named accounting, not their charged amounts.
The exact schedule test failed before implementation. All seven action-cost tests
passed afterward. Perturbing take's rate to zero caused two failures; restored.
Allocator suite plus four owner guards: 40 files, 212 tests passed. Typecheck
passed. Spawn/property pricing and the legacy attack executor remain pending.

Additional validation: a movement-cost Map incorrectly passed as an empty record.
A negative test reproduced this; Configurator now requires a plain object (null
prototype allowed) and rejects Maps/Dates. Both cases pass after the fix.
The first full run this continuation caught two new uninformative error messages
in the ak_create error-detail guard. Added invalid entry/rule context rather than
expanding the allowlist. The targeted guard passed.

Benchmark attribution: this continuation adds public Configurator normalization
cost assembly but does not wire it into CLI/MCP normalization or change ak_create
schema/buildArgv/argument mapping. No remote benchmark was run.

### Final verification for this continuation — September 10
After all production/test changes and restoration of every perturbation:
- `LLM_INTERNAL_HOST=192.0.2.10 pnpm run test`: exit 0, 500 files passed,
  3903 tests passed, 242 skipped, zero failures.
- `pnpm run typecheck`: exit 0.
- `pnpm run test:vitest -- tests/architecture/`: exit 0, 32 files/118 tests passed.
- `pnpm run test:vitest -- tests/core-ts/`: 34 files, 612 passed, 1 skipped.
- `git diff --check`: clean.
Logs: /tmp/ua-sep10-final-{test,types,architecture,core}.log.
Work remains uncommitted on codex/unified-actor at published HEAD de2a9325.
No original or benchmark worktree was modified. Completion is not claimed:
production still uses the legacy engine; normalized artifact/startup replacement,
remaining core mechanics, persona migration, pricing and UI/CLI/MCP still pending.

### September 10 — requested commit and UA.8c continuation
Committed the previously verified work as 4736f9ab. No push requested/performed.
Then added capability-driven exit progress to the common actor record and a
once-only resolveExits phase after regeneration. The two-tick threshold is shared
with the existing world rule. Exited actors vacate spatial queries without
removing other occupants; records retain terminal lifecycle and dwell progress.
JSON replay preserves both progress and phase completion. No preset dispatch.

Baseline: existing advanceTick invokes regeneration followed by exit dwell; all
six old exit tests passed. Five new tests first failed for missing implementation.
After implementation the focused new/old/turn suites passed (20 tests). Added a
sixth new shared-cell test and alive-at-threshold negative case. Removing exit
occupancy release produced one failure; restored. Initial typecheck found one
test's missing optional-vital assertion; corrected without widening types.
All six new exit tests pass. Full-gate results recorded below when complete.

UA.8c final gates: full suite 501 files, 3909 passed, 242 skipped, exit 0;
typecheck exit 0; separate architecture suite 32 files/118 passed. Owner/core
combined suite passed before the additional shared-cell test (41 files, 635
passed, 1 skipped); all six exit tests and the final full suite cover that addition.
All perturbations restored. Logs /tmp/ua-exit-{full,types-final,architecture-final}.log.

### September 10 — UA.9b2 and UA.20b roster continuation
Public Configurator normalizeActorRoster now assembles one actor list and separate
presentation map using the single-actor presets plus a fresh core registry for
identity, geometry, capability occupancy and zero-vital initial defeat. No second
placement/defeat evaluator, artifact builder or historical reader. Five tests
failed before implementation and pass afterward; bypassing registry validation
caused four failures, restored. Configurator + four owner guards: 41 files,
200 passed, 1 skipped. Typecheck passed.

The existing component combat/loot/fire-room scenarios now enter via whole-roster
normalization and complete the exit phase after regeneration. Both pass. Removing
the once-only exit guard caused both to fail; restored before final gates.

Producer inspection for the next milestone: Director buildspec-assembler.js
buildActorsAndGroups (line 310 at this checkpoint) constructs legacy kind/archetype,
normalizes vitals, and creates motivations: [inst.motivation]. Its caller at line
397 feeds mapped selections into Configurator inputs. The current artifact builder
also merges resolved-effects/traits and drops motivations. Production replacement
therefore needs that fresh authoring producer migrated, not a legacy artifact
reader or another builder. Existing CLI configurator also reads authored actors
from a file in commands/kernel.js (line 1521 at inspection). Preserve explicit
properties in the authoring path and move configuration decisions into Configurator;
Director should pass preset requests. No production producer switched in UA.9b2.

UA.9b2/UA.20b final gates: full suite 502 files, 3914 passed, 242 skipped,
exit 0; typecheck exit 0; separate architecture suite 32 files/118 tests passed.
All perturbations restored and git diff --check clean. Logs:
/tmp/ua-roster-{full,types-final,architecture}.log. No remote benchmarks or push.

## Production cutover — UA.9c / UA.12a (in progress, not committed)
The maintainer approved coordinated production migration after the barriers were
explained. Existing artifact-builders.js now emits normalized SimConfig terrain
and actionCosts, and normalized InitialState actors/presentation. Its old
resolved-effects/traits merge is deleted. The existing core-setup.mjs now exports
only initializeCoreFromArtifacts({simConfig,initialState}), returning one common
registry plus detached costs/presentation. Category placement, first-affinity-only
loading, numeric index mapping and primary-actor fallbacks were deleted, not kept
as compatibility readers.

Builder arguments: buildSimConfigArtifact requires normalized layout and explicit
movementStamina, with optional affinityRules. buildInitialStateArtifact takes
meta/simConfigRef plus authored actor definitions and dimensions/terrain. Grid
planning/presentation metadata remains allowed; tiles/kinds/category lists do not.
The runtime SimConfig contract now declares required terrain and actionCosts;
selectors remain version 1. Presentation categories have one exported contract
vocabulary. Loader checks envelope IDs/ref equality, exact presentation membership,
core record/occupancy validity and authored costs for mobile/owned pairs. It does
not run fields at startup. It creates no alternative legacy engine.

Measured verification:
- Existing artifact builder tests failed before replacement; both pass after.
- New real-builder -> JSON -> production-loader -> core cast/defeat/take scenario
  passes; stack-8 source yields one stack. Input mutation cannot change loaded state.
- Production loader consumes the four existing unified valid/invalid InitialState
  fixtures and rejects the intended active-key/duplicate-pair/defeat-vital cases.
- Omitting presentation from builder output produced one test failure; restored.
- Omitting reference ID equality from loader produced one failure; restored.
- Typecheck passed (exit 0).
- Final focused builder/loader/contract/schema/dependency/ports/error-detail gates:
  8 files, 23 tests passed. Log /tmp/ua-cutover-final-narrow.log.
- Full Configurator + owner guards: 4 failed, 196 passed, 1 skipped across 41 files.
  The four failures are legacy orchestrateBuild integration cases in actor-placement,
  mixed-room-composition, object-placement-problem and validate-lock.

Full cutover census (before removing one stale guard exemption): 748 failing tests
and one failed suite reported by Vitest. /tmp/ua-cutover-census.log. This is NOT a
passing release. Repeated failures come from removed setup exports imported by
runtime-fsm/preview, removed setup function calls, and old generated tiles/kinds/
legend/spawn/exit/category inputs reaching the new builder. Other legacy assertions
also need replacement. Error-detail guard flagged an exemption for the deleted
assertUniqueActorIds throw; removed that stale entry and its guard now passes.
Core behavior-wiring reports 32 unwired legacy exports against its baseline of 22:
remove the obsolete public core surface during migration; DO NOT widen the guard.
Persona-authority integration guards remain red while their producers are old.

Immediate continuation (preserve this uncommitted tree):
1. Migrate fresh Configurator level/actor authoring inputs and Director
   buildActorsAndGroups requests, then orchestrate-build.js/kernel.js builder calls.
   Author normalized terrain and explicit movement costs in Configurator, not glue.
2. Replace runtime-fsm.mjs imports at line 18 and init calls around 1608–1619 as part
   of its actual registry/turn integration. Do not merely alias removed functions.
   Delete numeric-ID mapping/active-actor adaptation. Actor/Moderator/Annotator
   consumers must use normalized records/actions and own their existing decisions.
3. Migrate core-facade.js initialize call, adapters-cli/tick-session.mjs setup,
   and ui-web/views/preview-view.js setup imports/callers. Their existing field and
   observation readers still expect old core APIs; migrate them, not just imports.
4. Replace the obsolete core-setup category test suites after equivalent common
   behavior is covered. Remove obsolete core exports/storage; keep the guards.
No fallback reader, version bump, remote benchmark, commit or push in this cutover.

## September 11 — UA.10a Director request handoff
Session refresh completed with --no-pull in the isolated worktree: source preserved,
deps/tools/context refreshed, Serena responds. Full startup test run remains red
(747 failed tests plus one failed suite reported; /tmp/ua-session-sep11.log).
No rollback, guard widening, commit, push or benchmark was performed.

Before-change executed trace: summary actors [{actorType:"warden", motivations:
["defending","exploring"], affinity:"fire", count:1}] emitted motivations only
["defending"], plus kind/archetype/traits/tokenCost. This is measured loss in the
production Director assembler, not an inference from a dormant branch.

Replaced its actor request output with category and common authored properties.
Selection records retain planning cost/setup mode. Requests preserve alignment,
capability overrides, defeat vital, owned pairs, active key (including null),
holdings and motivation lists without injecting a second set of vital defaults.
Summary selections and catalog mapping now forward the full list and explicit
common overrides. Warden card translation also preserves its full motivations.
Explicit invalid null properties survive to Configurator validation instead of
silently becoming defaults. Outputs are detached from the selection inputs.
Updated existing role/affinity/price assertions to their new owning representations.

Evidence: initial three tests red, then green; truncating emitted motivations made
all three fail, restored. Added explicit-null regression red then green. Final
Director plus owner gates: 87 passed, 1 skipped, 4 failed, across 19 files (18 pass,
one fail). All four failures are the pre-existing persona-authority cutover paths:
Configurator full build rejection, Director full build unsupported legacy layout,
Actor runtime and Annotator runtime calling removed applySimConfigToCore.
Typecheck passed. git diff --check passed. Logs /tmp/ua-director-final2.log and
/tmp/ua-sep11-types.log. No whole-application green result is claimed.

Remaining authoring work: summary/card normalization still supplies old vital
and affinity defaults upstream; hazard/resource cards still use separate planning
collections. Replace those under Configurator/Director ownership, including
terrain generation, capability-aware placement, normalized property pricing and
both orchestrate-build/kernel builder calls. Do not restore legacy actor fields
to satisfy unmigrated consumers. Runtime registry/turn adoption remains pending.

## September 11 continuation — UA.9d / UA.9e terrain authoring and placement
Used Configurator ownership; same session startup as above, no refresh repetition.
Executed pre-change generator trace (9x9, seed42, one3x3 room) showed tiles/kinds/
legend plus duplicate spawn/exit coordinates. The new generated-terrain test failed
on missing terrain and the production builder rejecting those fields.

Generator now emits canonical row-major terrain from the existing mask. Removed
numeric kinds, glyph rows, legend and duplicate marker positions. Room generation,
connectivity, pattern algorithms and floor-target reconciliation are retained.
The generator's own counting and wall checks now consume terrain. Hazard planning
positions still become floor; no hazards/resources were silently discarded.
Generated layouts without those pending entity collections pass the existing
production SimConfig builder directly. Five deterministic seeds covered.

Actor placement reads canonical walkability/markers through terrain-layout.js;
removed its numeric/glyph readers. The existing strategic/group placement policies
are retained, not claimed to implement the pending capability/alignment rewrite.
Public generated layout -> actor placement -> InitialState assembly passes for
three seeds. Core validates resulting actor occupancy when the artifact is built.
Existing geometry/pattern tests and two placement characterization fixtures were
migrated in place, preserving their expectations. Test-only glyph projection is
for independent geometry oracles, not a production historical reader.

Oracle correction: first new placement assertion incorrectly expected the actor
on spawn. Inspection showed collectReservedPlacementKeys reserves spawn and exit,
so the old strategic algorithm selects nearest available entry-room floor instead.
Corrected the test to this existing ordering rather than change placement policy.
The initial failed expectation is not counted as perturbation evidence.

Measured checks:
- Generated terrain tests red before implementation, then green.
- Routing generated floor to wall makes the measured seeded-geometry test fail;
  restored. Removing terrain marker lookup makes corrected placement oracle fail;
  restored. No mutations remain.
- Narrow final generator/placement suites: 3 files,13 tests pass; migrated room-size
  and placement characterization suites: 2 files,3 tests pass.
- Typecheck passed; git diff --check passed.
- Broader owner run before final fixture migration: 189 pass,14 fail,1 skipped.
  Remaining failures involve legacy readers/fixtures, not a passing application.
  Final owner rerun recorded below when complete.

Next production seams: object-placement.js still reads kinds/tiles and duplicate
markers; feasibility.js has two old walkability/floor readers; guidance-level-builder
still renders generated.value.tiles. Migrate these to canonical terrain without
fallback readers. Then finish actor/hazard/resource authoring and Configurator-owned
cost assembly before changing orchestrate-build.js/kernel.js builder arguments.
No commit, push, benchmark, or claim of full production readiness in this continuation.
Final Configurator + owner guards: 192 passed,11 failed,1 skipped across43 files
(36 passed,7 failed), /tmp/ua-terrain-owner-current.log. The four selected architecture
guards passed. Remaining failures: actor-placement full-build2, feasibility1,
layout-feasibility3, guidance-preview2, mixed-room full-build1, object-placement
full-build1, validate-lock full-build1. Narrow restored results are above.

## September 11 continuation — UA.9f/g remaining Configurator terrain readers
Updated feasibility.js and object-placement.js to query canonical terrain and
marker positions. Removed their kinds/tiles/legend fallback readers. Preserved
planned occupant exclusions, solver constraints, row-major fallback and marker
reservations. Preview generation projects canonical terrain into glyph rows only
at its existing rendering boundary; generated artifacts do not regain glyph state.
The object-placement fixture and its independent exhaustive-search oracle now use
canonical terrain, with the same expected assignments and four unsat families.

Measured evidence:
- Feasibility/layout-feasibility/guidance suites initially had 6 failed/3 passed;
  after reader migration all9 pass, including the185-case characterization and
  threshold checks. No characterization verdicts were re-recorded.
- Object test migration initially had a test syntax error, corrected before
  validation. Re-ran corrected tests against the original production reader:
  4 failed/4 passed. New reader: 1 failed/7 passed. The remaining full-build failure
  now reaches artifact assembly and rejects hazards/resources layout collections.
- Empty feasibility walkability mutation: 1 test fails; restored.
- Omit spawn reservation mutation: 2 additional solver tests fail (3 total including
  the already-red full-build case); restored. Both meaningful perturbations verified.
- Final Configurator + four owner architecture guards: 199 passed,4 failed,1 skipped
  across43 files (39 passed,4 failed). All selected guards pass. Four failures are
  the full-build actor-placement, mixed-room-composition, object-placement and
  validate-lock scenarios, all at unsupported hazards/resources layout fields.
- Typecheck exit0; git diff --check clean. Logs /tmp/ua-readers-owner.log,
  /tmp/ua-readers-types.log, /tmp/ua-readers-green.log, /tmp/ua-objects-green2.log.

Next: replace category-specific authoring outputs with normalized actor definitions
and holdings, remove their layout collections at their Configurator-owned origin,
then wire authored movement costs/terrain/actor records into orchestrate-build and
kernel builder calls. Do not merely strip hazards/resources: their mechanics,
rewards and pricing must survive. The production runtime migration is still pending.
No commit/push or benchmark. Same isolated branch; all perturbations restored.

## September 12 — UA.9h room composition marker regression
Session refresh --no-pull completed: selected source retained, deps/tools/context
refreshed, Serena activated/responds, CodeContext read. Full startup suite still
red (748 failed tests reported). This is the approved incomplete cutover, not a
release. No source reset or guard widening.

While tracing hazard authoring, found composeMixedRooms still read removed
layout.spawn/exit. First30 seeds did not reveal a failure; widened to1000 seeds
(0..999, 9x9, one3x3 room, fire/emit card):164 emitters occupied spawn or exit.
First recorded failure seed392, exit at4,4. New regression exercises that entire
domain and requires one generated emitter plus no marker placements.
Replaced only marker lookup with canonical terrainMarker; migrated old inline
fixture to canonical terrain with unchanged expected assignments/vitals. No changes
to source properties, RNG calls, profile ordering or candidate-order policy.

Validation: new test red before fix; both narrow tests pass after. Missing-marker
perturbation makes the 1000-seed regression fail, restored. Final Configurator plus
four owner guards:200 passed,4 failed,1 skipped across44 files (40 pass,4 fail).
All four selected architecture guards pass. Remaining four full-build failures are
still unsupported hazards/resources layout collections. Typecheck exit0 and diff
check clean. Logs /tmp/ua-sep12-owner.log,/tmp/ua-sep12-types.log; startup
/tmp/ua-sep12-refresh.log. No commit/push or benchmark.

Authoring conversion remains pending. Actual producers inspected: level-gen.js
normalizeHazardList, input-preparation.js prepareLevelGen/mapResources,
mixed-room-composition.js collectCardAffinityHazards/collectMixedRoomTemplateHazards,
and object-placement.js output assembly. Replace these outputs coherently; do not
strip their layout fields to reach green while losing mechanics or rewards.

## September 12 local continuation — UA.9i resource preset authoring
Maintainer confirmed remaining session stays local. Same worktree/session; no
cloud transfer or restart. Existing mapResources production mapper replaced its
_schemaVersion/tier/stat branches with common normalizeActorDefinition. Resource
is the omitted category default; explicit properties are validated and retained.
Unpositioned requests validate with a temporary origin then omit position in the
output, requiring placement before InitialState assembly. Explicit null position
still rejects. No authored vital pool is transformed into a reward.

Tests cover a mobile resource with two motivations, owned stack8 equipment, active
pair and explicit vital-grant holding through public mapping -> InitialState
assembly; ownership/detachment preserved. Invalid active pairs and obsolete
resource shapes fail. Existing input-preparation and validation/locking tests
updated to the common request contract, including missing-ID rejection at the
normalization boundary. CLI/card producers still need their contract migration.

Evidence: three new tests initially fail, then pass. Twelve narrow input-prep/
resource tests pass. Omitting holdings makes one new test fail; restored and all
three pass again. Final Configurator + four owner guards:203 passed,4 failed,
1 skipped across45 files (41 pass,4 fail). Four existing full-build failures still
reject hazards/resources layout collections. Typecheck exit0; diff check clean.
Logs /tmp/ua-resource-owner.log,/tmp/ua-resource-types.log,/tmp/ua-resource-perturb.log.
No guard widening, compatibility reader, commit/push or benchmark.

Next: carry common resource requests out of object placement into the InitialState
actor list instead of layout.resources, alongside hazard producer migration.
Preserve positioned resource fields and holdings when moving that handoff. The
existing Director resources projection and CLI resource parser still author old
fields; replace them directly. Property pricing and runtime adoption remain pending.

## September 12 local continuation — UA.12b/UA.9j production resource handoff

The production build now consumes `completeObjectPlacement().actors` and merges
placed resource actors into the unified actor roster before actor placement and
InitialState assembly. SimConfig construction uses canonical affinity rules and
movement stamina inputs; InitialState receives dimensions and terrain and no
longer passes removed legacy rule/effect references. The end-to-end production
resource scenario passes, including position, presentation category, and action
cost. Typecheck and diff checks pass. One legacy characterization still fails
because it asserts hazards in the layout; that is retained as the explicit
hazard-migration seam rather than hidden with a compatibility field.

## September 12 local continuation — UA.9k/UA.12c hazard actor handoff

All hazard sources now converge at object-placement completion and leave that
Configurator boundary as common actors. Their owned pair is active, default
mana/durability keeps the established scaling baseline, blocking is a capability,
and presentation remains `hazard`. The layout hazard collection is removed before
SimConfig assembly. Strategic placement reserves placed hazard/resource cells and
partitions remaining actors by alignment; keyword role inference was removed.

The full Configurator scope plus production integration passes: 42 files, 197
tests passed, one skipped. Typecheck and diff checks pass. Perturbing hazard
equipment to inactive made the production oracle fail, and restoring it returned
both resource/hazard integration scenarios to green. CLI/card authoring, pricing,
legacy affinity summary, runtime FSM, adapters, and UI remain pending.

## September 12 continuation — pricing handoff and broad baseline

Budget evaluation now passes placed hazards/resources through the ordinary actor
pricing path. Presentation category determines only the grouped receipt row; a
five-category parity oracle proves identical mechanical records produce identical
charge ids and quantities. Direct Allocator validation has 37 passing files; its
four failing files (11 tests) all stop at the removed runtime setup imports before
exercising pricing. Perturbing only the resource label to use a different spawn
item made the five-label parity oracle fail; restoring the common actor charge
returned it to green. Typecheck and diff checks pass.

A machine-readable full-suite run measured 744 files: 599 passed and 145 failed;
3182 of 4174 tests passed, with 746 failures. The failures are concentrated in
legacy runtime, CLI, adapter, and UI consumers. The immediate blocker is
runtime-fsm importing `applySimConfigToCore` and `applyInitialStateToCore` while
also depending broadly on the legacy core API. This requires a split runtime
cutover; compatibility aliases would conceal rather than complete the rewrite.

## September 13 — portal rebase and UA.12d1 runtime startup

Merged PR #174 and rebased `codex/unified-actor` onto main commit `7a8888f4`.
Resolved the 14-file overlap by retaining canonical row-major terrain and common
actors while carrying forward wall `spawn`/`exit` portals plus walkable
`spawnApproach`/`exitApproach` endpoints. The post-rebase Configurator and production
integration domain passes 43 files, 200 tests, one skip; the focused 11-file
architecture set passes 38 tests and typecheck passes.

UA.12d1 replaces runtime-fsm's deleted setup calls with
`initializeCoreFromArtifacts`. Runtime retains the detached registry, authored
costs and presentation, exposes detached snapshot readers, and projects canonical
terrain for the existing render boundary. The startup test installs throwing stubs
for all legacy setup call families and still loads a delver plus barrier. Narrow
startup/loader/production integration is 8/8; typecheck passes. Nulling the retained
registry turns the startup oracle red; the implementation was restored.

The dependency-direction and ports guards pass. The behavior-reachability ratchet
reports 36 instead of 13 because UA.12c removed all production references to 23
legacy setup exports. Deleting those exports immediately made 17 legacy core test
files fail typecheck, so that broader removal was reverted for its explicit
core-export/test migration milestone. No guard baseline or compatibility alias was
added. Next is ActorTurn action execution and once-only tick closing.

## September 13 — UA.12d2 unified runtime actions

Runtime now sends move, cast_affinity, equip_affinity, take, and wait through one
ActorTurn per apply phase using stable string actor IDs. Accepted actions use the
versioned Action envelope. After ordered actions, runtime resolves fields,
regeneration, and exits exactly once and records the resulting registry and turn
state in the apply TickFrame for replay. Conventional attack adaptation and its
direct applyAttack dispatch are removed.

The focused runtime, loader, production, and ActorTurn domain passes 19 tests; the
dependency-direction and ports guards pass 5 tests; typecheck passes. Temporarily
allowing attack through normalization made the runtime oracle fail, then restoring
the five-kind vocabulary returned it to green. The behavior reachability ratchet
is expected-red at 37 versus 13: the prior 23 setup exports plus applyAttack now
have no production caller. Actor still emits legacy proposals and runtime
observation still reads legacy world state, so the next milestone migrates that
decision boundary rather than claiming an end-to-end autonomous actor path.

## September 14 — Actor proposals and registry observations

The resumed Actor diff now uses alignment, active focused equipment and shared
mana. Fixed an observed scoring defect: a stack-2 push cast at distance 3 was
classified as in-range combat. The 12 expression/range combinations now classify
correctly; temporarily removing the range check made the test fail, then restored.
Area pairs no longer propose focused casts. Solver and exit fixtures now exercise
the new contracts; terminal actors cannot propose or request solver decisions.

The production runner now observes the common registry. Core projects detached
movement/sight grids and active fields, and applies existing visibility rules.
The real Actor moves from x=0 to x=1 and then x=2 in the production oracle; before
the cutover it stayed at x=0. Observation reads preserve registry state. Two
legacy production Actor fixtures now use Configurator-built unified artifacts.
Actor suite: 20 files, 108 passed, 5 skipped. Core, focused runtime, and boundary
validation: 46 files, 646 passed, 1 skipped. Typecheck and diff check pass.
Field utility, composed ranking, equip/take decisioning and legacy removal remain;
this is not full rewrite completion. Production changes remain uncommitted.

## September 15 — action vocabulary hardening

The runtime executor now accepts only the five unified actor actions. The former
attack escape hatch was removed from the reachable apply path, while legacy
core attack tests remain isolated for the later core-removal milestone. Wait
actions now serialize without a `params` member, matching the clean-break
contract. Narrow actor, core observation/field, and runtime suites pass: 25
files, 156 passed, 5 skipped; typecheck and diff check pass.

The earlier narrow verification (24 files, 149 passed, 5 skipped) missed three
Configurator regressions introduced during continuation: fabricated one-point
vitals, silent empty movement costs, and silently discarded unknown resource
fields. Astra review removed those changes and restored the existing strict
normalization paths. Three regression tests failed with those changes present;
after restoration all 35 assertions in seven focused behavior/authority files
pass. This supersedes the earlier claim that the defaulting was validated.
Legacy authority fixtures must migrate to the clean-break contracts; their
failures do not justify accepting obsolete resource shapes or inventing costs.

## September 15 — runtime authority fixture migration

The budget-admission and Annotator provenance runtime proofs now build unified
artifacts through the shared Configurator fixture. The budget proof uses move
and wait, with explicit motivation cost metadata, and requires the standalone
Allocator to admit exactly wait. Both migrated tests pass. Bypassing the injected
Allocator in Actor emitted move and failed the comparison; the mutation was
restored. The full authority file still has three authoring-side failures
(resource validation parity, validation ablation, and missing explicit movement
costs in the Director build request). Runtime grid loading no longer blocks
these two proofs. No guard was relaxed and shared legacy JSON was not rewritten.

## September 16 — authoring authority and conventional combat removal

All 16 persona-authority tests now pass. Resource parity uses valid unified
definitions and compares normalization errors as well as validate/lock verdicts.
Director authoring explicitly supplies its empty movement-cost map. The refusal
test supplies a fractional tile count, which reaches Configurator validation;
removing validate/lock calls makes the test fail (mutation restored).

Removed core applyAttack, its export registration, and rules/combat.ts. Removed
only conventional-combat assertions from legacy affinity/hazard suites, retaining
their other coverage. Added a negative export assertion that failed before
removal. The existing ActorTurn test continues to reject the attack action.
Core suite: 37 files, 609 tests pass; typecheck passes. Category-specific state
and legacy affinity APIs remain for subsequent removal; this is not completion.

Broader verification: pnpm run test reports 104 failed / 420 passed files and
429 failed / 3552 passed / 243 skipped tests (77.60 seconds). Raw output is local
at /tmp/ua-sep16-full-suite.log. This is the current incomplete-migration baseline,
not a clean gate. The separate architecture run reports 33 passed / 1 failed
files, 131 passed / 1 failed assertions: 36 unreachable core behaviors against
the unchanged baseline of 13. Deletions of combat.ts and combat-actions.test.mts
are staged because git-ls-files guards otherwise try to read deleted files.
No commit was made. Reintroducing an applyAttack export makes the negative export
test fails; restoration returns it to green. Next: remaining producer and
runtime/CLI fixture inputs, then remaining legacy state and API paths. The
shared runtime-decision reader is complete. Production create now reaches
missing movementStamina after hazard vitals conversion.
