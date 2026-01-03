# Configurator Persona

The Configurator is the **simulation configuration and composition persona**.

It is responsible for translating high-level plans into **concrete, executable simulation configurations**. The Configurator turns intent into structure by setting parameters, assembling layouts, and enabling or disabling features required for a run.

This document defines the Configurator as a **runtime composition and validation role**. Simulation rules, legality, and state transitions remain the responsibility of the simulation core (`core-as`).

---

## Persona Scope

The Configurator persona is responsible for **deciding how a simulation is set up**, not for enforcing what happens once it runs.

At a high level, the Configurator:
- Consumes structured plans produced by the Director.
- Produces a fully specified simulation configuration.
- Ensures configurations are internally consistent before execution.
- Hands validated configuration artifacts to the runtime runner.
- Emits a spend proposal for the Allocator when budgets/price lists are provided.

The simulation core (`core-as`) remains the sole authority on rule enforcement and state mutation.

---

## Responsibilities

### Configuration Assembly
The Configurator assembles:
- World and layout parameters (rooms, corridors, anchors, topology).
- Actor instantiation details (counts, traits, initial placement).
- Enabled systems and rule toggles.
- Initial limits and constraints supplied by upstream personas.

All configuration is explicit, serializable, and inspectable.

---

### Validation and Consistency Checks
Before execution, the Configurator performs:
- Structural validation (e.g. connectivity, reachability, containment).
- Constraint checks (e.g. required anchors present, queues sized correctly).
- Compatibility checks between enabled systems.

Validation ensures that the simulation starts from a **coherent state**, not that it will behave correctly at runtime.

---

### Solver-backed Validation (Optional)
Where constraints are complex, the Configurator may invoke solver-backed validation to:
- Verify layout feasibility.
- Confirm logical constraints are satisfiable.
- Reject or simplify configurations that cannot be made consistent.

Solver usage is bounded, deterministic, and treated as a configuration-time aid, not a runtime dependency.

---

## Determinism and Replay

To preserve determinism:
- Configuration output is a pure function of input plans and parameters.
- Validation decisions are deterministic and reproducible.
- The same inputs will always yield the same configuration artifact.

Once execution begins, the Configurator no longer participates in the simulation loop.

---

## Relationship to core-as

The Configurator does **not**:
- Apply simulation rules.
- Resolve conflicts at runtime.
- Modify state during ticks.
- Interpret or emit simulation events.

Instead, it supplies:
- Initial world state descriptions.
- Configuration flags and constraints.
- Static artifacts consumed by the simulation core at startup.

## State machine & phases
- States: uninitialized → pending_config → configured → locked.
- Subscribed tick phases: init, observe.
- Outputs: configuration artifacts/refs (data-only); no IO or runtime mutation.

`core-as` enforces all rules and transitions based on the provided configuration.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Configurator state-machine
inputs/outputs belong in `packages/runtime/src/personas/configurator/contracts.ts`.

This separation ensures that:
- Scenario setup complexity does not leak into the simulation core.
- Configuration logic can evolve independently of runtime mechanics.
- Invalid or incoherent scenarios are rejected early and explicitly.

The Configurator is therefore a **bridge between planning and execution**, responsible for preparing the simulation so that deterministic rules can operate without ambiguity.
