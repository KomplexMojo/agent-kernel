# agent-kernel

`agent-kernel` is a fixture-first simulation framework for building, running, replaying, and inspecting deterministic dungeon scenarios.

The project is organized around **Ports & Adapters**. The deterministic simulation core lives in `packages/core-ts`; runtime personas, CLI tools, browser UI, test doubles, and external IO live outside the core and communicate through explicit, versioned artifacts.

## What This Repo Contains

- A pure TypeScript simulation core for world state, movement, affinities, motivations, hazards, resources, and combat rules.
- Runtime personas that plan, configure, budget, execute, observe, and integrate simulation runs without putting policy or IO into the core.
- CLI and MCP adapters for authoring scenarios, building artifact bundles, running simulations, replaying tick frames, and inspecting prior runs.
- Browser UI surfaces for card building, preview, gameplay playback, and diagnostics.
- Fixture-backed adapters and tests so most workflows run offline and deterministically.

The old binary build path has been removed. CLI, runtime, and UI preview workflows use the TypeScript core directly.

## Quick Start

```bash
pnpm install
pnpm run test
pnpm run serve:ui
```

Open `http://localhost:8001/packages/ui-web/index.html` after starting the UI server.

For a CLI-first smoke path, use:

```bash
node packages/adapters-cli/src/cli/ak.mjs create \
  --room "size=small;count=1" \
  --delver "count=1;affinity=fire;motivation=attacking" \
  --warden "count=1;affinity=dark;motivation=defending"
```

By default, generated artifacts are written under `artifacts/runs/<runId>/<command>/`.

## Architecture

- **`packages/core-ts`**: deterministic simulation state, rules, affinity/motivation codebooks, field computation, and render buffers. It performs no IO.
- **`packages/runtime`**: personas, tick orchestration, command kernel, artifact contracts, telemetry, replay, and policy coordination.
- **`packages/adapters-*`**: concrete host adapters for CLI, browser, and tests.
- **`packages/ui-web`**: browser rendering and interaction surfaces.

The important boundary is that `core-ts` decides what happens in the simulation, while adapters and personas decide how requests enter the system, how artifacts are assembled, and where outputs are written.

Allowed dependency direction:

```text
adapters/ui -> runtime -> core-ts
```

## Common Commands

```bash
pnpm run test
pnpm run test:coverage:core-ts
pnpm run benchmark:core-ts-affinity
pnpm run serve:ui
```

## Documentation

Start with `docs/README.md` for the project map and reading order. The architecture charter and diagram are normative when implementation plans or older notes disagree.

Useful next stops:

- `packages/adapters-cli/README.md` for CLI workflows and artifact outputs.
- `packages/adapters-cli/src/mcp/README.md` for MCP tool usage.
- `tests/README.md` for deterministic test workflow.
- `tools/remote-ollama-control/README.md` for remote Ollama benchmark/control workflows.
