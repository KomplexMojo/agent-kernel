# CLI Runbook

This document explains how to run the CLI tools end-to-end and how to use them
from agents to produce deterministic outcomes.

Entry point:
```
node packages/adapters-cli/src/cli/ak.mjs <command> [options]
```

For full flag details, run `node packages/adapters-cli/src/cli/ak.mjs --help`
or read `packages/adapters-cli/README.md`.

## Prerequisites

- Node-based CLI runs directly from the repo.
- Build WASM only when you need `run` or `replay`:
```
pnpm run build:wasm
```
This produces `build/core-as.wasm` (default `--wasm` path).

## Determinism and network safety

- Fixture-first: use `--fixture` flags to keep runs deterministic and offline.
- `AK_ALLOW_NETWORK=1` enables non-local HTTP access for adapter calls. Local
  endpoints (localhost/127.0.0.1/::1) are always allowed.
- `AK_LLM_LIVE=1` enables live LLM guidance for `llm-plan`. When off, `llm-plan`
  uses the scenario `summaryPath` fixture instead.
- `AK_LLM_STRICT=1` disables LLM response repair/sanitization (strict contract
  parsing; errors are captured).
- `AK_LLM_CAPTURE_PATH` appends live prompt/response captures to a JSONL file.
- `AK_LLM_MODEL` and `AK_LLM_BASE_URL` provide defaults for LLM calls.
- `AK_LLM_FORMAT=json` requests JSON-only responses from Ollama-compatible endpoints.

## Output locations (defaults)

- Run-scoped outputs land in `artifacts/runs/<runId>/<command>`.
- `build` uses `spec.meta.runId` for the run folder; `llm-plan` uses `--run-id`.
- Commands without `--run-id` use an auto-generated run id.
- Shared outputs (like schema catalogs) should live under `artifacts/shared/<theme>`.
- Use `--out-dir` to override any default.
- Migration note: older defaults used `artifacts/build_<runId>` and `artifacts/<command>_<timestamp>`.

## Command map

Build and planning:
- `build`: build artifacts from a BuildSpec JSON.
- `llm-plan`: prompt an LLM (fixture or live) to generate a summary and build
  outputs, plus a captured input artifact for replay.
- `schemas`: emit the schema catalog (for UI or agent validation).

Runtime and inspection:
- `solve`: emit solver request/result artifacts for a scenario (fixture solver).
- `configurator`: build `SimConfigArtifact` + `InitialStateArtifact` from
  configurator inputs (optionally budget-aware).
- `budget`: read/emit budget artifacts and receipts for quick validation.
- `run`: execute a simulation run (requires WASM).
- `replay`: replay from captured TickFrames (requires WASM).
- `inspect`: summarize TickFrames/effects for diagnostics.

Adapter demos (direct IO, fixture-first):
- `ipfs`: fetch JSON/text by CID.
- `blockchain`: fetch chain id and balance by JSON-RPC.
- `llm` (alias `ollama`): request a raw LLM response (Ollama/OpenAI-compatible).

## Typical agent workflows

### 1) Agent-authored BuildSpec -> build outputs
Use this when the agent already knows the structure.
```
node packages/adapters-cli/src/cli/ak.mjs build \
  --spec tests/fixtures/artifacts/build-spec-v1-basic.json \
  --out-dir artifacts/runs/run_build_demo/build
```
Outputs include `spec.json`, `intent.json`, `plan.json`, optional budget artifacts,
`sim-config.json`, `initial-state.json`, plus `bundle.json`/`manifest.json`.

### 2) LLM-guided plan -> build outputs (fixture or live)
Scenario-driven (uses catalog + summary fixtures):
```
node packages/adapters-cli/src/cli/ak.mjs llm-plan \
  --scenario tests/fixtures/e2e/e2e-scenario-v1-basic.json \
  --model fixture \
  --fixture tests/fixtures/adapters/llm-generate-summary.json \
  --run-id run_llm_plan_fixture \
  --created-at 2025-01-01T00:00:00Z \
  --out-dir artifacts/runs/run_llm_plan_fixture/llm-plan
```
Prompt-only (no scenario; requires `--catalog`):
```
node packages/adapters-cli/src/cli/ak.mjs llm-plan \
  --prompt "Plan a small fire dungeon." \
  --catalog tests/fixtures/pool/catalog-basic.json \
  --model fixture \
  --goal "Prompt-only goal" \
  --budget-tokens 800 \
  --fixture tests/fixtures/adapters/llm-generate-summary.json \
  --run-id run_llm_plan_prompt \
  --created-at 2025-01-01T00:00:00Z \
  --out-dir artifacts/runs/run_llm_plan_prompt/llm-plan
```
Outputs include `captured-input-llm-1.json` plus the normal build bundle.

### 3) Build outputs -> run/replay
Use `run` to produce TickFrames/effects; use `replay` to re-run deterministically.
```
node packages/adapters-cli/src/cli/ak.mjs run \
  --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-basic.json \
  --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-basic.json \
  --ticks 3 \
  --run-id run_demo
```
Note: `run` uses `--run-id` for the default out dir (`artifacts/runs/<runId>/run`), but
`replay` and `inspect` need explicit `--out-dir` if you want them grouped under the same run.
```
node packages/adapters-cli/src/cli/ak.mjs replay \
  --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-basic.json \
  --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-basic.json \
  --tick-frames artifacts/runs/run_demo/run/tick-frames.json \
  --out-dir artifacts/runs/run_demo/replay
```

### 4) Agent validation and inspection
```
node packages/adapters-cli/src/cli/ak.mjs schemas --out-dir artifacts/shared/schemas
node packages/adapters-cli/src/cli/ak.mjs inspect \
  --tick-frames artifacts/runs/run_demo/run/tick-frames.json \
  --effects-log artifacts/runs/run_demo/run/effects-log.json \
  --out-dir artifacts/runs/run_demo/inspect
```

## Notes for agent-driven automation

- Prefer `build` with a validated BuildSpec for predictable outcomes.
- Use `llm-plan` only when you want live/fixture LLM guidance; capture artifacts
  are emitted for replay and auditing.
- Capture outputs are stable when you pin `--run-id`, `--created-at`, and use
  fixtures. For live calls, persist the captured input artifact for replay.
- The schema catalog (`schemas.json`) is the source of truth for contract names
  and schema versions used across CLI, UI, and agent runs.
