# Documentation Index

This folder contains the design intent, architecture rules, and current execution model for the project. Treat it as the starting point when you need to understand why the repo is shaped the way it is.

## Reading Order

For a newcomer, read these in order:

1. `README.md` at the repo root for the high-level project map.
2. `docs/vision-contract.md` for the constraints the project is preserving.
3. `docs/architecture-charter.md` for dependency direction and Ports & Adapters rules.
4. `docs/architecture/diagram.mmd` for the package-level map.
5. `docs/architecture/persona-state-machines.md` for runtime persona phases and transitions.
6. Package READMEs for the area you are working in.

When older notes disagree with the charter or vision contract, the charter and vision contract win.

## Core Documents

- `docs/vision-contract.md` — non-negotiable constraints and scope boundaries.
- `docs/architecture-charter.md` — Ports & Adapters rules and dependency direction.
- `docs/architecture/diagram.mmd` — Mermaid architecture overview.
- `docs/architecture/persona-state-machines.md` — deterministic persona FSM rules and state sets.

## Current Execution Model

At runtime, the system moves from authored intent to deterministic replayable artifacts:

1. A user, agent, fixture, or UI surface describes a scenario.
2. Runtime personas translate that intent into plans, budgets, configuration, and execution requests.
3. The TypeScript core applies deterministic rules and emits state changes.
4. Runtime writes TickFrames, effects, summaries, telemetry, and bundles for replay and inspection.

Key facts:

- The deterministic simulation core is `packages/core-ts`.
- The tick FSM (`init -> observe -> decide -> apply -> emit -> summarize`) is the canonical runtime loop.
- Runtime routes phase events through the tick orchestrator and personas before applying actions to the core.
- TickFrames are emitted per phase and include actions/effects plus persona views/telemetry for deterministic replay.
- Runtime inputs are documented in `docs/runtime-inputs.md`.
- The canonical M6 sandbox scenario fixture is `tests/fixtures/scenarios/delver-warden-battle-v1-basic.json`.
- The motivation-sandbox executable specs are `tests/core-ts/combat-actions.test.mts`, `tests/runtime/actor-motivation-combat.test.js`, `tests/runtime/runtime-combat-application.test.js`, `tests/adapters-test/z3-solver-adapter.test.js`, and `tests/runtime/complex-motivation-z3.test.js`.
- The UI sandbox exposes Step and Run-To-End playback over precomputed `tickFrames`; tests and tooling can load scenarios through `window.__ak_loadScenario(scenario, options)` or bundles through `window.__ak_loadGameplayBundle(bundle, options)`.
- UI preview/playback helpers that need deterministic core setup go through `packages/runtime/src/runner/core-facade.js`; `ui-web` must not import `core-ts` directly.
- Core affinity field records are the canonical tile visualization input. Runtime `observation.auras` remains compatibility output only.
- Hazards are the canonical affinity dangers; room affinity labels describe their contained hazards and do not add affinity to the room itself.
- The Phaser UI shell is centered on `packages/ui-web/src/views/phaser-frame-view.js`, a unified game frame for Card Builder and Gameplay surfaces.
- Card-authoring semantics live in `packages/runtime/src/commands/card-authoring.js`; `packages/ui-web/src/card-builder-controller.js` is the headless controller used by DOM and Phaser renderers.
- `packages/ui-web/src/views/card-builder-phaser-renderer.js` renders the Card Builder surface inside the Phaser frame.
- `packages/ui-web/src/phaser-surface-ingestion.js` routes existing versioned artifacts to the correct UI surface.
- `tests/playwright/phaser-frame.spec.mjs` is the Phaser frame browser smoke test.

## Common Commands

```bash
pnpm run test
pnpm run test:coverage:core-ts
pnpm run benchmark:core-ts-affinity
pnpm run serve:ui
```

The TypeScript core is synchronous and does not require a separate binary build step.

## Builder Workflow

Agent, CLI, and UI share the same BuildSpec (`agent-kernel/BuildSpec`). The agent writes a spec, the CLI builds artifacts, and the UI can load or edit the emitted bundle without translation.

`create`, `configure`, `room-plan`, `delver-plan`, and `warden-plan` share one canonical preview handoff: `bundle.json`, `manifest.json`, `sim-config.json`, `initial-state.json`, `telemetry.json`, and `resource-bundle.json`.

## LLM Pipeline

- `AK_LLM_LIVE=1`: enable LLM-guided planning flows.
- `AK_LLM_MODEL`: model name for live LLM requests.
- `AK_LLM_BASE_URL`: LLM API base URL.
- `AK_LLM_CAPTURE_PATH`: optional JSONL capture path.
- `AK_LLM_STRICT=1`: disable repair/sanitization.
- `AK_ALLOW_NETWORK=1`: allow non-local adapter network access.

Fixture-driven runs remain preferred for deterministic tests and replay.
