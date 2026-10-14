---
name: game-play
description: Play an agent-kernel level turn by turn in the chat. Usage /game-play [runId | bundled level name] [keys or plain-language moves].
disable-model-invocation: true
argument-hint: [runId | level] [moves]
---

# /game-play

Play turn by turn: $ARGUMENTS

Follow the `game-master` skill's house rules throughout.

- **Which game.** If a live game is running in this conversation, continue it with
  `ak_play_act`. Otherwise start one with `ak_play_start`: a `runId` from this conversation
  (an `ak_create` call) or a bundled level name (`first-steps`, `long-way-round`,
  `warden-hall`, `trap-rooms`); with neither, the level made most recently in this
  conversation, else the first bundled level. Use the default session name (`game`) unless
  the player is running several games. A name already running must be ended first
  (`ak_play_end`), or continued.
- **The game keeps itself.** Each `ak_play_act` plays only the new turns; the server saves
  the game after every call, so there is no key history to carry. `ak_play_view` shows the
  board without playing.
- **Party.** `party` lists the actors the player may play (authored `user_controlled`), with
  labels (`D1`, `D2`). "Switch to D2" is `ak_play_switch` (free). "Have D1 wait while D2
  moves" is one `ak_play_act` with `commands`, using `actorId` for the one not seated.
  Companions, wardens and traps cannot be played: if asked, say the engine's answer
  (`not_playable`) and carry on.
- **Plain-language moves.** Translate into `commands` or `keys`: "move east twice" is `dd` or
  two `move` commands, "wait" is `.`, "cast at W1" is a `cast_affinity` command with
  `targetId: "W1"`. Use the labels from `inSight` for anything on the board.
- **Bounded autopilot** (only when the player asks you to play for them, e.g. "explore until
  you find something"): at most 10 turns per call, and stop as soon as something new appears
  in `inSight`, a vital drops, or `status` changes (at the exit, defeated, escaped). Then
  report and let the player decide.
- **Each turn** show `screen` in a code block and one or two lines on what changed (moves,
  damage, loot, who is in sight, the party). If the seated actor is defeated or has escaped,
  say so: switch to another party member if there is one, else offer a new game.
- The player decides. Never refuse a move: a blocked move costs a turn, and the engine says why.
