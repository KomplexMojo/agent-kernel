# ui-ascii

A playable terminal front end for agent-kernel: you are `@`, find the exit `E`, and mind the traps `H`.

It is reachable from the `ak` CLI and the MCP server, so any harness can create a level and show it:

```bash
node packages/adapters-cli/src/cli/ak.mjs create --room "size=small;count=3" \
  --delver "count=1;affinity=wind;motivation=exploring" \
  --hazard "affinity=corrode;expression=emit;proximityRadius=1;mana=one-time:30" --out-dir /tmp/traps
node packages/adapters-cli/src/cli/ak.mjs play --dir /tmp/traps            # play it here
node packages/adapters-cli/src/cli/ak.mjs play --dir /tmp/traps --json     # { screen, status, turns, launch, warnings? }
```

Over MCP the same request ("create an ascii UI filled with <affinity> traps", for any of the ten affinities) is `ak_create` with hazards of that affinity, then `ak_play_ascii` with that call's `runId`: it returns the board as text plus the `launch` command for the interactive game. `ak play` runs this package as a separate program; adapters-cli never imports it.

**Play through Claude Code.** Opened in this repository, Claude Code already has the MCP server (the root `.mcp.json`, enabled with the game tools pre-allowed in `.claude/settings.json`) and the game commands in `.claude/skills/`: `/game-new` authors a level from a description with `ak_create` and shows it, `/game-play` plays it a few keys at a time, `/game-watch` steps through a recorded run, `/game-save` and `/game-load` keep a game in a capture file, `/game-recap` narrates a run, and `/game-terminal` gives the command for the interactive game. The `game-master` skill holds the rules Claude follows while doing it. Claude is a front end like this one: every move goes through `ak_play_ascii`, so the screen it shows is this package's.

```bash
pnpm run play:ascii                                 # bundled levels, in order
pnpm run play:ascii -- --level long-way-round       # start at a bundled level
pnpm run play:ascii -- --run <dir>                 # play a level `ak create --out-dir <dir>` generated (rooms + corridors)
pnpm run play:ascii -- --sim-config <p> --initial-state <p>
pnpm run play:ascii -- --keys "ddss" --no-color     # scripted: apply keys, print, exit
pnpm run play:ascii -- --keys "ddss" --json         # scripted, as { ok, level, turns, status, screen, warnings? }
pnpm run play:ascii -- --no-fog                     # debug: see the whole map
pnpm run play:ascii -- --record game.json           # on quit, save the played commands
pnpm run play:ascii -- --replay game.json           # re-run a saved game, then keep playing
```

**Viability floor.** A level loaded from files is played as written. If a delver or warden sits below the viability floor (health, mana and durability each need max 10 and regen 1, which `ak create` applies while authoring), the Configurator's report is printed as `warning:` lines on stderr and returned as `warnings` in `--json`.

**Watching a run.** The same screen also shows a run `ak run` recorded, tick by tick: `--watch --run <dir>` (an `ak run --out-dir`, or an `artifacts/runs/<id>` directory with the run under `run/` and the build under `create/`).

```bash
pnpm run play:ascii -- --watch --run <dir>                     # left/right (or h/l, ,/.) step a tick, [ ] jump to the first/last, q quits
pnpm run play:ascii -- --watch --run <dir> --tick 5 --json      # { ok, tick, maxTick, level, status, screen }
```

Every actor and trap is drawn where the run recorded it at that tick, with no fog (a viewer watches the whole run, not one actor's sight), and the HUD follows the actor the game would seat as the player, drawn `@`. What is on the board at a tick is the runtime run viewer's (`runner/run-viewer.js`): it reads the registry snapshot each tick frame recorded and hands back the play session's `view()` shape, so this package draws it with the same code; nothing is re-simulated. `ak play --watch`, MCP `ak_play_ascii` with `watch: true`, and the `ascii` of `ak tick` / `ak_show_state` are this screen. `--no-help` starts with the key help hidden, in play and in watch.

**Record and replay.** `--record <path>` writes the current level's played commands as a `CapturedInputArtifact` (`source.adapter: "player"`, one `{ tick, actorId, command }` per turn) when you quit or when `--keys` finishes. `--replay <path>` re-runs them on the same level (a bundled level is picked from the capture) and play continues from there; with `--keys` or `--json` it prints the result instead. The simulation is deterministic, so a replay reaches the exact same state; the play session refuses a capture whose commands no longer land on their recorded ticks. The log and the replay are the play session's (`captureInput`, `replayPlaySession`); this package only reads and writes the file.

**Fog of war is on.** You see only what is in sight (levels are unlit, so that is close by). Cells you have never seen are `?`, cells you saw before are drawn dimmed with no actors on them (until dark covers them out of sight, which makes you forget them), and other actors and traps appear only while in sight. What counts as in sight is core's and the play session's (`createPlaySession({ fog: true })`, `view().sight`); this package only draws it. `--no-fog` (also on `ak play`, and `fog: false` on `ak_play_ascii`) is a debug view of the whole level for tests and level checks, not a way to play.

Colour is on by default in a terminal and uses the application's approved palette (`GAME_COLOR_PALETTE`, via `runtime/src/render/ascii-cell-style.js`): tiles are flat fills like the Phaser board, the player is the user-controlled colour, wardens and delvers wear their role colours, and an actor or trap with an affinity is filled with that affinity's colour. Output that is not a terminal, `NO_COLOR`, or `--no-color` gives plain text; `--color` forces colour.

| Key | Does |
|---|---|
| arrows · WASD · `h j k l` | move |
| `y u b n` | move diagonally |
| `.` or space | wait one tick |
| Enter | next level (after escaping) |
| `r` | restart the level |
| `?` | toggle help |
| `q` · Esc · Ctrl-C | quit (in an open panel: close it) |
| `i` | list your affinities; then `1`–`9` equips one into a free slot (or in place of the oldest when every slot is full), or unequips it if it is equipped; Tab moves the `>` highlight and `+` / `-` run the highlighted equipped affinity one stack higher or lower (a turn each; the HUD shows `×running/held`) |
| `f` | aim at the nearest actor in sight; Tab picks the next, Enter (or `f`) casts your first equipped push or pull, Esc cancels |
| `1`–`9` | aim with that slot's push or pull (then Tab/Enter as for `f`); an emit or draw slot needs no cast |
| `g` | take loot from a defeated neighbour (with several items, `1`–`9` picks); slot loot opens one more affinity slot |

Reaching the exit's approach tile puts you **at the exit**; waiting one more tick steps you through. That is core's exit-dwell rule, not a UI rule. If a warden's casts bring your health to 0 you are defeated: the status line says so, moves do nothing, and `r` restarts the level. Every key that acts costs one turn, a blocked move included: so do an equip, a cast and a take, accepted or refused. Opening, browsing and closing a panel is free. A refusal names core's reason (not enough mana, out of range, nothing equipped). Push and pull are cast; an equipped emit or draw works on its own every turn while its mana upkeep is paid, and the HUD says when it is off waiting for mana. The HUD shows one row per affinity slot (delvers start with 3, wardens with 2); each slot pays its own upkeep and goes off on its own.

## Where it sits

`ui-ascii → runtime → core-ts`. This package imports only its own files, `packages/runtime`, and `node:` built-ins; `tests/architecture/dependency-direction.test.js` enforces it.

| File | Owns |
|---|---|
| `src/cli.mjs` | The terminal: arguments, raw-mode keypresses, redraws |
| `src/keymap.js` | Key → intent (`move`, `wait`, `affinities`, `cast`, `take`, …; and the watch keys). No legality |
| `src/game.js` | Intent → play-session call; level index, move count, last message, the open panel (affinities, target, loot) |
| `src/screen.js` | Lays out the view as text and turns palette hex into ANSI escapes. Board glyphs come from the play session's rows (the registry's terrain in the level's render legend); board colours from `render/ascii-cell-style.js`; vital labels and colours from runtime's HUD model |
| `src/watch.js` | Watching a recorded run: the tick cursor and help toggle over the runtime run viewer |
| `src/levels.js` | Finds and parses SimConfig + InitialState artifact pairs, and a recorded run's tick frames |
| `levels/` | Bundled levels, as `<name>.sim-config.json` + `<name>.initial-state.json`, generated from `levels/recipes.json` |

The simulation side is `packages/runtime/src/runner/play-session.js`: `await createPlaySession(...)`, then `await act({ kind: "move", params: { direction } })`, `act({ kind: "wait" })`, `act({ kind: "equip_affinity", params: { affinityKey, replaceKey?, stacks? } })`, `act({ kind: "unequip_affinity", params: { affinityKey } })`, `act({ kind: "cast_affinity", params: { targetId, affinityKey? } })` or `act({ kind: "take", params: { targetId, holdingId } })`, then `view()` (including `player.affinities`, `player.affinitySlots`, `player.equippedAffinityKeys`, `player.exhaustedAffinityKeys`, `player.equippedAffinityStacks`, `player.castableAffinities` (each equipped push or pull with its reach), `player.maxAffinitySlots` and `loot`) and `status()`; `viabilityReport` is the Configurator's list of actors below the viability floor. One command, one closed tick, one fresh frame. Core decides whether a move is legal, whether the actor reached the exit, when it leaves, and whether it is defeated: `status()` is `{ tick, exited, atExit, defeated }`, and once the player is defeated the session refuses every command (reason `defeated`) and runs no more ticks.

## Other actors and traps

The play session's rows draw the terrain, barriers (`B`) and the player (`@`). Other actors (`view().actors`) are drawn on top with the same letters as `ak tick`'s ASCII snapshot: `D` for a delver, `W` for a warden (read from the role, or the id when a generated level leaves the role unset). Traps are the level's hazard actors (`view().hazards`), drawn as `H` under any actor. A trap's field hurts whoever stands in it each turn, so an `emit` trap costs the vital its affinity targets (water: health), and it pays `2 + stacks` mana a turn to stay on. Whether actors move is the play session's business, not this package's.

## Bundled levels

Every bundled level is `ak create` output: the Configurator lays out the rooms and corridors and places the actors and traps. `levels/recipes.json` holds each level's `ak create` arguments; regenerate with `pnpm run levels:ascii`, and `pnpm run levels:ascii -- --check` (also a test) fails if a checked-in file drifts from what `ak create` makes. To add a level, add a recipe and regenerate; file names sort into play order, and `tests/ui-ascii/ui-ascii-game.test.js` checks that every bundled level is winnable.

| Level | Recipe |
|---|---|
| `first-steps` | one small room |
| `long-way-round` | three large rooms |
| `warden-hall` | two large rooms. One warden wanders at random; the Configurator posts it on the exit's approach, so the exit opens once it moves. The other attacks: it equips its push and casts at you whenever you are in reach, so you can lose here (r restarts the level). Which affinity each warden holds is just this level's data; any affinity works the same way |
| `trap-rooms` | three small rooms, three `emit` traps of different affinities (fire, water, decay); any affinity works the same way |

Tests that need an exact board shape use the hand-written levels in `tests/fixtures/ui-ascii/levels/`.
