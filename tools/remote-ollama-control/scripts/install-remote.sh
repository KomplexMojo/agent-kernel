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
REMOTE_SSH_PORT="${LLM_SSH_PORT:-22}"
# No defaults on purpose: host addresses are operator data, never committed.
INTERNAL_HOST="${LLM_INTERNAL_HOST:-}"
EXTERNAL_HOST="${LLM_EXTERNAL_HOST:-}"
SSH_KEY="${LLM_SSH_KEY:-}"
SSH_HOST_ALIAS="${LLM_SSH_HOST_ALIAS:-}"
REMOTE_PACKAGE_DIR="${LLM_REMOTE_PACKAGE_DIR:-/home/darren/remote-ollama-control}"
REMOTE_SCRIPTS_DIR="${LLM_REMOTE_SCRIPTS_DIR:-/home/darren/bin}"

# When an SSH host alias is configured, use it directly (skips route/host/port/key logic).
if [ -n "$SSH_HOST_ALIAS" ]; then
  SSH_OPTS=(-o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o BatchMode=yes)
  REMOTE="$SSH_HOST_ALIAS"
else
  case "$ROUTE" in
    internal|lan) REMOTE_HOST="$INTERNAL_HOST"; HOST_VAR=LLM_INTERNAL_HOST ;;
    external|vpn) REMOTE_HOST="$EXTERNAL_HOST"; HOST_VAR=LLM_EXTERNAL_HOST ;;
    *) printf 'Invalid route: %s\n' "$ROUTE" >&2; exit 2 ;;
  esac

  if [ -z "$REMOTE_HOST" ]; then
    printf 'ERROR: %s is not set, so route %s has no address.\n' "$HOST_VAR" "$ROUTE" >&2
    printf '       Copy config/llm-host.env.example to config/llm-host.env and fill it in.\n' >&2
    printf '       That file is untracked on purpose — host addresses are never committed.\n' >&2
    exit 2
  fi

  SSH_OPTS=(-p "$REMOTE_SSH_PORT" -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o BatchMode=yes)
  if [ -f "$SSH_KEY" ]; then
    SSH_OPTS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no)
  fi

  REMOTE="$REMOTE_USER@$REMOTE_HOST"
fi

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
           '$REMOTE_PACKAGE_DIR/scripts/ufw-remote-ollama.sh' \
           '$REMOTE_PACKAGE_DIR/bin/agent-kernel-benchmark' \
           '$REMOTE_PACKAGE_DIR/scripts/benchmark-agent.js' \
           '$REMOTE_PACKAGE_DIR/bin/agent-kernel-heartbeat' \
           '$REMOTE_PACKAGE_DIR/scripts/benchmark-heartbeat.js' && \
  ln -sf '$REMOTE_PACKAGE_DIR/bin/remote-ollama-profile' '$REMOTE_SCRIPTS_DIR/remote-ollama-profile' && \
  ln -sf '$REMOTE_PACKAGE_DIR/bin/remote-ollama-diagnostics' '$REMOTE_SCRIPTS_DIR/remote-ollama-diagnostics' && \
  ln -sf '$REMOTE_PACKAGE_DIR/bin/remote-project-safety-check' '$REMOTE_SCRIPTS_DIR/remote-project-safety-check' && \
  REMOTE_OLLAMA_INSTALL_IN_PLACE=1 '$REMOTE_PACKAGE_DIR/scripts/install-local-ubuntu.sh'"

printf 'Installed remote package to %s:%s\n' "$REMOTE" "$REMOTE_PACKAGE_DIR"
printf 'Remote profile manager: %s/remote-ollama-profile\n' "$REMOTE_SCRIPTS_DIR"
