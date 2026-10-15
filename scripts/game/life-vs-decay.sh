#!/usr/bin/env bash
# One room: a playable delver with life emit at 3 stacks against decay emit hazards at 3
# stacks: life restores health and decay damages it, and the two cancel where they meet.
# Floor tints show which side wins on each tile.
# Usage: bash scripts/game/life-vs-decay.sh [--out-dir dir]
#        then: node packages/adapters-cli/src/cli/ak.mjs play --dir artifacts/runs/life-vs-decay/create
set -euo pipefail
cd "$(dirname "$0")/../.."

AK="node packages/adapters-cli/src/cli/ak.mjs"

# A sustained emit costs 2 + stacks a turn (5 at 3 stacks), and a drained affinity switches
# off until mana is full again. Regen 5 matches that upkeep, so the hero and the traps stay
# on and the interaction is steady; drop a regen to 4 to watch that source flicker.
$AK create --run-id life-vs-decay --budget-tokens 2500 "$@" \
  --room "size=medium;count=1" \
  --delver "count=1;id=hero;affinity=life;affinities=life:emit:3;equip=life:emit;motivation=user_controlled;vitals=health:20:1,mana:40:5,stamina:10:1,durability:10:1" \
  --hazard "x=1;y=1;affinity=decay;expression=emit;stacks=3;vitals=mana:40:5,durability:10:1" \
  --hazard "x=3;y=4;affinity=decay;expression=emit;stacks=3;vitals=mana:40:5,durability:10:1" \
  --hazard "x=1;y=7;affinity=decay;expression=emit;stacks=3;vitals=mana:40:5,durability:10:1"
