# Moderator Persona

The Moderator is the **execution and sequencing persona** for the simulation.

It is responsible for running the simulation loop in a controlled, deterministic manner. The Moderator advances time, sequences and applies actions, and ensures that the simulation progresses according to a well-defined execution model.

This document defines the Moderator as a **runtime execution role**. Simulation rules, legality, and state transitions are enforced by the simulation core (`core-as`), while planning, configuration, and policy are handled by other personas.

---

## Persona Scope

The Moderator persona is responsible for **how the simulation is executed**, not for deciding what should be attempted or how the world is configured.

At a high level, the Moderator:
- Owns the simulation clock and tick advancement.
- Sequences execution phases in a deterministic order.
- Submits actions to the simulation core.
- Receives events and effects emitted by the core.
- Coordinates action sequencing and batching at the execution level.

The Moderator does not plan strategy, assemble configuration, or integrate with external systems.

---

## Responsibilities

### Tick and Phase Advancement
The Moderator:
- Advances the simulation clock one tick at a time.
- Enforces a strict phase order (e.g. observe → decide → act → resolve → emit).
- Ensures that all actors and systems observe a consistent notion of time.

Tick progression is explicit and fully controlled by the Moderator.

---

### Action Submission and Ordering
The Moderator:
- Collects actions proposed by Actor personas.
- Orders or batches actions according to deterministic rules.
- Submits actions to `core-as` for validation and application.

The Moderator does not decide *which* actions actors choose—only *when* and *in what order* they are applied.

---

### Action Sequencing and Conflict Preparation
When multiple actions interact (e.g. simultaneous movement or competing interactions), the Moderator is responsible for:

- Collecting unordered action proposals.
- Transforming them into a deterministic, ordered execution sequence.
- Optionally rejecting or deferring actions procedurally (e.g. capacity limits, phase rules).

The Moderator does **not** decide whether an action is legal or what its effects are.
It supplies an ordered sequence of actions to `core-as`, which enforces legality
and produces authoritative outcomes (accepted, rejected, or state-changing).

In short:
- The Moderator decides **when and in what order** actions are applied.
- `core-as` decides **what happens** when each ordered action is applied.

---

### Event and Effect Handling
The Moderator:
- Receives events and effects emitted by `core-as`.
- Routes events to downstream consumers (notably the Annotator).
- Routes effects according to their declared fulfillment category.
- Records effect fulfillment outcomes (fulfilled/deferred) for replay.
- Emits per-tick TickFrame records used as the canonical execution timeline.

During execution (`phase: "execute"`), the Moderator may **only fulfill deterministic effects**,
using pure, replayable providers (e.g. seeded randomness or pre-captured facts).

Effects that require external IO (persistence, publication, anchoring, notifications, etc.)
are **never fulfilled during execution**. These effects are recorded and deferred for
post-run handling by the Orchestrator and adapters.

For `need_external_fact` effects:
- Deterministic fulfillment is allowed only when `sourceRef` points to pre-captured artifacts.
- If no deterministic source is provided, fulfillment must be deferred and handled post-run.

The Moderator does not interpret events or effects beyond what is required for sequencing
and routing.

---

## Determinism and Replay

To preserve determinism and replayability:
- Tick advancement is explicit and reproducible.
- Action ordering rules are deterministic.
- No external IO is performed during execution.
- All inputs to execution (configuration, actions, constraints) are explicit artifacts.
- Effect fulfillment during execution is limited to deterministic providers; all IO-bound
  side effects are deferred and handled outside the execution phase.

Replaying a run requires only the recorded inputs and does not involve external systems.

---

## Relationship to Other Personas

The Moderator:
- **Consumes** configuration artifacts produced by the Configurator.
- **Applies** actions chosen by Actor personas.
- **Enforces** budget caps and limits supplied by the Allocator (via core enforcement).
- **Exposes** events and effects to the Annotator.
- **Does not** plan strategy (Director).
- **Does not** integrate with external systems (Orchestrator).

---

## Relationship to core-as

The Moderator does **not**:
- Implement simulation rules.
- Mutate state directly.
- Decide action legality.
- Interpret simulation outcomes.

Instead, the Moderator:
- Calls into `core-as` to apply actions and advance state.
- Treats `core-as` as the sole authority on state transitions and outcomes.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Moderator state-machine
inputs/outputs belong in `packages/runtime/src/personas/moderator/contracts.ts`.

The runtime runner module is owned by the Moderator and exists to execute Moderator-controlled ticks.

This separation ensures that:
- Execution mechanics are isolated from planning and policy.
- The simulation loop remains inspectable and testable.
- Deterministic behavior is preserved even as strategies and policies evolve.

The Moderator is therefore the **timekeeper and referee coordinator**, responsible for orderly execution while deferring all rule enforcement to the simulation core.
