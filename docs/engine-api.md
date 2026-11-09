# Engine API contract

Agon is the engine; games (Primordial is the first) are built on it. This page says what a game may rely on and how that changes. It does not restate the boundary rules: those are in `docs/architecture-charter.md` -> "Framework vs Game".

## What is public

The public API is exactly the modules listed in `apiSurface` in `tests/architecture/framework-game-boundary.json` (below), plus the `agon` CLI and the `agon_*` MCP tools. A game imports `@agon-engine/*` modules from that list and nothing else; it never imports `core-ts`. Anything not listed is internal and may change without notice.

| Module | Provides |
|---|---|
| `packages/runtime/src/runner/character-sheet.js` | character configuration screen model and pipeline |
| `packages/runtime/src/controls/intents.js` | the shared controls: intents, default key bindings as data (logical key names), help text (#505) |
| `packages/runtime/src/controls/messages.js` | the shared message wording and view readers every client uses (#505) |
| `packages/runtime/src/contracts/domain-constants.js` | affinity/expression/motivation vocabularies |
| `packages/runtime/src/contracts/sound-cues.js` | sound cue vocabulary for the play session's turn results (#757) |
| `packages/runtime/src/contracts/game-elements.js` | skin: GAME_COLOR_PALETTE, element visuals, asset and icon ids (re-exports the vocabulary) |
| `packages/runtime/src/commands/author-level.js` | author a level through the personas |
| `packages/runtime/src/render/affinity-role.js` | attack/defence/support labels, trait kinds |
| `packages/runtime/src/render/window-size.js` | observed window size |
| `packages/runtime/src/render/entity-sprite-composer.js` | board sprite pixels |
| `packages/adapters-web/src/adapters/solver-recorded/index.js` | recorded-solver replay adapter |
| `packages/ui-ascii/src/game.js` | the reference terminal client's game controller over the play session (the phone app runs it in the page) |
| `packages/ui-ascii/src/screen.js` | the reference client's board, HUD and log drawing |
| `packages/ui-ascii/src/keymap.js` | the reference client's terminal key decoding (the bindings and intents are `runtime/controls/intents.js`) |
| `packages/ui-ascii/src/html.js` | ANSI screen to HTML, for browser views of the reference client |
| `packages/adapters-cli/src/cli/playtest-scenarios.mjs` | the playtest scenario catalogue and its `agon create` arguments per seed (#744: framework content, shared with the sims) |
| `packages/runtime/src/render/client-surface.js` | graphical client facade: play session, HUD and icon models, resource bundle, board sprite state (#767) |
| `packages/adapters-cli/src/cli/agon.mjs` | the agon command line (spawn it with node: create, play, run, ...) |
| `packages/ui-ascii/src/character-cli.mjs` | the character configuration command line (spawn it with node) |

`tests/architecture/engine-api-doc.test.js` fails if this table and `apiSurface` disagree, so the list cannot drift.

## Installing

The published package is `@agon-engine/engine` (public npm, built JavaScript). Each module above is importable as `@agon-engine/engine/<package>/<path under src>`, e.g. `@agon-engine/engine/runtime/render/client-surface.js`. The two command lines are built as single files you spawn with `node`: `@agon-engine/engine/adapters-cli/cli/agon.mjs` and `@agon-engine/engine/ui-ascii/character-cli.mjs` (`playtest-scenarios.js` exports `AGON_CLI`, the resolved path of the first). `z3-solver` and `ws` are optional peer dependencies for solver and bridge commands. In development the unbuilt workspace packages are used directly; `pnpm run build:engine` builds the bundle, and `tests/architecture/engine-bundle.test.js` keeps its exports equal to `apiSurface`.

## Stability policy (0.x)

- **Additive first.** A new export is added and listed before a game is asked to use it. An export is removed only after the game has moved off it (the `api-request` / `ui-request` issue pair records both sides).
- **Breaking changes** to a listed module (renamed or removed export, changed return shape) are named in `CHANGELOG.md` under "Changed (breaking)" and need a matching `ui-request` issue in the game repository in the same PR.
- **Artifacts** keep their own rule: `schemaVersion` bumps on a breaking change; fields are never renamed or removed in place.
- **Versions.** The engine is on 0.x: minor versions may carry breaking changes, patch versions never do. 1.0 is cut when the first game has shipped against a pinned version without needing an api-request for a month.

## Changing the surface

1. Open (or answer) an `api-request` issue.
2. Add the export, add the module to `apiSurface` with a `provides` line, update this table (the test tells you if you forgot).
3. Add a `CHANGELOG.md` entry.
