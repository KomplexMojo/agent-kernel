#!/usr/bin/env bash
# One room: a playable delver with light emit at range 2, intensity 2 against dark emit
# hazards at range 3, intensity 2, to test how light and dark cancel on the cells between them
# (equal intensity cancels; range only sets how far each reaches, #340).
# Usage: bash scripts/game/light-vs-dark.sh [--out-dir dir]
#        then: node packages/adapters-cli/src/cli/ak.mjs play --dir artifacts/runs/light-vs-dark/create
set -euo pipefail
cd "$(dirname "$0")/../.."

AK="node packages/adapters-cli/src/cli/ak.mjs"

# Mana 40 with regen 6 keeps the light running: a sustained emit costs 2 + range + intensity
# a turn (6 for the hero, 7 for each trap), and a drained affinity switches off until mana is
# full again.
$AK create --run-id light-vs-dark --budget-tokens 3000 "$@" \
  --room "size=medium;count=1" \
  --delver "count=1;id=hero;affinity=light;affinities=light:emit:2:2;equip=light:emit;motivation=user_controlled;vitals=health:20:1,mana:40:6,stamina:10:1,durability:10:1" \
  --hazard "x=1;y=1;affinity=dark;expression=emit;stacks=3;intensity=2;vitals=mana:40:7,durability:10:1" \
  --hazard "x=3;y=4;affinity=dark;expression=emit;stacks=3;intensity=2;vitals=mana:40:7,durability:10:1" \
  --hazard "x=1;y=7;affinity=dark;expression=emit;stacks=3;intensity=2;vitals=mana:40:7,durability:10:1"
