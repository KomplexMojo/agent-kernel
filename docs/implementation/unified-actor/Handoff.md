# Unified actor rewrite — local continuation

## Start here

STANDING ORDER September 16: run the autonomous completion queue in Plan.md
without waiting for a maintainer prompt between S milestones. Local worktree
only. No push or PR. Stop only on the Plan escalate list.

CHECKPOINT September 16: local commit of the live production cutover and
leftover producer conversion on `codex/unified-actor`. Remaining red is
leftover pools, spawn/exit occupancy, and leftover oracles — not a license
to restore `attack` or `layout.hazards`. No push or PR; row 9 is later
reviewer.

LATEST September 16: leftover gameplay-view, inspector, and affinity-field
bridge read presentation hazard/resource actors and terrain glyphs. Leftover
layout.hazards/tiles collections are not used for selection, inspector lists,
or tile-visual fallback. Overlap selection prefers the mobile actor.
Leave pool denials, spawn/exit occupancy, proximityRadius, and leftover
JS-spread overlap fixture collections red. Typecheck 0. Wiring 36 vs 13.
No commit/push/PR.

LATEST September 16: leftover sandbox-tick S1/S2/S3, MCP tick-control,
tick-visualization, 10-tick ring, and cost-summary stubs now run on the
unified path. Resource-plan grant regen snapshots equal measured charges.
Leave proximityRadius, spawn/exit occupancy, auto-place without radius,
dry-run invalid permanenceMode, VSR vault V1 resources, pool denials, and
INT/VSR catalog red. Do not invent proximityRadius, pools, or Allocator
regen prices. Typecheck 0. Wiring 36 vs 13. No commit/push/PR.

LATEST September 16: leftover overlay occupancy uses hazard expression/stacks
and V3 resource holdings; spawn/exit occupancy reads terrain cells. Leftover
MCP place stubs now run. Leftover hazard-placement oracles read presentation
actors. Leftover field-records overlap uses Configurator artifacts. Leftover
execution-benchmark fixtures now use terrain plus presentation actors; smoke
and contract oracles pass. Leave llm-plan/warden-pool 0, t1-medium rooms
pool, overlay room-pool denials, leftover spawn/exit occupancy skips, and
delver-pool short 3/5 red. Typecheck 0. Wiring 36 vs 13. No commit/push/PR.

LATEST September 16: leftover `--tile-barrier` becomes Configurator barrier
actors; leftover CLI V1 `tier`/`stat`/`dropRate` is rejected at parse, not
accepted then failed later. ak-errors 20 including barrier placement.
Leave llm-plan/warden-pool 0, t1-medium rooms pool, overlay string-affinity,
and leftover MCP skipped stubs red. Typecheck 0. Wiring 36 vs 13. No
commit/push/PR.

LATEST September 16: leftover `--vital-default` uses Configurator
DEFAULT_VITALS, not a glue health-10 table. Kernel affinity-summary no longer
reads leftover layout.hazards. Phaser/preview draw hazard and resource actors
from presentation; leftover observation.hazards/resources collections are
dropped. Actor resolveBaseTiles and visualization snapshots use terrain, not
leftover tiles. Leave llm-plan/warden-pool 0, t1-medium rooms pool, overlay
string-affinity, leftover `--tile-barrier`, and leftover MCP skipped stubs
red. Typecheck 0. Wiring 36 vs 13. No commit/push/PR.

LATEST September 16: leftover sandbox MCP place rebuilds SimConfig/InitialState
through Configurator terrain + roster. No leftover tiles/legend/traits/loot.
V1 dropRate stays rejected; resource specs use V3 permanence. Wall occupancy
rejects the leftover rim-cell OOB setup. `ak run --tile-wall/--tile-floor`
mutate terrain; leftover `--tile-barrier` stays rejected. `--actor` requires
a unified category and rebuilds the roster through Configurator. sandbox-tick
37 passed / 16 skipped; sandbox-entities 14 passed / 16 skipped including
create→place→ak_run; ak-errors 20 passed. Leave llm-plan/warden-pool 0,
t1-medium rooms pool, overlay string-affinity, and leftover `--vital-default`
glue table red. Typecheck 0. Wiring 36 vs 13. No commit/push/PR.

LATEST September 16: leftover affinity-summary run uses Configurator artifacts;
unified layout has no hazards collection so summary.hazards is []. CLI/MCP
10-tick dungeon creates use V3 permanence resources. V1 loot stays rejected.
Leave llm-plan/warden-pool 0, t1-medium rooms pool, overlay string-affinity,
and leftover sandbox tiles/traits red. Typecheck 0. Wiring 36 vs 13. No
commit/push/PR.

LATEST September 16: leftover UI/CLI run/replay/inspect use Configurator
artifacts and drop leftover --actor/--tile-barrier flags. t2-stress and
hazard-free resource creates use V3 permanence payloads; receipts filter
category=resources. V1 loot stays rejected. Perturb leftover simConfigRef
failed; restored. Leave llm-plan/ui-cli warden-pool 0 and t1-medium room-pool
red. Typecheck 0. Wiring 36 vs 13. No commit/push/PR.

LATEST September 16: leftover element-placement invariant reads terrain
spawn/exit cells and walkable terrain; shrine resources use V3 vital/affinity
payloads. Leave llm-plan/ui-cli warden-pool 0 and room-pool denials red.
Typecheck 0. Wiring 36 vs 13. No commit/push/PR.

LATEST September 16: leftover authoring CLI and room-size hazard tests read
presentation hazard actors and terrain floors. Leave delver-pool denials red.
Typecheck 0. Wiring 36 vs 13. No commit/push/PR.

LATEST September 16: leftover element-matrix CLI oracles read presentation
hazard/delver categories and V3 resource holdings. V1 loot keys stay rejected.
Perturb using actor.category instead of presentation failed; restored.
Typecheck 0. Wiring 36 vs 13. Leave room-pool denials and overlay string
affinity red. No commit/push/PR.

LATEST September 16: Configurator viability seeds omitted actor vitals from
DEFAULT_VITALS then ACTOR_VIABILITY_FLOOR; motivation floor seeds stamina the
same way. Director leftover spawn-align now places walkable actors. Leave
room-pool denials and V1 loot/string-affinity red — do not invent pools or
hazard expressions. Perturb dropping omitted-vitals fill failed; restored.
Typecheck 0. Wiring 36 vs 13. No commit/push/PR.

LATEST September 16: leftover create hazards now become actors. mapHazards
assigns `hazard_N` when generated occupants omit id; cloneLayoutData strips
leftover tiles/hazards/kinds. CLI configurator places then assembles unified
artifacts. Create-blocking, ak-build, and ak-configurator retargeted off
layout.hazards. Perturb requiring hazard ids failed the new oracle; restored.
Typecheck 0. Wiring 36 vs 13 expected-red. Leave orchestrateBuild pool denials
and leftover ambulatory-without-category red. No commit/push/PR.

LATEST September 16: row 8 recorded. Attack/receipt/battle leftover tests now
use Configurator artifacts and `cast_affinity`; `attack` stays rejected.
Allocator pool-denial remaining snapshot 132 (measured). Scenario compose
still red on warden pool 0 — do not invent a pool. Full suite 4198 tests:
3808 passed, 162 failed, 228 pending; 74 failed files. Typecheck 0. Wiring
36 vs 13 expected-red. Remaining red is leftover CLI/create/build/catalog
producers, not a license to restore `attack` or layout.hazards. No commit,
push, or PR. Row 9 is later reviewer.

LATEST September 16: row 7 goldens — mapResources now converts CLI V3 affinity
payloads and ignores Director leftover `permanent: false` / undefined V1 keys.
Create g1–g3 and resource-plan g4 goldens regenerated from live Allocator
charges (g2/g4 affinity resource 120, not invented). Typecheck 0. Wiring 36 vs
13. Leave attack receipts, battle-run melee, and scenario budget denials red.
No commit/push/PR.

DECIDE September 16 — RESOLVED. Took the recorded recommendation: core owns
persist-or-spawn with no invented quantities; runner maps existing
`arm_static_hazard` onto that method. Moderator still plans the environment
effect and does not author actors.

LATEST September 16: autonomous rows 1 skipped, 2–6 landed; row 7 partial;
row 8 recorded. Full suite 4235 tests: 3725 passed, 274 failed, 236 pending;
104 failed files. Typecheck 0. Remaining red is leftover CLI/MCP/file
fixtures and producers, not a license to restore legacy APIs. No commit,
push, or PR. Uncommitted rewrite remains incomplete.

DECIDE September 16 — RESOLVED. Took the recorded recommendation: core owns
persist-or-spawn with no invented quantities; runner maps existing
`arm_static_hazard` onto that method. Moderator still plans the environment
effect and does not author actors.

LATEST September 16: autonomous rows 1 skipped, 2–4 landed, 5 escalate.
Row 1: V1 `stat=vitalMax|vitalRegen` has no ResourceVitalKey and CLI V1 always
requires `dropRate`; converting would invent health/mana/stamina and loot
keys. Row 2: three runtime.init families now use Configurator terrain +
unified actors (observation-scoping, actor-faction, multi-actor-orchestration).
Row 3: `scopeObservation` deletes `hazards`; `readObservation` no longer
emits a hazards collection; `placeResourceAt` / `armStaticHazardAt` remain.
Row 4: Phaser draws presentation-category hazard actors from
`observation.actors` and still falls back to `observation.hazards`.
UI renderer + adapter-io guards: 5 files, 106 passed, 4 skipped; typecheck 0.
Perturb restoring hazards-only draw failed the new oracle; restored.
Next: row 5 after the Decide above. Uncommitted rewrite remains incomplete;
no full-app green claim.

LATEST September 16: runtime observations from the unified registry carry
hazard actors and no hazards collection. LOS tests now use terrain walls and
barrier actors. Glue no longer enriches layout hazards into observations.
Observation tests + dependency/ports: 6 files, 14 passed; typecheck and diff
pass. Reattaching hazards: [] failed the vitals oracle and was restored. Next:
V1 resource shapes and leftover core category APIs. Uncommitted rewrite remains
incomplete; no full-app green claim.

LATEST September 16: cloneLayoutData strips `budgetScaffold` from locked SimConfig
layout and still rejects other extras. Glue may stamp the flag for Allocator
spend; it is not authored geometry. Configurator + four owner guards: 47 files,
220 passed, 1 skipped; typecheck and diff pass. Treating it as a layout field
failed the new oracle and was restored. Next: V1 resource shapes and leftover
core state/API. Uncommitted rewrite remains incomplete; no full-app green claim.

LATEST September 16: mapResources converts CLI V3 permanenceMode plus grant
vitals into one unclaimed holding and default source durability. Unknown extras
and V1 tier/stat still throw. Configurator + four owner guards: 47 files, 219
passed, 1 skipped; typecheck and diff pass. Spreading CLI extras failed the new
V3 test and was restored. Next: V1 resource shapes, layout `budgetScaffold` on
resource-only create, and leftover core state/API.
Uncommitted rewrite remains incomplete; no full-app green claim.

LATEST September 16: mapHazards accepts CLI string affinity plus expression, or
affinityStacks[0], instead of requiring an object pair. Configurator + four
owner guards: 47 files, 218 passed, 1 skipped; typecheck and diff pass.
Requiring an affinity object failed the new CLI-shape test and was restored.
Next: remaining CLI resource extras and leftover core state/API. Uncommitted
rewrite remains incomplete; no full-app green claim.

LATEST September 16: mapHazards converts one-time `{amount}` hazard vitals to
mechanical current/max/regen:0 and skips incomplete records so computed defaults
remain. Configurator + four owner guards: 47 files, 217 passed, 1 skipped;
typecheck and diff pass. Copying current/max/regen from one-time records failed
the new test and was restored. Next: remaining CLI/card defaults and leftover
core state/API. Uncommitted rewrite remains incomplete; no full-app green claim.

LATEST September 16: assembleMovementStamina builds the ID-keyed cardinal map
from the placed roster. Explicit costs win, then nonnegative
capabilities.movementCost, then the Configurator default for mobile actors.
Glue calls the helper; it does not invent IDs. Configurator + production-build +
four owner guards: 48 files, 219 passed, 1 skipped; typecheck and diff pass.
Skipping roster fill failed the omitted-map tests and was restored. Next:
remaining CLI/card defaults and leftover core state/API. Uncommitted rewrite
remains incomplete; no full-app green claim.

LATEST September 16: mapHazards projects authored regen vitals onto mechanical
current/max/regen and drops CLI `kind`. Configurator + four owner guards: 46
files, 214 passed, 1 skipped; typecheck and diff pass. Raw-spread perturbation
failed and was restored. Production create now fails on missing ID-keyed
movementStamina. Next: assemble that map from the placed roster, then remaining
CLI/card defaults and leftover core state/API. Uncommitted rewrite remains
incomplete; no full-app green claim.

LATEST September 16: shared runtime-decision reader projects live mechanical
actor records and drops injected hazards, role, kind, affinityGrants and
vitalEffects. LLM prompts no longer reintroduce a hazards collection. Solver
adapters stay tuple-only and are guarded against those tokens. Actor/four
guards/contract/observation/orchestrator/solver adapters: 34 files, 185 passed,
5 skipped; typecheck and diff pass. Hazards perturbation failed and was restored.
Next: remaining producer and runtime/CLI fixture inputs, then leftover core
state/API. Uncommitted rewrite remains incomplete; no full-app green claim.

LATEST September 15: Actor solver producer emits common live mechanical records
for self and visible actors. Removed its category kind, affinityGrants output,
separate hazard collector, and configured-alignment override. Equipment, holdings,
motivations and lifecycle cross the boundary without aliases. Actor/four guards/
production observation: 27 files, 149 passed, 5 skipped; typecheck and diff pass.
Alias perturbation failed and was restored. Next: shared runtime-decision reader
and adapter legacy cleanup, then remaining consumer migration and full gates.
Do not confuse producer cleanup with removal of every shared legacy contract.

LATEST September 15: focused readiness contributes to equipment candidates.
Actor reuses its nearest-hostile cast proposal and motivation intent classifier;
an owned in-range pair can replace an out-of-range active pair without fields.
Readiness precedes field safety/benefit in existing tuple order, ties retain current.
Equip remains stationary for action sequencing and core accepts a cast only on a
later turn. Actor + four guards + production observation: 27 files, 149 passed,
5 skipped; typecheck and diff check pass. Readiness-bypass perturbation failed
two tests and was restored. Next audit: remaining clean-break Actor/solver residue,
candidate parity and consumer migration; do not claim a damage/cost optimizer.
Uncommitted changes remain isolated; complete rewrite/full-app gates still pending.

LATEST September 15: taking candidates now work in deterministic and solver paths.
Living canTake receivers enumerate unclaimed holdings on adjacent defeated sources;
separate holdings have distinct candidate IDs. Core consumes the take action and
atomically claims one reward. Terminal sources no longer attract combat proposals.
Tests cover new/existing affinity pairs, explicit vital grants, stale competing
claims, capability/range/lifecycle exclusions and solver metadata. Actor + four
guards + production observation: 27 files, 141 passed, 5 skipped. Typecheck and
diff check pass; living-source perturbation failed and was restored.
Next: focused-target equipment evaluation; then remaining adapters/Annotator/UI,
legacy engine removal and full gates. Changes remain uncommitted.

LATEST September 15: field-driven equip candidates work in deterministic and
solver paths. Core observations preserve pre-cancellation affinityContributions
only for visible cells. Reprojection replaces only self contributions, retaining
unseen emitters. Strict fieldSafety/fieldBenefit improvement gates candidates;
ties keep current. Common tuple classifies equip as a stationary action. Tests
demonstrate draw mana, water cancellation, disabled equipment, tie retention,
unseen emitter preservation, solver evaluations and core turn consumption.
Next: focused-target equipment evaluation, take candidates, then remaining
runtime/Annotator/UI and legacy-removal work. Full rewrite remains incomplete.
All changes remain uncommitted; no benchmark run or PR.

Latest validation: 65 files, 769 passed, 6 skipped; final typecheck and diff check
pass. Focused observation/equipment tests pass after visibility typing fix.
Core reachability remains the known 37 vs baseline 13 failure; unchanged.

LATEST September 14: projectActorFieldsAt(actors, position) now shares core's
live projection implementation. It supports detached equipment alternatives;
tests demonstrate fire/draw mana and water/emit cancellation, unchanged inputs,
input-order stability and equivalence with full-grid projection. Opposition
perturbation failed the water oracle and was restored. Typecheck passes.
Next Actor integration must preserve observed fields whose sources are outside
sight: rebuilding from visible actors alone would incorrectly erase them.
Core projection does not infer missing sources. Equip candidates and tie retention
are not implemented yet. Known reachability guard remains 37 vs baseline 13.

LATEST September 14: Actor now scores unified fields through core
previewActorFieldChanges; legacy vitalEffects/grant-based field scoring is gone.
Core shares affinity routing with execution and forecasts detached receiver vitals
using changeActorVital. Covers overflow, active-only protection/draw absorption,
missing capacity, defeat, repeated-source budgets, stable source order. Scope:
receiver-local conservative residual-stack budget, before competing receivers;
does not reproject candidate equipment. Tests agree with real resolution across
20 one-receiver area affinity cases. Core + Actor + production observation + six
guards: 64 files, 762 passed, 6 skipped. Overflow and Actor-bypass perturbations
failed and were restored. Next: equipment counterfactual projection and candidates,
then taking. Known legacy reachability guard and full-app migration remain pending.

LATEST September 14 field groundwork: core actor-fields.ts now exposes
actorFieldExposureAmount(receiver, cell, localCells), and production projection
calls it. Pure receiver-local magnitude only: budget spending, mana credit,
vital routing and defeat remain in existing core resolvers. Tests cover inactive
equipment, self/terminal exclusion and 40 active affinity/expression pairs.
Restored core + dependency/ports guards: 39 files, 631 passed, 1 skipped;
typecheck passes. Core-behavior-wiring remains red at 37 vs baseline 13 (unchanged).
Actor still expects legacy vitalEffects and scores raw unified fields as zero.
Next: build authoritative vital-effect evaluation from this shared calculation
and route Actor through it; do not copy the routing matrix into Actor. Then
equip/take candidates. This change is groundwork, not finished field scoring.

LATEST September 14 deterministic selection: Actor now ranks its deduplicated
proposals per actor through the composed objective, emits one winner, and reports
the winner's intent class. Patrol-first combat and stable ties have regression
coverage. Selecting the first proposal instead makes both combat/intent tests red;
mutation restored. Typecheck passes. Field utility and equip/take candidates are
next; solver candidate expansion still adds adjacent moves/wait independently.
The uncommitted rewrite remains incomplete; do not report full gates as green.

LATEST September 14 continuation: stationary motivations no longer veto mobile
motivations; canMove=false still filters movement. Solver ranking now evaluates
each authored motivation using the existing complete tuple and retains each
candidate's best row. Actor + four ownership guards: 24 files, 122 passed,
5 skipped. Both perturbations failed on their intended regression tests and
were restored. Changes remain uncommitted. Next: use the same composed objective
for deterministic single-action selection and intention reporting, then migrate
field utility and equip/take proposals. This is not full-program completion.

LATEST September 14: unified registry observations now reach the real Actor.
Core projects detached movement/sight grids and active fields, reusing existing
radius, light/dark, and occlusion rules. Runtime reads live state each tick and
uses target coordinates for reserved moves. The two production Actor tests now
use Configurator-authored unified artifacts and pass. Actor: 20 files, 108 passed,
5 skipped. Core + runtime + boundary gates: 46 files, 646 passed, 1 skipped.
Typecheck passes. These changes remain uncommitted alongside the earlier Actor
diff. Next: finish capability eligibility, deterministic motivation union ranking,
active-pair field utility, equip/take candidates, then legacy engine removal.
The older failure counts below are historical.

September 14 update: the uncommitted Actor cutover now also fixes unlimited cast
reach in intent scoring and prohibits targeted casts from emit/draw equipment.
Both proposal and scoring paths consult the active pair; scoring receives the
live actor record. Solver combat fixtures now use owned fire/push, and exit
fixtures use explicit canExit. Actor eligibility rejects missing/terminal actors;
terminal actors emit no solver requests. Full Actor validation is now down to two
legacy production-artifact failures (actor-decision-inputs and
actor-proposes-or-nothing-does). Keep those tests for the observation cutover.
Do not declare the current milestone complete or commit the production diff yet:
README migration, remaining capability enforcement, field evaluation, motivation
ranking, equipment/take proposals, and runtime observation integration remain.
The cast-range perturbation failed as required and was restored. Typecheck passes.

**CURRENT CUTOVER: Actor proposals and observations are in progress.** The branch was
rebased onto main at portal merge `7a8888f4`; unified artifact production is
checkpointed at `d71af7e8`, runtime startup at `e3e53dc3`, and unified action
execution at `4d0dd0dc`. Runtime loads one detached actor registry and routes the
five public actions through one ActorTurn. The current Actor alignment and action
shape migration is uncommitted; preserve it and do not reset it.
Existing artifact builders now emit normalized state; core-setup loads one registry
and no longer exports category placement functions. Director actor requests now carry common properties and full motivations.
Generated layouts and actor placement now use canonical terrain.
Object placement, feasibility and previews now read canonical terrain too.
Resource and hazard placement now returns common actor requests and the production
build merges them after reserving their coordinates. SimConfig no longer stores
hazard/resource collections. Upstream CLI/card defaults, remaining pricing,
runtime actions/observations, adapter and UI callers remain unmigrated. The full application is temporarily broken as approved
by the maintainer; narrow builder/loader tests and typecheck pass. Read the latest
Documentation.md/Plan.md cutover section before using older green evidence below.

Latest measured post-rebase baseline: Configurator is green (43 files, 200 passed,
one skipped); the focused unified action/startup/loader/integration/core domain is
19/19, dependency/ports guards are 5/5, and typecheck passes. During the Actor
cutover, the Actor suite measured 20 files, 90 passed, 11 failed, and 5 pending;
the remaining failures are legacy runtime artifact setup, solver fixtures that
still expect attack, one objective fixture without the new active pair, and two
exit/production characterization seams. The action-admission perturbation fails
as required and was restored. The core-behavior reachability guard remains
expected-red because 23 legacy setup exports and applyAttack are now unreachable;
remove those exports with their legacy core test consumers during the prescribed
export/test cutover.

Repository: `KomplexMojo/agent-kernel`. Continue the existing isolated worktree on
`codex/unified-actor`, preserving its local commits and any working changes. Do not reset to
main or the published handoff checkpoint: neither contains the current local work.
The original rewrite base was `9a9168f8c63b07b1e9e789daa598a6edaa061cbd`.

**Current local status (2026-09-10): UA.1–UA.3 complete; routing, exposure,
passive projection, inventory, claims, movement, focused casting, turn windows
and Configurator preset normalization implemented.**
The published de2a932 checkpoint still contains only UA.1/UA.2. Local commit
4736f9ab contains the subsequent mechanics/authoring work. The maintainer did not
move to cloud. Continue from the local branch tip, which also includes later
exit-dwell work; no push was requested this continuation.
Read Plan.md's next implementation seam and Documentation.md's latest evidence.
The maintainer authorized continuing across bounded milestones until completion
or token exhaustion, superseding the old one-milestone stopping limit.
The new registry is retained by runtime startup and available through the runtime
snapshot surface. Tick actions and field sequencing use ActorTurn. The Actor
persona now uses alignment for hostility, emits move targets and active-pair casts,
and no longer emits conventional attacks; runtime observations, effects, budget
accounting and world-state capture still use legacy paths. Passing startup
and component tests does not prove a whole game tick. Do not merge this partial
rewrite into main.

Read these real, tracked files in order:
1. `Prompt.md` — approved mechanics, including the full affinity matrix.
2. `Plan.md` — milestone order, exact completed scope, next handoff and oracles.
3. `Implement.md` — validation commands and local execution caveats.
4. `Documentation.md` — evidence and limitations.

These files in this directory replace the Mac-only vault/local-codex documents
for this program. Do not depend on `/Users/...`, `~/vault`, symlinks, local MCP
registrations, or access to the original conversation. Keep these tracked files
updated with cloud progress. The portability is intentional and maintainer-authorized.

## Cloud environment

Run from the repository root. Configure Node >=22.18 and pnpm. The existing
`.cursor/install.sh` can be used as the cloud setup script (`bash .cursor/install.sh`);
it provisions dependencies and attempts optional Serena setup. Alternatively use
a suitable Node runtime plus `pnpm install --frozen-lockfile`.

Set `LLM_INTERNAL_HOST=192.0.2.10` in cloud environment settings. This documentation
address satisfies existing hardware dry-run tests; it is not a real remote host
and must never be used to run a remote benchmark. No live LLM or GPU is required
for the core milestone tests. Do not copy developer credentials or host files.

After reading AGENTS.md and CLAUDE.md, run the session-start protocol preserving
the selected commit (`bash scripts/setup/session-refresh.sh --no-pull`). Read this
directory's Plan.md in place of the vault plan. Tooling unavailable in cloud must
be reported accurately; use file inspection if Serena MCP is unavailable. Do not
block on creating an Obsidian vault. CodeContext can be regenerated locally in
the cloud checkout by the existing script.

## Resume locally

Continue in the existing codex/unified-actor worktree from its local branch tip.
Do not reset to the old published checkpoint or start again from main. The immediate
seam is finishing Actor proposal and observation migration: update solver/objective
fixtures to the alignment and active-pair contracts, then move runtime observation
off legacy world state. After that continue core export/test removal, Moderator/effects,
adapters, and UI migration. Read the exact continuation notes in Plan.md. Primitive
slot/claim/move APIs are wrapped by the tested turn window, and production runtime
action execution has adopted it; budget/effects and full observation have not.
Do not run remote benchmarks or merge this incomplete rewrite into main.

## September 13 continuation update — Actor proposal cutover in progress

The committed runtime checkpoint is `4d0dd0dc`. The current local diff updates
Actor to use alignment rather than presentation role for hostility, capability
checks rather than category dispatch for movement/exit/casting, move `{target}`
parameters, active-pair `cast_affinity` parameters containing only `targetId`,
and no conventional attack proposals. Obsolete role/attack behavior fixtures were
removed or replaced with unified-action coverage. The Actor suite currently reports
20 files: 90 passed, 11 failed, 5 pending. The remaining failures must be migrated
before this persona milestone is committed; they are not evidence to widen a test
baseline. Typecheck and the focused runtime/architecture gates were green before
this local Actor diff. Re-run the Actor skill gates after completing fixture
migration, then commit the persona milestone and proceed to unified observations.

## Published checkpoint baseline (historical)

Pre-publication full suite: 489 files passed, 3787 tests passed, 242 skipped,
zero failures with the documentation host variable above. Typecheck passed.
A missed source-path parity test from UA.2 was corrected without weakening its
assertions. The suite includes all 32 architecture files. Details and earlier
red/green/perturbation evidence are in Documentation.md.

## Last green pre-cutover verification — September 10

Full suite: 502 files passed, 3914 tests passed, 242 skipped, zero failures.
Typecheck passed. Separate architecture suite: 32 files and 118 assertions passed.
Separate core suite: 34 files, 612 passed, 1 skipped.
Latest additions: authored turn-cost assembly, file-backed invalid actor artifacts,
Configurator-to-core component acceptance/replay, and Allocator equip/take schedule.
The named attack charge is removed; legacy attack execution remains pending.
Capability-driven exit dwell and once-only exit phase now pass their six tests.
Whole-roster Configurator normalization and the component scenarios using it also
pass. Production artifact producers remain pending; see the Director producer
inspection notes at the end of Plan.md.
All perturbations restored; no guard baseline widened. These results cover the
local implementation, not the older published checkpoint. The production
engine migration remains incomplete; use Plan.md's updated continuation seam.

## Review requirement before PR
All Luna-produced implementation milestones must be checked by a more capable
model before opening or updating the PR. The reviewer must inspect the complete
diff, verify the locked mechanics and dependency/persona boundaries, rerun or
inspect the relevant gates, and record any required fixes. Do not treat Luna's
narrow green tests as sufficient approval for publication.

## Current continuation seam — September 16

Shared runtime-decision reader is complete. Hazard regen/one-time vitals and CLI
string affinity convert at mapHazards. V3 resource grants become holdings at
mapResources. Movement stamina for production create is assembled from the
placed roster. Locked SimConfig layout drops `budgetScaffold`. Unified runtime
observations no longer keep a hazards collection. Continue with V1 resource
shapes and leftover core category APIs. The architecture
reachability guard remains failing; do not widen its baseline. Do not claim
completion while category-specific producer paths and broader adapter/UI
surfaces remain.
