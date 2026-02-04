# LLM Interaction Enhancements (Budget Maximization Loop)

Goal: make the LLM iteratively spend the full budget by proposing layout (or rooms) first, then actors/configuration with remaining tokens until the budget is exhausted or no valid spend remains. The Director orchestrates the loop, the Allocator computes remaining budget, and the Configurator validates feasibility.

Constraints:
- Ports & Adapters only; no IO in runtime/core-as.
- Deterministic prompts and captures; all LLM interactions are captured as `CapturedInputArtifact`.
- Keep diffs small and reviewable.
- Requirements -> tests -> code in the same change set where feasible.

## 0) Prompt contract + session phases
1. [complete] Define a multi-phase LLM prompt contract (layout/rooms first, actors/config next).
   - Requirement: LLM can return a layout-only (tiles) or room-only proposal, then a follow-up actors/config proposal based on remaining budget.
   - Behavior details:
     - Add `phase` ("rooms_only" | "layout_only" | "actors_only") as an optional response field.
     - Add `remainingBudgetTokens` as an optional response field.
     - Add `stop` (or `stopReason`) with allowed values `done`, `missing`, `no_viable_spend`.
     - Phase-specific response shape:
       - layout_only: returns `layout` tile counts (rooms/actors omitted).
       - rooms_only: returns `rooms` array (actors optional/omitted).
       - actors_only: returns `actors` array (rooms optional/omitted).
   - Prompt contract work:
     - Provide a phase-aware prompt builder that injects: phase, remaining budget, allowed profiles, stop conditions.
     - Preserve existing single-pass prompt output for compatibility.
   - Session work:
     - Update `runLlmSession` to accept `phase` and `phaseContext` (prior phase summary), and to embed phase metadata into captures.
   - Tests:
     - Fixture prompts/responses for each phase.
     - Unit tests for normalization (phase fields, stop reasons, remaining budget).
     - LLM session test that `phase` metadata is captured and parsing is phase-aware.

## 1) Director-driven budget loop
1. [complete] Add a Director loop that sequences LLM phases until budget is spent or capped.
   - Requirement: The Director requests layout, computes remaining budget, then requests actors/config until budget is exhausted or LLM signals stop.
   - Behavior details:
     - Phase order: layout_only first, then one or more actors_only rounds (bounded).
     - Stop conditions:
       - remainingBudgetTokens <= 0,
       - remainingBudgetTokens < cheapest possible spend,
       - LLM stop reason (`done`, `missing`, `no_viable_spend`).
   - Work:
     - Implement a loop controller that:
       - Starts with layout proposal,
       - Calls Allocator helper to compute spend/remaining,
       - Requests actors/config with `remainingBudgetTokens`,
       - Trims over-budget picks deterministically,
       - Emits a deterministic trace (phase order, remaining budget, trims).
   - Data shape:
     - Loop result should include: combined summary, approved selections, remaining budget, trace, and captures.
   - Tests:
     - Deterministic loop test with fixture LLM responses showing budget decrement and stop conditions.
     - Loop test that produces multiple `CapturedInputArtifact` entries in order.

## 2) Allocator budget feedback API
1. [complete] Add allocator helpers to compute spend and remaining budget for proposals.
   - Requirement: Return approved counts, rejected counts, and remaining budget for each phase.
   - Behavior details:
     - Compute per-selection cost from applied catalog entry (or price list override).
     - Approve up to remaining budget, trim excess deterministically.
     - Return warnings for missing/invalid costs or trimmed counts.
   - Work: Add a helper that accepts `selections`, `priceList`, and `budgetTokens`, returning:
     - `spentTokens`, `remainingBudgetTokens`,
     - `approvedSelections`, `rejectedSelections`,
     - `warnings` describing trims.
   - Tests:
     - Unit tests covering room costs, actor costs, and trimming when over budget.

## 3) Configurator validation feedback
1. [complete] Validate room and actor proposals for feasibility before spending.
   - Requirement: Provide structured validation errors to the Director to inform LLM repairs.
   - Behavior details:
     - Validate that picks map to catalog entries.
     - Validate minimum counts per phase (rooms_only requires >= 1 room; actors_only requires >= 1 actor).
     - Reserve advanced layout/actor placement checks for Configurator-level validation hooks.
   - Work:
     - Add a proposal validation path that emits structured errors for missing catalog matches.
     - Surface validation errors in repair prompts as deterministic hints.
   - Tests:
     - Fixture proposals that trigger validation errors and confirm repair prompts are generated.

## 4) BuildSpec assembly from loop output
1. [complete] Assemble BuildSpec using final loop selections.
   - Requirement: BuildSpec uses approved room selections, approved actors/config, and budget receipts.
   - Work:
     - Update the Director buildspec assembler to accept loop output (approved selections + combined summary).
     - Preserve existing single-pass summary path.
   - Tests:
     - End-to-end build test verifies artifacts and budget receipts.

## 5) CLI integration + fixtures
1. [complete] Add a CLI flag to enable the budget loop.
   - Requirement: `llm-plan` can run in single-pass or budget-loop mode.
   - Work:
     - Add `--budget-loop` and `AK_LLM_BUDGET_LOOP=1`.
     - Implement multi-response LLM fixtures for loop mode.
     - Keep single-pass behavior unchanged by default.
   - Tests:
     - CLI fixture test asserts multiple captures and deterministic bundle/manifest output.

## 6) Capture + telemetry
1. [complete] Capture each LLM phase and expose it in build outputs.
   - Requirement: Each LLM phase produces a `CapturedInputArtifact` with prompt/response/errors.
   - Work:
     - Ensure capture IDs are phase-indexed to avoid collisions.
     - Include all phase captures in bundle/manifest with deterministic ordering.
     - Add telemetry entries for phase timing and budget deltas.
   - Tests:
     - Verify multiple captures are present in `bundle.json` and `manifest.json`.

## 7) Documentation
1. [complete] Document the budget loop behavior and prompts.
   - Requirement: CLI docs explain the loop, flags, and stop conditions.
   - Work:
     - Update `packages/adapters-cli/README.md` and `docs/README.md` with examples.
     - Note deterministic capture ordering and stop reasons.
   - Tests: N/A (documentation only).

## 8) Layout vs actor requirements mismatch (tiles-based layout budget)
1. [complete] Replace room affinity picks with tile-based layout planning.
   - Requirement: Rooms do **not** have affinities or motivations. Layout is defined by tile counts (walls, floors, hallways).
   - Requirement: Each layout tile has a cost; layout spend must be bounded by budget.
   - Requirement: Unspent layout budget rolls into actor budget.
   - Requirement: Actors can be ambulatory or stationary (stationary == trap-like).
2. [complete] Define a layout spend contract for LLM planning.
   - Work: Add a layout response shape that includes tile counts (e.g., `layout: { floorTiles, wallTiles, hallwayTiles }`).
   - Work: Add layout price list mapping (`tile_wall`, `tile_floor`, `tile_hallway`).
   - Work: Update prompt contract to remove room affinities/motivations and request tile counts.
3. [complete] Update the budget loop to allocate layout-first then actors.
   - Work: Phase 1 requests layout tile counts and computes layout spend.
   - Work: Phase 2 requests actor counts/types with remaining budget.
   - Work: Stop when remaining budget < cheapest actor or LLM signals `no_viable_spend`.
4. [complete] Add allocator helper for tile-based spend.
   - Work: Compute layout spend from tile counts + price list, return remaining budget.
   - Work: Emit warnings when layout exceeds budget (trim or repair).
5. [complete] Update Configurator feasibility validation for tile layouts.
   - Work: Validate tile counts produce a feasible grid (min size, connectivity).
   - Work: Ensure actor placement respects walkable tiles after layout generation.
6. [complete] Update tests + fixtures.
   - Work: New fixtures for layout-only responses and layout+actors loop.
   - Work: CLI + runtime tests for layout spend, remaining budget, and captures.
7. [complete] Update documentation.
   - Work: Document layout tile budgeting, actor types, and budget rollover rules.

## 9) Budget pool allocation (player/layout/defenders/loot)
1. [complete] Add pool-based budget allocation with user-configurable weights.
   - Requirement: Split total budget into pools for player actor configuration, level build (layout), defending actor counts/config, and optional loot/drops.
   - Requirement: Allow users to override pool weights from the CLI (deterministic, validated, and captured).
   - Behavior details:
     - Default weights (e.g., player=0.2, layout=0.4, defenders=0.4, loot=0.0) with deterministic rounding.
     - Loot pool is optional; when unset or zero, no loot budget is allocated.
     - Optional reserve tokens for player config (hard floor) before applying weights.
     - Unspent layout budget can roll into defenders (explicit rule in loop).
   - Work:
     - Extend Director budget allocation to accept custom pool weights (id + weight list) and return a `BudgetAllocationArtifact`.
     - Add CLI flags for pool weights (e.g., `--budget-pool player=0.2 --budget-pool layout=0.4 --budget-pool defenders=0.4 --budget-pool loot=0.0`)
       and validate sum > 0; normalize weights deterministically.
     - Thread allocation into the LLM budget loop:
       - Layout phase uses only the layout pool budget.
       - Defenders phase uses only the defenders pool budget (+ rollover from layout).
       - Player config is handled first (pre-costed or dedicated phase) and deducted from total budget.
       - Loot pool is reserved for future drops/loot generation; no spend until loot implementation lands.
     - Capture the allocation (weights + computed pool budgets) in telemetry/manifest for replay.
   - Tests:
     - Unit test for deterministic pool allocation with custom weights + reserve tokens.
     - CLI test that passes `--budget-pool` flags and asserts pool budgets are respected in the loop trace.
     - Budget loop test asserting rollover behavior from layout → defenders.




## ToDo (Reevaluate with core-as capability model)
- Revisit feasibility validation so actor counts and placement respect new stamina/movement constraints (e.g., only ambulatory actors consume walkable tiles; stationary/trap-like actors use static capability defaults).
- Recheck BuildSpec/actor generation paths to ensure capability defaults (movement/action costs, stamina/mana) align with core-as requirements for LLM-selected actors.
- Confirm budget-loop prompts/repair hints remain valid if capability-driven constraints or costs are added to the catalog/price list.
