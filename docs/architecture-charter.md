# Architecture Charter (Ports & Adapters)
Core (AssemblyScript/WASM) is pure logic. It must not depend on UI, network, storage, or Node APIs.

## Core vs Runtime Personas

This project is intentionally split into:

- **`core-as` (WASM)**: deterministic simulation rules and state transitions only.
- **Runtime personas (TypeScript)**: long-lived controllers that coordinate execution, orchestration,
  telemetry, planning, and adapter interaction.

### Why this split exists

- **Determinism**: core logic must be replayable and free of IO or hidden state.
- **Portability**: WASM core runs in any browser environment; personas can evolve without changing the core.
- **Separation of concerns**: personas handle policy, workflows, and IO selection; the core enforces rules.
- **Safety**: keeping IO-adjacent logic out of the core prevents architectural drift.

### What belongs in `core-as`

- Canonical simulation state and transition rules.
- Deterministic validation and legality checks.
- Pure effects emitted as data (no IO). Effects must carry deterministic ids/requestIds and fulfillment hints; new kinds include solver_request, need_external_fact (fulfill/defer), log/telemetry, and limit_violation.
- Deterministic render frame generation from canonical state (UI renders the buffer).

### What belongs in personas (runtime)

- Long-lived workflows and state machines.
- Action proposal/ordering, orchestration, and integration logic (including budget-aware request_external_fact/request_solver/fulfill/defer loops).
- Telemetry capture, normalization, and emission; log/telemetry effects are data-only and routed via adapters.
- UI rendering and presentation logic (consumes core frame buffers).
- Guidance-to-artifact derivation for background builders (for example, summary-to-level-gen transforms used by worker adapters).

The browser still runs JavaScript to host WASM. Shipping a no-install browser app does not require
persona code to be inside WASM; it only requires that all code is delivered as static assets.

---

Allowed dependency direction:
- adapters-*  -> runtime -> bindings-ts -> core-as (WASM)
- ui-web      -> runtime -> bindings-ts -> core-as (WASM)
- core-as imports nothing outside itself

All external IO must be implemented as adapters via narrow ports.

### Dedicated Builder Port

- The LLM/orchestrator step may stop at guidance summary generation.
- Heavy level synthesis must run behind a builder adapter (web worker in browser, in-process fallback in tests/unsupported runtimes).
- UI code must hand off summaries to this adapter instead of synthesizing layouts on the main thread.
- The builder output contract must include both ASCII and image-ready level artifacts.
- The same builder adapter must support regeneration from guidance summary, normalized `levelGen`, or direct tile rows so it can be reused during simulation ticks and live gameplay updates.
- Gameplay visibility policy (fog of war, explored-cell HUDs, viewport limits) lives in runtime/UI layers; simulation review may still render full-map output.
