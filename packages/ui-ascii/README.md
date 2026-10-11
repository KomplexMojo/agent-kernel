# ui-ascii

A playable terminal front end for agent-kernel: you are `@`, find the exit `E`, and mind the traps `H`.

It is reachable from the `ak` CLI and the MCP server, so any harness can create a level and show it:

```bash
node packages/adapters-cli/src/cli/ak.mjs create --room "size=small;count=3" \
  --delver "count=1;affinity=wind;motivation=exploring" \
  --hazard "affinity=water;expression=emit;proximityRadius=1;mana=one-time:30" --out-dir /tmp/water
node packages/adapters-cli/src/cli/ak.mjs play --dir /tmp/water            # play it here
node packages/adapters-cli/src/cli/ak.mjs play --dir /tmp/water --json     # { screen, status, turns, launch }
```

Over MCP the same request ("create an ascii UI filled with water affinity traps") is `ak_create` with water hazards, then `ak_play_ascii` with that call's `runId`: it returns the board as text plus the `launch` command for the interactive game. `ak play` runs this package as a separate program; adapters-cli never imports it.

```bash
pnpm run play:ascii                                 # bundled levels, in order
pnpm run play:ascii -- --level long-way-round       # start at a bundled level
pnpm run play:ascii -- --run <dir>                 # play a level `ak create --out-dir <dir>` generated (rooms + corridors)
pnpm run play:ascii -- --sim-config <p> --initial-state <p>
pnpm run play:ascii -- --keys "ddss" --no-color     # scripted: apply keys, print, exit
pnpm run play:ascii -- --keys "ddss" --json         # scripted, as { ok, level, turns, status, screen }
pnpm run play:ascii -- --no-fog                     # debug: see the whole map
```

**Fog of war is on.** You see only what is in sight (levels are unlit, so that is close by). Cells you have never seen are `?`, cells you saw before are drawn dimmed with no actors on them, and other actors and traps appear only while in sight. What counts as in sight is core's and the play session's (`createPlaySession({ fog: true })`, `view().sight`); this package only draws it. `--no-fog` (also on `ak play`, and `fog: false` on `ak_play_ascii`) is a debug view of the whole level for tests and level checks, not a way to play.

Colour is on by default in a terminal and uses the application's approved palette (`GAME_COLOR_PALETTE`, via `runtime/src/render/ascii-cell-style.js`): tiles are flat fills like the Phaser board, the player is the user-controlled colour, wardens and delvers wear their role colours, and an actor or trap with an affinity is filled with that affinity's colour. Output that is not a terminal, `NO_COLOR`, or `--no-color` gives plain text; `--color` forces colour.

| Key | Does |
|---|---|
| arrows · WASD · `h j k l` | move |
| `y u b n` | move diagonally |
| `.` or space | wait one tick |
| Enter | next level (after escaping) |
| `r` | restart the level |
| `?` | toggle help |
| `q` · Esc · Ctrl-C | quit |

Reaching the exit's approach tile puts you **at the exit**; waiting one more tick steps you through. That is core's exit-dwell rule, not a UI rule. Every key that acts costs one turn, a blocked move included.

## Where it sits

`ui-ascii → runtime → core-ts`. This package imports only its own files, `packages/runtime`, and `node:` built-ins; `tests/architecture/dependency-direction.test.js` enforces it.

| File | Owns |
|---|---|
| `src/cli.mjs` | The terminal: arguments, raw-mode keypresses, redraws |
| `src/keymap.js` | Key → intent (`move`, `wait`, `restart`, …). No legality |
| `src/game.js` | Intent → play-session call; level index, move count, last message |
| `src/screen.js` | Lays out the view as text and turns palette hex into ANSI escapes. Glyphs come from core's frame buffer; board colours from `render/ascii-cell-style.js`; vital labels and colours from runtime's HUD model |
| `src/levels.js` | Finds and parses SimConfig + InitialState artifact pairs |
| `levels/` | Bundled levels, as `<name>.sim-config.json` + `<name>.initial-state.json`, generated from `levels/recipes.json` |

The simulation side is `packages/runtime/src/runner/play-session.js`: `await createPlaySession(...)`, then `await act({ kind: "move", params: { direction } })` or `act({ kind: "wait" })`, `view()` and `status()`. One command, one closed tick, one fresh frame. Core decides whether a move is legal, whether the actor reached the exit, and when it leaves.

## Other actors and traps

Core's frame buffer draws only the player. When the play session reports other actors (`view().actors`), the screen draws them on top with the same letters as `ak tick`'s ASCII snapshot: `D` for a delver, `W` for a warden (read from the role, or the id when a generated level leaves the role unset). Traps are the level's static hazards (`view().hazards`), drawn as `H` under any actor. Core applies a trap when you step on it, so an `emit` trap costs the vital its affinity targets (water: health). Whether actors move is the play session's business, not this package's.

## Bundled levels

Every bundled level is `ak create` output: the Configurator lays out the rooms and corridors and places the actors and traps. `levels/recipes.json` holds each level's `ak create` arguments; regenerate with `pnpm run levels:ascii`, and `pnpm run levels:ascii -- --check` (also a test) fails if a checked-in file drifts from what `ak create` makes. To add a level, add a recipe and regenerate; file names sort into play order, and `tests/ui-ascii/ui-ascii-game.test.js` checks that every bundled level is winnable.

| Level | Recipe |
|---|---|
| `first-steps` | one small room |
| `long-way-round` | three large rooms |
| `warden-hall` | two large rooms, a fire and a water warden wandering at random. The Configurator posts the first warden on the exit's approach, so the exit opens once it moves |
| `water-traps` | three small rooms, three water `emit` traps |

Tests that need an exact board shape use the hand-written levels in `tests/fixtures/ui-ascii/levels/`.
