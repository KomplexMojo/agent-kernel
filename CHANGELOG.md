# Changelog

The engine API contract and stability policy are in `docs/engine-api.md`. Entries name changes to the public API (`apiSurface`, `agon`, `agon_*` MCP tools) only.

## 0.3.2

### Fixed

- The published `agon` command line could not reach `z3-solver` even when it was installed: the bundle's optional-peer shim imported itself, so `agon create` refused every level whose placement needs the solver with `placement_constraints_need_solver ... (constraint_compile_error)`. This broke the game's build on 0.2.0, 0.3.0 and 0.3.1 for any scenario with a `--tactic`. `ws` had the same fault. The refusal now also carries the solver's own message, so a missing peer says so.

## 0.3.1

### Added

- Wall connectivity for graphical clients (#817): `buildBoardDrawModel` cells with `tile: "wall"` carry `wallMask` (0..15, bits `WALL_NEIGHBOUR_BITS` = north 1, east 2, south 4, west 8), the same true-grid rule as the ASCII wall glyphs, so remembered walls join under fog; fog cells carry none. `view().wallMasks` is the underlying grid (null off walls and in unknown cells; also null where a level draws walls its own way). `WALL_NEIGHBOUR_BITS` is exported from `client-surface.js`. Additive; `tile` is unchanged.

## 0.3.0

### Added

- `buildAffinityBoardOverlayModel(view)` on `client-surface.js` (#814): per cell, the field layer (mark, tint `{mix, alpha, valence}`, per-kind contributors with `weight`, `falloff`, `intensity`, `stacks`, `strength`, `restores`, `vital`, `sources`), the draw layer, the last tick's cast arrow (`glyph`, `direction`, kind hex) and defeat or spent marks, from the fog-masked view. The tint maths is one shared `affinityFieldTint` in `ascii-cell-style.js` that the terminal also paints with, so ASCII output is unchanged.
- `view().drawField` (#815): lasting draw sustains in a grid of their own (`expression: "draw"` on each entry, `restores: false`), masked by sight like `view.field`, with your own reach kept in fog. `view.field` still holds emit and push only. Cast path cells in `view().casts` also carry `direction` (`north`, `southeast`, ...).
- `agon play` / `play-session` take `--logical-keys` (a JSON array of key names such as `["ArrowUp","Enter","Escape"]`), and the `agon_play_*` MCP tools take `logicalKeys`, played after `keys` (#811). Raw `keys` work as before.
- A guard that the benchmark's `agon_create` tool schema uses the runtime's affinity, expression, motivation and vital vocabularies (`tests/tools/agon-tool-schema-vocabulary.test.js`, #765). The schema itself is unchanged, so benchmark results stay comparable.
- The game controller moved into runtime (#505, step 1b): `runtime/controls/game-controller.js` (`createGameController`: intents to play-session commands, the open panel, `frame()` for any client to draw). `ui-ascii`'s `createGame` wraps it and adds only the ASCII screen and panel layout; its return value and every export are unchanged. The new module is in the API surface.
- The shared controls moved into runtime (#505, step 1a): `runtime/controls/intents.js` (intents, default key bindings as data by logical key name, help text) and `runtime/controls/messages.js` (rejection wording, battle, vital and loot lines, order choices). `ui-ascii` keeps terminal key decoding and drawing and re-exports everything it exported before, so nothing changes for its callers. Both new modules are in the API surface.
- A `watcher` configuration recipe (#564): a warden or delver whose emit and pull take a kind from the affinity table's `reveals` column (`kindColumn`), the first by default, rather than a kind the data names. `kind=` accepts only kinds with that column. The catalogue is 21 recipes.
- A warden that has read a hostile's affinity ranks a pack swap to the counter kind above staying, behind the same `counterKinds` decision point (#564). Casting at the hostile still outranks an equip, so the swap happens on a turn the warden cannot usefully cast; a counter it could not aim (a restoring push) is never swapped to.
- A revealing kind's push or pull that struck an actor reveals it the next turn at the slot's intensity, less any concealing field there; `readActorRegistryRevealLevels` and `readActorRegistryReadings` take the last turn, and the player's fog view and the Actor's readings share the rule (#564). Changes what the player sees after a light push or pull.
- Actors read other actors' affinities only through revealing fields (core `readActorRegistryReadings`, capped by the reveal level as the player's view is); a read kind is remembered with its tick, and a cast prefers the opposite kind among slots that reach, through one replaceable decision point `counterKinds` (#564). No inspect, no new pricing.

### Fixed

- The adaptive-workflow sectional seam hosts the Allocator's budget fit when a `ports.solver` adapter is supplied, instead of always using the greedy fallback; an architecture guard now requires every build-capability spread to host the fit or be named (#381).
- The Actor's seeded draws (random movement, yield coins, tie-breaks) now use the level's run seed (#791). They all fell back to seed 0 before, so two levels built with different seeds drew the same coins for the same actor and tick. Levels with a seed and a random actor play differently; runs still replay exactly. The simulation sweep (62 scenarios, which carry no seed) is unchanged.

### Removed
- `render/sprite-atlas-manifest.js` and the `agon/SpriteAtlasManifest` schema (#772). The ResourceBundle, dressed by a game with a `ResourceBundleDressing`, is the one art contract. It was never on `apiSurface`; a game packaging an Aseprite atlas turns it into a dressing.

### Changed
- `--tactic auto` (#651): with a budget, the Director sizes the seeded mix to the hazard and warden pools, using the Allocator's pool split and one-unit quotes, so a level spends most of its dungeon share instead of about a fifth. The mix and the draws are the seed's; only the sizes grow, and the build's fit step still trims what the Allocator does not approve. `pickSeededTactics(seed, counts, sizing?)` takes the optional third argument. Levels built with `auto` change, and build slower.
- Pricing (#650): lasting expressions (emit, draw) cost more the more an actor holds. The k-th lasting slot, cheapest first, costs k times its price; one slot is unchanged. Actors with two or more emit or draw slots quote higher (the shadowblade delver 391 to 454, the spellward 378 to 461).

### Fixed
- `@agon-engine/engine` 0.2.0 (#796): the published bundle now includes `playtest-scenarios.json`, a working `agon` command line (`adapters-cli/cli/agon.mjs`, which `AGON_CLI` points at) and the character configuration command line (`ui-ascii/character-cli.mjs`). Both command lines are listed in the public API. `z3-solver` and `ws` are optional peers, needed only by solver and bridge commands.
### Added
- `docs/engine-api.md`: the public API list and the 0.x stability policy.

- `@agon-engine/engine`: a built (plain JS) bundle of the public API, published to npm on a `v*` tag by `.github/workflows/publish-engine.yml`. Subpaths are `./<package>/<path under src>`, for example `@agon-engine/engine/runtime/render/client-surface.js`.

### Changed (breaking)
- Renamed the `ak` command to `agon` (`agon.mjs`, `agon-impl.mjs`; bins `agon`, `agon-mcp`, `agon-persona`, `agon-maze`), every `ak_*` MCP tool to `agon_*`, every `AK_*` environment variable to `AGON_*` (including the `AK_CLI` export of `playtest-scenarios`, now `AGON_CLI`), and the `ak.uiReady.v1` message type to `agon.uiReady.v1` (#795). No aliases are kept. Update saved MCP configs, shell aliases and environment files.
- Renamed agent-kernel to **Agon**. Schema ids are now `agon/<Name>` (was `agent-kernel/<Name>`), packages are `@agon-engine/*` (was `@agent-kernel/*`), the MCP server is `agon-cli`, and the root package is `agon`. No aliases are kept. The `agon` command and `agon_*` MCP tool names are unchanged for now.
