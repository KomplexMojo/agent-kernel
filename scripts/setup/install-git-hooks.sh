#!/usr/bin/env bash
# Point this clone's git hooks at the repo's own .githooks/ directory.
#
# .git/hooks is not versioned, so a hook that lives only there protects exactly one clone and
# silently protects nothing on the next one — including every cloud agent VM. core.hooksPath moves
# the hooks into the tree, where they are reviewed, tested, and present for whoever clones next.
#
# Idempotent; safe to run on every session. Run by scripts/setup/session-refresh.sh.
set -Eeuo pipefail

REPO_ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

current="$(git config --local --get core.hooksPath || true)"
if [ "$current" = ".githooks" ]; then
  echo "git hooks: already pointed at .githooks"
  exit 0
fi

if [ -n "$current" ] && [ "$current" != ".githooks" ]; then
  echo "git hooks: core.hooksPath was '$current' — repointing to .githooks" >&2
fi

git config --local core.hooksPath .githooks
echo "git hooks: core.hooksPath set to .githooks (direct commits and pushes to main are now refused)"
