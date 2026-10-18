#!/usr/bin/env bash
# Playtest a scenario built by `ak create`, with every turn recorded and a report written when
# you quit (artifacts/playtest/<when>-<scenario>-s<seed>/report.md). Paste or attach the report
# in the playtest thread to log what you found.
# Usage: bash scripts/game/playtest.sh                       list the scenarios
#        bash scripts/game/playtest.sh <scenario> [--seed N] [-- <ak play options, e.g. --no-fog>]
#        bash scripts/game/playtest.sh --open <report.md>     rebuild the level and replay that game
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node scripts/game/playtest.mjs "$@"
