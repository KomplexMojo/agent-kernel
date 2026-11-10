# @agon-engine/engine

Agon is a deterministic simulation engine where players and AI agents contest under one rule set. This package is the built bundle of its public API: plain ESM JavaScript, Node 22 or newer. Primordial, the first game on it, imports it from the npm registry.

```bash
npm install @agon-engine/engine
```

## Import the named entries

| Entry | Use it for |
|---|---|
| `@agon-engine/engine/client` | Playing a level: play session, game controller, intents, board frame, HUD and overlay models, window size. |
| `@agon-engine/engine/authoring` | Node build and playtest scripts: `authorLevel`, the character sheet, the recorded solver adapter and the playtest catalogue (reads files). |
| `@agon-engine/engine/authoring/browser` | A **browser** bundle: the same level, character sheet and solver adapter, with no Node builtin in the import graph. |
| `@agon-engine/engine/skin` | Palette, element visuals, board sprite pixels, the resource bundle with dressing and element art. |
| `@agon-engine/engine/vocabulary` | Affinity kinds and expressions, vitals, motivations, sound cue names. |
| `@agon-engine/engine/terminal` | The reference terminal client. |

The file-path subpaths (`@agon-engine/engine/runtime/...` and so on) still resolve but are aliases and will be removed in a later minor release.

## The command line

The package installs an `agon` command (`npx agon create ...`; `npx agon` with no arguments lists the commands). Building a level with the solver needs the optional peer `z3-solver`; `agon` serving a browser needs `ws`.

## What may change

The contract, the 0.x stability policy and the full module list are in [`docs/engine-api.md`](https://github.com/KomplexMojo/agon/blob/main/docs/engine-api.md). Every release is in [`CHANGELOG.md`](https://github.com/KomplexMojo/agon/blob/main/CHANGELOG.md).
