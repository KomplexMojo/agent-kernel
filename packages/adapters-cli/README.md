# adapters-cli — CLI Adapters

`adapters-cli` provides Node-based command-line tools that implement runtime ports and
support deterministic workflows (solve, run, replay, inspect). These CLIs are **adapters**:
they do not contain core simulation logic and they do not mutate `core-as` directly.

This package exists to enable automation, debugging, and batch execution outside the UI.

---

## Scope

CLI adapters:
- Construct runtime artifacts (Intent, Plan, SimConfig, TickFrame, SolverRequest, etc.).
- Invoke runtime ports and adapters (e.g., solver, telemetry, persistence).
- Produce deterministic logs suitable for replay.

They do **not**:
- Embed simulation rules (those live in `core-as`).
- Replace personas (they call into runtime and ports, not core directly).

---

## Planned CLIs

### `solve`
Stage a constrained scenario (e.g., "two actors conflict") and call a solver adapter
to produce a `SolverResult` artifact for downstream personas.

### `run`
Execute a configured simulation run using captured artifacts, emitting TickFrame logs.

### `replay`
Replay a run deterministically from captured inputs and TickFrames without external IO.

### `inspect`
Summarize or extract telemetry snapshots for debugging and analysis.

---

## Architectural Intent

CLI tools are **adapters** in the Ports & Adapters model:

- They live outside `core-as` and do not depend on browser APIs.
- They interact with runtime through ports and artifacts.
- They can use native Node capabilities (file system, process control) without changing
  determinism, because inputs/outputs are fully captured as artifacts.

This keeps the core small and deterministic, while providing powerful automation
for development and batch workflows.

---

## Relationship to Runtime and Core

```
cli -> adapters-cli -> runtime -> bindings-ts -> core-as
```

The CLI layer is a **driver**, not a simulator. It orchestrates personas, adapters, and
artifacts in a deterministic way, enabling reproducible runs and offline analysis.
