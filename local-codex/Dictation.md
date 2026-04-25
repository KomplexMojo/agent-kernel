Short version: the missing piece is not just "more fields on artifacts." The repo currently computes some spend, but cost is not a first-class persisted contract across the build pipeline. To make every generated artifact cost-aware, I'd recommend a single canonical cost artifact plus a lightweight cost context on every artifact, instead of duplicating full receipts everywhere.

**What's Missing**
- Authoring with only `budgetTokens` does not reliably materialize cost artifacts. In orchestrate-build.js, `budgetReceipt` and `spendProposal` are only built when a mapped `budget` and `priceList` exist.
- The runtime already knows how to persist cost artifacts, but `spend-proposal.json` is still optional/intermediate-only. See kernel.js.
- `SpendProposal` is too thin to support attribution. In artifacts.ts, proposal items only carry `id`, `kind`, and `quantity`, not category, unit cost, total cost, or artifact linkage.
- `BudgetReceiptArtifact` has an outdated scenario summary. In artifacts.ts, `scenarioSpendReport` only covers `rooms`, `delvers`, and `wardens`, not `floor tiles`, `traps`, `hazards`, or `resources`.
- Artifact schemas for hazards/resources carry configuration but no cost context. See artifacts.ts (HazardArtifact ~line 1696 and ResourceArtifact ~line 1739).
- The current spend ledger focuses on layout and actors; hazards/resources are not surfaced as first-class spend categories in the persisted build output. See spend-proposal.js.
- Build outputs are written without enriching `spec`, `manifest`, `bundle`, `sim-config`, `initial-state`, or `telemetry` with cost pointers/summaries. See ak-impl.mjs.
- Secondary contract drift: the authoring object-kind union still omits `resource`, which will make clean cost attribution harder if you key by authored object kind. See artifacts.ts (~line 101).

**Recommended Code Changes**
- Add a shared `ArtifactCostContextV1` and attach it to `ArtifactMeta` as an optional field. Keep it small:
  `selfTokens`, `runTotalTokens`, `budgetTokens`, `category`, `receiptRef`, `proposalRef`, `lineItemIds`.
- Expand `SpendProposalItemV1` into a real attribution record:
  `category`, `unitCost`, `totalCost`, `status`, `artifactRef` or `subjectRef`, and optional `detail`.
- Always synthesize a canonical budget context for build-like authoring when a hard budget is present, even if the caller only supplied `budgetTokens`.
  Use the default price list/rules so `create`/`configure` always produce a receipt/proposal when budget is part of the request.
- Promote `spend-proposal.json` to persisted-by-default for build/create/configure flows, not just an intermediate.
- Extend the spend/category model so it explicitly covers:
  `rooms`, `floor_tiles`, `traps`, `hazards`, `resources`, `delvers`, `wardens`, and `shared/system`.
- Attach cost context to every emitted artifact:
  `spec`, `intent`, `plan`, `sim-config`, `initial-state`, `hazard-*`, `resource-*`, `bundle`, `manifest`, `telemetry`, and any summary artifacts.
- Update `BudgetReceiptArtifact.scenarioSpendReport` to the new category set and stop using proportional actor cost splits where exact attribution is possible.
- Update CLI/MCP summaries (`create`, `configure`, `show`, `runs list`) to surface cost paths and top-level totals consistently.

**Rough Plan**
- Wave 1: Contract Foundation
  Tasks: define `ArtifactCostContextV1`; expand `SpendProposal`; update `BudgetReceiptArtifact` category model; fix `AgentCommandObjectKind` drift for `resource`; add schema tests.
- Wave 2: Cost Materialization
  Tasks: synthesize default budget/price-list context for authoring with hard budgets; ensure `orchestrateBuild` always produces `budgetReceipt` + `spendProposal` when budgeted; persist both by default.
- Wave 3: Attribution Coverage
  Tasks: extend spend calculation to hazards/resources/floor tiles/traps; add exact line-item attribution IDs/refs; remove proportional fallback where deterministic attribution is available.
- Wave 4: Artifact Enrichment
  Tasks: write `meta.cost` onto every generated artifact; add `costRef`/`lineItemIds` to per-element sidecars like `hazard-*.json` and `resource-*.json`; include top-level cost summary in `manifest.json`, `bundle.json`, and `telemetry.json`.
- Wave 5: Surface Area
  Tasks: update CLI structured output and MCP responses to expose cost summaries; update `ak_show`/`runs list` to aggregate new categories; add fixture coverage proving every emitted artifact includes cost-related metadata.
- Wave 6: Migration and Docs
  Tasks: version schema changes carefully; backfill docs/README examples; add a migration note for older artifacts that only have receipt/proposal sidecars and no `meta.cost`.

My recommendation is to make one canonical cost artifact plus per-artifact pointers/summaries the core design. That gives you universal coverage without bloating every artifact with duplicate line items.
