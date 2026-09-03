#!/usr/bin/env bash
# Cloud Agent install script for agent-kernel.
#
# Idempotent repository bootstrap: it selects a Node runtime with native
# TypeScript support and installs workspace dependencies. Safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Node runtime: the repo imports `.ts` modules directly under Node (see the
# README quick start and `packages/adapters-cli/src/cli/ak.mjs`), which relies
# on native TypeScript type stripping. That is on by default only in Node
# >= 22.18 / >= 23.6. Older runtimes fail with ERR_UNKNOWN_FILE_EXTENSION.
#
# This base image already ships such a runtime via nvm; make it the default and
# put it ahead of any older `node` shim on PATH for interactive agent shells.
# ---------------------------------------------------------------------------
MIN_MAJOR=22
MIN_MINOR=18

version_ok() {
  # $1 = version like v22.22.2 (or 22.22.2). Returns 0 when >= MIN_MAJOR.MIN_MINOR.
  local v="${1#v}"
  local major="${v%%.*}"
  local rest="${v#*.}"
  local minor="${rest%%.*}"
  [ -z "$major" ] && return 1
  if [ "$major" -gt "$MIN_MAJOR" ]; then return 0; fi
  if [ "$major" -eq "$MIN_MAJOR" ] && [ "$minor" -ge "$MIN_MINOR" ]; then return 0; fi
  return 1
}

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
NODE_BIN_DIR=""
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"

  # Prefer an already-installed runtime that satisfies the minimum; only reach
  # out to the network if none is present.
  if ! version_ok "$(nvm version default 2>/dev/null)"; then
    if version_ok "$(nvm version 22 2>/dev/null)"; then
      nvm alias default 22 >/dev/null 2>&1 || true
    else
      nvm install 22 >/dev/null 2>&1 || true
      nvm alias default 22 >/dev/null 2>&1 || true
    fi
  fi

  nvm use default >/dev/null 2>&1 || true
  NODE_BIN_DIR="$(dirname "$(nvm which default 2>/dev/null || command -v node)")"
fi

if [ -z "$NODE_BIN_DIR" ]; then
  NODE_BIN_DIR="$(dirname "$(command -v node)")"
fi

# Persist the runtime choice for future interactive shells (idempotent).
MARKER="# agent-kernel: prefer Node with native TypeScript support"
if [ -n "$NODE_BIN_DIR" ] && ! grep -qF "$MARKER" "$HOME/.bashrc" 2>/dev/null; then
  {
    echo ""
    echo "$MARKER"
    echo "export PATH=\"$NODE_BIN_DIR:\$PATH\""
  } >> "$HOME/.bashrc"
fi
export PATH="$NODE_BIN_DIR:$PATH"

# Pin pnpm to the version the lockfile (v9.0) and maintainer use. Corepack
# otherwise defaults to the latest pnpm, whose differing store layout triggers a
# node_modules purge that aborts in the no-TTY cloud shell.
PNPM_VERSION="10.33.3"
corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null 2>&1 || true

echo "Using node $(node --version) from $NODE_BIN_DIR"
echo "Using pnpm $(pnpm --version)"

# CI=true keeps pnpm non-interactive (no confirmation prompts) in the cloud shell.
CI=true pnpm install --frozen-lockfile

echo "agent-kernel install complete."
