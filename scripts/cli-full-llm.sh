#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/packages/adapters-cli/src/cli/ak.mjs"
WASM="${WASM:-$ROOT/build/core-as.wasm}"

RUN_ID="${RUN_ID:-run_cli_live_$(date +%Y%m%d_%H%M%S)}"
CREATED_AT="${CREATED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"
TICKS="${TICKS:-3}"
AK_LLM_FORMAT="${AK_LLM_FORMAT:-json}"
export AK_LLM_FORMAT

SCENARIO="${SCENARIO:-$ROOT/tests/fixtures/e2e/e2e-scenario-v1-basic.json}"
MODEL="${MODEL:-${AK_LLM_MODEL:-}}"
BASE_URL="${BASE_URL:-${AK_LLM_BASE_URL:-http://localhost:11434}}"

BASE="$ROOT/artifacts/runs/$RUN_ID"
SIM_CONFIG="$BASE/llm-plan/sim-config.json"
INITIAL_STATE="$BASE/llm-plan/initial-state.json"

if [[ -z "$MODEL" ]]; then
  echo "MODEL is required (set MODEL or AK_LLM_MODEL)." >&2
  exit 1
fi

if [[ ! -f "$WASM" ]]; then
  echo "Missing WASM at $WASM. Run 'pnpm run build:wasm' first." >&2
  exit 1
fi

echo "RUN_ID=$RUN_ID"

AK_LLM_LIVE=1 node "$CLI" llm-plan \
  --scenario "$SCENARIO" \
  --model "$MODEL" \
  --base-url "$BASE_URL" \
  --run-id "$RUN_ID" \
  --created-at "$CREATED_AT"

if [[ ! -f "$SIM_CONFIG" || ! -f "$INITIAL_STATE" ]]; then
  echo "Missing sim-config or initial-state from llm-plan. Check $BASE/llm-plan." >&2
  exit 1
fi

node "$CLI" run \
  --sim-config "$SIM_CONFIG" \
  --initial-state "$INITIAL_STATE" \
  --ticks "$TICKS" \
  --wasm "$WASM" \
  --run-id "$RUN_ID"

node "$CLI" replay \
  --sim-config "$SIM_CONFIG" \
  --initial-state "$INITIAL_STATE" \
  --tick-frames "$BASE/run/tick-frames.json" \
  --wasm "$WASM" \
  --out-dir "$BASE/replay"

node "$CLI" inspect \
  --tick-frames "$BASE/run/tick-frames.json" \
  --effects-log "$BASE/run/effects-log.json" \
  --out-dir "$BASE/inspect"

echo "Artifacts ready under $BASE"
