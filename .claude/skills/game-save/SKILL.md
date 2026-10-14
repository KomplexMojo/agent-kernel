---
name: game-save
description: Save the agent-kernel game being played in this conversation to a capture file. Usage /game-save [name].
disable-model-invocation: true
argument-hint: [name]
---

# /game-save

Save the current game: $ARGUMENTS

1. Take the level (`runId` or bundled `level`) and the full key history of the game being
   played in this conversation. If no game is in progress, say so and stop.
2. Call `ak_play_ascii` with that level, `keys` set to the whole history, and
   `record: "artifacts/games/<name>.json"` (name as given, else the level's id plus the turn
   count). `artifacts/` is git-ignored.
3. Reply with the path and the level it belongs to; `/game-load <name>` resumes it.
