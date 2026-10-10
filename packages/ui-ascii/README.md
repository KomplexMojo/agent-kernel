# ui-ascii

A playable terminal front end for agent-kernel: you are `@`, find the exit `E`.

```bash
pnpm run play:ascii                                 # bundled levels, in order
pnpm run play:ascii -- --level long-way-round       # start at a bundled level
pnpm run play:ascii -- --run artifacts/runs/<runId> # play a level an `ak` run built
pnpm run play:ascii -- --sim-config <p> --initial-state <p>
pnpm run play:ascii -- --keys "ddss" --no-color     # scripted: apply keys, print, exit
```

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
| `src/screen.js` | Lays out the view as text. Glyphs come from core's frame buffer; vital labels and colours from runtime's HUD model |
| `src/levels.js` | Finds and parses SimConfig + InitialState artifact pairs |
| `levels/` | Bundled levels, as `<name>.sim-config.json` + `<name>.initial-state.json` |

The simulation side is `packages/runtime/src/runner/play-session.js`: `await createPlaySession(...)`, then `await act({ kind: "move", params: { direction } })` or `act({ kind: "wait" })`, `view()` and `status()`. One command, one closed tick, one fresh frame. Core decides whether a move is legal, whether the actor reached the exit, and when it leaves.

## Other actors

Core's frame buffer draws only the player. When the play session reports other actors (`view().actors`), the screen draws them on top with the same letters as `ak tick`'s ASCII snapshot: `D` for a delver, `W` for a warden. Whether they move is the play session's business, not this package's.

Add a level by dropping a new artifact pair into `levels/`; file names sort into play order, and `tests/ui-ascii/ui-ascii-game.test.js` checks that every bundled level is winnable.
