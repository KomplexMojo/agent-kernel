# Allocator Persona

The Allocator is the **budgeting and resource-policy persona** for the simulation.

It acts as a deterministic “banker” that evaluates proposed simulation configurations and behaviors against explicit cost models, ensuring that runs remain bounded, auditable, and comparable.

This document defines the Allocator as a **policy and coordination role**. Detailed rule enforcement and state mutation remain the responsibility of the simulation core (`core-as`).

---

## Persona Scope

The Allocator persona is responsible for **deciding whether proposed activity is affordable**, not for enforcing the effects of that activity.

At a high level, the Allocator:
- Owns budget policies and cost models.
- Evaluates requests for resources or complexity.
- Issues validated budget receipts.
- Signals approval, rejection, or required reconciliation.

The simulation core (`core-as`) remains responsible for applying costs to state and enforcing consequences.

---

## Responsibilities

### Budget Policy and Cost Modeling
The Allocator defines and applies:
- Global purses or run-level budgets.
- Deterministic price lists for actions, actors, motivations, solver depth, or layout complexity.
- Budget categories (e.g. movement, cognition, structure, effects).

Price lists are policy artifacts. The Orchestrator may fetch them externally (e.g., IPFS)
and provide them to the Allocator as inputs.

These models are explicit, deterministic, and inspectable.

---

### Request Evaluation
Upstream personas (e.g. Director, Configurator, Actor policies) may submit requests such as:
- Proposed actor counts or compositions.
- Enabled motivation stacks.
- Solver depth or planning horizons.
- Structural or layout complexity.

The Allocator evaluates these requests against available budgets and produces a decision.

---

### Budget Receipts
When a request is accepted, the Allocator issues a **budget receipt** that:
- Caps allowed spending.
- Encodes limits and constraints.
- Is passed downstream as a validated artifact.

Downstream personas must operate within the bounds of the receipt.

---

### Reconciliation and Adjustment
When budgets are exceeded or threatened, the Allocator may:
- Require simplification (e.g. reduce actors, truncate motivations).
- Reject configurations outright.
- Propose alternative allocations that fit the purse.

These decisions are expressed as data and remain auditable.

---

## Determinism and Replay

To preserve determinism:
- All cost models and allocation decisions are deterministic functions of inputs.
- Budget decisions are explicit artifacts that can be logged and replayed.
- The same requests presented to the Allocator will always yield the same decision.

This allows budget enforcement to be compared across runs and environments.

---

## State machine & phases
- States: idle → budgeting → allocating → monitoring → rebalancing.
- Subscribed tick phases: observe, decide.
- Outputs: budget policies/receipts as data; no IO or direct state mutation.

## Relationship to core-as

The Allocator does **not**:
- Deduct resources from simulation state.
- Enforce movement, action, or solver costs directly.
- Modify world or actor state.

Instead, it supplies **constraints and receipts** that the runtime and core respect.

`core-as` maintains the authoritative budget ledger (caps, spend, availability) and emits
limit events when caps are reached or violated.

### What this implies for core-as

The following concepts may exist in `core-as`, but only as **data and rule enforcement**, not policy:

- Representation of resource counters or cost accumulators.
- Validation that actions respect provided caps.
- Emission of events when limits are reached or violated.

Pricing, prioritization, and trade-offs remain exclusively in the Allocator persona.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Allocator state-machine
inputs/outputs belong in `packages/runtime/src/personas/allocator/contracts.ts`.

This separation ensures that:
- Cost control is explicit and auditable.
- Economic experimentation does not destabilize simulation rules.
- Budget policy can evolve independently of core mechanics.

The Allocator is therefore a **policy authority**, not a rule engine, designed to keep complexity bounded while preserving determinism and replayability.
