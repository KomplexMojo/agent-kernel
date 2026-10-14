---
name: game-load
description: Resume an agent-kernel game saved with /game-save. Usage /game-load <name or path>.
disable-model-invocation: true
argument-hint: <name or path>
---

# /game-load

Resume a saved game: $ARGUMENTS

1. The save is `artifacts/games/<name>.json`, or the path given.
2. Call `ak_play_start` with `load` set to it (and a session name; end a game already running
   under that name first, or pick another). The save names its own level, and the engine
   re-runs every saved command, seating the actor that was seated. If it refuses (the save
   does not name its level, or no longer fits it), report its reason as it is.
3. Show `screen` and carry on as `/game-play` does.
