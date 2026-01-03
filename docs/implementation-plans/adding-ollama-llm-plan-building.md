# adding-ollama-llm-plan-building

Goal: Add a UI workflow that prompts Ollama, converts output into a BuildSpec, builds artifacts in agent mode, and loads them for review/run.

## 1) UI Prompt + LLM
1. [pending] Add a UI panel for free-form prompts with Ollama settings (model/base URL).
2. [pending] Add a prompt template + response contract for BuildSpec JSON output.
3. [pending] Validate and surface BuildSpec errors before build.

## 2) Build Orchestration
1. [pending] Provide a UI action to run the CLI build (`ak.mjs build --spec`) or a local bridge that proxies it.
2. [pending] Persist build outputs (`bundle.json`, `manifest.json`, `telemetry.json`) for UI reload.

## 3) UI Review + Run
1. [pending] Load the emitted bundle into the UI and allow edits/round-trip.
2. [pending] Run the simulation from the loaded artifacts with existing UI controls.

## 4) Tests
1. [pending] Add UI tests for prompt → BuildSpec preview.
2. [pending] Add adapter tests for Ollama fixture mode and deterministic outputs.
3. [pending] Add integration test for build → bundle → UI load.

## 5) Docs
1. [pending] Document the prompt → build → review/run workflow and fixture mode.
