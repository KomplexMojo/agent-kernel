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

# Written AFTER the copy, never before: rsync --delete would remove it. This is the only record of
# which commit the installed copy came from -- the package dir is a file copy, not a checkout, so
# `git log` there fails and a merge to main leaves it untouched and silent. The heartbeat publishes
# this so the off-box alarm can say "a merge has not been deployed" instead of nobody noticing for
# an hour, which is exactly what happened on 2026-08-23.
INSTALL_SOURCE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
INSTALL_SOURCE_REF="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
# Prefer an explicit provenance from the caller (install-remote.sh knows the Mac checkout's
# commit; the package directory on the box is a file copy, so git there fails and would leave
# sourceCommit null — which disables the undeployed-agent alarm).
if [ -n "${REMOTE_OLLAMA_INSTALL_SOURCE_COMMIT:-}" ]; then
  INSTALL_SOURCE_COMMIT="$REMOTE_OLLAMA_INSTALL_SOURCE_COMMIT"
fi
if [ -n "${REMOTE_OLLAMA_INSTALL_SOURCE_REF:-}" ]; then
  INSTALL_SOURCE_REF="$REMOTE_OLLAMA_INSTALL_SOURCE_REF"
fi
# A source tree that is not a checkout yields null, not the string "null" and not a broken document:
# the reader treats absent provenance as unknown, and an unparseable one would silence the beacon.
if [ -n "$INSTALL_SOURCE_COMMIT" ]; then
  INSTALL_COMMIT_JSON="\"$INSTALL_SOURCE_COMMIT\""
else
  INSTALL_COMMIT_JSON=null
fi
if [ -n "$INSTALL_SOURCE_REF" ]; then
  INSTALL_REF_JSON="\"$INSTALL_SOURCE_REF\""
else
  INSTALL_REF_JSON=null
fi
cat > "$REMOTE_PACKAGE_DIR/.install-manifest.json" <<MANIFEST
{
  "schemaVersion": "agent-kernel-install-manifest/v1",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sourceCommit": $INSTALL_COMMIT_JSON,
  "sourceRef": $INSTALL_REF_JSON
}
MANIFEST

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
  # Units are installed without enabling them, but a reinstall of an already-enabled timer must
  # reactivate it so OnActiveSec can arm a next fire. daemon-reload alone leaves NEXT blank.
  for timer in agent-kernel-heartbeat.timer agent-kernel-benchmark.timer; do
    if systemctl --user is-enabled "$timer" >/dev/null 2>&1; then
      systemctl --user restart "$timer"
    fi
  done
fi

printf 'Installed local Ubuntu package to %s\n' "$REMOTE_PACKAGE_DIR"
printf 'Command links created in %s\n' "$REMOTE_SCRIPTS_DIR"
printf 'Benchmark user units installed but not enabled in %s\n' "$SYSTEMD_USER_DIR"
