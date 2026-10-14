---
name: game-watch
description: Let an agent-kernel level play itself (every actor on its own motivations) and step through the recorded run. Usage /game-watch [runId] [ticks].
disable-model-invocation: true
argument-hint: [runId] [ticks]
---

# /game-watch

Watch a level play itself: $ARGUMENTS

Follow the `game-master` skill's house rules throughout.

1. The level is the `runId` given, else the one made most recently in this conversation.
   Run it with `ak_run {fromRun: <level runId>, ticks, runId: <level runId>-watch-<n>}`
   (default 20 ticks; use the number given).
2. Show tick 0: `ak_play_ascii {runId: <watch runId>, watch: true, tick: 0}`. Watching has no
   fog and the HUD follows the actor the game would seat as the player.
3. Step on request ("next", "+5", "end", "tick 12") with `tick`, showing `screen` and one line
   on what changed. `maxTick` is the last tick.
4. When done, offer `/game-recap` for the story, or a second watch with a different `ticks`
   or seed compared with `ak_diff {runA, runB}`.
