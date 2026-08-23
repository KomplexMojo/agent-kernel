#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so a test can run the installer without inheriting the operator's
# own config. The LLM_REMOTE_* paths in that file describe the Ubuntu box, and
# they are used below as local install targets — correct on the box, wrong
# anywhere else.
ENV_FILE="${REMOTE_OLLAMA_ENV_FILE:-$ROOT_DIR/config/llm-host.env}"

INSTALL_SYSTEM="${REMOTE_OLLAMA_INSTALL_SYSTEM:-$(uname -s)}"
if [ "$INSTALL_SYSTEM" != "Linux" ]; then
  cat >&2 <<'MSG'
install-local-ubuntu.sh must be run on the Ubuntu LLM machine.

From the Mac, use:
  ./scripts/install-remote.sh internal

From Ubuntu, use:
  ./scripts/install-local-ubuntu.sh
MSG
  exit 2
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

REMOTE_PACKAGE_DIR="${LLM_REMOTE_PACKAGE_DIR:-$HOME/remote-ollama-control}"
REMOTE_SCRIPTS_DIR="${LLM_REMOTE_SCRIPTS_DIR:-$HOME/bin}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
BENCHMARK_CONFIG_DIR="$CONFIG_HOME/agent-kernel-benchmark"
SYSTEMD_USER_DIR="$CONFIG_HOME/systemd/user"

mkdir -p "$REMOTE_PACKAGE_DIR" "$REMOTE_SCRIPTS_DIR" "$BENCHMARK_CONFIG_DIR" "$SYSTEMD_USER_DIR"

if [ "${REMOTE_OLLAMA_INSTALL_IN_PLACE:-0}" = "1" ]; then
  :
elif command -v rsync >/dev/null 2>&1; then
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
         "$REMOTE_PACKAGE_DIR/bin/remote-ollama-diagnostics" \
         "$REMOTE_PACKAGE_DIR/bin/remote-project-safety-check" \
         "$REMOTE_PACKAGE_DIR/scripts/remote-ollama-profile.js" \
         "$REMOTE_PACKAGE_DIR/scripts/remote-ollama-diagnostics.sh" \
         "$REMOTE_PACKAGE_DIR/scripts/ufw-remote-ollama.sh" \
         "$REMOTE_PACKAGE_DIR/bin/agent-kernel-benchmark" \
         "$REMOTE_PACKAGE_DIR/scripts/benchmark-agent.js" \
         "$REMOTE_PACKAGE_DIR/bin/agent-kernel-heartbeat" \
         "$REMOTE_PACKAGE_DIR/scripts/benchmark-heartbeat.js"

ln -sf "$REMOTE_PACKAGE_DIR/bin/remote-ollama-profile" "$REMOTE_SCRIPTS_DIR/remote-ollama-profile"
ln -sf "$REMOTE_PACKAGE_DIR/bin/remote-ollama-diagnostics" "$REMOTE_SCRIPTS_DIR/remote-ollama-diagnostics"
ln -sf "$REMOTE_PACKAGE_DIR/bin/remote-project-safety-check" "$REMOTE_SCRIPTS_DIR/remote-project-safety-check"
ln -sf "$REMOTE_PACKAGE_DIR/bin/agent-kernel-benchmark" "$REMOTE_SCRIPTS_DIR/agent-kernel-benchmark"
ln -sf "$REMOTE_PACKAGE_DIR/bin/agent-kernel-heartbeat" "$REMOTE_SCRIPTS_DIR/agent-kernel-heartbeat"

if [ ! -f "$REMOTE_PACKAGE_DIR/config/llm-host.env" ]; then
  cp "$REMOTE_PACKAGE_DIR/config/llm-host.env.example" "$REMOTE_PACKAGE_DIR/config/llm-host.env"
fi

if [ ! -f "$BENCHMARK_CONFIG_DIR/benchmark-agent.env" ]; then
  cp "$REMOTE_PACKAGE_DIR/config/benchmark-agent.env.example" "$BENCHMARK_CONFIG_DIR/benchmark-agent.env"
  chmod 600 "$BENCHMARK_CONFIG_DIR/benchmark-agent.env"
fi
cp "$REMOTE_PACKAGE_DIR/systemd/agent-kernel-benchmark.service" "$SYSTEMD_USER_DIR/agent-kernel-benchmark.service"
cp "$REMOTE_PACKAGE_DIR/systemd/agent-kernel-benchmark.timer" "$SYSTEMD_USER_DIR/agent-kernel-benchmark.timer"
cp "$REMOTE_PACKAGE_DIR/systemd/agent-kernel-heartbeat.service" "$SYSTEMD_USER_DIR/agent-kernel-heartbeat.service"
cp "$REMOTE_PACKAGE_DIR/systemd/agent-kernel-heartbeat.timer" "$SYSTEMD_USER_DIR/agent-kernel-heartbeat.timer"
if [ "${REMOTE_OLLAMA_SKIP_SYSTEMCTL:-0}" != "1" ] && command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload
fi

printf 'Installed local Ubuntu package to %s\n' "$REMOTE_PACKAGE_DIR"
printf 'Command links created in %s\n' "$REMOTE_SCRIPTS_DIR"
printf 'Benchmark user units installed but not enabled in %s\n' "$SYSTEMD_USER_DIR"
