# Changelog

The engine API contract and stability policy are in `docs/engine-api.md`. Entries name changes to the public API (`apiSurface`, `agon`, `agon_*` MCP tools) only.

## Unreleased

### Added

- Actors read other actors' affinities only through revealing fields (core `readActorRegistryReadings`, capped by the reveal level as the player's view is); a read kind is remembered with its tick, and a cast prefers the opposite kind among slots that reach, through one replaceable decision point `counterKinds` (#564). No inspect, no new pricing.

### Fixed
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
