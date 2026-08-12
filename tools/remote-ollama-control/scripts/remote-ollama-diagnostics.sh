#!/usr/bin/env bash
set -Eeuo pipefail

PROFILE="${1:-primary}"
SAMPLE_SECONDS="${SAMPLE_SECONDS:-12}"
PROMPT="${DIAG_PROMPT:-Write one short sentence about GPU diagnostics.}"

section() {
  printf '\n\n===== %s =====\n' "$*"
}

run() {
  printf '\n$ %s\n' "$*"
  set +e
  "$@" 2>&1
  local rc=$?
  set -e
  printf '[exit %s]\n' "$rc"
}

run_sh() {
  printf '\n$ %s\n' "$*"
  set +e
  bash -lc "$*" 2>&1
  local rc=$?
  set -e
  printf '[exit %s]\n' "$rc"
}

json_escape() {
  sed 's/\\/\\\\/g; s/"/\\"/g' <<<"$1" | tr -d '\n'
}

section "diagnostic metadata"
printf 'generated_at=%s\n' "$(date -Is)"
printf 'hostname=%s\n' "$(hostname)"
printf 'user=%s\n' "$(id)"
printf 'pwd=%s\n' "$(pwd)"
printf 'profile=%s\n' "$PROFILE"
printf 'sample_seconds=%s\n' "$SAMPLE_SECONDS"

section "os and hardware"
run uname -a
run_sh 'cat /etc/os-release'
run lscpu
run_sh 'lspci -nn | grep -Ei "vga|display|3d|amd|ati" || true'

section "tool availability"
run_sh 'command -v node || true; node --version || true'
run_sh 'command -v ollama || true; ollama --version || true'
run_sh 'command -v rocm-smi || true; rocm-smi --version || true'
run_sh 'command -v rocminfo || true'
run_sh 'command -v nvtop || true'
run_sh 'command -v radeontop || true'

section "device permissions"
run groups
run_sh 'ls -l /dev/kfd /dev/dri /dev/dri/render* 2>/dev/null || true'

section "profile manager status"
run_sh 'command -v remote-ollama-profile || true'
run remote-ollama-profile status
run remote-ollama-profile status --json
run remote-ollama-profile telemetry --profile "$PROFILE" --json

section "systemd and ports"
run_sh 'systemctl status ollama --no-pager || true'
run_sh 'systemctl --user status ollama-profile@primary.service --no-pager || true'
run_sh 'systemctl --user status ollama-profile@secondary.service --no-pager || true'
run_sh 'systemctl --user status ollama-profile@dual.service --no-pager || true'
run_sh 'ss -tulnp | grep -E ":11434|:11435|:11436" || true'

section "processes"
run_sh 'ps -ef | grep -E "[o]llama|remote-ollama" || true'
run_sh 'for pid in $(pgrep -f "ollama" || true); do echo "--- pid $pid"; ps -fp "$pid"; tr "\0" "\n" < "/proc/$pid/environ" 2>/dev/null | grep -E "OLLAMA|ROCR|HIP|HSA|ROC" || true; done'

section "rocm baseline"
run rocm-smi
run_sh 'rocminfo 2>&1 | sed -n "1,180p" || true'

section "ollama api inventory"
for port in 11434 11435 11436; do
  run_sh "echo PORT=$port; curl -fsS http://127.0.0.1:$port/api/version || true; echo; curl -fsS http://127.0.0.1:$port/api/ps || true; echo; curl -fsS http://127.0.0.1:$port/api/tags | sed -n '1,80p' || true"
done

section "profile logs"
run remote-ollama-profile logs --profile primary --tail 220
run remote-ollama-profile logs --profile secondary --tail 220
run remote-ollama-profile logs --profile dual --tail 220
run_sh 'journalctl --user -u "ollama-profile@*.service" -n 260 --no-pager || true'
run_sh 'journalctl -u ollama -n 220 --no-pager || true'

section "live telemetry during one request"
PORT="$(remote-ollama-profile status --json 2>/dev/null | node -e '
const fs = require("fs");
const profile = process.argv[1];
const rows = JSON.parse(fs.readFileSync(0, "utf8"));
const row = rows.find((item) => item.profile === profile) || rows[0];
process.stdout.write(String(row?.port || 11434));
' "$PROFILE" 2>/dev/null || printf '11434')"
MODEL="$(remote-ollama-profile status --json 2>/dev/null | node -e '
const fs = require("fs");
const profile = process.argv[1];
const rows = JSON.parse(fs.readFileSync(0, "utf8"));
const row = rows.find((item) => item.profile === profile) || rows[0];
process.stdout.write(String(row?.model || ""));
' "$PROFILE" 2>/dev/null || true)"
printf 'request_profile=%s\nrequest_port=%s\nrequest_model=%s\n' "$PROFILE" "$PORT" "$MODEL"

if [ -n "$MODEL" ]; then
  (
    for _ in $(seq 1 "$SAMPLE_SECONDS"); do
      printf '\n--- telemetry tick %s ---\n' "$(date -Is)"
      rocm-smi 2>&1 || true
      ps -o pid,ppid,pcpu,pmem,etime,comm,args -p "$(pgrep -n ollama)" 2>/dev/null || true
      sleep 1
    done
  ) &
  sampler_pid=$!

  escaped_prompt="$(json_escape "$PROMPT")"
  run_sh "curl -fsS http://127.0.0.1:$PORT/api/generate -H 'content-type: application/json' -d '{\"model\":\"$MODEL\",\"prompt\":\"$escaped_prompt\",\"stream\":false,\"options\":{\"num_predict\":64}}' | sed -n '1,80p'"
  wait "$sampler_pid" || true
else
  printf 'Skipped live request because no model was reported for profile %s.\n' "$PROFILE"
fi

section "final rocm and cpu snapshot"
run rocm-smi
run_sh 'top -b -n 1 | sed -n "1,35p" || true'
