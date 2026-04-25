# CodeContext Snapshot
Generated: 2026-04-22T00:00:00.000Z

## Repository Stats
- Files: 789
- Functions: 4,980
- Classes: 11
- Modules: 221

## Package Dependency Map
Derived from CLAUDE.md architecture charter (module_deps MCP queries returned empty — graph re-index needed):

```
adapters-cli / adapters-web / adapters-test / ui-web
      ↓
   runtime          ← personas: orchestrator, director, configurator, actor, allocator, annotator, moderator
      ↓
 bindings-ts        ← WASM boundary only
      ↓
  core-as           ← AssemblyScript WASM, pure logic, no IO
```

### Key files in scope for this plan

**Contracts (artifacts / schemas):**
- `packages/runtime/src/contracts/artifacts.ts` — all versioned artifact schemas (PriceList:474, BudgetReceipt:605, SpendProposal:694, Hazard:~1696, Resource:~1739, AgentCommandObjectKind:~101)
- `packages/runtime/src/contracts/build-spec.js` — BuildSpec validation, budget section

**Allocator persona (spend validation):**
- `packages/runtime/src/personas/allocator/validate-spend.js:37` — `validateSpendProposal` (primary spend logic)
- `packages/runtime/src/personas/allocator/schema/price-list.example.json` — canonical price list example

**Configurator persona (spend building):**
- `packages/runtime/src/personas/configurator/spend-proposal.js:152` — `buildSpendProposal` (layout+actors+traps only; missing hazards/resources)
- `packages/runtime/src/personas/configurator/spend-proposal.js:165` — `evaluateConfiguratorSpend`

**Director persona (budget allocation):**
- `packages/runtime/src/personas/director/budget-allocation.js:148` — `buildBudgetAllocation`

**Orchestrator persona (budget inputs):**
- `packages/runtime/src/personas/orchestrator/budget-inputs.js:23` — `isPriceListArtifact`, `normalizePriceListInput`

**Build pipeline:**
- `packages/runtime/src/build/orchestrate-build.js:1294` — `budgetReceipt`/`spendProposal` only built when `budget`+`priceList` both present
- `packages/runtime/src/commands/kernel.js:1162` — `priceList = null` default

**CLI adapter:**
- `packages/adapters-cli/src/cli/ak-impl.mjs:3314` — `buildDryRunBudgetEstimate` (surface area)
- `packages/adapters-cli/src/cli/ak-impl.mjs:3750` — build output writing (no cost enrichment)

**Price list fixtures (current state — incomplete):**
- `tests/fixtures/artifacts/price-list-artifact-v1-basic.json` — only `vital_health_point`, `vital_mana_point`
- `tests/fixtures/artifacts/price-list-artifact-v1-tiles.json` — only `tile_floor`, `tile_hallway`
- `packages/runtime/src/personas/allocator/schema/price-list.example.json` — has motivations, `health_point`, `health_regen_per_tick`, `actor_spawn`, `move_action`, `attack_action`; missing: affinities with quadratic formula, stamina, durability, mana regen, hazards, resources, traps, rooms

**Known field naming inconsistency:** example.json uses `key`/`unitCost`/`unit`; fixtures use `id`/`kind`/`costTokens`. Must be normalized.

**UI:**
- `packages/ui-web/src/budget-panels.js:37` — `resolveBudgetTriplet` reads `price-list.json` by path pattern

## Complexity Hotspots (Top 10)
| Function | File | Complexity |
|---|---|---|
| applyAction | core-as/assembly/index.ts | 41 |
| applyMove | core-as/assembly/rules/move.ts | 28 |
| validateActorPlacement | core-as/assembly/state/world.ts | 23 |
| validateDirection | core-as/assembly/rules/move.ts | 22 |
| resolveTrapTargetVital | core-as/assembly/rules/move.ts | 21 |
| applyResourceCaptureAt | core-as/assembly/rules/move.ts | 18 |
| validateActorCapabilities | core-as/assembly/state/world.ts | 15 |
| applyActorPlacements | core-as/assembly/state/world.ts | 15 |
| setRowFromString | core-as/assembly/state/world.ts | 15 |
| dispatchNonMoveAction | core-as/assembly/index.ts | 15 |

Note: All top-10 hotspots are in `core-as` (WASM layer) — not directly touched by this plan. The highest-risk runtime files are `orchestrate-build.js`, `kernel.js`, and `artifacts.ts`.
