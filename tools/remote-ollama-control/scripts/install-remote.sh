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

ROUTE="${1:-${LLM_DEFAULT_ROUTE:-internal}}"
REMOTE_USER="${LLM_REMOTE_USER:-darren}"
REMOTE_SSH_PORT="${LLM_SSH_PORT:-2222}"
INTERNAL_HOST="${LLM_INTERNAL_HOST:-192.168.1.143}"
EXTERNAL_HOST="${LLM_EXTERNAL_HOST:-154.5.75.3}"
SSH_KEY="${LLM_SSH_KEY:-$HOME/.ssh/ubuntu_llm_ed25519}"
REMOTE_PACKAGE_DIR="${LLM_REMOTE_PACKAGE_DIR:-/home/darren/remote-ollama-control}"
REMOTE_SCRIPTS_DIR="${LLM_REMOTE_SCRIPTS_DIR:-/home/darren/bin}"

case "$ROUTE" in
  internal|lan) REMOTE_HOST="$INTERNAL_HOST" ;;
  external|vpn) REMOTE_HOST="$EXTERNAL_HOST" ;;
  *) printf 'Invalid route: %s\n' "$ROUTE" >&2; exit 2 ;;
esac

SSH_OPTS=(-p "$REMOTE_SSH_PORT" -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o BatchMode=yes)
if [ -f "$SSH_KEY" ]; then
  SSH_OPTS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no)
fi

REMOTE="$REMOTE_USER@$REMOTE_HOST"

ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$REMOTE_PACKAGE_DIR' '$REMOTE_SCRIPTS_DIR'"

if command -v rsync >/dev/null 2>&1; then
  rsync -az --delete \
    --exclude 'results/*' \
    --exclude 'config/llm-host.env' \
    -e "ssh ${SSH_OPTS[*]}" \
    "$ROOT_DIR/" "$REMOTE:$REMOTE_PACKAGE_DIR/"
else
  tar -C "$ROOT_DIR" \
    --exclude './results/*' \
    --exclude './config/llm-host.env' \
    -czf - . \
    | ssh "${SSH_OPTS[@]}" "$REMOTE" "tar -C '$REMOTE_PACKAGE_DIR' -xzf -"
fi

ssh "${SSH_OPTS[@]}" "$REMOTE" "\
  chmod +x '$REMOTE_PACKAGE_DIR/bin/remote-ollama-profile' \
           '$REMOTE_PACKAGE_DIR/bin/remote-ollama-diagnostics' \
           '$REMOTE_PACKAGE_DIR/bin/remote-project-safety-check' \
           '$REMOTE_PACKAGE_DIR/scripts/remote-ollama-profile.js' \
           '$REMOTE_PACKAGE_DIR/scripts/remote-ollama-diagnostics.sh' \
           '$REMOTE_PACKAGE_DIR/scripts/ufw-remote-ollama.sh' && \
  ln -sf '$REMOTE_PACKAGE_DIR/bin/remote-ollama-profile' '$REMOTE_SCRIPTS_DIR/remote-ollama-profile' && \
  ln -sf '$REMOTE_PACKAGE_DIR/bin/remote-ollama-diagnostics' '$REMOTE_SCRIPTS_DIR/remote-ollama-diagnostics' && \
  ln -sf '$REMOTE_PACKAGE_DIR/bin/remote-project-safety-check' '$REMOTE_SCRIPTS_DIR/remote-project-safety-check'"

printf 'Installed remote package to %s:%s\n' "$REMOTE" "$REMOTE_PACKAGE_DIR"
printf 'Remote profile manager: %s/remote-ollama-profile\n' "$REMOTE_SCRIPTS_DIR"
