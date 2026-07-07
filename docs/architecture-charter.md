# Architecture Charter (Ports & Adapters)

`packages/core-ts` is the deterministic core. It must not depend on UI, network, storage, filesystem, clocks, process state, or Node APIs.

## Core vs Runtime

- **`core-ts`**: simulation state, transition rules, validation, render buffers, affinity field computation, motivation evaluation, and data-only effects.
- **Runtime personas**: long-lived controllers that coordinate planning, tick phases, action ordering, telemetry, and adapter interaction.
- **Adapters/UI**: host-specific IO and presentation. They call runtime or consume artifacts; they do not own simulation rules.

## Dependency Direction

```text
adapters-* -> runtime -> core-ts
ui-web     -> runtime -> core-ts
```

All external IO must be implemented behind adapters via narrow ports. Core APIs remain synchronous and deterministic.

## Core Responsibilities

- Canonical simulation state and legal state transitions.
- Pure validation and deterministic rule enforcement.
- Data-only effects with deterministic ids/requestIds and adapter hints.
- Affinity system: 10-kind codebook, spatial formulas, interaction matrix, static trap and actor field computation.
- Motivation system: 12-kind codebook, cost formulas, behavior flags, and profile derivation.
- Render buffers and observations derived from canonical state.

## Runtime Responsibilities

- Tick FSM and persona orchestration.
- Action proposal, ordering, replay, and telemetry capture.
- Artifact normalization and schema boundary enforcement.
- Card-authoring semantics: card normalization, property application, budget receipts, and summary construction live in `packages/runtime/src/commands/card-authoring.js`.
- Solver/external fact request routing through ports.
- UI-facing visualization assembly from core outputs and resource bundles.
- UI-facing core access facades for preview/playback setup. Browser UI code must
  call runtime helpers rather than importing `core-ts` directly.

## Builder Port

Heavy level synthesis runs behind a builder adapter. UI code hands off summaries, normalized `levelGen`, or direct tile rows to that adapter instead of synthesizing layouts on the main thread.

## Combat Boundary

- `packages/core-ts/src/rules/combat.ts` owns the deterministic combat primitive: `createCombatRules(world).applyAttack(attackerIndex, defenderIndex, damage)`.
- `core.applyAttack` is the only mutation entry point for HP changes caused by an attack. It enforces valid actor indices, rejects self-attacks, requires Chebyshev-1 adjacency, requires positive integer damage, and clamps defender HP to `0`.
- Runtime never mutates HP directly for attacks. `packages/runtime/src/runner/runtime-fsm.mjs` adapts actor `attack` actions into a direct `{ kind: "apply_attack" }` directive, converts runtime actor IDs to core motivated-actor indices, and calls `core.applyAttack`.
- `core-ts` remains IO-free and runtime-ignorant: no adapter imports, no clocks, no process state, and no dependency on persona or runtime action shapes.

## Motivation And Action Flow

- Simple actor motivations are resolved deterministically in `packages/runtime/src/personas/actor/controller.mts` (`controller.js` is a thin runtime re-export of it).
- `buildMotivatedProposals()` reads `motivation.kind` from the observation actor record or `payload.initialState.actors`. It uses `resolveNearestHostile()` to choose the closest other actor by Chebyshev distance.
- Current simple motivation kinds are `attacking`, `defending`, `stationary`, and `random`: attacking actors attack adjacent hostiles or pursue distant hostiles, defending actors attack adjacent hostiles or hold position when distant, stationary actors emit no movement proposal, and random actors move to a seed-derived legal adjacent tile.
- `random` movement is deterministic pseudo-random: the choice derives from `seed:actorId:tick` (FNV/mulberry), never `Math.random()`, and synthesizes a `wait` when no legal adjacent tile exists. Replays of the same seed produce identical movement.
- Multi-actor ticks: `packages/runtime/src/runner/runtime-fsm.mjs` runs the DECIDE phase for every actor each tick and reserves proposed target tiles within the tick so two actors cannot move onto the same tile in the same tick.
- Complex motivation is opt-in. Actors with runtime decisioning enabled, for example `runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" }`, emit a `solver_request` effect instead of directly returning a concrete action.

## Solver Adapter Boundary

- Complex motivation must route through the runtime solver port (`packages/runtime/src/ports/solver.js`) and adapter implementations. Runtime code constructs the request envelope and consumes the normalized result; it does not embed solver-specific logic.
- `packages/runtime/src/personas/_shared/runtime-decision.mts` resolves fulfilled solver results through `resolveActionFromSolverResult()` and maps the selected candidate back to a concrete runtime action.
- The Z3-shaped adapter currently lives in `packages/adapters-test/src/adapters/solver/z3-adapter.js`. It is a deterministic priority-rule adapter for tests, not a real Z3 binding.
- Z3 adapter code must not move into `runtime` or `core-ts`. The dependency direction remains `adapters-* / ui-web -> runtime -> core-ts`.

## UI Sandbox Playback

- The M1 sandbox contract is playback over precomputed `tickFrames`, not live tick execution from Step or Run-To-End controls.
- `packages/ui-web/src/scenario-loader.js` compiles a scenario into a gameplay bundle by running the runtime to completion once, then the UI replays the recorded frames.
- `globalThis.__ak_loadScenario(scenario, options)` compiles and forwards to `globalThis.__ak_loadGameplayBundle(bundle, options)`.
- `packages/ui-web/src/views/gameplay-view.js` implements Step and `runToEnd()` by moving the current frame cursor over `tickFrames`; it does not call runtime step during playback.
- `packages/runtime/src/runner/core-facade.js` is the runtime-owned browser facade for preview/playback helpers that need deterministic core setup, frame rendering, observation reads, and affinity field records.
- Tick playback is keyboard-driven with a fixed binding policy: bare keys belong to the game surface, Cmd/Ctrl+arrows step tick playback, Cmd/Ctrl+`[`/`]` navigate screens back/forward, and Ctrl+digit jumps directly to a screen. Cmd+digit is reserved by browsers and never bound. The gameplay stage exposes the cursor as `data-gameplay-current-tick`.

## Sandbox Bridge (MCP → CLI → UI)

- The `ak_push_to_ui` MCP tool delivers an `agent-kernel/GameplayBundle` to a connected browser UI over the sandbox WebSocket bridge (`packages/adapters-cli/src/mcp/bridge-server.mjs`, default port 38487, override with `AK_SANDBOX_BRIDGE_PORT`).
- The tool accepts an inline `bundle`, a `bundlePath`, or an `outDir` containing `bundle.json`; the browser side is `packages/ui-web/src/sandbox-bridge-client.js`, which loads the bundle into the gameplay Phaser surface via `window.__ak_loadGameplayBundle`.
- `openBrowser: true` lets the MCP bootstrap the whole loop: it serves the canonical `index_c.html` via `scripts/serve-ui.mjs` when nothing answers `/health`, opens the default browser, and pre-stages the bundle for the bridge's replay window so the freshly opened UI loads it on connect.
- CLI `run` stitches a post-run `GameplayBundle` (`bundle.json`) only when its inputs came from an authored `create` outDir; fixture-driven runs stay bundle-free so CLI output remains artifact-for-artifact equivalent to the browser host's run output.
- The bridge is an adapter-layer concern: bundle assembly reuses runtime contracts, and no bridge or WebSocket code lives in `runtime` or `core-ts`.

## Affinity Visualization

- `core-ts` affinity field buffers are the canonical source for tile affinity visualization.
- Runtime facades assemble UI-facing tile visuals from core field records and resource bundles.
- `packages/runtime/src/render/affinity-aura.js` and `observation.auras` are retained only as compatibility output for existing renderers/tests. New preview or gameplay surfaces must not recompute JS aura fallbacks in `ui-web`.

## Phaser UI Layer

- `packages/ui-web/src/card-builder-controller.js` is a headless controller around runtime card-authoring commands. It has no DOM dependency; UI surfaces orchestrate view state only, while card semantics, simulation rules, and artifact contracts remain outside `ui-web`.
- `packages/ui-web/src/views/phaser-frame-view.js` is the unified Phaser game frame. It hosts the Card Builder surface and the Gameplay surface, including the existing `createGameplayPhaserRenderer` path.
- `ui-web` renders and emits UI intents only. The current Phaser card-builder intent set is: select chip, apply property to the active card, select card, move card between groups, load bundle, and select tile/entity. Phaser interaction mechanics remain in `ui-web`; card-authoring semantics remain in runtime.
- `packages/ui-web/src/views/card-builder-phaser-renderer.js` renders card-builder interactions for the Phaser surface without owning card semantics or artifact schemas.
- `packages/ui-web/src/phaser-surface-ingestion.js` is a UI-side artifact ingestion boundary. It routes existing versioned artifacts to the correct Phaser surface and introduces no new MCP tool schemas.
