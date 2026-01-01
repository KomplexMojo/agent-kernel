#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/artifacts/cli_llm_fixture}"

node "$ROOT/packages/adapters-cli/src/cli/ak.mjs" llm \
  --model "fixture" \
  --prompt "hello from fixture" \
  --fixture "$ROOT/tests/fixtures/adapters/llm-generate.json" \
  --out-dir "$OUT_DIR"

echo "llm: wrote $OUT_DIR"
