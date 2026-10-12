#!/usr/bin/env bash
# Per-boot UI server for Cloud Agents.
#
# Idempotent: if :8001 already serves the UI, exit 0. Otherwise stay in the
# foreground so a dead server shows up as a non-zero start status.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use default >/dev/null 2>&1 || true
  NODE_BIN_DIR="$(dirname "$(nvm which default 2>/dev/null || true)")"
  if [ -n "$NODE_BIN_DIR" ] && [ -x "$NODE_BIN_DIR/node" ]; then
    export PATH="$NODE_BIN_DIR:$PATH"
  fi
fi

UI_URL="http://127.0.0.1:8001/packages/ui-web/index_c.html"
if curl -sf -o /dev/null --max-time 2 "$UI_URL"; then
  echo "ui already listening on :8001"
  exit 0
fi

exec pnpm run serve:ui
