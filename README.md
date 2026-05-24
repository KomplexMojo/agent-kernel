# agent-kernel

Pure TypeScript simulation kernel built around the **Ports & Adapters** architectural pattern.

The deterministic core now lives in `packages/core-ts`. Runtime personas, UI, CLI, and external IO remain outside the core and communicate through explicit artifacts and adapter boundaries.

## Quick Start

```bash
pnpm install
pnpm run test
pnpm run serve:ui
```

Open `http://localhost:8001/packages/ui-web/index.html` after starting the UI server.

## Architecture

- **`packages/core-ts`**: deterministic simulation state, rules, affinity/motivation codebooks, field computation, and render buffers. It performs no IO.
- **`packages/runtime`**: personas, tick orchestration, command kernel, artifact contracts, telemetry, replay, and policy coordination.
- **`packages/adapters-*`**: concrete host adapters for CLI, browser, and tests.
- **`packages/ui-web`**: browser rendering and interaction surfaces.

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

The old binary build path has been removed. CLI, runtime, and UI preview workflows use the TypeScript core directly.

## Documentation

Start with `docs/README.md`. The architecture charter and diagram are normative when implementation plans or older notes disagree.
