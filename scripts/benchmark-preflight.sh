#!/usr/bin/env bash
# Is this machine actually able to run a benchmark, or will it quietly measure nothing?
#
# Every way this setup breaks is SILENT. That is the whole reason this script exists:
#   - OLLAMA_MODELS unset or pointing at an unmounted drive -> `ollama list` returns EMPTY, not an
#     error, and a run fails per-attempt with "model not found" after doing real work.
#   - ssh-agent empty after a reboot -> "Permission denied", which reads as a dead box.
#   - a stale identity pin -> NO error at all. The run completes and compares incomparable results.
#   - llm-host.env absent in a fresh worktree -> two unrelated tests fail for reasons that are not
#     your diff.
#
# Harness-neutral on purpose: a person, Claude, Codex or CI all run the same script and get the same
# named failures. Do not reimplement these checks inside a harness -- a second copy is a second thing
# to go stale.
#
#   scripts/benchmark-preflight.sh          # local debug run (default)
#   scripts/benchmark-preflight.sh --remote # also check the box: reachability and pin freshness
#
# Exit 0 = safe to run. Exit 1 = at least one FAIL. Warnings never fail the run.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_REMOTE=0; [ "${1:-}" = "--remote" ] && CHECK_REMOTE=1
fails=0; warns=0
pass () { printf "  \033[32mok  \033[0m %s\n" "$1"; }
fail () { printf "  \033[31mFAIL\033[0m %s\n     -> %s\n" "$1" "$2"; fails=$((fails+1)); }
warn () { printf "  \033[33mwarn\033[0m %s\n     -> %s\n" "$1" "$2"; warns=$((warns+1)); }

echo "== local =="

# 1. A server that answers is not the same as a server that can see the models.
if ver=$(curl -sS --max-time 5 http://127.0.0.1:11434/api/version 2>/dev/null); then
  pass "ollama responds ($(echo "$ver" | tr -d '{}"' | cut -d: -f2))"
  count=$(curl -sS --max-time 10 http://127.0.0.1:11434/api/tags 2>/dev/null \
    | python3 -c 'import json,sys;print(len(json.load(sys.stdin).get("models",[])))' 2>/dev/null || echo 0)
  if [ "$count" -gt 0 ]; then
    pass "ollama sees $count model(s)"
  else
    fail "ollama sees ZERO models" \
      "This is the silent one: an empty list is not an error. The server is reading the wrong store.
        Check the running process's env (ps eww \$(pgrep -f 'ollama serve')) for OLLAMA_MODELS, and
        that ~/.ollama/models resolves to a MOUNTED path. A dangling symlink stops the server
        starting; a real-but-empty directory serves nothing and says nothing."
  fi
else
  fail "ollama does not respond on 127.0.0.1:11434" "Start it, then re-run."
fi

# 2. The model store must be a live path, not a stale mount point.
store="$(readlink "$HOME/.ollama/models" 2>/dev/null || echo "$HOME/.ollama/models")"
if [ -d "$store" ]; then
  pass "model store present ($store)"
else
  fail "model store missing: $store" \
    "~/.ollama/models points somewhere that is not mounted. Re-attach the drive; do NOT re-pull."
fi

# 3. Untracked config a fresh worktree never has.
if [ -f "$ROOT/tools/remote-ollama-control/config/llm-host.env" ]; then
  pass "llm-host.env present"
else
  warn "llm-host.env absent (gitignored, so a fresh worktree/clone lacks it)" \
    "Local runs work without it, but two remote-ollama tests will fail for reasons that are not your
        diff. Copy it from another checkout."
fi

# 4. The CLI has to actually load before a long run discovers otherwise.
if node "$ROOT/tools/remote-ollama-control/scripts/remote-ollama-mac.js" --help >/dev/null 2>&1 \
   || node "$ROOT/tools/remote-ollama-control/scripts/print-benchmark-identity.js" >/dev/null 2>&1; then
  pass "benchmark tooling loads"
else
  fail "benchmark tooling will not load" "Run 'pnpm install' in this worktree."
fi

if [ "$CHECK_REMOTE" = "1" ]; then
  echo "== remote =="
  host="${AK_BENCHMARK_SSH_HOST:-llm-wan}"
  if ssh -o ConnectTimeout=10 -o BatchMode=yes "$host" true 2>/dev/null; then
    pass "box reachable via $host"
    # 5. The dangerous one: a stale pin produces no error, just meaningless comparisons.
    local_id=$(node "$ROOT/tools/remote-ollama-control/scripts/print-benchmark-identity.js" 2>/dev/null)
    remote_env=$(ssh -o ConnectTimeout=10 -o BatchMode=yes "$host" \
      'cat ~/.config/agent-kernel-benchmark/benchmark-agent.env 2>/dev/null' 2>/dev/null)
    for pair in "scenarioSet:AK_BENCHMARK_SCENARIO_HASH" "matrix:AK_BENCHMARK_MATRIX_HASH"; do
      key="${pair%%:*}"; var="${pair##*:}"
      here=$(echo "$local_id" | python3 -c "import json,sys;print(json.load(sys.stdin)['$key']['sha256'])" 2>/dev/null)
      there=$(echo "$remote_env" | grep "^$var=" | cut -d= -f2)
      if [ -z "$there" ]; then warn "$var not pinned on the box" "The agent cannot detect drift."
      elif [ "$here" = "$there" ]; then pass "$key pin matches (${here:0:12}…)"
      else
        fail "$key pin is STALE" \
          "box=${there:0:12}… working tree=${here:0:12}…
        Nothing errors on this. The agent will run and compare results that are not comparable.
        Reinstall the agent and repin before trusting any number it publishes."
      fi
    done
  else
    fail "box unreachable via $host" \
      "Check the ssh-agent has the key first -- an empty agent after a reboot reads as a dead box:
        ssh-add --apple-use-keychain ~/.ssh/ubuntu_llm_ed25519"
  fi
fi

echo
if [ "$fails" -gt 0 ]; then
  echo "PREFLIGHT FAILED: $fails problem(s), $warns warning(s). Fix the FAILs before running."
  exit 1
fi
echo "preflight OK ($warns warning(s)). Safe to run."
