# Strategy sources compared by play-sim outcome (#677)

Tracker #611, AI S1. Strategy here is the dungeon configuration. The same scenario, seed and token budget were built through `agon create` twice, differing only in who picked the placement tactics, then played by the same T0 driver (the delver is ordered to the exit).

Tool: `scripts/testing/play-sim-strategy-sources.mjs`. Everything goes through `agon create` and the Allocator; nothing is hand-priced. No engine changes.

```
node scripts/testing/play-sim-strategy-sources.mjs --scenarios first-look,duel --seeds 0,1,2 \
  --model <id> --base-url <ollama url>          # live model (sets AGON_LLM_LIVE=1 for the llm source)
node scripts/testing/play-sim-strategy-sources.mjs --fixture tests/fixtures/llm/tactic-plan-valid.json   # recorded reply
```

- **catalogue**: `--tactic auto`, the Director's seeded pick (#395).
- **llm**: `--tactic llm`. If there is no model or the reply is invalid, agon falls back to the seeded plan. A pair where the model did not decide is listed as `fellBack` and left out, so "llm" never silently means "catalogue".
- **Progress**: exits and median ticks to exit. **Deaths**: defeats. **Loops**: timeouts, where the fixed order never reached the exit.

## Result of the run made here

6 scenarios (first-look, duel, party, structures, gather, line-of-fire) x seeds 0, 1, 2 = 18 pairs, T0 `dash`, 200 ticks.

| Source | Runs | Exited | Defeated | Loops | Median ticks to exit |
|---|---|---|---|---|---|
| catalogue | 18 | 10 | 4 | 4 | 24 |
| llm (recorded reply) | 18 | 12 | 3 | 3 | 24 |

**Read this with care.** No live model was available in this session, so the "llm" side is one recorded reply (`retinue` + `minefield`) applied to all 18 cases, not a model's judgement of each level. The comparison is therefore "retinue + minefield" against the seeded pick, which chose `retinue` + `shrine` (or a mix) in the runs inspected. Two more exits out of 18 is within what the seeds alone move; **this is not evidence that either source is better.** Scenarios that fix their own `--tactic` (fields, tactics, long-haul, shrines, full-budget-tactics, generate-random) are skipped.

## What the next run should be

A real run on Darren's box with `--model` and `--base-url`, 3 or more seeds per scenario, reading the `fellBack` list first: if most pairs fell back, the model's replies are not passing the Director's checks and that is the finding. Only then compare exits, defeats and loops. The T0 `dash` driver ignores combat, so defeats mostly measure how deadly the placement is on the straight route, not how well it plays.
