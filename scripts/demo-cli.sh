#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/packages/adapters-cli/src/cli/ak.mjs"
OUT_DIR="${1:-"$ROOT/artifacts/demo-bundle"}"

mkdir -p "$OUT_DIR"

SOLVER_FIXTURE="$ROOT/tests/fixtures/artifacts/solver-result-v1-basic.json"
IPFS_FIXTURE="$ROOT/tests/fixtures/adapters/ipfs-price-list.json"
CHAIN_FIXTURE="$ROOT/tests/fixtures/adapters/blockchain-chain-id.json"
BALANCE_FIXTURE="$ROOT/tests/fixtures/adapters/blockchain-balance.json"
LLM_FIXTURE="$ROOT/tests/fixtures/adapters/llm-generate.json"

# Leftover basic stationary fixtures fail runtime.init (invalid JSON state). Write
# Configurator boxed terrain + delver artifacts for the demo run/replay path.
DEMO_ARTIFACTS="$OUT_DIR/artifacts"
mkdir -p "$DEMO_ARTIFACTS"
DEMO_ARTIFACTS="$DEMO_ARTIFACTS" ROOT="$ROOT" node --input-type=module <<'EOF'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { boxedTerrain, buildUnifiedArtifacts } = await import(
  `${process.env.ROOT}/tests/fixtures/personas/unified-actor-runtime.mjs`
);
const width = 3;
const height = 3;
const terrain = boxedTerrain(width, height);
terrain[1 * width + 1] = 'floor';
const { simConfig, initialState } = buildUnifiedArtifacts({
  width,
  height,
  terrain,
  runId: 'run_demo_cli',
  clock: '2025-01-01T00:00:00.000Z',
  producedBy: 'demo-cli',
  actors: [{
    id: 'actor_1',
    category: 'delver',
    position: { x: 1, y: 1 },
    motivations: ['exploring'],
    vitals: { health: { current: 10, max: 10, regen: 0 } },
  }],
});
const dir = process.env.DEMO_ARTIFACTS;
writeFileSync(join(dir, 'sim-config.json'), `${JSON.stringify(simConfig, null, 2)}\n`);
writeFileSync(join(dir, 'initial-state.json'), `${JSON.stringify(initialState, null, 2)}\n`);
EOF
SIM_CONFIG="$DEMO_ARTIFACTS/sim-config.json"
INITIAL_STATE="$DEMO_ARTIFACTS/initial-state.json"

echo "Writing demo artifacts to $OUT_DIR"

node "$CLI" solve --scenario "two actors conflict" --solver-fixture "$SOLVER_FIXTURE" --out-dir "$OUT_DIR/solve"

node "$CLI" run \
  --sim-config "$SIM_CONFIG" \
  --initial-state "$INITIAL_STATE" \
  --ticks 1 \
  --out-dir "$OUT_DIR/run"

node "$CLI" replay \
  --sim-config "$SIM_CONFIG" \
  --initial-state "$INITIAL_STATE" \
  --tick-frames "$OUT_DIR/run/tick-frames.json" \
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

node "$CLI" llm \
  --model "fixture" \
  --prompt "hello" \
  --fixture "$LLM_FIXTURE" \
  --out-dir "$OUT_DIR/llm"

echo "Demo artifacts ready under $OUT_DIR"
