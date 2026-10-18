#!/usr/bin/env bash
# One room: a playable delver with growth emit at range 3, intensity 2 against decay emit
# hazards at the same range and intensity: growth restores health and decay damages it, and
# the two cancel where they meet.
# Floor tints show which side wins on each tile.
# Usage: bash scripts/game/growth-vs-decay.sh [--out-dir dir]
#        then: node packages/adapters-cli/src/cli/ak.mjs play --dir artifacts/runs/growth-vs-decay/create
set -euo pipefail
cd "$(dirname "$0")/../.."

AK="node packages/adapters-cli/src/cli/ak.mjs"

# Every emit here is range 3, intensity 2 (#340): equal intensity cancels where the fields meet.
# A sustained emit costs 2 + range + intensity a turn (7 here), and a drained affinity switches
# off until mana is full again. Regen 7 matches that upkeep, so the hero and the traps stay
# on and the interaction is steady; drop a regen to 6 to watch that source flicker.
$AK create --run-id growth-vs-decay --budget-tokens 3000 "$@" \
  --room "size=medium;count=1" \
  --delver "count=1;id=hero;affinity=growth;affinities=growth:emit:3:2;equip=growth:emit;motivation=user_controlled;vitals=health:20:1,mana:40:7,stamina:10:1,durability:10:1" \
  --hazard "x=1;y=1;affinity=decay;expression=emit;stacks=3;intensity=2;vitals=mana:40:7,durability:10:1" \
  --hazard "x=3;y=4;affinity=decay;expression=emit;stacks=3;intensity=2;vitals=mana:40:7,durability:10:1" \
  --hazard "x=1;y=7;affinity=decay;expression=emit;stacks=3;intensity=2;vitals=mana:40:7,durability:10:1"
