# core-as — Simulation Core (AssemblyScript / WebAssembly)

`core-as` is the **deterministic simulation kernel** of the system, implemented in AssemblyScript and compiled to WebAssembly.

It defines the **physics of the world**: how state changes over time in response to actions.  
It does *not* decide intent, perform IO, coordinate workflows, define economic policy, perform observability, assemble scenarios, perform planning, **or run the simulation loop itself**.

This module is designed to be:
- Browser-runnable
- Deterministic and replayable
- Environment-agnostic
- Stable over long time horizons

---

## Purpose and Scope

The responsibility of `core-as` is intentionally narrow:

- Define the **canonical world state**
- Define **actors** as simulation entities
- Define **legal actions** and their semantics
- Apply actions to state deterministically
- Emit events describing what occurred
- Derive observations as pure data
- Produce deterministic render frames derived from canonical state

Everything else — external interaction, intent formation, planning, configuration, budgeting policy, **execution sequencing**, telemetry aggregation, formatting, and IO — lives outside the core.

## Build and Use

```
pnpm run build:wasm
```

Load the resulting `build/core-as.wasm` via `packages/bindings-ts` or the runtime runner.

## Configuration

- No environment variables or runtime config are read directly by `core-as`.
- All inputs are provided via artifacts and bindings calls.

---

## What Belongs in core-as

### World and Actor State
- Actor identity, position, traits, and stats
- Classification of actors (stationary vs ambulatory)
- Spatial relationships and constraints
- Global simulation state required for rule evaluation

### Actions and Rules
- Action types (e.g. move, wait, interact)
- Validation rules (what actions are legal)
- State transition logic
- Conflict rules and legality outcomes (collisions, blocking, resource contention)

`core-as` defines *what happens* when actions are applied, not *when* or *in what order* they are applied.

In particular, `core-as` defines conflict *outcomes* given an ordered set of applied actions
(e.g., whether a move is legal, rejected, or causes a state change), but it does not decide
how simultaneous action proposals are ordered or batched. The transformation from unordered
action proposals into an ordered execution sequence is the responsibility of the Moderator.

### Configuration Consumption (Policy-Free)
`core-as` consumes **externally produced configuration artifacts** but does not create, modify, validate, or interpret them.

This includes:
- Initial world state descriptions
- Static layout representations (grids, graphs, surfaces)
- Enabled or disabled rule flags
- Initial actor instantiation data
- Externally supplied limits and constraints

Configuration artifacts are treated as **immutable inputs** once execution begins.

All decisions about:
- *what should be attempted* (planning),
- *how scenarios are assembled* (configuration),
- *which external systems are involved* (orchestration),
- *how execution is sequenced* (moderation),

belong to upstream personas (Director, Configurator, Orchestrator, and **Moderator** respectively).

### Costs, Limits, and Enforcement (Policy-Free)
`core-as` may represent and enforce **externally supplied constraints**, but it does not define them.

This includes:
- Resource counters or cost accumulators attached to state
- Application of costs when actions are executed
- Validation that actions respect provided caps or limits
- Emission of events when limits are reached or violated

`core-as` is the **ledger of available and allocated funds** for a run. It tracks spend against
the caps supplied via configuration and reports spend via limit events and optional snapshots.

All pricing, prioritization, trade-off, reconciliation, and escalation logic is supplied by upstream personas (notably the Allocator).

### Events and Observations
- Events emitted as the result of applying actions
- Observations derived from state for actor decision-making
- Minimal state snapshots required for replay and inspection
- All outputs expressed as pure, serializable data

Events are **facts**, not interpretations, plans, or execution decisions.

---

## What Does *Not* Belong in core-as

To preserve determinism and portability, the following are explicitly excluded:

- Decision-making or intent selection
- Planning, strategy, or goal formulation
- Scenario assembly or configuration validation
- Actor motivations, policies, or budget strategies
- Orchestration, routing, or external service selection
- **Simulation loop control, tick advancement, or action ordering**
- Validation of high-level scenario coherence
- Long-lived workflows or personas
- Pricing models or economic trade-offs
- Telemetry aggregation, formatting, or interpretation
- Observability concerns (metrics, traces, summaries)
- Networking, persistence, clocks, randomness from the environment
- Direct calls to browser, Node, or external APIs

If a concern involves **external systems**, **intent**, **planning**, **policy**, **coordination**, **execution sequencing**, **interpretation**, or **IO**, it does not belong here.

---

## Determinism and Replay

Determinism is a primary design constraint.

`core-as` guarantees that:
- Given the same initial state
- Given the same configuration artifacts
- Given the same sequence of actions
- Given the same externally supplied constraints and deterministic inputs

…the resulting state and emitted events will be identical.

This enables:
- Full replay from an action log
- Independent re-annotation of the same run
- Replay without contacting external systems
- Cross-environment verification (browser, CLI, tests)
- Fair comparison between different planning, configuration, **execution**, decision-making, allocation, and orchestration strategies

---

## Deterministic Input Validation

`core-as` performs minimal, deterministic validation to prevent undefined behavior. This is
referee-level sanity checking, not scenario coherence or policy validation.

- Invalid init/config inputs are rejected with a stable `init_invalid` / `config_invalid` event or effect.
- Malformed actions are rejected with `action_rejected` outcomes.

These checks must be deterministic and emit explicit, replayable outcomes.

---

## Ports and Effects

`core-as` does not perform IO.  
When interaction beyond pure simulation is required, it is expressed as **effects** or **requests** in data form.

Examples:
- Requesting random values
- Requesting external facts
- Signaling that persistence or publication is required
- Signaling budget or limit violations

Effects are surfaced to the runtime layer, which fulfills them via adapters and personas.  
Downstream personas (notably the Annotator) may observe these effects but never alter them.

---

## Architectural Relationships

- `core-as` is consumed by `bindings-ts`, which provides a stable TypeScript API.
- The runtime layer drives the simulation by supplying:
  - configuration artifacts (from the Configurator),
  - actions (from Actor personas),
  - externally defined constraints (from Allocator),
  - **execution sequencing and tick advancement (from the Moderator)**.
- Planning artifacts (Director) and integration decisions (Orchestrator) are **never consumed directly** by `core-as`; they are transformed into configuration or handled entirely outside execution.
- Personas (Actor, Configurator, Allocator, Director, Orchestrator, Moderator, Annotator) operate *around* the core, never inside it.
- Annotator consumes events and effects as read-only inputs.

Dependency direction is strictly outward:

```
adapters / ui / cli
        ↓
      runtime
        ↓
   bindings-ts
        ↓
     core-as
```

---

## Design Intent

The long-term intent of `core-as` is to remain:

- Small and understandable
- Resistant to feature creep
- Easy to reason about mathematically
- Cheap to audit and replay

If a proposed change makes `core-as` responsible for **execution control**, **orchestration**, **planning**, **configuration**, **policy**, **prioritization**, **economic choice**, or **observability interpretation**, it belongs elsewhere.

---

## Core vs Personas (Execution Relationship)

Personas are workflow managers and decision-makers that live in the runtime layer.
They propose actions, coordinate sequencing, and integrate external inputs.

`core-as` is the authoritative simulation engine: it owns the canonical state, enforces
rules, and produces deterministic outputs (events, observations, and render frames).

The UI renders frames produced by `core-as`. Rendering itself still happens in the UI layer;
`core-as` only generates the pixel buffer.

---

## Rendering Responsibility

`core-as` exposes render frames as raw buffers in WASM memory. The UI reads these buffers
and paints them to the screen. This keeps rendering deterministic while keeping the core
free of direct DOM or graphics APIs.

---

## Snapshot Ceiling

Snapshots are **stable inspector views only** and must not expose full internal state.
If a full state dump is needed for debugging, it must be emitted as a separate debug artifact
with explicit "debug-only" warnings and no determinism guarantees.
