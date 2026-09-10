# Historical milestone evidence

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
