# Documentation Index

This folder contains the design intent and architecture rules for the project.

## Core Documents

- `docs/vision-contract.md` — non-negotiable constraints and scope boundaries.
- `docs/architecture-charter.md` — Ports & Adapters rules and dependency direction.
- `docs/architecture/diagram.mmd` — Mermaid architecture overview.
- `docs/architecture/persona-state-machines.md` — deterministic persona FSM rules and state sets.

If a plan or README conflicts with these documents, the charter and vision contract win.

## Current Execution Model

- The deterministic simulation core is `packages/core-ts`.
- The tick FSM (`init -> observe -> decide -> apply -> emit -> summarize`) is the canonical runtime loop.
- Runtime routes phase events through the tick orchestrator and personas before applying actions to the core.
- TickFrames are emitted per phase and include actions/effects plus persona views/telemetry for deterministic replay.
- Runtime inputs are documented in `docs/runtime-inputs.md`.

## Common Commands

```bash
pnpm run test
pnpm run test:coverage:core-ts
pnpm run benchmark:core-ts-affinity
pnpm run serve:ui
```

The TypeScript core is synchronous and does not require a separate binary build step.

## Builder Workflow

Agent/CLI/UI share the same BuildSpec (`agent-kernel/BuildSpec`). The agent writes a spec, the CLI builds artifacts, and the UI can load/edit the emitted bundle without translation.

`create`, `configure`, `room-plan`, `delver-plan`, and `warden-plan` share one canonical preview handoff: `bundle.json`, `manifest.json`, `sim-config.json`, `initial-state.json`, `telemetry.json`, and `resource-bundle.json`.

## LLM Pipeline

- `AK_LLM_LIVE=1`: enable LLM-guided planning flows.
- `AK_LLM_MODEL`: model name for live LLM requests.
- `AK_LLM_BASE_URL`: LLM API base URL.
- `AK_LLM_CAPTURE_PATH`: optional JSONL capture path.
- `AK_LLM_STRICT=1`: disable repair/sanitization.
- `AK_ALLOW_NETWORK=1`: allow non-local adapter network access.

Fixture-driven runs remain preferred for deterministic tests and replay.
