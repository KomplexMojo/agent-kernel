#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/artifacts/cli_blockchain_fixture}"

node "$ROOT/packages/adapters-cli/src/cli/ak.mjs" blockchain \
  --rpc-url "http://fixture.invalid" \
  --address "0x0000000000000000000000000000000000000000" \
  --fixture-chain-id "$ROOT/tests/fixtures/adapters/blockchain-chain-id.json" \
  --fixture-balance "$ROOT/tests/fixtures/adapters/blockchain-balance.json" \
  --out-dir "$OUT_DIR"

echo "blockchain: wrote $OUT_DIR"
