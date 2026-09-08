# Unified Actor Rewrite — execution source
## START HERE
Branch codex/unified-actor in the current repository checkout, base 9a9168f8c63b07b1e9e789daa598a6edaa061cbd. Original worktree has unrelated uncommitted work. Do not stage, modify, or copy it.

Approved behavior is fully recorded in Prompt.md; no access to the original conversation is required. UA.1 declarations and UA.2 registry component are complete and verified; milestones 3–20 remain pending. The first bounded handoff is contract milestone UA.1. It changes declarations, not runtime execution. Do not report new mechanics as working until runtime oracles pass.

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

Each owner reads its skill before edits. One M or two S milestones per handoff. No generic ECS, new persona, unrelated cleanup, or legacy backend. Reuse spatial/balance helpers except explicitly replaced outcomes. Remaining runtime integration is expected after the declaration milestone; do not preserve deprecated declarations merely to disguise pending work.

## UA.1 exact scope — COMPLETE
Owner architecture-artifacts-contracts; supporting structured-test-authoring. Targets packages/runtime/src/contracts/artifacts.ts; tests/contracts/unified-actor-contract.test.js; tests/fixtures/contracts/unified-actor-contract.ts; packages/runtime/src/contracts/README.md; docs/readme-index.md. Add ActorRecord and its supporting shapes; use it for InitialStateArtifactV1.actors and WorldStateArtifactV2.actors. Presentation is an external ID map. Replace ActionV1 with a discriminated union of wait/move/cast_affinity/equip_affinity/take. Keep envelope selectors unchanged. Delete superseded world-state subtype declarations. Hazard/Resource authoring artifacts remain until producer migration; do not implement their compatibility handling.

Validation: new compiler-backed fixture test red before declarations, green after; contract suite + schema origin/catalog guards; pnpm run typecheck. Perturbation: permit attack in the action union and prove the negative fixture fails with an unused expected-error diagnostic, then restore. Stop after this bounded milestone and record remaining migration explicitly.

## Acceptance oracles for later milestones
Fire/earth 5 vs durability 3, health 10 => 0/8. Water/decay => 3/5. Corrode => 0/10. Life drain kills through durability and transfers actual removal. Defeat is terminal. Equip preserves mana and allows no second action. Finite field absorption. Stack-8 source grants one stack per pair once. Mobile resource/motivated barrier use common rules. Label-only changes do not affect behavior/price. Equal alignment allies regardless of preset. Composed motivation/equipment choices deterministic with no tie-switch churn. CLI/MCP/UI normalization equivalent. Core snapshots and tick frames replay identically.

## Next handoff
Implement milestone 3: common vitals and terminal defeat in the registry component, under architecture-dependency-direction. Read Prompt.md, the shared actor-types.ts, actor-registry.ts and the contract README first. Keep registry snapshot alias protection and deterministic identity/occupancy intact. Add failing tests for missing/invalid defeat vital, negative/nonfinite/out-of-range vitals, health defeat with positive durability, durability depletion without health-governed defeat, immediate terminal defeat, and no regeneration or blocking after defeat. No gameplay labels in core, runtime imports, conventional attack path, or compatibility engine. Action resolution, full field mechanics and createCore/runner replacement remain later milestones; do not claim registry tests demonstrate runtime adoption.

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
