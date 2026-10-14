---
name: game-load
description: Resume an agent-kernel game saved with /game-save. Usage /game-load <name or path>.
disable-model-invocation: true
argument-hint: <name or path>
---

# /game-load

Resume a saved game: $ARGUMENTS

1. The capture is `artifacts/games/<name>.json`, or the path given.
2. Call `ak_play_ascii` with `replay` set to it and the same level the save was made on
   (the `runId` or bundled `level`; a bundled level is picked from the capture on its own).
   The replay re-runs the saved commands; the engine refuses a capture that no longer fits
   its level, and you report that reason as it is.
3. Show `screen` and carry on as `/game-play` does. Every later turn passes `replay` again with
   only the new keys in `keys`, so keep that new-key history.
