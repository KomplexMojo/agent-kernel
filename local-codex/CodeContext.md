# CodeContext Snapshot
Generated: 2026-04-18T00:00:00Z

## Repository Stats
- Files: 768 | Functions: 4,795 | Classes: 11 | Modules: 213
- Monorepo root: /Users/darren/Documents/GitHub/agent-kernel
- Package manager: pnpm

## Package Map
```
adapters-cli / adapters-web / adapters-test / ui-web
      ↓
   runtime          ← personas, contracts, port effects
      ↓
 bindings-ts        ← WASM boundary
      ↓
  core-as           ← AssemblyScript WASM, pure logic
```

Key packages for this task:
| Package | Key files |
|---|---|
| `packages/runtime/src/contracts/` | `artifacts.ts`, `domain-constants.js`, `build-spec.js`, `schema-catalog.js` |
| `packages/adapters-cli/src/cli/` | `ak.mjs` (CLI entry), `ak-impl.mjs` (command implementations) |
| `packages/ui-web/` | card builder UI components |
| `packages/core-as/assembly/` | `index.ts` (WASM export), `state/world.ts`, `rules/move.ts` |

## Graphify Community Map (relevant communities)
From graphify-out/GRAPH_REPORT.md (163 communities):
- **Actor Generator** — actor config generation logic
- **Affinity Systems** — dominant cluster (10+ sub-communities); affinity kinds, expressions, targets, stacks
- **Architecture Contracts** — artifact schemas and versioned boundaries
- **Card Room** — room card configuration surface
- **Build Spec UI** — UI card builder
- **Budget Policies / Spend Policies** — token cost computation
- **Feasibility Configurator** — config validation
- **Pool Catalog** — resource/item pools

## Actor Type Taxonomy (current codebase)

### Actor kind values (from artifacts.ts line 105-107)
```typescript
type ActorKind = "hazard" | "delver" | "warden"
```
**Critical gap:** `room tile` and `resource` are NOT in the current ActorKind union. Rooms/tiles
are treated as layout geometry (floorTiles, hallwayTiles), not as actors. Resources exist as
a price catalog concept, not as a configured actor type.

### Vital keys (from domain-constants.js line 111-112)
```js
VITAL_KEYS      = ["health", "mana", "stamina", "durability"]  // full actor vitals
TRAP_VITAL_KEYS = ["mana", "durability"]                        // restricted set for traps/hazards
```
Note: the codebase uses "trap" as a synonym for "hazard" in many places.

### Affinity system (from domain-constants.js)
```js
AFFINITY_KINDS       = ["fire","water","earth","wind","life","decay","corrode","fortify","light","dark"]
AFFINITY_EXPRESSIONS = ["push","pull","emit","draw"]
AFFINITY_TARGET_TYPES = ["self","ally","enemy","area","barrier","floor"]
```
Affinity expressions have profiles: push (burst), pull (control), emit (presence), draw (sustain).
`DEFAULT_ROOM_CARD_AFFINITY = "dark"`, `DEFAULT_ROOM_AFFINITY_EXPRESSION = "emit"`.

Room tiles already carry an affinity (emit/dark by default) — this is the existing room-level
affinity concept. What is NOT established: room tiles as first-class actor configs with the full
actor base.

### Tile cost model (from domain-constants.js line 88-96)
```js
LAYOUT_TILE_FIELDS      = ["floorTiles", "hallwayTiles"]
DEFAULT_LAYOUT_TILE_COSTS = { floorTiles: 1, hallwayTiles: 1 }
LAYOUT_TILE_PRICE_IDS   = { floorTiles: {id:"tile_floor", kind:"tile"}, hallwayTiles: {id:"tile_hallway", kind:"tile"} }
```
Tile costs are currently computed from layout geometry counts only — not from per-tile actor
configuration. This will need to extend to include per-tile affinity/motivation/durability costs.

### Artifact schemas relevant to this task (from artifacts.ts)
- `BuildSpecActorHintV1` (line 294) — actor hints in a build spec
- `BuildSpecActorGroupHintV1` (line 303) — actor group hints
- `ActorLoadoutArtifactV1` (line 981) — actor affinities at runtime
- `ActorLoadoutAffinityV1` (line 952) — per-actor affinity record; sourceType: "actor"|"trap"|"static_trap"
- `ActorStateV1` (line 1051) — runtime actor state (id, position, vitals)
- `HazardProposalArtifact` (line 482) — hazard seeding by Director; carries affinity + budget ceiling
- Resource artifact (line 1629+) — `ResourceArtifact` with vital grants and tier

### CLI commands relevant to this task
- `packages/adapters-cli/src/cli/ak-impl.mjs` — contains `delverPlanCommand` (line 3205)
  Uses `applyBudgetCappedFulfillment` for delver config with budget enforcement.
- Budget enforcement happens at the Allocator persona level, not ad-hoc in CLI commands.

## Complexity Hotspots (Top 5 unique files)
| Function | File | Complexity |
|---|---|---|
| `applyAction` | `core-as/assembly/index.ts:140` | 41 |
| `applyMove` | `core-as/assembly/rules/move.ts:126` | 28 |
| `validateActorPlacement` | `core-as/assembly/state/world.ts:618` | 23 |
| `resolveTrapTargetVital` | `core-as/assembly/rules/move.ts:30` | 21 |
| `validateActorCapabilities` | `core-as/assembly/state/world.ts:1084` | 15 |

## Key Assumptions for Codex Planning

1. **Room tiles are not yet actors.** The codebase treats tiles as layout geometry. Making them
   first-class actors with the actor base is new work.

2. **Resources are not yet actors.** Resources exist in the price catalog and as artifact schemas
   for vital grants, but are not configured as actor types via the CLI or card builder.

3. **"Hazard" = "trap" in the codebase.** The user calls them hazards; the code calls them traps.
   `TRAP_VITAL_KEYS` already encodes the correct restriction (mana + durability). The plan should
   clarify whether "hazard" replaces or extends the "trap" terminology.
   NOTE: User spec says hazards have mana + mana regen ONLY (not durability). TRAP_VITAL_KEYS
   currently includes durability — this may need correction.

4. **The card builder UI** community exists ("Build Spec UI", "Card Room") but the extent to
   which it is one unified component vs. type-specific screens is unknown — Codex should audit
   `packages/ui-web/` before assuming.

5. **CLI is the enforcement layer.** Budget enforcement already flows through `applyBudgetCappedFulfillment`
   + Allocator persona. Per-type config constraints (e.g. hazard affinity count = 1) may or may
   not be enforced at the CLI level today — Codex should verify in `ak-impl.mjs`.
