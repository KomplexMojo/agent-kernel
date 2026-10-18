#!/usr/bin/env bash
# A full level that spends ~19,500 of a 20,000-token budget across every pool.
# Affinities read kind:expression:range[:intensity] (#340): `decay:push:7:3` reaches 7 tiles
# and hits at intensity 3 (2 × 3² = 18); intensity 1 when left out.
# The Allocator splits the budget into pools (base-costs.json levelBudgetSplitPercent):
# rooms 5,400 · delvers 5,000 · wardens 4,800 · hazards 3,000 · resources 1,800.
# Each pool has its own cap, so maxing the budget means filling every pool.
# Usage: bash scripts/game/big-20k-level.sh [--dry-run] [--out-dir dir]
#        then: node packages/adapters-cli/src/cli/ak.mjs play --dir artifacts/runs/big-20k/create
set -euo pipefail
cd "$(dirname "$0")/../.."

AK="node packages/adapters-cli/src/cli/ak.mjs"
PLAYER="vitals=health:40:3,mana:40:3,stamina:20:2,durability:20:2"

$AK create --run-id big-20k --budget-tokens 20000 "$@" \
  `# Rooms pool (5,400): six large rooms, and floor tiles at 1 token each.` \
  --room "size=large;count=6" \
  --floor-tile "count=5399" \
  `# Delver pool (5,000): two playable delvers (D1 with 6 slots, 4 equipped) and five followers.` \
  --delver "count=1;id=hero;affinity=light;affinities=light:emit:4,fire:push:4,growth:emit:3,fortify:emit:2;slots=6;equip=light:emit,fire:push,growth:emit,fortify:emit;motivation=user_controlled;$PLAYER" \
  --delver "count=1;id=scout;affinity=wind;motivation=user_controlled;$PLAYER" \
  --delver "count=5;id=pal;affinity=earth;vitals=health:20:2,mana:20:2,stamina:10:1,durability:10:1;motivation=exploring+friendly+goal_oriented;strategy=follow:hero-1:2" \
  `# Warden pool (4,800): a boss that hunts the player, four patrols, four defenders.` \
  --warden "count=1;id=boss;affinity=dark;affinities=dark:emit:7,decay:push:7:3,corrode:pull:5;slots=3;equip=dark:emit,decay:push,corrode:pull;vitals=health:80:6,mana:80:6,stamina:20:2,durability:20:2;motivation=stationary+goal_oriented;strategy=defeat:hero-1" \
  --warden "count=4;id=guard;affinity=corrode;affinities=corrode:push:5:2,fortify:emit:3;equip=corrode:push,fortify:emit;motivation=patrolling;vitals=health:50:4,mana:50:4,stamina:10:1,durability:10:1" \
  --warden "count=4;id=sentry;affinity=water;affinities=water:pull:6:2,earth:push:5;equip=water:pull,earth:push;motivation=defending;vitals=health:60:5,mana:60:5,stamina:10:1,durability:10:1" \
  `# Hazard pool (3,000): five placed traps in room 1, five roaming ones with mana to burn.` \
  --hazard "x=2;y=2;affinity=light;expression=emit;stacks=5;vitals=mana:120:10,durability:80:5" \
  --hazard "x=6;y=4;affinity=dark;expression=emit;stacks=5;vitals=mana:120:10,durability:80:5" \
  --hazard "x=4;y=6;affinity=fire;expression=push;stacks=5;blocking=true;vitals=mana:120:10,durability:80:5" \
  --hazard "x=8;y=8;affinity=decay;expression=draw;stacks=5;vitals=mana:120:10,durability:80:5" \
  --hazard "x=3;y=9;affinity=wind;expression=pull;stacks=5;vitals=mana:120:10,durability:80:5" \
  --hazard "affinity=fire;expression=emit;proximityRadius=2;mana=regen:60:60:5" \
  --hazard "affinity=decay;expression=push;proximityRadius=1;mana=regen:60:60:5" \
  --hazard "affinity=water;expression=pull;proximityRadius=2;mana=regen:60:60:5" \
  --hazard "affinity=corrode;expression=emit;proximityRadius=3;mana=regen:80:80:5;durability=regen:40:40:3" \
  --hazard "affinity=light;expression=draw;proximityRadius=2;mana=regen:80:80:5;durability=regen:40:40:3" \
  `# Resource pool (1,800): a slot unlock, vitals, and temporary and permanent affinities.` \
  --resource "slots=1" \
  --resource "permanenceMode=consumable;vital=health;delta=10" \
  --resource "permanenceMode=consumable;vital=mana;delta=20;regen=1" \
  --resource "permanenceMode=permanent;vital=mana;delta=5;regen=1" \
  --resource "permanenceMode=permanent;vital=health;delta=10;regen=2" \
  --resource "permanenceMode=level;vital=health;delta=15;regen=2" \
  --resource "affinity=fortify;expression=emit;stacks=2;mana=40" \
  --resource "affinity=growth;expression=emit;stacks=2;mana=40" \
  --resource "affinity=earth;expression=pull;stacks=2;mana=40;manaRegen=1" \
  --resource "affinity=dark;expression=emit;stacks=3;mana=60;manaRegen=3" \
  --resource "affinity=wind;expression=push;stacks=3;mana=60;manaRegen=3"
