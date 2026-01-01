#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/artifacts/cli_solve_fixture}"

node "$ROOT/packages/adapters-cli/src/cli/ak.mjs" solve \
  --scenario "two actors conflict" \
  --solver-fixture "$ROOT/tests/fixtures/artifacts/solver-result-v1-basic.json" \
  --out-dir "$OUT_DIR"

echo "solve: wrote $OUT_DIR"
