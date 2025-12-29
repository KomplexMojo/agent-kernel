# Tests and MVP Plan

Goal: build MVP examples for adapters-cli and add a comprehensive test suite for existing functionality.

## 1) Inventory and Baseline
1. [complete] Enumerate current adapters and runtime/bindings entrypoints that need coverage (tracked in docs/implementation-plans/testing-inventory.md).
2. [complete] Confirm the CLI adapters expected for MVP (solve/run/replay/inspect) and list their target inputs/outputs and required artifacts.
   - solve
     - Inputs: scenario prompt or plan stub, optional solver config, optional runId.
     - Required artifacts: IntentEnvelope or PlanArtifact (if using Director), SolverRequest.
     - Outputs: SolverResult artifact (meta + solution payload), persisted to disk for replay.
     - Validation: ensure schema + schemaVersion for SolverRequest/SolverResult.
   - run
     - Inputs: SimConfigArtifact + InitialStateArtifact (+ ExecutionPolicy), optional BudgetReceipt/PriceList refs.
     - Required runtime calls: createRuntime().init({ seed, simConfig }) + step().
     - Outputs: TickFrame list, effects log, optional TelemetryRecord/RunSummary artifacts.
     - Validation: reject missing schema or mismatched schemaVersion; log missing adapters as deferred effects.
   - replay
     - Inputs: stored artifacts (SimConfigArtifact, InitialStateArtifact, ExecutionPolicy, TickFrames, Effect log).
     - Required behavior: re-run deterministically without external IO, using test adapters as needed.
     - Outputs: replay TickFrames and diff summary (match/mismatch by tick + phaseDetail).
   - inspect
     - Inputs: TickFrames and telemetry artifacts (TelemetryRecord/RunSummary).
     - Outputs: summarized report (counts of effects, fulfilled/deferred, budget caps/spend snapshots, phase timings).
     - Validation: tolerant of missing optional artifacts; warn on missing TickFrames.
   - Artifact schemas live in: packages/runtime/src/contracts/artifacts.ts.
3. [complete] Identify stable artifacts and contracts to use as fixtures (from runtime artifacts schemas).
   - Fixture home: tests/fixtures/artifacts/ (JSON files; one artifact per file).
   - Naming: <schema>-v1-<label>.json (e.g., intent-envelope-v1-basic.json).
   - Required base fields for all top-level artifacts:
     - schema + schemaVersion (must be 1), meta.id/runId/createdAt/producedBy.
   - IntentEnvelope, PlanArtifact, BudgetRequest, BudgetReceipt, PriceList:
     - Include minimal valid meta + required fields; BudgetReceipt should reference a BudgetRequest.
     - PriceList should include at least one item with key + unitCost.
   - SimConfigArtifact, InitialStateArtifact, ExecutionPolicy:
     - SimConfig includes planRef + seed + layout + optional constraints.
     - InitialState must reference SimConfig (simConfigRef) and include at least one actor.
     - ExecutionPolicy fixture should cover one deterministic strategy (e.g., round_robin).
   - SolverRequest, SolverResult:
     - SolverRequest includes problem.language + problem.data; optional intent/plan refs.
     - SolverResult references SolverRequest and includes status.
   - Action, Observation, Event, Effect:
     - Action includes actorId + tick + kind; Observation includes view data.
     - Event includes kind + tick; Effect includes fulfillment + kind + data or sourceRef.
   - Snapshot, DebugDump, TickFrame:
     - Snapshot includes tick + minimal view; DebugDump includes warning flag.
     - TickFrame includes meta + tick + phase + acceptedActions + emittedEffects/fulfilledEffects.
   - TelemetryRecord, RunSummary:
     - TelemetryRecord includes scope + data; RunSummary includes outcome + metrics.
   - Artifact schemas live in: packages/runtime/src/contracts/artifacts.ts (source of truth).
4. [complete] Record any gaps in coverage or missing fixtures discovered during the inventory to feed into later steps (include file paths and owners where possible).
   - CLI: no CLI tests exist for argument validation failures or schema mismatch errors (owner: adapters-cli; add tests under tests/adapters-cli).
   - Runtime: no direct tests for applyBudgetCaps, dispatchEffect, solveWithAdapter (owner: runtime; add tests under tests/runtime).
   - Bindings: no tests verifying loadCore error handling for missing/invalid WASM (owner: bindings-ts; add tests under tests/bindings).
   - Adapters-web: no tests for fetch error handling or URL construction in IPFS/blockchain/ollama adapters (owner: adapters-web; add tests under tests/adapters-web).
   - Adapters-cli: no tests for adapter modules (ipfs/blockchain/ollama) or solver-wasm error paths (owner: adapters-cli; add tests under tests/adapters-cli).
   - Adapters-test: no tests for fixture registration/lookup behavior (owner: adapters-test; add tests under tests/adapters-test).
   - Fixtures: no negative fixtures (invalid schemaVersion, missing required fields) for schema validation tests (owner: tests; add under tests/fixtures/artifacts/invalid).

## 2) Testing Foundations
1. [complete] Decide the test runner scope (Node built-in test is current baseline).
   - Use `node --test` for all tests; prefer CJS test files with helper for ESM modules.
   - Keep tests under top-level `tests/` with `*.test.js` naming.
2. [complete] Add a shared test helpers folder for common fixtures (artifacts, core wasm loader).
   - `tests/helpers/esm-runner.js`: run ESM-only modules via a spawned Node process.
   - `tests/helpers/fixtures.js`: helper to load JSON fixtures from tests/fixtures/artifacts.
   - `tests/helpers/core-loader.js`: helper to load core-as WASM from build/core-as.wasm (skip if missing).
3. [complete] Create smoke tests for runtime modules (core-as bindings, runtime runner, ports).
   - Bindings smoke test: verify `loadCore` module exists and handles missing/invalid wasm.
   - Runtime smoke test: verify runtime entrypoints exist and ports can be imported.
   - Runner smoke test: minimal run using core-as wasm (if present) to produce tick frames.

## 3) Core-as / Bindings Tests
1. [complete] Test core init/step/action validation (invalid seed/action outcomes).
   - Core-as: invalid seed (negative or non-finite) emits InitInvalid effect.
   - Core-as: invalid action kind/value emits ActionRejected effect.
   - Bindings: surface effects via getEffectCount/getEffectKind/getEffectValue.
2. [complete] Test budget ledger behavior (limit reached/violated).
   - Core-as: set budget cap via setBudget; spend until cap reached emits LimitReached.
   - Core-as: spending beyond cap emits LimitViolated.
   - Runtime: applyBudgetCaps uses SimConfig constraints to seed caps.
3. [complete] Verify effect queue and tick frame recording via runtime.
   - Runtime runner: init records phaseDetail \"init\" frame with emitted effects.
   - Runtime runner: step emits observe/collect/apply/emit TickFrames in order.
   - Runtime runner: fulfilledEffects log includes effect + status + result fields.

## 4) Runtime Tests
1. [complete] TickFrame emission: phaseDetail ordering and fulfillment outcomes.
   - Expect TickFrames recorded in order: init, observe, collect, apply, emit.
   - Verify emittedEffects and fulfilledEffects are present on init/emit frames.
   - When logger adapter is missing, fulfilledEffects records status=deferred + reason=missing_logger.
2. [complete] Budget cap application from SimConfig constraints.
   - Provide SimConfigArtifact with constraints.categoryCaps.caps values.
   - Verify core budget cap is applied before first step (limit reached when spend hits cap).
   - Validate runtime uses applyBudgetCaps and does not mutate caps directly.
3. [complete] need_external_fact policy enforcement (sourceRef vs deferred).
   - Emit a need_external_fact effect with sourceRef and assert deterministic fulfillment allowed.
   - Emit a need_external_fact effect without sourceRef and assert status=deferred.
   - Record both paths in TickFrame.fulfilledEffects for replay.

## 5) Adapter MVP Examples (CLI + External Adapters)
1. [complete] `solve` MVP: accept a scenario input and emit SolverRequest/SolverResult artifacts.
   - CLI: `packages/adapters-cli/src/cli/ak.mjs solve`
   - Inputs: `--scenario`/`--scenario-file` or `--plan`/`--intent` artifacts.
   - Outputs: `solver-request.json`, `solver-result.json` in artifacts folder.
2. [complete] `run` MVP: execute a minimal run, output TickFrames and events.
   - CLI: `packages/adapters-cli/src/cli/ak.mjs run`
   - Inputs: `--sim-config`, `--initial-state`, optional `--execution-policy`.
   - Outputs: `tick-frames.json`, `effects-log.json`, `run-summary.json`.
3. [complete] `replay` MVP: re-run from stored artifacts without external IO.
   - CLI: `packages/adapters-cli/src/cli/ak.mjs replay`
   - Inputs: `--sim-config`, `--initial-state`, `--tick-frames`, optional `--execution-policy`.
   - Outputs: `replay-summary.json`, `replay-tick-frames.json`.
4. [complete] `inspect` MVP: summarize key telemetry outputs.
   - CLI: `packages/adapters-cli/src/cli/ak.mjs inspect`
   - Inputs: `--tick-frames`, optional `--effects-log`.
   - Outputs: `inspect-summary.json` (TelemetryRecord schema).
5. [complete] IPFS adapter MVP (web + CLI): fetch price lists/artifacts by CID.
   - Web: `packages/adapters-web/src/adapters/ipfs/index.js`
   - CLI: `packages/adapters-cli/src/adapters/ipfs/index.js`
   - Expected usage: fetch `tests/fixtures/artifacts/price-list-v1-basic.json` by CID in a demo.
6. [complete] Blockchain adapter MVP (web + CLI): fetch balances via JSON-RPC.
   - Web: `packages/adapters-web/src/adapters/blockchain/index.js`
   - CLI: `packages/adapters-cli/src/adapters/blockchain/index.js`
   - Expected usage: fetch a fixed balance (fixture via adapters-test) for a known address.
7. [complete] Ollama adapter MVP (web + CLI): request strategy or content prompts.
   - Web: `packages/adapters-web/src/adapters/ollama/index.js`
   - CLI: `packages/adapters-cli/src/adapters/ollama/index.js`
   - Expected usage: prompt with a small plan summary and capture response JSON for replay.

## 6) Adapter Tests
1. [complete] CLI argument parsing and validation.
   - Cover missing required args for solve/run/replay/inspect/ipfs/blockchain/ollama.
   - Assert stderr contains clear error message and exit code non-zero.
2. [complete] Artifact serialization round-trip tests.
   - Load fixture JSON, serialize to string, parse back, and deep-equal.
   - Ensure schema + schemaVersion preserved on round-trip.
3. [complete] Deterministic outputs from fixed inputs (golden fixtures).
   - Use tests/fixtures/artifacts to drive adapter commands and compare output JSON.
   - For runtime outputs, validate schema, counts, and stable fields (not timestamps).
4. [complete] Test adapters for IPFS/Blockchain/Ollama using deterministic fixtures.
   - Use adapters-test fixtures to stub fetch or RPC responses.
   - Validate error paths (missing fixture, RPC error, Ollama failure).

## 7) Documentation and Usage
1. [complete] Update `packages/adapters-cli/README.md` with MVP usage examples.
   - Ensure CLI commands listed match `ak.mjs` help output.
   - Include example invocations for solve/run/replay/inspect/ipfs/blockchain/ollama.
2. [complete] Add a minimal “how to run tests” section in root README (if needed).
   - Mention `node --test "tests/**/*.test.js"` and note WASM dependency for core/runtime tests.

## 8) Final Validation
1. [complete] Run test suite locally.
   - `node --test "tests/**/*.test.js"` (skip tests if WASM not built).
2. [complete] Verify MVP CLIs produce expected artifacts and logs.
   - Run `ak.mjs` solve/run/replay/inspect with fixtures and validate outputs.
3. [complete] Ensure no new architectural violations in core-as.
   - Confirm no new IO or imports added under `packages/core-as/assembly`.

---

## Cleanup List
- Keep CLI usage docs aligned with actual CLI flags (`packages/adapters-cli/README.md`).
  - Update examples after any change to `ak.mjs --help` output.
- Prefer shared helpers for fixtures and core loading when adding new tests (`tests/helpers/fixtures.js`, `tests/helpers/core-loader.js`).
  - Avoid duplicating WASM loader logic in new tests.
- Add negative fixtures under `tests/fixtures/artifacts/invalid` whenever schema validation paths are added.
  - Create at least one missing-required-field and one bad-schemaVersion fixture per schema.
- Expand smoke tests into behavior tests as adapters gain real IO wiring (web/cli/test).
  - Validate output payloads, not just file existence.
- Update tests when schema versions change; bump fixtures in `tests/fixtures/artifacts`.
  - Keep old fixtures only if backwards-compat coverage is required.
- Ensure runner smoke tests skip when WASM build is missing to keep CI green.
  - Use the same guard pattern as `tests/runtime/runner-smoke.test.js`.
- Consider documenting `effectFactory` in Moderator runner docs if it becomes part of the public runtime surface.
  - Add a short rationale and expected shape if it remains supported.
- Reuse `effectFactory` in other runtime tests that need custom effect shapes (need_external_fact, deferred effects).
  - Avoid patching runtime internals in tests; use factory overrides instead.
- Add CLI tests for `ipfs`/`blockchain`/`ollama` commands using fixture-based fetch stubs (avoid network).
  - Reuse `tests/fixtures/adapters/*` as the payload sources.
- Add a small README for `tests/fixtures/adapters` describing each fixture payload and intended tests.
  - Mirror `tests/fixtures/artifacts/README.md` structure.
- Add schema-validation tests that consume invalid fixtures from `tests/fixtures/artifacts/invalid` (not just round-trip).
  - Assert explicit error messages on schema/version mismatches.
- Consider a lightweight core-as import guard test (no external imports under `packages/core-as/assembly`).
  - Use `rg --pcre2` to detect non-relative imports.

---

## Runnable Interfaces Checklist (CLI + Web UI)
1. Ensure dependencies and WASM build are available.
   - Install deps: `npm install` or `pnpm install`.
   - Build/copy WASM: `npm run build:wasm` (produces `build/core-as.wasm` and `packages/ui-web/assets/core-as.wasm`).
2. CLI MVP (solve/run/replay/inspect) with fixtures.
   - `node packages/adapters-cli/src/cli/ak.mjs solve --plan tests/fixtures/artifacts/plan-artifact-v1-basic.json --out-dir artifacts/solve`
   - `node packages/adapters-cli/src/cli/ak.mjs run --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-basic.json --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-basic.json --ticks 1 --wasm build/core-as.wasm --out-dir artifacts/run`
   - `node packages/adapters-cli/src/cli/ak.mjs replay --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-basic.json --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-basic.json --tick-frames artifacts/run/tick-frames.json --wasm build/core-as.wasm --out-dir artifacts/replay`
   - `node packages/adapters-cli/src/cli/ak.mjs inspect --tick-frames artifacts/run/tick-frames.json --effects-log artifacts/run/effects-log.json --out-dir artifacts/inspect`
3. CLI adapter demos with test data (no network).
   - IPFS: `node packages/adapters-cli/src/cli/ak.mjs ipfs --cid bafy... --json --fixture tests/fixtures/adapters/ipfs-price-list.json --out-dir artifacts/ipfs`
   - Blockchain: `node packages/adapters-cli/src/cli/ak.mjs blockchain --rpc-url http://local --address 0xabc --fixture-chain-id tests/fixtures/adapters/blockchain-chain-id.json --fixture-balance tests/fixtures/adapters/blockchain-balance.json --out-dir artifacts/blockchain`
   - Ollama: `node packages/adapters-cli/src/cli/ak.mjs ollama --model fixture --prompt \"hello\" --fixture tests/fixtures/adapters/ollama-generate.json --out-dir artifacts/ollama`
4. Web UI (local run with test data).
   - Serve repo root with a static server (examples: `python3 -m http.server 8000` or `npx serve .`).
   - Open `http://localhost:8000/packages/ui-web/index.html` and verify counter/port effects update.
