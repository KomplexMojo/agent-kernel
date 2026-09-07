#!/usr/bin/env bash
# Is this branch one that must never receive a direct commit or push?
#
# The decision lives here, on its own, for two reasons: both hooks need the same answer, and a test
# can call this directly with any branch name. A guard whose logic is only reachable by actually
# committing to main is a guard nobody can prove works.
#
#   protected-branch.sh <branch-name> <commit|push>
#
# Exit 0 = allowed. Exit 1 = refused, with the reason and the way forward on stderr.
set -uo pipefail

BRANCH="${1:-}"
ACTION="${2:-commit}"

# master is included because a clone of this repo under an older default would otherwise be
# unguarded, and the cost of listing it is nothing.
case "$BRANCH" in
  main|master) ;;
  *) exit 0 ;;
esac

cat >&2 <<MSG

  ✗ Refused: direct ${ACTION} on '${BRANCH}'.

  Every change lands through a feature branch and a PR — no exception for a one-line fix,
  a typo, or a doc tweak, and no exception for which agent is driving (Claude, Codex, Cursor).
  See AGENTS.md → "Branching — every change goes through a branch and a PR".

  From here:

    git switch -c <type>/<short-description>     # feat/ fix/ chore/ docs/ test/ refactor/
MSG

if [ "$ACTION" = "commit" ]; then
  cat >&2 <<'MSG'
    git commit ...                               # your commit, now on the branch
MSG
else
  cat >&2 <<'MSG'
    git push -u origin HEAD                      # push the branch, not main
MSG
fi

cat >&2 <<'MSG'
    gh pr create --fill
    gh pr merge --squash --delete-branch         # merges, then removes it here and on origin

  This hook is a guard, not a wall: `--no-verify` bypasses it, as does any admin bypass on
  the GitHub ruleset. It exists to stop the accident, not to defeat a deliberate override.

MSG
exit 1
