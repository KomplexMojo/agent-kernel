# end-to-end-integration-tests

Goal: add deterministic integration tests that prove the full budget -> LLM summary -> BuildSpec -> build artifacts -> Allocator/Annotator outputs -> UI runtime flow using fixtures (no network) and stable ordering. This plan may introduce new code and functionality required to enable full-tier, deterministic, headless testing; keep additions minimal, versioned, and test-driven.

Scope note: integration fixtures should include concrete actor instances where needed to make runtime visualization meaningful. Use six tiered scenarios with progressively larger levels and actor counts:
- Tier 1 (XS): 5x5 level, 1 actor.
- Tier 2 (S): 10x10 level, 3 actors.
- Tier 3 (M): 20x20 level, 10 actors.
- Tier 4 (L): 50x50 level, 20 actors.
- Tier 5 (XL): 100x100 level, 50 actors.
- Tier 6 (Perf): start at 1000x1000 level, 500 actors; allow auto-scaling up/down based on hardware capability (opt-in).
Actors should be varied across motivations, affinities, and affinity expressions (emit/push/pull) to exercise diversity in the pipeline.
Level layouts should include multiple connected rooms/cavities with minimums by tier: Tier 3 = 2 rooms, Tier 4 = 3 rooms, Tier 5 = 6 rooms, Tier 6 = 12 rooms.

## 0) Scaling + Headless Prereqs (unblock Tier 1-6)
This section fixes known code constraints that would otherwise cap tier sizes/actor counts. Complete these before implementing tiers beyond the current limits, then proceed with Sections 1-7.

1. [implemented] Lift `core-as` grid size limits for tiered levels.
   - Requirement: Support at least the Tier 5 target (100x100) in WASM core; Tier 6 should be bounded by an explicit max-cells safety check.
   - Current deficiency: `core-as` world uses fixed `MAX_WIDTH/MAX_HEIGHT` and `StaticArray` storage that caps the grid (currently 9x9).
   - Work: Replace fixed-size world storage with dynamically sized typed arrays keyed by `width*height`, and add a `maxCells` guard that fails fast with a validation error when exceeded.
   - Tests: `core-as` bounds tests (small sizes, Tier 1/2/5 sizes, and failure for excessive sizes).
   - Determinism: No timestamps/IO; all memory allocation is deterministic for a given size.
2. [implemented] Add a large-grid-safe action/event encoding path.
   - Requirement: Allow simulation ticks/moves on grids where `x/y` exceed current bit-packing limits and where actor IDs exceed current 4-bit packing.
   - Current deficiency: Move encoding and some effect encodings pack coordinates/actor IDs into small bit fields.
   - Work: Replace the current move/effect encodings with a new encoding that does not rely on 4-bit/8-bit packing; delete the old packing code and update all call sites (bindings, UI playback, fixtures) to the new format.
   - Tests: Encode/decode tests for the new format (including large coords/ids) and end-to-end headless playback tests that exercise the new encoding.
3. [implemented] Add multi-actor support for “motivated” actors in the simulation core.
   - Requirement: Support Tier 2-6 actor counts in headless simulation (at minimum: load/validate placements for N actors + deterministic observation enumeration; stretch goal: deterministic tick policy for multiple actors).
   - Current deficiency: Core/runtime artifact loading only spawns a single primary actor.
   - Work: Extend core state to store N actor slots (positions + vitals), validate placement collisions, expose observation APIs that can enumerate actors deterministically, and add explicit `maxActors` safety checks for extreme counts.
   - Tests: Placement validation tests (collisions, out-of-bounds) and “load initialState with N actors” test.
4. [implemented] Add a bulk layout load path for large grids (avoid per-tile JS->WASM calls).
   - Requirement: Large tiers must load within reasonable time on low-power hardware.
   - Current deficiency: Layout load uses nested loops that call `setTileAt()` per cell across the boundary.
   - Work: Add a bulk import/export for tile bytes (or equivalent) and update the runtime loader to use it when available.
   - Tests: Smoke test that bulk-loaded layouts match per-cell loading for small grids.
5. [implemented] Make runtime execution fully headless and deterministic when requested.
   - Requirement: All integration tests (including “load bundle into runtime”) run under `node --test` with no DOM, and can be made deterministic (fixed runId/clock) for assertions.
   - Current deficiency: Some runtime frame metadata uses `Date.now()` / `new Date()` and run IDs derived from wall clock.
   - Work: Add injectable `clock`/`runId` options to the runtime runner and thread them through tests; ensure UI-web tests can continue using stubs.
   - Tests: Assert deterministic `runId`/`createdAt` when provided; avoid snapshotting volatile fields when not.
6. [implemented] Add an opt-in performance harness that scales to the host machine.
   - Requirement: Tier 6 runs headless and scales up/down to the host’s practical limits (memory/time), without destabilizing the default test suite.
   - Work: Add a separate perf test/harness (skipped by default) that:
     - Detects hardware constraints (e.g., memory budget/time budget) and chooses max grid/actor counts via probing or binary search.
     - Records metrics (load time, tick throughput, memory) but asserts only basic sanity (no crashes, stable ordering).
   - Tests: `--perf`/env-gated test that can be run locally/CI when desired.
7. [implemented] Add deterministic room/cavity generation + hallway connections for tiered layouts.
   - Requirement: For tiers 3-6, produce layouts with a minimum number of rooms/cavities and at least one connected path between rooms.
   - Work: Implement a deterministic (seeded) room/cavity placer and corridor router that outputs `layout.kind="grid"` data usable by the build pipeline; include a connectivity check (BFS/DFS) to validate reachability between key rooms/spawn/exit.
   - Defaults: Use fixed seeds per tier to keep fixtures deterministic; avoid any IO.
   - Tests: Layout validation tests (room count, connectivity, spawn/exit placement).
8. [implemented] Add deterministic high-count actor configuration generation for tiers and perf.
   - Requirement: Generate large actor sets (Tier 6 and beyond) with controlled diversity in motivations/affinities/expressions, and deterministic placement patterns.
   - Work: Add a seeded actor generator that can emit N actors with stable IDs, spread positions across the map, and assign affinities/expressions from an allowed menu without randomness at runtime.
   - Tests: Generator tests (count, stable ordering/IDs, bounded positions, diversity invariants).

## 1) Scenario Fixtures & Budget Inputs
1. [implemented] Define the canonical end-to-end scenario fixtures.
   - Requirement: Provide a single scenario fixture set that includes the budget input, pool catalog, and a valid LLM summary response.
   - Behavior details: Budget starts as a numeric token cap (budgetTokens) that is fed into the LLM prompt contract; the summary response chooses from allowed motivations/affinities and includes token hints.
   - Data shape proposal: `E2EScenario { goal, tier, levelSize, actorCount, budgetTokens, catalogPath, summaryPath, expectedSelectionsPath }` under `tests/fixtures/e2e/`.
   - Defaults: Use existing pool catalog defaults when possible; avoid solver/network adapters.
   - Tests: Fixture load test to confirm JSON is valid and matches the prompt contract schema.
   - Determinism: Fixture order stable; IDs and tokens unchanged across runs.
   - Notes: Prefer reusing `tests/fixtures/pool/catalog-basic.json` unless the scenario needs extra entries.
2. [implemented] Add captured prompt/response fixtures that include budget context.
   - Requirement: Capture the exact prompt text + LLM response used by the integration tests.
   - Behavior details: Store prompt text (with budgetTokens), raw response text, and parsed summary JSON.
   - Data shape proposal: `{ prompt, responseRaw, responseParsed }` in `tests/fixtures/e2e/llm-summary-response.json`.
   - Defaults: Fixture-only; no live LLM calls.
   - Tests: Prompt contract parse test should validate the parsed summary.
   - Determinism: Prompt text is stable and generated from the same menu ordering.
   - Notes: Keep the response JSON minimal and menu-only.
3. [implemented] Add tiered actor instance fixtures for runtime visualization.
   - Requirement: Provide per-tier actor instance sets (positions, motivations, affinities, expressions) to validate runtime visualization and annotation outputs.
   - Behavior details: Each tier fixture defines a target level size, actor count, and a spread of motivations/affinities; larger tiers can reuse patterned placement for determinism.
   - Data shape proposal: `E2EActors { tier, level: { width, height }, actors: [{ id, kind, position, vitals, affinities, motivations }] }` under `tests/fixtures/e2e/actors/`.
   - Defaults: Use deterministic positions (grid or seeded) and fixed vitals; avoid procedural randomness in fixtures.
   - Tests: Fixture ingest test that counts match tier requirements and entries are schema-valid.
   - Determinism: Actor ordering stable; IDs deterministic per tier.
   - Notes: Ensure a mix of motivations and affinities across tiers; include multiple affinity expressions (`emit`, `push`, `pull`) where supported. Prefer using the Section 0 generators + pinned seeds for Tier 6 to avoid huge JSON fixtures.

## 2) Orchestrator Prompt Contract Integration
1. [implemented] Thread budgetTokens into the menu prompt.
   - Requirement: Ensure the prompt explicitly includes the budgetTokens the LLM must respect.
   - Behavior details: Extend the prompt builder to accept budgetTokens and embed it in the prompt text (goal/notes + budget line).
   - Data shape proposal: `buildMenuPrompt({ goal, notes, budgetTokens })`.
   - Defaults: If budgetTokens missing, omit the budget line and expect `missing` to include it.
   - Tests: Contract test asserts prompt text contains the budget line and menus remain ordered.
   - Determinism: Prompt content and menu ordering stable.
   - Notes: Avoid any JSON schema expansion in the prompt.
2. [implemented] Add capture/parse integration test for LLM summary.
   - Requirement: Validate that the captured response parses into a normalized summary with no errors.
   - Behavior details: Use `capturePromptResponse` with fixture response; assert `summary` matches expected picks.
   - Data shape proposal: `PromptCapture { prompt, responseRaw, responseParsed, summary, errors[] }`.
   - Defaults: Fixture-only.
   - Tests: New test under `tests/runtime/prompt-contract-e2e.test.js`.
   - Determinism: Summary normalization errors ordered and stable.

## 3) Director + Allocator End-to-End Mapping
1. [implemented] Integrate summary -> pool selections -> budget enforcement -> BuildSpec.
   - Requirement: Chain `normalizeSummary` -> `mapSummaryToPool` -> `enforceBudget` -> `buildBuildSpecFromSummary` with the scenario fixtures.
   - Behavior details: Assert receipts reflect budget trims and BuildSpec validates with no errors.
   - Data shape proposal: `E2EResult { summary, selections, receipts, buildSpec }`.
   - Defaults: If budget is tight, ensure down-tiered receipts are expected.
   - Tests: `tests/runtime/e2e-summary-buildspec.test.js` (or similar) asserts BuildSpec schema and key fields.
   - Determinism: Selection order and receipts stable.
   - Notes: Do not invent stats; only catalog metadata.
2. [implemented] Validate budget references and price list consistency.
   - Requirement: BuildSpec should include budget refs and match expected budget/price list fixtures.
   - Behavior details: Use existing budget fixtures under `tests/fixtures/allocator/` or add a new minimal pair.
   - Data shape proposal: BudgetArtifact + PriceList refs in BuildSpec.
   - Defaults: Keep refs stable and versioned.
   - Tests: Assert budget/price list refs exist and are valid.
   - Determinism: IDs and schema versions fixed.

## 4) Allocator + Annotator Persona Outputs
1. [implemented] Exercise Allocator budget outputs in the integration flow.
   - Requirement: Ensure Allocator-managed artifacts (budget receipt/ledger) are present and consistent with BuildSpec and build outputs.
   - Behavior details: Use existing allocator fixtures or the build output budget receipt to validate schema and runId linkage.
   - Data shape proposal: `BudgetReceiptArtifact` and related budget ledger outputs from existing Allocator code.
   - Defaults: Use fixture-mode data; no external IO.
   - Tests: `tests/runtime/e2e-allocator-artifacts.test.js` verifies receipt artifacts are in manifest/bundle.
   - Determinism: Receipt ordering stable and references match manifest entries.
   - Notes: Prefer validating current outputs; if a missing artifact blocks full-tier testing, add the minimal deterministic logic/hook needed to emit it and capture the change as a TODO/follow-up.
2. [implemented] Exercise Annotator outputs in the integration flow.
   - Requirement: Ensure Annotator-managed artifacts (affinity summary/trap annotations) are produced and can be inspected.
   - Behavior details: Use existing Annotator output generation paths and validate that summary artifacts appear in bundle.
   - Data shape proposal: `AffinitySummary` + related annotation artifacts, as currently emitted.
   - Defaults: Use fixture-mode data; no external IO.
   - Tests: `tests/runtime/e2e-annotator-artifacts.test.js` asserts annotations are present and schema-valid.
   - Determinism: Ordering stable; annotations tied to the same runId.
   - Notes: Prefer validating current outputs; if a missing artifact blocks full-tier testing, add the minimal deterministic logic/hook needed to emit it and capture the change as a TODO/follow-up.

## 5) Build Orchestration & Artifact Generation
1. [implemented] Run a build from the generated BuildSpec and validate outputs.
   - Requirement: Produce bundle/manifest/telemetry/sim-config/initial-state from the integration BuildSpec.
   - Behavior details: Call `orchestrateBuild` directly (no network) or reuse CLI build helpers; ensure outputs match schema catalog.
   - Data shape proposal: `BuildOutput { bundle, manifest, telemetry, simConfig, initialState }`.
   - Defaults: Use fixture solver inputs only if required by the spec.
   - Tests: `tests/runtime/e2e-build-artifacts.test.js` verifies required files/fields.
   - Determinism: Artifacts sorted by schema + id; timestamps pinned or injected via clock.
   - Notes: Reuse existing `schema-catalog` utilities for assertions.
2. [implemented] Verify build receipts and telemetry capture.
   - Requirement: Ensure budget receipts and build telemetry reflect the same runId and status.
   - Behavior details: Compare telemetry artifact refs to manifest entries.
   - Data shape proposal: `TelemetryRecord { status, artifactRefs[] }`.
   - Defaults: Status should be `success` for the happy-path scenario.
   - Tests: Assert telemetry includes spec/intent/plan entries and runId.
   - Determinism: Telemetry ordering stable.

## 6) UI Runtime Visualization Integration
1. [implemented] Drive the runtime UI from generated bundle artifacts.
   - Requirement: Use the generated bundle to populate Bundle Review and run runtime playback (ticks=0).
   - Behavior details: Reuse `setupPlayback` + `initializeCoreFromArtifacts` with a stub core or WASM fixture.
   - Data shape proposal: `RuntimeInput { simConfig, initialState }` sourced from BuildOutput.
   - Defaults: Dry-run tick count to avoid non-deterministic behavior.
   - Tests: `tests/ui-web/e2e-runtime-from-build.test.mjs` asserts frame buffer and status text are populated.
   - Determinism: Fixed seed and stable layout assertions.
   - Notes: Keep this test headless (no DOM dependencies beyond existing stubs).

## 7) End-to-End Integration Test Harness
1. [implemented] Add a single top-level integration test that stitches the full flow.
   - Requirement: Prove steps 1-6 in a single test file using fixtures and deterministic functions.
   - Behavior details: BudgetTokens -> prompt contract -> summary -> pool mapping -> BuildSpec -> build artifacts -> runtime load.
   - Data shape proposal: `E2ETrace { budgetTokens, prompt, summary, buildSpec, artifacts, runtimeReady }`.
   - Defaults: Run as part of the default test suite.
   - Tests: `tests/integration/e2e-llm-pool-runtime.test.js`.
   - Determinism: Stable ordering, fixed timestamps via injected clock where applicable.
   - Notes: Keep the test narrow (assert key fields, not full deep-equals) to reduce brittleness.

## 8) Documentation
1. [implemented] Document how to run the end-to-end integration tests and fixtures.
   - Requirement: Add a short section in `docs/human-interfaces.md` or a dedicated `docs/README` note pointing to the scenario and test command.
   - Behavior details: Include the fixture paths and the expected outputs (bundle, telemetry).
   - Data shape proposal: Reference the `tests/fixtures/e2e/` schema.
   - Defaults: Recommend running `node --test "tests/**/*.test.js"`.
   - Tests: N/A (docs).
   - Determinism: Call out fixed ordering and fixture-driven flow.

## 9) TODOs (for full integration if gaps are discovered)
- [pending] If Allocator/Annotator artifacts are not emitted in the current build output, add minimal deterministic implementations or build pipeline hooks to expose them for integration tests. (see Step 10-11)
- [implemented] If the prompt contract does not currently accept `budgetTokens`, add a minimal parameter pass-through and mark it as test-only wiring until full persona integration is completed.
- [implemented] If UI runtime cannot consume bundle artifacts end-to-end without WASM, add a test-only stub core adapter (do not alter production runtime) and record as a follow-up for full runtime integration.
- [pending] If large tiers are too heavy to store as JSON fixtures, add deterministic fixture generators (seeded) that emit layouts/actors on-demand for the perf harness while keeping Tier 1-5 as static fixtures for regression. (see Step 12)

## 10) TODO follow-ups
10. [implemented] Emit Allocator artifacts in build output for integration tests.
   - Requirement: Orchestrated builds include spend proposal + budget receipt artifacts (and ledger if available) in bundle/manifest outputs.
   - Work: Extend `orchestrateBuild` outputs to surface spend proposal artifacts; update bundle/manifest assembly (tests or adapters) to include them.
   - Tests: Update `tests/runtime/e2e-build-artifacts.test.js` and `tests/runtime/e2e-allocator-artifacts.test.js` to assert presence via build output.
   - Determinism: Sorting stable; IDs from build meta.

11. [implemented] Emit Annotator artifacts in build output for integration tests.
   - Requirement: Build output includes affinity summary/trap annotation artifacts derived from `simConfig` + `initialState`.
   - Work: Add annotator generation in `orchestrateBuild` (or a dedicated helper) and include artifacts in bundle/manifest.
   - Tests: Update `tests/runtime/e2e-annotator-artifacts.test.js` and `tests/runtime/e2e-build-artifacts.test.js` to assert presence via build output.
   - Determinism: Ordering stable; runId tied to build meta.
   
12. [implemented] Evaluate large-tier fixture sizes and add seeded generators if needed.
   - Requirement: Avoid oversized JSON fixtures while keeping deterministic regression coverage.
   - Work: Add seeded layout/actor generators for large tiers and gate on-demand generation for perf harness; keep Tier 1-5 static.
   - Tests: Generator tests for count/ordering/bounds; perf harness uses generators when enabled.

13. [implemented] Exercise room/cavity layouts in the stitched end-to-end flow.
   - Requirement: Ensure the integration pipeline uses room-based layouts for tiers 3+ so minimum room counts and connectivity are exercised in end-to-end tests.
   - Work: Add a tiered scenario fixture (or expand the existing scenario) that requests `shape.profile="rooms"` with tier-specific `roomCount`, then update the stitched test to assert `layout.rooms` and `layout.connectivity` from `simConfig`.
   - Tests: Update `tests/integration/e2e-llm-pool-runtime.test.js` to assert room count minimums and connectivity when running the tiered scenario.
   - Determinism: Use fixed seeds per tier and stable ordering in assertions.
