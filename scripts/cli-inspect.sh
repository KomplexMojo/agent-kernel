#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${1:-}"
OUT_DIR="${2:-}"

if [[ -z "$RUN_DIR" ]]; then
  echo "usage: $0 <run-dir> [out-dir]"
  exit 1
fi

TICK_FRAMES="$RUN_DIR/tick-frames.json"
EFFECTS_LOG="$RUN_DIR/effects-log.json"

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$RUN_DIR/inspect"
fi

ARGS=(--tick-frames "$TICK_FRAMES" --out-dir "$OUT_DIR")
if [[ -f "$EFFECTS_LOG" ]]; then
  ARGS+=(--effects-log "$EFFECTS_LOG")
fi

node "$ROOT/packages/adapters-cli/src/cli/ak.mjs" inspect "${ARGS[@]}"

echo "inspect: wrote $OUT_DIR"
