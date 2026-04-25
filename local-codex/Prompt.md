# Prompt

## Problem
The repo computes some spend, but cost is not yet a first-class persisted contract across the build pipeline. Authoring with only `budgetTokens` does not reliably materialize cost artifacts, `spend-proposal.json` is still optional or intermediate-only, and current artifact schemas and build outputs do not consistently carry cost attribution, summaries, or pointers.

## Scope
- Add a single canonical cost artifact and a lightweight cost context on every artifact instead of duplicating full receipts everywhere.
- Add `ArtifactCostContextV1` and attach it as an optional field on `ArtifactMeta`.
- Expand `SpendProposalItemV1` into a real attribution record.
- Make build-like authoring synthesize a canonical budget context when a hard budget is present, even if the caller only supplied `budgetTokens`.
- Persist `spend-proposal.json` by default for build, create, and configure flows.
- Extend the spend and category model to cover `rooms`, `floor_tiles`, `traps`, `hazards`, `resources`, `delvers`, `wardens`, and `shared/system`.
- Attach cost context to emitted artifacts such as `spec`, `intent`, `plan`, `sim-config`, `initial-state`, `hazard-*`, `resource-*`, `bundle`, `manifest`, `telemetry`, and summary artifacts.
- Update `BudgetReceiptArtifact.scenarioSpendReport`.
- Update CLI and MCP summaries for `create`, `configure`, `show`, and `runs list` to surface cost paths and top-level totals consistently.
- Add schema tests and fixture coverage for the new cost metadata.

## Constraints
- Keep the shared cost context small: `selfTokens`, `runTotalTokens`, `budgetTokens`, `category`, `receiptRef`, `proposalRef`, and `lineItemIds`.
- Expand proposal items to include `category`, `unitCost`, `totalCost`, `status`, `artifactRef` or `subjectRef`, and optional `detail`.
- Use the default price list and rules so `create` and `configure` always produce a receipt and proposal when budget is part of the request.
- Update `BudgetReceiptArtifact.scenarioSpendReport` to the new category set and stop using proportional actor cost splits where exact attribution is possible.
- Version schema changes carefully.
- Backfill docs and README examples.
- Add a migration note for older artifacts that only have receipt or proposal sidecars and no `meta.cost`.

## Acceptance Criteria
1. A shared `ArtifactCostContextV1` exists and is attached to `ArtifactMeta` as an optional field.
2. `SpendProposalItemV1` includes the requested attribution fields.
3. Build-like authoring with a hard budget produces canonical budget context even when only `budgetTokens` is supplied.
4. `spend-proposal.json` is persisted by default for build, create, and configure flows.
5. The spend and category model explicitly covers all requested categories.
6. Emitted artifacts include cost context where requested, including sidecar artifacts and top-level summary artifacts.
7. `BudgetReceiptArtifact.scenarioSpendReport` reflects the updated category set.
8. CLI and MCP summaries expose cost paths and top-level totals consistently.
9. Schema tests and fixture coverage prove the new cost metadata is present.

## Out of Scope
- None stated.

## Open Questions
- None stated. All three open questions have been resolved by the user (see Constraints below).

## Resolved Questions (user answers, incorporated into Constraints)
1. **Default price list**: The canonical default price list is a versioned JSON artifact (`agent-kernel/PriceList`) that must include formulas for every item category. Base unit: 1 health point = 1 token. Regeneration (health regen, mana regen) and affinity stack costs scale quadratically with quantity (formula: `unitCost * n^2`). The artifact must cover all categories: vitals (health, mana, stamina, durability), regen rates, motivations, affinity slots, affinity stacks (quadratic), traps, hazards, resources, floor tiles, rooms (summarized from component costs), actors (delver/warden spawn). The current price-list fixtures are missing: affinity items with the quadratic formula field, stamina, durability, mana regen, hazard/resource/trap items, and room aggregate pricing. These must be added. Field naming must also be normalized to a single canonical shape (`id`, `kind`, `unitCost`, optional `formula`).
2. **Which artifacts carry `meta.cost`**: Every generated artifact must carry a token receipt. Complex/composite artifacts (rooms, bundles, manifests) carry a summary receipt derived from their component costs. Leaf artifacts (individual vitals, affinity stacks, traps, hazards, resources) carry their own direct receipts.
3. **Migration / restructuring scope**: This is a comprehensive code review and restructuring that must include the Allocator persona. The Allocator is the correct owner of all spend validation, price evaluation, and receipt issuance logic. Any spend logic currently scattered outside the Allocator must be moved into it as part of this work.
