# Vitals: what each one decides (audit)

Playability P2 (#621, S5). Each vital should answer a different question for the player. This table
states what the rules do today, from `core-ts` (`actor-turn.ts`, the affinity table), so a change that
blurs two roles shows up against it. It prices nothing and proposes no change; prices are the
Allocator's (`base-costs.json`), and a retune needs cohort evidence (play-sim, #611).

| Vital | Decision it drives | What spends it | What recovers it | Role no other vital has |
|---|---|---|---|---|
| **Health** | Can I stay in this fight? | Harm that reaches it: a hit's primary vital when the kind targets it (decay), or spill once another vital is empty | Regen each tick; a restoring kind (growth). Regen stops for the hit turn and 3 turns after a push/pull hit (#478) | Defeat vital for delvers and wardens: at 0 you are out |
| **Mana** | Which cast or emit can I afford, and can I keep it running? | Casts (push/pull, priced on the curve), emit/draw upkeep each tick, watching (1 a turn), raised barrier upkeep | Regen each tick (not paused by hits); light restores; draws steal it | The only budget for affinity use: shapes build and tempo |
| **Stamina** | Where can I move, and is a sprint worth it? | Each step (diagonal and soaked cost more), sprint (about 3× a step) | Regen every tick, doubled on a turn without a move (#407); paused after a hit like health | The only budget for movement: shapes positioning and retreat |
| **Durability** | How much can I be hit before it reaches health? | Harm from kinds whose primary vital is durability (fire, earth, corrode); spill target for hazards, resources and barriers | Regen; fortify restores | Armour: a buffer in front of health, and the defeat vital of things that are not actors |

## What to keep distinct

- Waiting restores stamina fastest and mana and health slowly. A level where waiting out a full refill
  is always safe collapses the stamina and mana decisions into "wait". The sweep reports it: the metrics
  `waitRegenGrinds` and `maxWaitRegenStreak` count movers that rest in safety while a vital refills for
  `WAIT_REGEN_LIMIT` (10) turns or more (`scripts/testing/simulation-lib.mjs`). It is a metric, not a rule.
- Do not fix a grind by adding hunger, timers or a new vital: change the encounter (pressure while
  resting) or, with cohort evidence, a price.
- A vital with no cost to spend it and no reason to refill it has no role. Check both columns for any
  new expression.
