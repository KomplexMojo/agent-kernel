# Live LLM Orchestrator Pipeline (Productization)

Goal: promote the live LLM flow from env-gated tests to a first-class Orchestrator pipeline, run runtime loading against WASM (not stub), and support a strict mode that fails on contract drift (no sanitization).

Constraints:
- Ports & Adapters only; `core-as` is accessed via IO adapters.
- Prompt/response capture must be deterministic and replayable via `CapturedInputArtifact`.
- Keep diffs small and reviewable.
- Captured inputs are canonical in manifest/bundle; `IntentEnvelope.context.capturedInputs` is optional traceability.

## 0) Orchestrator LLM pipeline (runtime)
1. [complete] Add an Orchestrator LLM session module.
   - Requirement: Orchestrator can request an LLM response, capture prompt/response as a `CapturedInputArtifact`, and return normalized summary + capture metadata (first-class pipeline, not test-only).
   - Work: Add `packages/runtime/src/personas/orchestrator/llm-session.js` that composes `buildMenuPrompt`, `capturePromptResponse`, and `buildLlmCaptureArtifact` while respecting Ports & Adapters (adapter injected, no direct network code in runtime).
   - Work: Define a small session API (e.g., `runLlmSession({ model, baseUrl, prompt, adapter, strict, clock, runId, meta, options })`) that:
     - builds the prompt (or accepts a prebuilt prompt) and calls the injected adapter for IO,
     - parses/normalizes the response, and
     - returns `{ summary, capture, responseText, responseParsed, errors }` for downstream BuildSpec assembly.
   - Work: Add strict vs resilient handling in the session module (strict mode disables repair/sanitization; resilient mode can reuse current repair/sanitize logic from the live test).
   - Tests: Fixture-based unit tests for session flow with a fixture adapter (no network) covering success, invalid JSON, and strict vs resilient behavior; use deterministic clocks and runIds.
   - Determinism: capture must include prompt, raw response, parsed response, errors, and runId/meta; require caller-provided `runId` + `clock` to avoid Date.now drift.

2. [complete] Thread the Orchestrator LLM session into build outputs.
   - Requirement: Orchestrated outputs expose captured LLM artifacts in bundle/manifest for replay.
   - Work: Extend build output assembly to include `capturedInputs` in bundle/manifest; optionally attach refs to `IntentEnvelope.context.capturedInputs` for traceability.
   - Work: Wire the LLM session output into `orchestrateBuild({ capturedInputs })` so the build result includes capture artifacts alongside intent/plan/configurator outputs.
   - Work: Ensure manifest/bundle schema catalogs include `CapturedInputArtifact` when present (no special casing; reuse existing schema filtering).
   - Work: Keep capture artifacts ordered deterministically with other artifacts (schema + id ordering) to preserve stable diffs.
   - Work: If `IntentEnvelope.context.capturedInputs` is used, only add refs (no inline payloads) and keep it optional.
   - Tests: Update `tests/runtime/e2e-build-artifacts.test.js` to assert capture artifacts are present.
   - Tests: Add a fixture capture in the build pipeline test (or a small helper) and assert:
     - bundle artifacts include the `CapturedInputArtifact`,
     - manifest entries include the capture path,
     - schema catalog includes `agent-kernel/CapturedInputArtifact`.

## 1) CLI integration (first-class flow)
1. [complete] Add a CLI entrypoint to run the LLM session and build artifacts.
   - Requirement: `ak.mjs` can run a live or fixture-driven LLM prompt and produce BuildSpec + build outputs.
   - Work: Add a command (e.g., `llm-plan`) that accepts `--model`, `--base-url`, `--prompt`/`--scenario`, and writes captured inputs + build outputs.
   - Work: Reuse the runtime `runLlmSession` (adapter injected) and the Director BuildSpec assembly to keep the CLI thin and deterministic.
   - Work: Inputs:
     - `--scenario` points to an e2e scenario fixture (goal + budget + catalog paths).
     - `--prompt` bypasses scenario and uses the raw prompt as-is.
     - `--fixture` supplies the LLM response payload for deterministic runs.
   - Work: Outputs:
     - Build output directory with `spec.json`, `intent.json`, `plan.json`, `sim-config.json`, `initial-state.json` (when applicable),
       plus `captured-input-llm-1.json`, `bundle.json`, `manifest.json`, and `telemetry.json`.
     - Optional `--out-dir` to override the default `artifacts/runs/<runId>/llm-plan` location.
   - Tests: CLI fixture test that validates generated artifacts, including the capture.
   - Tests: Use fixture response JSON to assert the capture payload includes `prompt`, `responseRaw`, `responseParsed`, and `summary`.
   - Tests: Confirm manifest/bundle include `CapturedInputArtifact` and schema catalog includes the capture schema.
   - Determinism: fixture mode required unless `AK_ALLOW_NETWORK=1`; localhost access is allowed even when `AK_ALLOW_NETWORK` is off.
   - Gating: `AK_LLM_LIVE=1` controls whether the LLM is queried for guidance; when off, fall back to non-LLM flow.

## 2) WASM runtime load path
1. [complete] Replace stub core in live LLM integration test with WASM core.
   - Requirement: end-to-end live LLM test loads runtime against the real WASM exports.
   - Work: use `tests/helpers/core-loader.js` (or a new helper) to load WASM in `tests/integration/e2e-llm-live-runtime.test.js` under `AK_LLM_USE_WASM=1`.
   - Work: Keep the stub core as the default path; only switch to WASM when the env flag is set and the WASM file exists.
   - Work: Add a helper that resolves the WASM path (default `build/core-as.wasm`) and throws a clear error when missing.
   - Work: Ensure the WASM core API shape matches the stub (configureGrid/setTileAt/spawnActorAt/setActorVital).
   - Tests: CI-safe default remains stub; WASM path is env-gated.
   - Tests: Add a small assertion that the WASM path was used when `AK_LLM_USE_WASM=1` (e.g., via a diagnostic or a flag).

## 3) Strict vs resilient parsing
1. [complete] Add a strict mode that disables sanitization/repair.
   - Requirement: In strict mode, any contract errors fail the flow and are recorded in the capture artifact.
   - Work: Add `AK_LLM_STRICT=1` handling in the live test + session module; keep current sanitization as default.
   - Work: Surface strict mode in the CLI `llm-plan` path (env or flag) so fixture-driven tests can exercise both modes.
   - Work: Ensure strict mode still writes a capture artifact with `errors` populated even when the flow fails.
   - Tests: Add a fixture case that fails in strict mode and passes in resilient mode.
   - Tests: Use a fixture response with swapped affinity/expression (or invalid tokenHint) to verify:
     - strict mode returns errors and no summary,
     - resilient mode sanitizes and produces a valid summary.

## 4) Documentation
1. [complete] Document the Orchestrator LLM pipeline and CLI usage.
   - Requirement: Add usage and env flags (`AK_LLM_LIVE`, `AK_LLM_MODEL`, `AK_LLM_BASE_URL`, `AK_LLM_CAPTURE_PATH`, `AK_LLM_STRICT`, `AK_LLM_USE_WASM`) in `packages/adapters-cli/README.md` or `docs/README.md`.
   - Determinism: emphasize fixture mode for replayable runs.
   - Work: Document `llm-plan` CLI flow (inputs/outputs, fixture-first defaults, local vs network gating).
   - Work: Clarify strict vs resilient behavior and how to opt in via `AK_LLM_STRICT=1`.
   - Work: Call out that `AK_ALLOW_NETWORK` gates non-local internet access; localhost LLM endpoints are allowed.
   - Work: Mention `AK_LLM_USE_WASM=1` enables WASM in the live integration test.
   - Tests: N/A (documentation only).

## 5) Additional steps (gap scan)
1. [complete] Support prompt-only `llm-plan` runs without a scenario.
   - Requirement: `--prompt` should bypass scenario while still providing catalog + budget context for deterministic mapping.
   - Work: Add `--catalog` (required when `--prompt` is used) and optional `--goal`/`--budget-tokens` flags; make `--scenario` optional in this mode.
   - Work: Use `--goal` (or a default goal) for BuildSpec intent when no scenario is present; ensure `budgetTokens` is injected into the prompt when supplied.
   - Work: Require `--model` and `--prompt` when `--scenario` is omitted; error if both `--scenario` and `--catalog` are missing.
   - Tests: Add a prompt-only CLI fixture test that validates BuildSpec + captured input output, including intent goal and budgetTokens.

2. [complete] Apply localhost exception to build-time LLM capture gating.
   - Requirement: `AK_ALLOW_NETWORK` should not block local LLM endpoints for `spec.adapters.capture[]`.
   - Work: Reuse the `isLocalBaseUrl` check in `captureAdapterPayload` for the LLM adapter; keep non-local gating unchanged.
   - Work: Treat `request.baseUrl` and `request.base_url` as local when host is `localhost`, `127.0.0.1`, or `::1`.
   - Tests: Add a CLI build test that uses a local base URL + fixture to confirm no gating error.
   - Tests: Add a negative CLI build test that uses a non-local base URL without `AK_ALLOW_NETWORK=1` to confirm gating still fails.

3. [complete] Refactor the live LLM integration test to use `runLlmSession`.
   - Requirement: keep strict/resilient behavior consistent with the session module and CLI.
   - Work: Replace inline repair/sanitize logic in `tests/integration/e2e-llm-live-runtime.test.js` with a `repairPromptBuilder` passed to `runLlmSession`.
   - Work: Reuse the test’s existing repair prompt text inside the builder so the behavior stays the same, but centralize parsing/sanitization in the session module.
   - Work: Pass `strict: AK_LLM_STRICT=1` through to the session to disable repair/sanitization.
   - Tests: Ensure live test still captures prompt/response artifacts via `buildLlmCaptureArtifact` or the session result.

4. [complete] Add a non-live `llm-plan` fallback test.
   - Requirement: when `AK_LLM_LIVE=0`, the CLI should use `scenario.summaryPath` and still emit deterministic build outputs.
   - Tests: Add a fixture-based CLI test that runs with `AK_LLM_LIVE=0` and asserts spec/intent/plan outputs.
   - Tests: Confirm no capture artifact is emitted when LLM is disabled and no prompt is provided.

5. [complete] Re-organize CLI artifact output folders by theme and runId.
   - Requirement: generic, reusable artifacts live in themed folders; run-specific outputs are grouped under a stable `runId` path.
   - Work: Define a canonical artifacts layout (e.g., `artifacts/shared/<theme>/...` for catalogs/fixtures and `artifacts/runs/<runId>/<command>/...` for outputs) and document it.
   - Work: Update CLI default output directory logic (`defaultOutDir`, `defaultBuildOutDir`, `defaultLlmPlanOutDir`) to follow the new layout while honoring `--out-dir`.
   - Work: Ensure manifest/bundle paths reflect the new folder structure without changing artifact schemas.
   - Work: Add a migration note and update CLI docs (`docs/cli-runbook.md`, `packages/adapters-cli/README.md`) with the new defaults.
   - Tests: Update CLI tests that assert output paths to use the new directory layout.
