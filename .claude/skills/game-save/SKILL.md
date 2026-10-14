---
name: game-save
description: Save the agent-kernel game being played in this conversation to a file. Usage /game-save [name].
disable-model-invocation: true
argument-hint: [name]
---

# /game-save

Save the current game: $ARGUMENTS

1. If a live game is running (`ak_play_start` in this conversation), call `ak_play_view` with
   its session and `save: "artifacts/games/<name>.json"` (name as given, else the session
   name plus the turn count). `artifacts/` is git-ignored. The game keeps running.
2. If the game was played with `ak_play_ascii` and a key history instead, call
   `ak_play_ascii` with that level, `keys` set to the whole history and
   `record: "artifacts/games/<name>.json"`.
3. If no game is in progress, say so and stop. Otherwise reply with the path;
   `/game-load <name>` resumes it.
