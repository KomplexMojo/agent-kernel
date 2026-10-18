#!/usr/bin/env bash
# One room: a playable delver with dark emit at range 3, intensity 2 against light emit
# hazards at the same range and intensity, the mirror of light-vs-dark.sh: how a dark-bearer
# reads lit cells, and how light traps cancel its dark.
# Usage: bash scripts/game/dark-vs-light.sh [--out-dir dir]
#        then: node packages/adapters-cli/src/cli/ak.mjs play --dir artifacts/runs/dark-vs-light/create
set -euo pipefail
cd "$(dirname "$0")/../.."

AK="node packages/adapters-cli/src/cli/ak.mjs"

# Every emit here is range 3, intensity 2 (#340): equal intensity cancels where the fields meet.
# A sustained emit costs 2 + range + intensity a turn (7 here), and a drained affinity switches
# off until mana is full again. Regen 7 matches that upkeep, so the hero and the traps stay
# on and the interaction is steady; drop a regen to 6 to watch that source flicker.
$AK create --run-id dark-vs-light --budget-tokens 3000 "$@" \
  --room "size=medium;count=1" \
  --delver "count=1;id=hero;affinity=dark;affinities=dark:emit:3:2;equip=dark:emit;motivation=user_controlled;vitals=health:20:1,mana:40:7,stamina:10:1,durability:10:1" \
  --hazard "x=1;y=1;affinity=light;expression=emit;stacks=3;intensity=2;vitals=mana:40:7,durability:10:1" \
  --hazard "x=3;y=4;affinity=light;expression=emit;stacks=3;intensity=2;vitals=mana:40:7,durability:10:1" \
  --hazard "x=1;y=7;affinity=light;expression=emit;stacks=3;intensity=2;vitals=mana:40:7,durability:10:1"
