# adapters-cli — CLI Adapters

`adapters-cli` provides Node-based command-line tools that exercise runtime artifacts and
support deterministic workflows (solve, run, replay, inspect). These CLIs are **adapters**:
they do not contain core simulation logic and they do not mutate `core-as` directly.

This package exists to enable automation, debugging, and batch execution outside the UI.

---

## Scope

CLI adapters:
- Construct runtime artifacts (IntentEnvelope, PlanArtifact, SimConfigArtifact, TickFrame, SolverRequest, etc.).
- Invoke adapter modules and emit artifacts for ports (e.g., solver, telemetry, persistence).
- Produce deterministic logs suitable for replay.

They do **not**:
- Embed simulation rules (those live in `core-as`).
- Replace personas (they act as a driver and record artifacts for downstream personas).

---

## CLI Commands (MVP)

### `solve`
Stage a constrained scenario (e.g., "two actors conflict") and emit a `SolverRequest`
artifact plus a `SolverResult` using a stubbed/fixture-driven solver adapter (no network).

### `run`
Execute a configured simulation run using captured artifacts, emitting TickFrame and
effect logs plus a minimal RunSummary artifact.

### `configurator`
Build `SimConfigArtifact` + `InitialStateArtifact` outputs from deterministic configurator inputs.

### `replay`
Replay a run deterministically from captured inputs and TickFrames without external IO,
producing a replay summary and regenerated TickFrames.

### `inspect`
Summarize or extract telemetry snapshots for debugging and analysis.

### Adapter demo commands
These commands exercise the external adapters directly.

- `ipfs`: fetch text/JSON by CID via an HTTP gateway.
- `blockchain`: fetch chain id and optional balance via JSON-RPC.
- `llm` (alias: `ollama`): request a response from an LLM endpoint (Ollama/OpenAI-compatible HTTP API).

### Local run
```
node packages/adapters-cli/src/cli/ak.mjs <command> [options]
```

Example usage:
```
node packages/adapters-cli/src/cli/ak.mjs solve --scenario "two actors conflict"
node packages/adapters-cli/src/cli/ak.mjs run --sim-config path/to/sim-config.json --initial-state path/to/initial-state.json --ticks 3
node packages/adapters-cli/src/cli/ak.mjs run --sim-config path/to/sim-config.json --initial-state path/to/initial-state.json --actions path/to/action-sequence.json --ticks 0
node packages/adapters-cli/src/cli/ak.mjs configurator --level-gen path/to/level-gen.json --actors path/to/actors.json --out-dir path/to/out
node packages/adapters-cli/src/cli/ak.mjs run --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json --ticks 0 --affinity-presets tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json --affinity-loadouts tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json --affinity-summary
node packages/adapters-cli/src/cli/ak.mjs replay --sim-config path/to/sim-config.json --initial-state path/to/initial-state.json --tick-frames path/to/tick-frames.json
node packages/adapters-cli/src/cli/ak.mjs inspect --tick-frames path/to/tick-frames.json --effects-log path/to/effects-log.json
node packages/adapters-cli/src/cli/ak.mjs ipfs --cid bafy... --json
node packages/adapters-cli/src/cli/ak.mjs blockchain --rpc-url https://rpc.example --address 0xabc
node packages/adapters-cli/src/cli/ak.mjs llm --model llama3 --prompt "Summarize plan"
node packages/adapters-cli/src/cli/ak.mjs solve --scenario "two actors conflict" --solver-fixture tests/fixtures/artifacts/solver-result-v1-basic.json

Fixture-driven usage (no network):
```
node packages/adapters-cli/src/cli/ak.mjs ipfs --cid bafy... --json --fixture tests/fixtures/adapters/ipfs-price-list.json
node packages/adapters-cli/src/cli/ak.mjs blockchain --rpc-url http://local --address 0xabc --fixture-chain-id tests/fixtures/adapters/blockchain-chain-id.json --fixture-balance tests/fixtures/adapters/blockchain-balance.json
node packages/adapters-cli/src/cli/ak.mjs llm --model fixture --prompt "hello" --fixture tests/fixtures/adapters/llm-generate.json
node packages/adapters-cli/src/cli/ak.mjs solve --scenario "two actors conflict" --solver-fixture tests/fixtures/artifacts/solver-result-v1-basic.json
node packages/adapters-cli/src/cli/ak.mjs run --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-configurator-affinity.json --ticks 0
```
Expected outputs (defaults when `--out-dir` is set):
- ipfs: `ipfs.json`
- blockchain: `blockchain.json`
- llm: `llm.json`
- solve: `solver-request.json`, `solver-result.json`
- run: `tick-frames.json`, `effects-log.json`, `run-summary.json`, `action-log.json`
- configurator: `sim-config.json`, `initial-state.json`

---

## Configuration

- IPFS: `--gateway` (default: `https://ipfs.io/ipfs`), `--cid`, optional `--path`.
- Blockchain: `--rpc-url` (required), `--address` (optional for balance).
- LLM (Ollama-style): `--base-url` (default: `http://localhost:11434`), `--model`, `--prompt`.
- Fixture mode: `--fixture`, `--fixture-chain-id`, `--fixture-balance` (no network).
- Run action log: `--actions` path to an ActionSequence artifact (emitted to `action-log.json`).
- Actor overrides (run):
  - `--actor id,x,y,kind` (kind: motivated/ambulatory/stationary)
  - `--vital actorId,vital,current,max,regen`
  - `--vital-default vital,current,max,regen`
  - `--tile-wall x,y`, `--tile-barrier x,y`, `--tile-floor x,y` (repeatable)

When overrides are provided, `run` writes `resolved-sim-config.json` and
`resolved-initial-state.json` to the output directory for inspection.

## Configurator artifacts (affinities + traps)

Configurator artifacts are affinity-only (no martial weapons). Affinity kinds:
fire, water, earth, wind, life, decay, corrode, dark. Expressions: push, pull, emit.

Example `SimConfigArtifact.layout.data` snippet with traps:
```json
{
  "layout": {
    "kind": "grid",
    "data": {
      "tiles": ["#####", "#.S.#", "#..E#", "#...#", "#####"],
      "kinds": [[1,1,1,1,1],[1,0,0,0,1],[1,0,2,0,1],[1,0,0,0,1],[1,1,1,1,1]],
      "traps": [
        { "x": 2, "y": 2, "blocking": false, "affinity": { "kind": "fire", "expression": "push", "stacks": 2 } }
      ]
    }
  }
}
```

Example `InitialStateArtifact.actors[].traits` snippet:
```json
{
  "traits": {
    "affinities": { "fire:push": 2, "life:pull": 1 },
    "abilities": [
      { "id": "fire_bolt", "kind": "attack", "affinityKind": "fire", "expression": "push", "potency": 4, "manaCost": 6 }
    ]
  }
}
```

Defaults: manaCost=0, stacks=1, shape profile=rectangular, edgeBias=false. Required:
preset id, kind, expression, actor id. Deterministic ordering is preserved in artifacts.

Affinity summary output (resolved from presets + loadouts):
- `--affinity-presets` path to `AffinityPresetArtifact`
- `--affinity-loadouts` path to `ActorLoadoutArtifact`
- When both are supplied, `run` writes `affinity-summary.json` to `--out-dir` (default). Use `--affinity-summary` to override the output path.

Example:
```
node packages/adapters-cli/src/cli/ak.mjs run --sim-config tests/fixtures/artifacts/sim-config-artifact-v1-configurator-trap.json --initial-state tests/fixtures/artifacts/initial-state-artifact-v1-affinity-base.json --ticks 0 --affinity-presets tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json --affinity-loadouts tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json --affinity-summary
```
Expected outputs in `--out-dir`:
- `affinity-summary.json`
- `run-summary.json`
- `tick-frames.json`

Configurator command (artifact builder):
- `--level-gen` path to configurator level-gen input
- `--actors` path to an `{ actors: [...] }` payload
- Optional: `--plan`, `--budget-receipt`, `--affinity-presets`, `--affinity-loadouts`

Example:
```
node packages/adapters-cli/src/cli/ak.mjs configurator --level-gen tests/fixtures/configurator/level-gen-input-v1-trap.json --actors tests/fixtures/configurator/actors-v1-affinity-base.json --affinity-presets tests/fixtures/artifacts/affinity-presets-artifact-v1-basic.json --affinity-loadouts tests/fixtures/artifacts/actor-loadouts-artifact-v1-basic.json --out-dir artifacts/configurator_demo
```

## Demo bundle script

Run all fixture-first demos and emit artifacts under `artifacts/demo-bundle` (override path with an argument):
```
pnpm run demo:cli
pnpm run demo:cli -- /tmp/agent-kernel-demo
```

## Effect logs and TickFrames

- `run` and `replay` emit TickFrames and effect logs containing effect ids, requestIds, adapter hints, and fulfillment status.
- `need_external_fact` effects with `sourceRef` are fulfilled deterministically; others are deferred for post-run handling.
- `solver_request` effects carry requestId + targetAdapter; fixture solver adapters respond deterministically when provided.
- `log`/`telemetry` effects include severity/tags/personaRef for UI/CLI inspection.

Inspect the emitted artifacts in your chosen `--out-dir` or `artifacts/demo-bundle` to see these shapes. Examples align with `tests/fixtures/adapters/effects-routing.json`.

## Architectural Intent

CLI tools are **adapters** in the Ports & Adapters model:

- They live outside `core-as` and do not depend on browser APIs.
- They interact with runtime through ports and artifacts.
- They can use native Node capabilities (file system, process control) without changing
  determinism, because inputs/outputs are fully captured as artifacts.

This keeps the core small and deterministic, while providing powerful automation
for development and batch workflows.

---

## Relationship to Runtime and Core

```
cli -> adapters-cli -> core-as (WASM)
```

The CLI layer is a **driver**, not a simulator. For the MVP it loads WASM directly and
implements a minimal runner for deterministic outputs; deeper runtime integration can
follow once the runtime entrypoints are wired for CLI use.
