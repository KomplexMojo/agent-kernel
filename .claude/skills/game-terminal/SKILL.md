---
name: game-terminal
description: Give the command that opens the live, coloured agent-kernel game in a terminal. Usage /game-terminal [runId | level].
disable-model-invocation: true
argument-hint: [runId | level]
---

# /game-terminal

Open the live game for: $ARGUMENTS

The chat is not a terminal, so live keyboard play runs in its own terminal tab.

1. The level is the `runId` or bundled level given, else the one played or made most recently
   in this conversation.
2. Call `ak_play_ascii` for it with no keys and give its `launch` command in a code block,
   to run from the repository root. If a game is in progress, offer `/game-save` first and give
   the same command with `--replay artifacts/games/<name>.json` appended, so the terminal game
   continues from the save (`launch` itself never includes it).
