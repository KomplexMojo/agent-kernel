# Plan

## Summary
This work makes cost a first-class, persisted contract across the runtime build pipeline instead of an optional sidecar. The implementation sequence starts with versioned schema changes, then centralizes pricing and receipt issuance in the Allocator, then makes build-like flows always synthesize and persist canonical budget artifacts, and finally propagates cost context into emitted artifacts and adapter summaries. Public docs and migration guidance close the branch only after the runtime and adapter outputs are stable.

## Milestones

### M1 - Cost Contract Foundation
- Size band: M
- Assigned agent: Claude Sonnet/high
- Target files:
  - `packages/runtime/src/contracts/artifacts.ts`
  - `tests/contracts/artifact-meta-cost-context.test.js`
  - `tests/contracts/spend-proposal-item.test.js`
  - `tests/contracts/budget-receipt-artifact.test.js`
  - `tests/fixtures/artifacts/invalid/artifact-meta-v1-invalid-cost.json`
  - `tests/fixtures/artifacts/invalid/spend-proposal-item-v1-invalid.json`
- Tests:
  - Add contract coverage for `ArtifactCostContextV1` on `ArtifactMeta`, including the small-field constraint (`selfTokens`, `runTotalTokens`, `budgetTokens`, `category`, `receiptRef`, `proposalRef`, `lineItemIds`).
  - Add schema coverage for expanded `SpendProposalItemV1` attribution fields: `category`, `unitCost`, `totalCost`, `status`, `artifactRef` or `subjectRef`, and optional `detail`.
  - Add coverage that `BudgetReceiptArtifact.scenarioSpendReport` uses the new category set: `rooms`, `floor_tiles`, `traps`, `hazards`, `resources`, `delvers`, `wardens`, and `shared/system`.
- Success criteria:
  1. Write failing contract tests and invalid fixtures for the new cost metadata shape -> verify: `node --test tests/contracts/artifact-meta-cost-context.test.js tests/contracts/spend-proposal-item.test.js tests/contracts/budget-receipt-artifact.test.js` exits non-zero before schema edits.
  2. Update the versioned runtime contracts so `ArtifactMeta.cost` is optional, proposal items carry attribution fields, and receipt summaries use the new categories -> verify: `node --test tests/contracts/artifact-meta-cost-context.test.js tests/contracts/spend-proposal-item.test.js tests/contracts/budget-receipt-artifact.test.js`.
  3. Prove malformed or oversized cost metadata is rejected by schema validation instead of leaking into emitted artifacts -> verify: `node --test tests/contracts/artifact-meta-cost-context.test.js tests/contracts/spend-proposal-item.test.js`.
- Validation command: `node --test tests/contracts/artifact-meta-cost-context.test.js tests/contracts/spend-proposal-item.test.js tests/contracts/budget-receipt-artifact.test.js`
- Stop condition: The versioned artifact contracts accept only the new canonical cost shape, and no unversioned top-level cost fields are required outside `ArtifactMeta.cost`.
- Assumptions:
  - These are additive contract changes inside the existing artifact version family, not a parallel schema fork.
  - `detail` remains optional and JSON-serializable.
  - `shared/system` is represented as one report category label even if individual line items remain more specific.

### M2 - Allocator-Owned Pricing And Default Price List
- Size band: M
- Assigned agent: Claude Sonnet/high
- Target files:
  - `packages/runtime/src/personas/allocator/validate-spend.js`
  - `packages/runtime/src/personas/configurator/spend-proposal.js`
  - `packages/runtime/src/personas/director/budget-allocation.js`
  - `packages/runtime/src/personas/allocator/schema/price-list.example.json`
  - `tests/runtime/allocator/validate-spend-proposal.test.js`
  - `tests/contracts/price-list-artifact.test.js`
  - `tests/fixtures/artifacts/price-list-artifact-v1-basic.json`
  - `tests/fixtures/artifacts/price-list-artifact-v1-tiles.json`
- Tests:
  - Add failing coverage that the default `agent-kernel/PriceList` normalizes on `id`, `kind`, `unitCost`, and optional `formula`.
  - Add failing coverage that pricing covers vitals, regen rates, motivations, affinity slots, affinity stacks with quadratic pricing, traps, hazards, resources, floor tiles, room aggregates, and actor spawn costs.
  - Add failing coverage that spend validation, price evaluation, and receipt issuance are driven through the Allocator entry point rather than duplicated in Configurator or Director helpers.
- Success criteria:
  1. Add failing tests that expose missing categories, missing formulas, and field-name normalization gaps in the current price list fixtures -> verify: `node --test tests/contracts/price-list-artifact.test.js tests/runtime/allocator/validate-spend-proposal.test.js` exits non-zero before implementation.
  2. Refactor spend validation and receipt issuance so Allocator owns canonical pricing decisions and downstream personas consume that result instead of recomputing cost -> verify: `node --test tests/contracts/price-list-artifact.test.js tests/runtime/allocator/validate-spend-proposal.test.js`.
  3. Prove the default price list can price every requested category, including quadratic affinity stacks and regen items -> verify: `node --test tests/contracts/price-list-artifact.test.js`.
- Validation command: `node --test tests/contracts/price-list-artifact.test.js tests/runtime/allocator/validate-spend-proposal.test.js`
- Stop condition: The Allocator is the sole owner of spend validation, price evaluation, and receipt issuance, and the default price list artifact can price every prompt-defined category in canonical form.
- Assumptions:
  - Room pricing is stored as an aggregate derived from priced components, not a second disconnected room-cost system.
  - Configurator and Director may still prepare inputs, but must not own canonical receipt math after this milestone.
  - The default price list remains a versioned JSON artifact checked into the repo rather than generated at runtime.

### M3 - Canonical Budget Context And Sidecar Persistence
- Size band: M
- Assigned agent: Claude Sonnet/high
- Target files:
  - `packages/runtime/src/personas/orchestrator/budget-inputs.js`
  - `packages/runtime/src/build/orchestrate-build.js`
  - `packages/runtime/src/commands/kernel.js`
  - `tests/runtime/build/orchestrate-build-cost-context.test.js`
  - `tests/integration/ak-budget-sidecars.test.js`
- Tests:
  - Add failing coverage that `build`, `create`, and `configure` synthesize canonical budget context when only `budgetTokens` is supplied.
  - Add failing coverage that `spend-proposal.json` and the canonical receipt sidecar are written by default for build-like authoring flows when a hard budget is present.
  - Add failing coverage that default price list fallback is used when the request includes `budgetTokens` but no explicit price list artifact.
- Success criteria:
  1. Write failing runtime and integration tests for `budgetTokens`-only authoring requests -> verify: `node --test tests/runtime/build/orchestrate-build-cost-context.test.js tests/integration/ak-budget-sidecars.test.js` exits non-zero before implementation.
  2. Update budget-input normalization and build orchestration so a hard budget always resolves to canonical receipt/proposal context, even without an explicit price list input -> verify: `node --test tests/runtime/build/orchestrate-build-cost-context.test.js tests/integration/ak-budget-sidecars.test.js`.
  3. Prove `build`, `create`, and `configure` persist `spend-proposal.json` by default whenever budgeted authoring is requested -> verify: `node --test tests/integration/ak-budget-sidecars.test.js`.
- Validation command: `node --test tests/runtime/build/orchestrate-build-cost-context.test.js tests/integration/ak-budget-sidecars.test.js`
- Stop condition: Budgeted authoring no longer depends on callers supplying both `budget` and `priceList` artifacts up front, and receipt/proposal sidecars are default outputs rather than optional intermediates.
- Assumptions:
  - Existing CLI flags stay stable; the behavior change is default artifact synthesis and persistence, not a new public flag family.
  - The canonical default price list from M2 is the fallback source for `budgetTokens`-only flows.
  - Dry-run behavior may report would-be artifact paths but must still exercise the same pricing path.

### M4 - Artifact Cost Propagation And Exact Attribution
- Size band: M
- Assigned agent: Claude Sonnet/high
- Target files:
  - `packages/runtime/src/build/orchestrate-build.js`
  - `packages/runtime/src/commands/kernel.js`
  - `tests/runtime/build/artifact-cost-context.test.js`
  - `tests/integration/ak-emitted-artifact-cost-links.test.js`
- Tests:
  - Add failing coverage that emitted artifacts carry `meta.cost` with `selfTokens`, `runTotalTokens`, `budgetTokens`, `category`, `receiptRef`, `proposalRef`, and `lineItemIds`.
  - Add failing coverage that leaf artifacts (`hazard-*`, `resource-*`) receive direct receipts while composite artifacts (`spec`, `intent`, `plan`, `sim-config`, `initial-state`, `bundle`, `manifest`, `telemetry`, summary artifacts) receive summary cost context derived from components.
  - Add failing coverage that scenario spend reporting uses exact attribution where possible and stops proportionally splitting actor cost when exact line-item linkage exists.
- Success criteria:
  1. Write failing artifact-emission tests for missing `meta.cost` and missing receipt/proposal references on emitted artifacts -> verify: `node --test tests/runtime/build/artifact-cost-context.test.js tests/integration/ak-emitted-artifact-cost-links.test.js` exits non-zero before implementation.
  2. Update emitted artifact assembly so every requested artifact family carries canonical cost context without embedding full receipts everywhere -> verify: `node --test tests/runtime/build/artifact-cost-context.test.js tests/integration/ak-emitted-artifact-cost-links.test.js`.
  3. Prove receipt summaries and scenario spend reporting use exact attribution when line-item linkage exists -> verify: `node --test tests/runtime/build/artifact-cost-context.test.js`.
- Validation command: `node --test tests/runtime/build/artifact-cost-context.test.js tests/integration/ak-emitted-artifact-cost-links.test.js`
- Stop condition: Requested emitted artifacts and summary artifacts all expose canonical `meta.cost` references, and receipt reporting prefers exact attribution over proportional actor splits whenever exact linkage is available.
- Assumptions:
  - Composite artifacts carry summarized cost context only; they do not inline full child receipts.
  - `lineItemIds` are stable identifiers from the persisted proposal/receipt artifacts, not recomputed ephemeral labels.
  - Telemetry and summary artifacts can reference the same persisted receipt/proposal pair as the run-level outputs.

### M5 - CLI And MCP Cost Summary Surface
- Size band: S
- Assigned agent: Claude Sonnet/high
- Target files:
  - `packages/adapters-cli/src/cli/ak-impl.mjs`
  - `packages/adapters-cli/src/mcp/server.mjs`
  - `tests/adapters-cli/ak-cost-summary.test.js`
  - `tests/integration/ak-runs-list-cost-summary.test.js`
- Tests:
  - Add failing coverage that `create`, `configure`, `show`, and `runs list` surface cost paths and top-level totals consistently.
  - Add failing coverage that MCP summaries mirror the CLI summaries for receipt path, proposal path, run total, and budget total.
  - Add failing coverage that summary output tolerates older runs that have sidecar receipts or proposals but no `meta.cost`, with an explicit migration note instead of silent omission.
- Success criteria:
  1. Write failing adapter tests for inconsistent or missing cost summary fields in CLI and MCP output -> verify: `node --test tests/adapters-cli/ak-cost-summary.test.js tests/integration/ak-runs-list-cost-summary.test.js` exits non-zero before implementation.
  2. Update CLI and MCP summary formatting so `create`, `configure`, `show`, and `runs list` expose the same top-level totals and artifact paths -> verify: `node --test tests/adapters-cli/ak-cost-summary.test.js tests/integration/ak-runs-list-cost-summary.test.js`.
  3. Prove old runs without `meta.cost` still surface sidecar-based guidance rather than failing summary commands -> verify: `node --test tests/adapters-cli/ak-cost-summary.test.js`.
- Validation command: `node --test tests/adapters-cli/ak-cost-summary.test.js tests/integration/ak-runs-list-cost-summary.test.js`
- Stop condition: CLI and MCP summary surfaces are consistent for new runs and degrade explicitly for older runs with sidecar-only cost data.
- Assumptions:
  - Adapter output remains concise and top-level; detailed spend inspection still belongs in the persisted artifacts.
  - `show` and `runs list` should not require a UI consumer to reconstruct totals from nested receipt payloads.
  - Migration messaging can be textual in adapter output as long as the command shape remains machine-readable where already promised.

### M6 - Cost Test Permutations
- Size band: S
- Assigned agent: Ollama
- Target files:
  - `tests/contracts/artifact-meta-cost-context.test.js`
  - `tests/contracts/spend-proposal-item.test.js`
  - `tests/contracts/budget-receipt-artifact.test.js`
  - `tests/contracts/price-list-artifact.test.js`
  - `tests/runtime/allocator/validate-spend-proposal.test.js`
  - `tests/runtime/build/orchestrate-build-cost-context.test.js`
  - `tests/runtime/build/artifact-cost-context.test.js`
  - `tests/adapters-cli/ak-cost-summary.test.js`
- Tests:
  - Expand every `## TODO: Test Permutations` block created in M1-M5 into concrete edge-case coverage.
  - Add bounded permutations for malformed formulas, missing line-item references, budget-only flows, old-run migration paths, and category mismatches.
  - Keep execution narrow and deterministic so failures map back to one cost boundary at a time.
- Success criteria:
  1. Confirm the base test files from M1-M5 include `## TODO: Test Permutations` handoff sections -> verify: observable check in the listed test files before Ollama expansion begins.
  2. Expand the TODO stubs into concrete tests without changing production code -> verify: `node --test tests/contracts/artifact-meta-cost-context.test.js tests/contracts/spend-proposal-item.test.js tests/contracts/budget-receipt-artifact.test.js tests/contracts/price-list-artifact.test.js tests/runtime/allocator/validate-spend-proposal.test.js tests/runtime/build/orchestrate-build-cost-context.test.js tests/runtime/build/artifact-cost-context.test.js tests/adapters-cli/ak-cost-summary.test.js`.
  3. Prove the expanded permutations isolate failure classes instead of duplicating the same assertion shape -> verify: `node --test tests/runtime/build/orchestrate-build-cost-context.test.js tests/adapters-cli/ak-cost-summary.test.js`.
- Validation command: `node --test tests/contracts/artifact-meta-cost-context.test.js tests/contracts/spend-proposal-item.test.js tests/contracts/budget-receipt-artifact.test.js tests/contracts/price-list-artifact.test.js tests/runtime/allocator/validate-spend-proposal.test.js tests/runtime/build/orchestrate-build-cost-context.test.js tests/runtime/build/artifact-cost-context.test.js tests/adapters-cli/ak-cost-summary.test.js`
- Stop condition: All base test files have concrete permutation coverage in place, and no TODO stub section remains for the cost-contract slice.
- Assumptions:
  - `tests/README.md` is read before expansion and remains the bounded workflow source of truth.
  - Ollama edits only test files and does not reopen production design decisions.
  - Narrow targeted suites are sufficient; a full repo-wide run is not required for the permutation handoff milestone itself.

### M7 - Docs, README Examples, And Migration Note
- Size band: S
- Assigned agent: GitHub Copilot
- Target files:
  - `docs/architecture-charter.md`
  - `docs/README.md`
  - `packages/adapters-cli/README.md`
  - `docs/migrations/artifact-cost-context-v1.md`
- Tests:
  - Document the new `meta.cost` contract, persisted proposal/receipt defaults, and the updated CLI/MCP summary shape.
  - Add a migration note for older artifacts that only have receipt or proposal sidecars and no `meta.cost`.
  - Refresh README examples so budgeted `create`, `configure`, `show`, and `runs list` outputs align with the implemented summaries.
- Success criteria:
  1. Update public docs and examples only after M1-M5 behavior is stable -> verify: observable check that each target file references the new cost contract and sidecar defaults.
  2. Add a migration note that explains how old artifacts without `meta.cost` are interpreted by the new summaries -> verify: `node -e "const fs=require('fs'); const files=['docs/architecture-charter.md','docs/README.md','packages/adapters-cli/README.md','docs/migrations/artifact-cost-context-v1.md']; const text=files.map((f)=>fs.readFileSync(f,'utf8')).join('\\n'); for (const token of ['meta.cost','spend-proposal.json','budgetTokens']) { if (!text.includes(token)) throw new Error('missing '+token); }"`.
  3. Confirm the documented commands and summary examples match the implemented adapter behavior -> verify: `node --test tests/adapters-cli/ak-cost-summary.test.js tests/integration/ak-runs-list-cost-summary.test.js`.
- Validation command: `node -e "const fs=require('fs'); const files=['docs/architecture-charter.md','docs/README.md','packages/adapters-cli/README.md','docs/migrations/artifact-cost-context-v1.md']; const text=files.map((f)=>fs.readFileSync(f,'utf8')).join('\\n'); for (const token of ['meta.cost','spend-proposal.json','budgetTokens']) { if (!text.includes(token)) throw new Error('missing '+token); }"`
- Stop condition: Public docs, README examples, and the migration note all describe the implemented cost contract and legacy-artifact behavior without contradicting the adapter outputs.
- Assumptions:
  - The migration note can live under `docs/migrations/` as a new file.
  - README examples should show top-level totals and artifact paths, not full receipt payload dumps.
  - Architecture charter updates are limited to boundary-contract wording; no new package diagram is required unless implementation changes package direction.

## Dependency Graph
- `M1 -> M2`
- `M2 -> M3`
- `M1 -> M4`
- `M2 -> M4`
- `M3 -> M4`
- `M3 -> M5`
- `M4 -> M5`
- `M1 -> M6`
- `M2 -> M6`
- `M3 -> M6`
- `M4 -> M6`
- `M5 -> M6`
- `M5 -> M7`

## Architecture Flags
- `M2` requires Claude escalation before implementation because it restructures spend ownership across runtime personas. Charter rule touched: runtime personas own policy and workflow logic, while `core-as` remains pure logic with no IO.
- `M3` requires Claude escalation before implementation because it changes the default artifact-emission contract for build-like authoring flows. Charter rule touched: all boundary-crossing data uses versioned artifact schemas from `packages/runtime/src/contracts/artifacts.ts`.
- `M4` requires Claude escalation before implementation because it adds `meta.cost` to emitted artifacts across runtime outputs. Charter rule touched: all boundary-crossing data must remain versioned artifact contracts rather than adapter-only fields.
- `M5` requires Claude escalation before implementation because it changes adapter-facing summary surfaces in CLI and MCP. Charter rules touched: external IO must stay in adapters via narrow ports, and dependency direction remains `adapters-* -> runtime -> bindings-ts -> core-as`.

## Open Items
- None from `local-codex/Prompt.md`. The prompt’s prior open questions were resolved and are captured here as milestone assumptions rather than start blockers.
