# adding-ollama-llm-plan-building

Goal: Add a UI workflow that prompts Ollama, converts output into a BuildSpec, builds artifacts in agent mode, and loads them for review/run.

## 1) UI Prompt + LLM
1. [implemented] Add a UI panel for free-form prompts with Ollama settings (model/base URL).
   - Requirement: Provide a UI surface to enter a free-form prompt and Ollama connection details.
   - Behavior details: Panel collects prompt text, model, base URL; disables live calls unless user opts in; shows loading/error states.
   - Data shape proposal: `{ prompt, model, baseUrl, options? }`; persisted in UI state/local storage.
   - Defaults: Model/baseUrl prefilled with local Ollama defaults; fixture mode toggle defaults to on.
   - Tests: UI test for rendering panel, toggling fixture/live, and state persistence.
   - Determinism: Fixture mode returns deterministic mock responses; live mode opt-in only.
   - Notes: Keep adapter boundary clean; no core logic in UI.
2. [implemented] Add a prompt template + response contract for BuildSpec JSON output.
   - Requirement: Define a prompt template that elicits a BuildSpec JSON response from Ollama.
   - Behavior details: UI builds a structured prompt with instructions + schema snippet; validates JSON parse and schema before build.
   - Data shape proposal: Response contract is `BuildSpec` JSON; errors surfaced with line/field if parse/validation fails.
   - Defaults: Use a compact template referencing key fields (meta/intent/plan/configurator/budget/adapters).
   - Tests: Fixture-based test that parses a canned Ollama response into BuildSpec and passes validation.
   - Determinism: Use fixed fixture responses in tests; no randomness in template generation.
   - Notes: Keep template editable/configurable in code for future tuning.
3. [implemented] Validate and surface BuildSpec errors before build.
   - Requirement: Run BuildSpec validation client-side and block build until valid.
   - Behavior details: On submit, validate schema; show inline errors; allow user to edit the JSON before invoking build.
   - Data shape proposal: Validation result `{ ok, errors[] }` from shared validator.
   - Defaults: Validation runs automatically on response receipt and on manual edits.
   - Tests: UI test with invalid fixture response showing errors and blocking build action.
   - Determinism: Validation errors ordered and stable for replays.
   - Notes: Reuse runtime validator; do not fork schema.

## 2) Build Orchestration
1. [implemented] Provide a UI action to run the CLI build (`ak.mjs build --spec`) or a local bridge that proxies it.
   - Requirement: From the UI, trigger artifact generation via the existing CLI build or a local bridge endpoint.
   - Behavior details: UI sends BuildSpec to a local helper that runs `ak.mjs build --spec`; reports progress/errors; returns paths or bundle.
   - Data shape proposal: Request `{ specPath | specJson, outDir? }`; response `{ bundlePath?, manifestPath?, telemetryPath?, bundle?, manifest?, telemetry? }`.
   - Defaults: Out dir follows `artifacts/runs/<runId>/build`; if a local bridge is unavailable, offer a manual download of spec.json.
   - Tests: Integration-style test with a mock bridge that returns fixture bundle/manifest; assert UI handles success/failure.
   - Determinism: Use fixture BuildSpec + bundle responses in tests; stable out-dir derivation in real runs.
   - Notes: Keep build execution outside the browser; UI only orchestrates.
2. [implemented] Persist build outputs (`bundle.json`, `manifest.json`, `telemetry.json`) for UI reload.
   - Requirement: Store build outputs so the UI can reload/review them without rerunning the build.
   - Behavior details: After build, cache bundle/manifest/telemetry in local storage or file paths; provide a “Load last build” action.
   - Data shape proposal: Persist either in-memory snapshot or references to file paths; include `runId` and `specPath`.
   - Defaults: Auto-load the most recent successful build in the session; do not auto-load failed builds unless user chooses to inspect telemetry.
   - Tests: UI test to save and reload a fixture bundle/manifest/telemetry set.
   - Determinism: Snapshot data should be identical to emitted files; ordering preserved.
   - Notes: Respect adapter boundary—no hidden mutations of artifacts when reloading.

## 3) UI Review + Run
1. [implemented] Load the emitted bundle into the UI and allow edits/round-trip.
   - Requirement: UI can import a `bundle.json`/`manifest.json` set and display/edit the BuildSpec and artifacts.
   - Behavior details: Provide file-picker or auto-load last bundle; show schemas, intent/plan/configurator; allow saving edits back to spec.
   - Data shape proposal: Use existing UI bundle format (spec + artifacts + schemas) and render per-artifact views.
   - Defaults: Preserve unknown fields and schema order; edits apply only to spec unless user opts to edit artifacts.
   - Tests: UI test that loads the existing UI bundle fixture and confirms fields render and round-trip.
   - Determinism: Rendering order stable; re-serialization preserves ordering.
   - Notes: Avoid coupling to CLI specifics beyond manifest/bundle contract.
2. [implemented] Run the simulation from the loaded artifacts with existing UI controls.
   - Requirement: Allow user to run or replay using the loaded SimConfig/InitialState.
   - Behavior details: Hook into existing run controls; ensure paths/refs point to loaded artifacts; block run if required artifacts missing.
   - Data shape proposal: Expect `SimConfigArtifact` + `InitialStateArtifact` from bundle; optional budget receipt/plan refs.
   - Defaults: If bundle missing run inputs, show actionable error; no implicit regeneration.
   - Tests: UI integration test that loads the UI bundle fixture and triggers a no-op/dry-run path (ticks=0) without errors.
   - Determinism: Use fixture-driven run/replay to avoid non-deterministic network/LLM.
   - Notes: Reuse existing UI run pipeline; no new simulation path.

## 4) Tests
1. [implemented] Add UI tests for prompt → BuildSpec preview.
   - Requirement: Ensure prompt entry, fixture response parsing, and validation all work in UI.
   - Behavior details: Simulate entering prompt, receiving fixture response, and showing parsed BuildSpec with no errors.
   - Data shape proposal: Fixture response JSON matching BuildSpec; test asserts parsed fields.
   - Defaults: Use fixture mode; no live calls.
   - Tests: UI test harness with mocked adapter returning canned BuildSpec.
   - Determinism: Fixed fixture responses; stable validation errors.
   - Notes: Keep test scoped to UI parsing/validation (no build invocation).
2. [implemented] Add adapter tests for Ollama fixture mode and deterministic outputs.
   - Requirement: Validate Ollama adapter returns deterministic fixture responses and handles basic error paths.
   - Behavior details: Adapter called with fixturePath returns fixture JSON; missing fixture yields error.
   - Data shape proposal: Fixture shape mirrors existing `tests/fixtures/adapters/llm-generate.json`.
   - Defaults: Fixture mode only; no network.
   - Tests: Node-level adapter test for generate() success/failure with fixtures.
   - Determinism: Deterministic fixture content and ordering.
   - Notes: Keep adapter tests parallel to existing IPFS/blockchain fixture tests.
3. [implemented] Add integration test for build → bundle → UI load.
   - Requirement: End-to-end check that a BuildSpec from Ollama flow can be built and loaded into UI views.
   - Behavior details: Use a fixture BuildSpec, run through build (mocked bridge), then load bundle into UI components.
   - Data shape proposal: Use existing UI bundle fixtures or a new minimal bundle.
   - Defaults: Fixture-only; no live adapter calls.
   - Tests: Integration test across bridge + UI load, asserting key artifact fields render.
   - Determinism: Fixed fixtures and no external IO.
   - Notes: Keep scope minimal to avoid brittle UI timing.

## 5) Docs
1. [implemented] Document the prompt → build → review/run workflow and fixture mode.
   - Requirement: Add a short doc section describing the Ollama prompt flow, build invocation, and UI review/run.
   - Behavior details: Include steps for fixture mode vs live, how to supply model/baseUrl, and where outputs land.
   - Data shape proposal: Reference BuildSpec schema, bundle/manifest schema lists, and CapturedInputArtifact for adapter outputs.
   - Defaults: Recommend fixture mode by default; live mode opt-in.
   - Tests: N/A (docs only).
   - Determinism: Call out deterministic fixtures and sorted outputs for diffability.
   - Notes: Link to CLI README and existing bundle fixtures as examples.
