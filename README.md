# agent-kernel

WASM-first simulation kernel built around the **Ports & Adapters** architectural pattern.

This repository is intentionally structured to keep the **AssemblyScript WebAssembly core** small, deterministic, and environment-agnostic, while all orchestration, personas, and IO live outside the core in clearly defined layers.

---

## High-level principles

- **Browser-first**: the simulation core runs in the browser via WebAssembly.
- **Deterministic & replayable**: core logic has no IO and no hidden state.
- **Ports & Adapters**: all external interaction happens through explicit ports implemented by adapters.
- **Persona-driven runtime**: long-lived workflows and coordination logic are modeled as personas.

---

## Quick start

```
pnpm install
pnpm run build:wasm
pnpm run serve:ui
```

Open `http://localhost:8001/packages/ui-web/index.html` (or set `PORT` to override).

---

## Core vs Personas

**`core-as` (WASM)** is the authoritative simulation engine: it owns canonical state, enforces
rules deterministically, emits events/effects, and produces render frame buffers.

**Personas (runtime, TypeScript)** are workflow managers: they propose actions, coordinate phases,
orchestrate adapters, and normalize telemetry. They never mutate core state directly.

Rendering is performed by the UI layer, which reads the frame buffers produced by `core-as`.

---

## Repository layout (overview)

```
docs/                 Architectural intent and constraints
packages/
  core-as/            AssemblyScript WASM simulation core
  bindings-ts/        TypeScript bindings over WASM exports
  runtime/            Application layer (personas, orchestration)
  adapters-web/       Browser adapters (fetch, IndexedDB, etc.)
  adapters-cli/       CLI / Node adapters (automation, AI drivers)
  adapters-test/      Deterministic test adapters
  ui-web/             Browser UI (rendering + input only)
  tools/              Developer tooling
scripts/              Repo maintenance and scaffolding scripts
```

---

## Documentation (`docs/`)

| Path | Purpose |
|------|---------|
| `docs/README.md` | Documentation index (entry point) |
| `docs/vision-contract.md` | Non-negotiable constraints (browser-runnable, decentralized, API-only IO) |
| `docs/architecture-charter.md` | Ports & Adapters rules, dependency direction, banned patterns |
| `docs/architecture/diagram.mmd` | Mermaid architecture overview |

These documents define **architectural law** and are treated as normative.
Start at `docs/README.md` for the full index.

---

## Toolchain

Required to compile AssemblyScript to WebAssembly and run tests:

- **Node.js (LTS)** — build/test runtime and WASM host.
- **Package manager** — `npm` or `pnpm` for installing toolchain deps.
- **AssemblyScript compiler** — `assemblyscript` / `asc` for `packages/core-as`.
- **Test runner** — `node:test` (built-in) or the project-selected runner.

Runtime requirements: a modern browser only; no server or local installs for end users.

---

## Running tests

```
node --test "tests/**/*.test.js"
```

Core/runtime tests expect `build/core-as.wasm` to exist. If it is missing, those tests skip.

---

## `packages/core-as` — WASM simulation core

This is the **hexagon center**. It contains only deterministic simulation logic.

| Path | Purpose |
|------|---------|
| `assembly/index.ts` | Stable WASM export surface |
| `assembly/state/` | Canonical simulation state |
| `assembly/rules/` | Pure state transition rules |
| `assembly/sim/` | Step / tick / apply-action logic |
| `assembly/types/` | Shared domain types (actions, events, ids) |
| `assembly/ports/` | Effect / port definitions (IO expressed as data) |
| `assembly/util/` | Pure helpers |

**Invariant:** `core-as` imports nothing outside itself and performs no IO.

`core-as` owns canonical state and produces deterministic render frames as raw buffers in WASM memory.
The UI consumes those buffers to draw; rendering is still performed outside the core.

---

## `packages/bindings-ts` — WASM bindings

Provides a stable TypeScript API over the WASM module.

| Purpose |
|---------|
| Encapsulates WASM memory management |
| Prevents adapters and UI from touching raw WASM internals |
| Stabilizes the interface exposed by `core-as` |

---

## `packages/runtime` — Application layer

This layer composes the WASM core with ports, adapters, and personas.

### Runtime structure

| Path | Purpose |
|------|---------|
| `src/contracts/` | Shared port interfaces used by personas |
| `src/runner/` | Simulation loop, stepping, replay |
| `src/telemetry/` | Canonical telemetry envelopes |
| `src/personas/` | Persona controllers (see below) |

---

## Personas (`packages/runtime/src/personas`)

Personas represent **long-lived, stateful controllers** that coordinate workflows.
They do not perform IO directly and do not mutate WASM state directly.

Each persona follows the same structure:

```
persona-name/
  controller.ts     Lifecycle + state machine owner
  contracts.ts      Persona-specific types and invariants
  state/            Individual state handlers
```

### Defined personas

| Persona | Responsibility |
|--------|----------------|
| **Orchestrator** | Handles external interaction and drives workflows |
| **Director** | Translates requests into structured plans |
| **Configurator** | Sets simulation dials, seeds, and constraints |
| **Actor** | In-world decision logic (policies for simulation entities) |
| **Allocator** | Resource and budget allocation policies |
| **Annotator** | Telemetry capture, formatting, and emission |
| **Moderator** | Responsible for the orderly running of the simulation. |


---

## Adapters (`packages/adapters-*`)

Adapters implement ports using concrete environments.

### Web adapters

| Path | Purpose |
|------|---------|
| `adapters-web/src/network/` | HTTP / fetch-based adapters |
| `adapters-web/src/persistence/` | IndexedDB / browser storage |

### CLI adapters

| Path | Purpose |
|------|---------|
| `adapters-cli/src/` | Node-based drivers (automation, AI policies) |

### Test adapters

| Path | Purpose |
|------|---------|
| `adapters-test/src/` | Deterministic fakes for CI and replay tests |

---

## UI (`packages/ui-web`)

| Purpose |
|---------|
| Browser rendering and input handling |
| Calls into `runtime` and `bindings-ts` to load `core-as` |

---

## Tools (`packages/tools`)

| Purpose |
|---------|
| Validators, generators, inspectors |
| Development-only; not part of runtime execution |

---

## Mental model

- **WASM core** = physics of the world
- **Runtime personas** = brains and workflows
- **Ports** = promises about the outside world
- **Adapters** = concrete reality
- **UI / CLI / AI** = different drivers of the same machine

This separation is intentional and enforced to prevent architectural drift over long development cycles.
