---
name: game-new
description: Create a new agent-kernel game level from a plain description and show its starting board. Usage /game-new <description>.
disable-model-invocation: true
argument-hint: <description of the level>
---

# /game-new

Create a level from this description and show it: $ARGUMENTS

Follow the `game-master` skill's house rules throughout.

1. Turn the description into `ak_create` spec objects (`room`, `delver`, `warden`, `hazard`,
   `resource`); the grammar is in `packages/adapters-cli/README.md` under `create`. Unless the
   description says otherwise, give one delver `motivation=user_controlled` so there is a
   character to play; only that delver is playable, the rest are companions. Kinds combine one
   per family with `+` (a companion `exploring+attacking`, a player `user_controlled+stealthy`). Use the description's own affinities; if it names none, leave the
   choice to the spec defaults rather than picking one.
2. Pick a short, readable `runId` from the description (e.g. `three-rooms-traps`) and call
   `ak_create` with `dryRun: true` first. If `valid` is false, fix the specs from `errors` and
   try again; tell the player only if their own request is what the engine rejected, quoting
   its reason.
3. Call `ak_create` for real with the same specs and `runId`.
4. Call `ak_play_ascii {runId}` and show `screen` in a code block, then one line naming what
   was made (rooms, actors, traps, from `actorIds`/`roomIds`), the `runId`, and that
   `/game-play` plays it (as a live game: `ak_play_start` with that `runId`) and
   `/game-terminal` opens it in a terminal.
