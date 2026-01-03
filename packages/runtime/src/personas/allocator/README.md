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

Budget receipts are emitted as `agent-kernel/BudgetReceiptArtifact` and reference
the originating `BudgetArtifact` and `PriceList` for auditability.

---

## ALLOCATOR scenarios

The examples below assume integer tokens and the current price list rules:
- Actor spawn is 0 tokens and starts with zero vitals, no affinities, no motivations.
- Vital points cost 1 token each (health/mana/stamina/durability).
- Regen costs 10 tokens per +1 per tick (per vital).
- Affinity stacks are quadratic: base cost = `50 * stacks^2`.
- Affinity expression stacks are quadratic: expression cost = `60 * stacks^2`.
- Motivations: reflexive = 1, goal-oriented = 5, strategy-focused = 20 tokens.
- Actors without movement-related motivations are treated as tiles/barriers.
- Vitals without regen are one-time pools; once spent, they do not recover.

Scenario A: 100-token single-stat actor
- Health 100 = 100 tokens
- Total cost = 100 (no regen, affinities, or motivations)

Scenario B: 300-token balanced actor with regen + motivations
- Health 80 (80) + Stamina 60 (60) + Mana 40 (40) + Durability 20 (20)
- Health regen +2 (20) + Stamina regen +1 (10)
- Motivation: goal-oriented (5) + reflexive (1)
- Total cost = 236 tokens (64 tokens remain for more V/A/M)

Scenario C: 1,000-token affinity specialist (quadratic example)
- Health 100 (100) + Stamina 50 (50)
- Affinity stacks (2): 50 * 2^2 = 200
- Affinity expression (externalize, 2): 60 * 2^2 = 240
- Motivation: strategy-focused (20)
- Total cost = 610 tokens (390 tokens remain)
- Note: 3 stacks would cost 50 * 3^2 = 450 and 60 * 3^2 = 540 (990 total for affinity + expression)

Scenario D: Director-scale 10,000-token budget (illustrative)
- 10 actors with Health 150 each = 1,500 tokens
- 10 actors with Stamina 50 each = 500 tokens
- 10 actors with Health regen +1 = 100 tokens
- 6 actors with 3-stack affinity + expression = 6 * 990 = 5,940 tokens
- 10 strategy-focused motivations = 200 tokens
- Total cost = 8,240 tokens (1,760 tokens remain)

Scenario E: Level building with durable, immobile tiles and barriers
- Goal: large level using tile actors and barriers (no movement motivations).
- Tile profile: Durability 1 (1 token), no regen, no affinities, no motivations.
- Barrier profile: Durability > 1 (e.g., Durability 5 = 5 tokens), no regen, no affinities, no motivations.
- Budget for tiles + barriers = 3,000 tokens.
- Example mix: 2,000 tiles (2,000 tokens) + 200 barriers at Durability 5 (1,000 tokens) = 3,000 tokens total.
- Implication: higher barrier durability reduces how many barriers can be placed within the budget.

Note: Fog tiles can be priced via atomic items (mana, regen, affinity stacks, expression). A persona (e.g., Director or Configurator) should compute the composite cost for a fog tile profile rather than adding a bespoke price list entry.

Note: Sensing can be modeled as an affinity kind with mana drain; externalize (push) enables long-range fog piercing, localized (emit) extends local visibility radius, and internalized (pull) can represent self-focused detection (e.g., trap awareness within normal sight). Composite costs should be derived from atomic affinity + expression + mana/regen pricing.

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

## Drift guardrails
- Canonical entrypoints: `controller.mts` + `state-machine.mts` + `contracts.ts`; import controllers (not state machines) from consumers.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.mts`; use `ts-node/esm` or a build step before consuming outside the test harness.
