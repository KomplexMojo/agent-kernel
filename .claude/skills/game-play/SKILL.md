---
name: game-play
description: Play an agent-kernel level turn by turn in the chat. Usage /game-play [runId | bundled level name] [keys or plain-language moves].
disable-model-invocation: true
argument-hint: [runId | level] [moves]
---

# /game-play

Play turn by turn: $ARGUMENTS

Follow the `game-master` skill's house rules throughout.

- **Which level.** A `runId` from this conversation (an `ak_create` call) or a bundled level
  name (`ak_play_ascii {level}`; `first-steps`, `long-way-round`, `warden-hall`, `trap-rooms`).
  With neither, use the level made most recently in this conversation, else the first bundled
  level.
- **Keeping the game.** `ak_play_ascii` is stateless: each call replays from the start. Keep
  the full key history for this game in the conversation and send all of it every turn,
  with the new keys appended. After each turn say the history in one line
  (`keys so far: ddss.`) so it survives a long conversation. `r` restarts the level; start
  the history afresh after it.
- **Plain-language moves.** Translate "move east twice" into keys (`dd`), "wait" into `.`,
  "cast at the warden" into `f` then Enter, and so on (the key map is in `game-master`). Send
  a handful of keys per turn, not a whole plan; stop early when something new comes into
  sight so the player can decide.
- **Each turn** show `screen` in a code block and one or two lines from `status` and the
  screen: what happened, and the player's health and mana if they changed. If the player is
  defeated or has exited, say so and offer `r` or `/game-new`.
- The player decides. Play their character for them only when they ask, and never refuse a
  move: a blocked move costs a turn, and the engine reports why.
