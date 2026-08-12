#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/artifacts/cli_ipfs_fixture}"

node "$ROOT/packages/adapters-cli/src/cli/ak.mjs" ipfs \
  --cid "fixture" \
  --json \
  --fixture "$ROOT/tests/fixtures/adapters/ipfs-price-list.json" \
  --out-dir "$OUT_DIR"

echo "ipfs: wrote $OUT_DIR"
