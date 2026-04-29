#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/config/llm-host.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

REMOTE_PACKAGE_DIR="${LLM_REMOTE_PACKAGE_DIR:-/home/darren/remote-ollama-control}"
REMOTE_SCRIPTS_DIR="${LLM_REMOTE_SCRIPTS_DIR:-/home/darren/bin}"

mkdir -p "$REMOTE_PACKAGE_DIR" "$REMOTE_SCRIPTS_DIR"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude 'results/*' \
    --exclude 'config/llm-host.env' \
    "$ROOT_DIR/" "$REMOTE_PACKAGE_DIR/"
else
  tar -C "$ROOT_DIR" \
    --exclude './results/*' \
    --exclude './config/llm-host.env' \
    -czf - . \
    | tar -C "$REMOTE_PACKAGE_DIR" -xzf -
fi

chmod +x "$REMOTE_PACKAGE_DIR/bin/remote-ollama-profile" \
         "$REMOTE_PACKAGE_DIR/bin/remote-project-safety-check" \
         "$REMOTE_PACKAGE_DIR/scripts/remote-ollama-profile.js"

ln -sf "$REMOTE_PACKAGE_DIR/bin/remote-ollama-profile" "$REMOTE_SCRIPTS_DIR/remote-ollama-profile"
ln -sf "$REMOTE_PACKAGE_DIR/bin/remote-project-safety-check" "$REMOTE_SCRIPTS_DIR/remote-project-safety-check"

if [ ! -f "$REMOTE_PACKAGE_DIR/config/llm-host.env" ]; then
  cp "$REMOTE_PACKAGE_DIR/config/llm-host.env.example" "$REMOTE_PACKAGE_DIR/config/llm-host.env"
fi

printf 'Installed local Ubuntu package to %s\n' "$REMOTE_PACKAGE_DIR"
printf 'Command links created in %s\n' "$REMOTE_SCRIPTS_DIR"
