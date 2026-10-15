#!/usr/bin/env bash
# One room: a playable delver with light emit at 2 stacks against dark emit hazards at 3
# stacks, to test how light and dark cancel on the cells between them.
# Usage: bash scripts/game/light-vs-dark.sh [--out-dir dir]
#        then: node packages/adapters-cli/src/cli/ak.mjs play --dir artifacts/runs/light-vs-dark/create
set -euo pipefail
cd "$(dirname "$0")/../.."

AK="node packages/adapters-cli/src/cli/ak.mjs"

# Mana 40 with regen 4 keeps the light running: a sustained emit costs 2 + stacks a turn,
# and a drained affinity switches off until mana is full again.
$AK create --run-id light-vs-dark --budget-tokens 2500 "$@" \
  --room "size=medium;count=1" \
  --delver "count=1;id=hero;affinity=light;affinities=light:emit:2;equip=light:emit;motivation=user_controlled;vitals=health:20:1,mana:40:4,stamina:10:1,durability:10:1" \
  --hazard "x=1;y=1;affinity=dark;expression=emit;stacks=3;vitals=mana:40:4,durability:10:1" \
  --hazard "x=3;y=4;affinity=dark;expression=emit;stacks=3;vitals=mana:40:4,durability:10:1" \
  --hazard "x=1;y=7;affinity=dark;expression=emit;stacks=3;vitals=mana:40:4,durability:10:1"
