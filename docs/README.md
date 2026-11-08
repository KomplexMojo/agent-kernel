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

- `docs/building-a-game.md` — a walkthrough of building a game on Agon, with Primordial as the worked example.
- `docs/engine-api.md` — what a game may import from Agon, how the API may change, and how to install it.
- `docs/vision-contract.md` — non-negotiable constraints and scope boundaries.
- `docs/architecture-charter.md` — Ports & Adapters rules and dependency direction.
- `docs/architecture/diagram.mmd` — Mermaid architecture overview.
- `docs/architecture/persona-state-machines.md` — deterministic persona FSM rules and state sets.
- `docs/adaptive-workflow.md` — the `AdaptiveWorkflowAgent` durable control plane: architecture, state-machine flow, model/runtime profiles, strategy rules, extension points, benchmarks, and failed-run diagnosis.

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
- The motivation-sandbox executable specs are `tests/core-ts/combat-actions.test.mts`, `tests/personas/actor/actor-motivation-combat.test.js`, `tests/runtime/runtime-combat-application.test.js`, `tests/adapters-test/z3-solver-adapter.test.js`, and `tests/personas/actor/actor-complex-motivation-z3.test.js`.
- Preview/playback helpers that need deterministic core setup go through `packages/runtime/src/runner/core-facade.js`; no client imports `core-ts` directly. The browser UI that used them was archived in Primordial (#744).
- Interactive turn-by-turn play, where the player commands one actor and every other actor takes its Actor-persona turn, goes through `packages/runtime/src/runner/play-session.js` (`runtime.step({ actorCommands })` underneath).
- Watching a recorded run in the same terminal UI goes through `packages/runtime/src/runner/run-viewer.js`, which draws each tick from the registry snapshot the run recorded.
- Core affinity field records are the canonical tile visualization input. Runtime `observation.auras` is no longer produced: its only source was the old core world's observation, removed in #227.
- Hazards are the canonical affinity dangers; room affinity labels describe their contained hazards and do not add affinity to the room itself.
- Card authoring is the Configurator persona (`authorCandidates`); `commands/card-authoring.js` was deleted (#754).

## Common Commands

```bash
pnpm run test
pnpm run test:coverage:core-ts
```

The TypeScript core is synchronous and does not require a separate binary build step.

## Builder Workflow

Agent, CLI, and UI share the same BuildSpec (`agon/BuildSpec`). The agent writes a spec, the CLI builds artifacts, and the UI can load or edit the emitted bundle without translation.

`create`, `configure`, `room-plan`, `delver-plan`, and `warden-plan` share one canonical preview handoff: `bundle.json`, `manifest.json`, `sim-config.json`, `initial-state.json`, `telemetry.json`, and `resource-bundle.json`.

## LLM Pipeline

- `AGON_LLM_LIVE=1`: enable LLM-guided planning flows.
- `AGON_LLM_MODEL`: model name for live LLM requests.
- `AGON_LLM_BASE_URL`: LLM API base URL.
- `AGON_LLM_CAPTURE_PATH`: optional JSONL capture path.
- `AGON_LLM_STRICT=1`: disable repair/sanitization.
- `AGON_ALLOW_NETWORK=1`: allow non-local adapter network access.

Fixture-driven runs remain preferred for deterministic tests and replay.
