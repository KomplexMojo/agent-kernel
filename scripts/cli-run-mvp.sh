#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/artifacts/cli_run_mvp}"

node "$ROOT/packages/adapters-cli/src/cli/ak.mjs" run \
  --sim-config "$ROOT/tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json" \
  --initial-state "$ROOT/tests/fixtures/artifacts/initial-state-artifact-v1-mvp-actor.json" \
  --actions "$ROOT/tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json" \
  --ticks 3 \
  --seed 1337 \
  --out-dir "$OUT_DIR"

echo "run: wrote $OUT_DIR"
