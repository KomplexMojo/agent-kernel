The Director turns strategy into actionable tactics. It collaborates with the Orchestrator to fetch external insight (e.g., LLM-generated “trap level” strategies from Ollama/OpenAI endpoints), translates that guidance into budgets, layouts, and actor directives for the Configurator, and ensures plans stay within the available shards/tokenized budgets before a single instruction reaches the simulation.

# Director Persona

The Director is the **planning and intent-translation persona**.

It is responsible for turning high-level strategy into **structured, actionable plans** that can be executed by downstream personas. The Director bridges the gap between external intent and internal execution by shaping goals, constraints, and tactics into a form the system can reason about.

This document defines the Director as a **runtime planning role**. Simulation rules, configuration assembly, budgeting policy, and execution remain the responsibility of other personas and the simulation core (`core-as`).

---

## Persona Scope

The Director persona is responsible for **deciding what should be attempted**, not for deciding how it is configured or how it unfolds during execution.

At a high level, the Director:
- Consumes high-level goals, strategy, or external guidance.
- Produces structured plans and directives.
- Ensures plans are internally coherent and well-scoped.
- Hands plans to downstream personas for feasibility checks and configuration.

The Director does not participate in simulation execution and does not mutate simulation state.

---

## Responsibilities

### Strategy Translation
The Director translates inputs such as:
- External instructions or prompts (human, AI, or scripted).
- Scenario-level objectives (e.g. difficulty, themes, success conditions).
- Environmental or narrative constraints.

Into **explicit planning artifacts**, such as:
- Target objectives and priorities.
- Actor roles and high-level behaviors.
- Structural intents (e.g. defensive layout, exploration focus).
- Constraint envelopes to be respected downstream.

---

### Plan Structuring
The Director produces plans that are:
- Explicit and serializable.
- Decomposed into clear directives.
- Free of implementation details.

Plans describe *what is desired*, not *how it will be built* or *how it will be enforced*.

---

### Boundary Management
The Director ensures that:
- Plans are scoped narrowly enough to be feasible.
- Responsibilities are clearly delegated to downstream personas.
- No execution or configuration details leak into planning artifacts.

Feasibility, cost, and validation are delegated to other personas.

## State machine & phases
- States: uninitialized → intake → draft_plan → refine → ready → stale.
- Subscribed tick phases: decide (ignores other phases).
- Outputs: data-only planning artifacts; no IO and no direct state mutation.

---

## Determinism and Replay

To preserve determinism and replayability:
- Director outputs are pure functions of their inputs.
- The same inputs will always yield the same plan.
- Plans are explicit artifacts that can be logged and replayed.

Replay does not require re-running external systems that originally produced the strategy.

---

## Relationship to Other Personas

The Director:
- **Consumes** intent from the Orchestrator or external drivers.
- **Supplies** structured plans to the Configurator.
- **Does not** enforce budgets (Allocator).
- **Does not** assemble configurations (Configurator).
- **Does not** influence execution or observe outcomes (Annotator).

---

## Relationship to core-as

The Director does **not**:
- Apply simulation rules.
- Assemble world state or layouts.
- Modify actors or state directly.
- Interpret or emit simulation events.

`core-as` remains the sole authority on legality, state transitions, and outcomes.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Director state-machine
inputs/outputs belong in `packages/runtime/src/personas/director/contracts.ts`.

This separation ensures that:
- Strategic reasoning remains isolated from execution mechanics.
- Planning logic can evolve independently of configuration and simulation rules.
- External intelligence (including AI systems) can be integrated without destabilizing determinism.

The Director is therefore a **planner and intent shaper**, focused on *what should be attempted*, leaving *how it is realized* to downstream personas and the simulation core.

## Drift guardrails
- Canonical entrypoints: `controller.mts` + `state-machine.mts` + `contracts.ts`; import controllers (not state machines) from consumers.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.mts`; use `ts-node/esm` or a build step before consuming outside the test harness.
