#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/packages/adapters-cli/src/cli/ak.mjs"
WASM="$ROOT/build/core-as.wasm"
OUT_DIR="${1:-"$ROOT/artifacts/demo-bundle"}"

if [[ ! -f "$WASM" ]]; then
  echo "Missing WASM at $WASM. Run 'pnpm run build:wasm' first." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

SOLVER_FIXTURE="$ROOT/tests/fixtures/artifacts/solver-result-v1-basic.json"
SIM_CONFIG="$ROOT/tests/fixtures/artifacts/sim-config-artifact-v1-basic.json"
INITIAL_STATE="$ROOT/tests/fixtures/artifacts/initial-state-artifact-v1-basic.json"
IPFS_FIXTURE="$ROOT/tests/fixtures/adapters/ipfs-price-list.json"
CHAIN_FIXTURE="$ROOT/tests/fixtures/adapters/blockchain-chain-id.json"
BALANCE_FIXTURE="$ROOT/tests/fixtures/adapters/blockchain-balance.json"
LLM_FIXTURE="$ROOT/tests/fixtures/adapters/ollama-generate.json"

echo "Writing demo artifacts to $OUT_DIR"

node "$CLI" solve --scenario "two actors conflict" --solver-fixture "$SOLVER_FIXTURE" --out-dir "$OUT_DIR/solve"

node "$CLI" run \
  --sim-config "$SIM_CONFIG" \
  --initial-state "$INITIAL_STATE" \
  --ticks 1 \
  --wasm "$WASM" \
  --out-dir "$OUT_DIR/run"

node "$CLI" replay \
  --sim-config "$SIM_CONFIG" \
  --initial-state "$INITIAL_STATE" \
  --tick-frames "$OUT_DIR/run/tick-frames.json" \
  --wasm "$WASM" \
  --out-dir "$OUT_DIR/replay"

node "$CLI" inspect \
  --tick-frames "$OUT_DIR/run/tick-frames.json" \
  --effects-log "$OUT_DIR/run/effects-log.json" \
  --out-dir "$OUT_DIR/inspect"

node "$CLI" ipfs \
  --cid "fixture" \
  --json \
  --fixture "$IPFS_FIXTURE" \
  --out-dir "$OUT_DIR/ipfs"

node "$CLI" blockchain \
  --rpc-url "http://fixture" \
  --address "0xabc" \
  --fixture-chain-id "$CHAIN_FIXTURE" \
  --fixture-balance "$BALANCE_FIXTURE" \
  --out-dir "$OUT_DIR/blockchain"

node "$CLI" ollama \
  --model "fixture" \
  --prompt "hello" \
  --fixture "$LLM_FIXTURE" \
  --out-dir "$OUT_DIR/ollama"

echo "Demo artifacts ready under $OUT_DIR"
