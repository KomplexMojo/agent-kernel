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
node packages/adapters-cli/src/cli/ak.mjs ollama --model fixture --prompt "hello" --fixture tests/fixtures/adapters/ollama-generate.json
```
See `packages/adapters-cli/README.md` for full help/flags; it mirrors `ak.mjs --help`.

## 4) Serve the web UI (fixture-backed by default)
```
pnpm run serve:ui
# open http://localhost:8001/packages/ui-web/index.html
```
The UI should load the counter/effect log and (after implementation) an adapter playground panel that uses fixture payloads by default.
