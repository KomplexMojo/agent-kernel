#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${1:-}"
OUT_DIR="${2:-}"

if [[ -z "$RUN_DIR" ]]; then
  echo "usage: $0 <run-dir> [out-dir]"
  exit 1
fi

SIM_CONFIG="$RUN_DIR/resolved-sim-config.json"
INITIAL_STATE="$RUN_DIR/resolved-initial-state.json"
TICK_FRAMES="$RUN_DIR/tick-frames.json"

if [[ ! -f "$SIM_CONFIG" ]]; then
  SIM_CONFIG="$ROOT/tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"
fi
if [[ ! -f "$INITIAL_STATE" ]]; then
  INITIAL_STATE="$ROOT/tests/fixtures/artifacts/initial-state-artifact-v1-mvp-actor.json"
fi
if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$RUN_DIR/replay"
fi

node "$ROOT/packages/adapters-cli/src/cli/ak.mjs" replay \
  --sim-config "$SIM_CONFIG" \
  --initial-state "$INITIAL_STATE" \
  --tick-frames "$TICK_FRAMES" \
  --out-dir "$OUT_DIR"

echo "replay: wrote $OUT_DIR"
