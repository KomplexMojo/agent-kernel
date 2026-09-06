#!/usr/bin/env bash
# Cursor session-start refresh for agent-kernel.
#
# Brings the workspace to a known-good state at the start of a coding session,
# on a cloud agent or locally:
#   1. source up to date   — fetch + ff-only pull (never touches uncommitted work)
#   2. tools refreshed      — pnpm deps, Serena ignored-dirs patch, agent context
#   3. tests run            — pnpm run test
#
# Idempotent, environment-aware, and best-effort: an individual step that fails
# or is unavailable is reported, not fatal, so the summary always prints. Exit
# code is non-zero only when something needs attention (deps install or tests).
set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

RUN_TESTS=1
RUN_PULL=1
RUN_TOOLS=1
for arg in "$@"; do
  case "$arg" in
    --no-tests) RUN_TESTS=0 ;;
    --no-pull)  RUN_PULL=0 ;;
    --no-tools) RUN_TOOLS=0 ;;
    -h|--help)
      echo "usage: session-refresh.sh [--no-tests] [--no-pull] [--no-tools]"
      exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# uv / serena live under ~/.local/bin.
export PATH="$HOME/.local/bin:$PATH"

# The repo imports .ts directly, so tests need Node >= 22.18 (native type
# stripping). Prefer such a runtime when the one on PATH is older (e.g. a cloud
# VM's default shim), mirroring .cursor/install.sh.
ensure_node() {
  local min_major=22 min_minor=18
  version_ok() {
    local v="${1#v}"; local major="${v%%.*}"; local rest="${v#*.}"; local minor="${rest%%.*}"
    [ -n "$major" ] || return 1
    [ "$major" -gt "$min_major" ] && return 0
    [ "$major" -eq "$min_major" ] && [ "$minor" -ge "$min_minor" ] && return 0
    return 1
  }
  if command -v node >/dev/null 2>&1 && version_ok "$(node --version 2>/dev/null)"; then
    return 0
  fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm use default >/dev/null 2>&1 || nvm use 22 >/dev/null 2>&1 || true
    local bin; bin="$(dirname "$(nvm which default 2>/dev/null || command -v node)")"
    [ -n "$bin" ] && export PATH="$bin:$PATH"
  fi
}
ensure_node

status_source="skipped"
status_tools="skipped"
status_tests="skipped"
fails=0
section() { printf '\n=== %s ===\n' "$1"; }

# 1) Source up to date --------------------------------------------------------
if [ "$RUN_PULL" = 1 ]; then
  section "source"
  branch="$(git symbolic-ref --short -q HEAD || echo DETACHED)"
  if [ "$branch" = DETACHED ]; then
    echo "detached HEAD — not pulling"
    status_source="skipped (detached)"
  elif [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git fetch --quiet 2>/dev/null || true
    echo "uncommitted changes present — fetched only, not pulling (your work is untouched)"
    status_source="fetched (dirty tree)"
  elif git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
    git fetch --quiet 2>/dev/null || true
    if git merge-base --is-ancestor HEAD '@{upstream}' 2>/dev/null; then
      if git pull --ff-only --quiet; then
        echo "fast-forwarded $branch to its upstream"
        status_source="up to date"
      else
        echo "ff-only pull could not apply — left as-is"
        status_source="pull skipped"
      fi
    else
      echo "local $branch is ahead of / diverged from upstream — not pulling"
      status_source="local ahead (no pull)"
    fi
  else
    echo "$branch has no upstream — nothing to pull"
    status_source="no upstream"
  fi
fi

# 2) Supporting tools ---------------------------------------------------------
if [ "$RUN_TOOLS" = 1 ]; then
  section "tools"
  if command -v pnpm >/dev/null 2>&1; then
    if CI=true pnpm install --frozen-lockfile; then
      echo "deps: pnpm install ok"
    else
      echo "deps: pnpm install FAILED"; fails=$((fails + 1))
    fi
  else
    echo "pnpm not found — skipping deps"
  fi

  # Serena's TypeScript adapter re-hardcodes build/dist as ignored on every
  # install; the patch is idempotent and self-skips when Serena is absent.
  if [ -f scripts/setup/patch-serena-ignored-dirs.py ]; then
    python3 scripts/setup/patch-serena-ignored-dirs.py || true
  fi

  # Branch guard. .git/hooks is not versioned, so without this every fresh clone and every
  # cloud agent VM starts with no guard at all — which is precisely when a direct commit to
  # main happens, because nothing is there to refuse it.
  if bash scripts/setup/install-git-hooks.sh; then
    :
  else
    echo "git hooks: install FAILED (direct commits to main would not be refused)"
    fails=$((fails + 1))
  fi

  # Agent context snapshot (local-codex/CodeContext.md + vault mirror). Best
  # effort: it needs no external indexer, so a failure here is not fatal.
  if bash scripts/setup/agent-context.sh >/dev/null 2>&1; then
    echo "context: agent snapshot refreshed (local-codex/CodeContext.md)"
  else
    echo "context: agent snapshot refresh failed (non-fatal)"
  fi
  status_tools="refreshed"
fi

# 3) Tests --------------------------------------------------------------------
if [ "$RUN_TESTS" = 1 ]; then
  section "tests"
  if command -v pnpm >/dev/null 2>&1; then
    if pnpm run test; then
      status_tests="passed"
    else
      status_tests="FAILED"; fails=$((fails + 1))
    fi
  else
    echo "pnpm not found — cannot run tests"
    status_tests="skipped (no pnpm)"
  fi
fi

# Summary ---------------------------------------------------------------------
section "summary"
printf 'node:   %s\n' "$(node --version 2>/dev/null || echo 'not found')"
printf 'source: %s\n' "$status_source"
printf 'tools:  %s\n' "$status_tools"
printf 'tests:  %s\n' "$status_tests"
if [ "$fails" -gt 0 ]; then
  echo "session-refresh: $fails item(s) need attention."
  exit 1
fi
echo "session-refresh: OK"
