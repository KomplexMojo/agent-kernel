# Human Interfaces Quickstart (CLI + Web UI)

Offline-first steps to exercise the CLI demos and web UI using fixtures.

## 1) Build WASM (required for CLI run/replay and UI)
```
pnpm run build:wasm
```
Outputs:
- `build/core-as.wasm`
- `packages/ui-web/assets/core-as.wasm` (copied for the browser)

## 2) Validate WASM presence (optional fast-fail)
```
pnpm run test:wasm-check
```
Skips if WASM hasn’t been built; otherwise asserts both copies exist.

## 3) Run CLI demos (fixture-first, no network)
```
# Solve with fixture solver result
node packages/adapters-cli/src/cli/ak.mjs solve --scenario "two actors conflict" --solver-fixture tests/fixtures/artifacts/solver-result-v1-basic.json

# Adapter demos (fixture)
node packages/adapters-cli/src/cli/ak.mjs ipfs --cid bafy... --json --fixture tests/fixtures/adapters/ipfs-price-list.json
node packages/adapters-cli/src/cli/ak.mjs blockchain --rpc-url http://local --address 0xabc --fixture-chain-id tests/fixtures/adapters/blockchain-chain-id.json --fixture-balance tests/fixtures/adapters/blockchain-balance.json
node packages/adapters-cli/src/cli/ak.mjs llm --model fixture --prompt "hello" --fixture tests/fixtures/adapters/llm-generate.json
```
Bundle all demos at once:
```
pnpm run demo:cli
# writes to artifacts/demo-bundle (override with: pnpm run demo:cli -- /path/to/out)
```
See `packages/adapters-cli/README.md` for full help/flags; it mirrors `ak.mjs --help`.

### New persona-visible effects (fixtures)
- CLI run/replay records TickFrames and effect logs with effect ids, requestIds, targetAdapter hints, and fulfillment status.
- `need_external_fact` effects with `sourceRef` are fulfilled deterministically; without a `sourceRef` they are marked deferred.
- `solver_request` effects include requestId, adapter hints, and payloads; fixture solver adapters respond deterministically.
- `log`/`telemetry` effects capture severity/tags/personaRef for UI timelines/inspectors.
Inspect the emitted `artifacts/demo-bundle/*` JSON to see these in UI/CLI demos.

## 4) Serve the web UI (fixture-backed by default)
```
pnpm run serve:ui
# open http://localhost:8001/packages/ui-web/index.html
```
The UI uses persona tabs with Runtime as the default playback view and playback controls. Use Configurator for the run builder, Annotator for affinity/trap summaries, and Orchestrator for the adapter playground (fixture-backed by default).
