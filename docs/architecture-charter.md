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
- Solver/external fact request routing through ports.
- UI-facing visualization assembly from core outputs and resource bundles.

## Builder Port

Heavy level synthesis runs behind a builder adapter. UI code hands off summaries, normalized `levelGen`, or direct tile rows to that adapter instead of synthesizing layouts on the main thread.
