# Integrating Allocator: Prices and Budgets

## Goal
Introduce a deterministic budget + price list framework so the Orchestrator can pass budget constraints through Director/Configurator, and the Allocator can approve spend and emit receipts (token-based costs).

## Intent
- Establish Budget/PriceList/Receipt artifacts for token-based costs.
- Keep allocator enforcement deterministic and fixture-driven.
- Enable Orchestrator -> Director -> Configurator -> Allocator flow without touching core-as IO.

## Initial Notes
- Token budgets are abstract units for now; future ERC20 linkage remains a boundary concern (adapters/ports).
- Start with config-time costs (layout, traps, actors) before runtime action costs.

## Implementation Steps
1. [complete] Define Budget, PriceList, and BudgetReceipt artifacts in runtime contracts.
   - Requirement: Add runtime contracts for token-based budgets, price lists, and allocator receipts.
   - Behavior details: Introduce `BudgetArtifact` (tokens total, ownerRef, constraints), `PriceListArtifact` (line items keyed by kind/id with token costs), and `BudgetReceiptArtifact` (approved/denied status, totalCost, remaining, line items). Keep schemas aligned with existing artifact naming/versioning and contracts registry.
   - Data shape proposal: `BudgetArtifact` `{ schema, schemaVersion, meta?, budget: { tokens, ownerRef?, notes? } }`; `PriceListArtifact` `{ schema, schemaVersion, meta?, items: [{ id, kind, costTokens, notes? }] }`; `BudgetReceiptArtifact` `{ schema, schemaVersion, meta?, budgetRef, priceListRef, proposalRef?, status: "approved"|"denied"|"partial", totalCost, remaining, lineItems: [{ id, kind, quantity, unitCost, totalCost, status }] }`.
   - Defaults (if relevant): Tokens as integers; status default `approved`; remaining defaults to `budget.tokens - totalCost` when approved.
   - Tests: Add contract validation tests for the new artifacts (accept valid shapes, reject missing costs/status).
   - Determinism: Stable ordering of lineItems/items; no timestamps; ids/version strings fixed.
   - Notes: Keep artifact names consistent with `packages/runtime/src/contracts/artifacts.ts`; no core-as IO.
2. [complete] Add fixture artifacts for budgets, price lists, and receipts (including negative cases).
   - Requirement: Provide deterministic fixtures for budgets, price lists, and receipts (happy + invalid).
   - Behavior details: Add valid fixtures under `tests/fixtures/artifacts/` for budget, price list, and receipt; add invalid fixtures under `tests/fixtures/artifacts/invalid/` (missing costs, over-budget receipt, unknown item).
   - Data shape proposal: `budget-artifact-v1-basic.json`, `price-list-artifact-v1-basic.json`, `budget-receipt-artifact-v1-basic.json`, plus invalid variants.
   - Defaults (if relevant): Token values as small integers; stable ids/kinds reused across fixtures.
   - Tests: Extend artifact validation tests to load these fixtures and assert pass/fail per placement.
   - Determinism: Fixture ordering stable; no meta timestamps.
   - Notes: Reuse existing artifact naming conventions and schema fields.
3. [complete] Implement Allocator validation to approve/deny proposed spend against budget + price list.
   - Requirement: Add an allocator validation path that consumes a spend proposal + budget + price list and emits a BudgetReceipt.
   - Behavior details: For each proposal line item, look up cost in price list, multiply by quantity, sum total; if total <= budget.tokens, approve and compute remaining; otherwise return denied/partial receipt with clear line-item statuses. No side effects beyond receipt creation.
   - Data shape proposal: `SpendProposal` `{ items: [{ id, kind, quantity }] }`; Allocator returns `{ receipt, errors? }`.
   - Defaults (if relevant): Default quantity = 1 when omitted; unknown items -> error/deny.
   - Tests: Add allocator unit tests with fixture budgets/price lists/proposals covering approve, deny (over budget), partial/unknown item cases.
   - Determinism: Pure function; stable sort of line items and errors.
   - Notes: Keep in runtime (TypeScript) with no IO; align receipts with artifact schema.
4. [complete] Wire Configurator to emit spend proposals and consume receipts deterministically.
   - Requirement: Have Configurator build a spend proposal from the chosen layout/actors/traps and accept a receipt to proceed.
   - Behavior details: Derive proposal line items from config inputs (map size, trap count, actor count, affinity extras); feed to Allocator validator; persist receipt reference alongside generated artifacts; block/flag when denied.
   - Data shape proposal: Proposal/receipt refs stored in Configurator outputs (e.g., `meta.receiptRef`).
   - Defaults (if relevant): Treat missing price list as error; treat missing budget as deny.
   - Tests: Configurator unit/integration test using fixtures: proposal -> receipt approve; proposal over budget -> denied.
   - Determinism: Same config + price list + budget yields identical receipt; stable ordering of proposal items.
   - Notes: Keep proposal construction pure; no IO; reuse existing Configurator artifact outputs.
5. [complete] Add CLI/UI surfaces to inspect budgets, price lists, and receipts (read-only).
   - Requirement: Surface budgets/price lists/receipts in CLI and UI (Allocator/Configurator tabs) without changing behavior.
   - Behavior details: CLI: add flags to load/show budget/price list and print receipts; UI: add JSON output panels in Allocator/Configurator tabs for these artifacts; read-only, fixture-first.
   - Data shape proposal: Reuse artifact JSON; pretty-print in UI panels; CLI prints JSON to stdout or writes to file when requested.
   - Defaults (if relevant): Show “No JSON output yet.” when absent; defaults to fixture mode in UI.
   - Tests: Add CLI surface test to ensure flags load/display fixtures; UI test to assert placeholders/loaded JSON in Allocator/Configurator panels.
   - Determinism: Outputs mirror fixture content; no timestamps or random ids introduced.
   - Notes: Align CLI flags with existing patterns (`--budget`, `--price-list`, `--receipt-out`).
6. [complete] Add fixture-driven tests for allocator validation, receipt emission, and determinism.
   - Requirement: Cover allocator validation end-to-end with fixtures and assert deterministic receipts.
   - Behavior details: Tests feed budget + price list + proposal fixtures into the allocator; assert receipt totals/status; include negative/unknown item cases.
   - Data shape proposal: Use the fixtures from step 2 plus proposal fixtures under `tests/fixtures/allocator/`.
   - Defaults (if relevant): None beyond fixture values.
   - Tests: Add `tests/allocator/allocator-validation.test.js` (or similar) with approve/deny/unknown cases; ensure stable ordering of line items and remaining tokens.
   - Determinism: Assert exact JSON equality for receipts; no time-based fields.
   - Notes: Keep tests pure; no network/IO.
7. [complete] Update documentation for cost framework and allocator/ configurator responsibilities.
   - Requirement: Document the budget/price/receipt flow and persona responsibilities.
   - Behavior details: Update `docs/README.md` (or relevant persona docs) to describe the budget pipeline, artifacts, and which persona owns what; add a short example of proposal -> receipt; note token units and future ERC20 handoff via adapters.
   - Data shape proposal: N/A (docs).
   - Defaults (if relevant): Describe tokens as integer units; Runtime default tab remains unchanged.
   - Tests: No tests required.
   - Determinism: Copy only.
   - Notes: Keep docs aligned with artifact names and persona roles (Orchestrator/Director/Configurator/Allocator).

## UI + CLI Follow-ups
8. [complete] Wire Allocator/Configurator UI panels to live JSON outputs.
   - Requirement: Populate the new UI JSON panels with real budget/price list/receipt artifacts.
   - Behavior details: Feed budget/price list inputs into Configurator outputs; render receipts in Allocator tab; keep placeholder text when artifacts are missing.
   - Data shape proposal: Reuse `BudgetArtifact`, `PriceList`, `BudgetReceiptArtifact`, and `SpendProposal` JSON as-is.
   - Defaults (if relevant): Show "No JSON output yet." until artifacts are present.
   - Tests: UI tests to assert populated JSON content for fixtures.
   - Determinism: Render order and formatting stable (pretty-printed JSON).
   - Notes: Keep rendering read-only; no UI-triggered IO.
9. [complete] Add CLI budget pipeline flags to `configurator` (optional).
   - Requirement: Allow CLI configurator runs to accept budget/price list inputs and emit a receipt file.
   - Behavior details: Add `--budget` and `--price-list` to `configurator`; write `budget-receipt.json` (or `--receipt-out`) when provided; error when inputs are missing.
   - Data shape proposal: Reuse artifact JSON files from fixtures.
   - Defaults (if relevant): No receipt emitted unless budget + price list are provided.
   - Tests: CLI test that `configurator` emits a receipt for fixture inputs.
   - Determinism: Receipt identical for identical inputs.
   - Notes: Keep logic in runtime modules; no core-as IO.

## Vertical Integration Follow-ups
10. [complete] Orchestrator ingests budget + price list inputs and publishes them as runtime artifacts.
   - Requirement: Pull budget (ERC20-backed in future) and price list inputs into the runtime pipeline.
   - Behavior details: Orchestrator accepts external budget and price list data (adapter inputs) and emits `BudgetArtifact` + `PriceList` artifacts for downstream personas; fixture mode uses local JSON until adapter wiring is present.
   - Data shape proposal: Reuse `BudgetArtifact` and `PriceList` schemas; include `ownerRef` for budget provenance.
   - Defaults (if relevant): Fixture mode populates budget + price list when no adapter input is provided.
   - Tests: Add fixture-driven tests for Orchestrator budget ingestion (adapter-test or CLI fixture mode).
   - Determinism: Inputs are explicit artifacts; no time-based values in emitted artifacts beyond meta.
   - Notes: Keep external IO in adapters; Orchestrator remains an IO boundary.
11. [complete] Director allocates budgets across level design, actors, and policy reserves.
   - Requirement: Produce a deterministic allocation plan from the top-level budget and price list.
   - Behavior details: Director partitions the budget into pools (level layout, actor build, affinity/motivation reserves); emits an allocation artifact that Configurator and Actor personas can consume.
   - Data shape proposal: New `BudgetAllocationArtifact` `{ schema, schemaVersion, meta, budgetRef, priceListRef, pools: [{ id, tokens, notes? }], policy?: { reserveTokens, maxActorSpend? } }`.
   - Defaults (if relevant): Reserve tokens default to 0; pool ordering stable.
   - Tests: Add unit tests for allocation plan creation using fixture budgets.
   - Determinism: Allocation is a pure function of inputs and policy settings.
   - Notes: Keep the allocation artifact in runtime contracts; no IO in Director logic.
12. [complete] Configurator expands spend proposals using V/A/M atomic pricing.
   - Requirement: Build spend proposals that include vitals, regen, affinities, and motivations using atomic price list items.
   - Behavior details: Map layout + actor inputs to atomic line items (vital points, regen ticks, affinity stacks/expressions, motivation tiers); include counts in `SpendProposal.items`.
   - Data shape proposal: Reuse `SpendProposal` items with `{ id, kind, quantity }` aligned to price list ids.
   - Defaults (if relevant): Missing sections default to zero quantity; no implicit costs outside the price list.
   - Tests: Add configurator proposal tests that assert V/A/M line items and totals match fixtures.
   - Determinism: Item ordering is stable (by kind/id) and proposal content is pure.
   - Notes: Keep pricing atomic; composite costs are computed by personas, not encoded in the price list.
13. [completed] Actor persona consumes allocation + receipt to gate motivations and affinity use.
   - Requirement: Enforce per-actor budget constraints during behavior selection.
   - Behavior details: Actor persona checks remaining budget pools/receipts before enabling motivations or affinity stacks; denied options are excluded from action selection.
   - Data shape proposal: Actor policy input includes `BudgetReceiptArtifact` + optional `BudgetAllocationArtifact` refs.
   - Defaults (if relevant): If no budget data, behavior stays unchanged (no gating).
   - Tests: Add actor policy tests that verify motivation/affinity selection is pruned by budget constraints.
   - Determinism: Gating decisions are deterministic and based only on inputs.
   - Notes: No IO; policy-level enforcement only.
14. [completed] Allocator ledger updates for runtime spending events (optional phase).
   - Requirement: Track ongoing spend and emit updated receipts or ledgers during runtime.
   - Behavior details: Introduce a deterministic ledger update function that accepts spend events (e.g., motivation activation, affinity use) and updates remaining budgets; emit updated receipts or a `BudgetLedgerArtifact`.
   - Data shape proposal: `BudgetLedgerArtifact` `{ schema, schemaVersion, meta, budgetRef, remaining, spendEvents: [...] }`.
   - Defaults (if relevant): If no spend events, ledger equals initial receipt.
   - Tests: Add unit tests for ledger updates with fixture spend events.
   - Determinism: Stable event ordering; no timestamps beyond explicit meta.
   - Notes: Keep ledger updates in runtime; core-as only enforces provided caps.
