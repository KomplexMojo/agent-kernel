# Director Persona

The Director is the **planning and intent-translation persona**.

It is responsible for turning high-level strategy into **structured, actionable plans** that can be executed by downstream personas. The Director bridges the gap between external intent and internal execution by shaping goals, constraints, and tactics into a form the system can reason about.

When LLMs are used, the Director authors the prompt plan and response contract. The Orchestrator performs the IO, captures the exchange, and hands the resulting guidance back as explicit artifacts.

This document defines the Director as a **runtime planning role**. Simulation rules, configuration assembly, budgeting policy, and execution remain the responsibility of other personas and the simulation core (`core-ts`).

---

## At a Glance

| Area | Director responsibility |
| --- | --- |
| Owns | Translating goals into structured plans and prompt contracts |
| Does not own | IO, configuration assembly, budget enforcement, or execution |
| Primary inputs | Human/agent intent, scenario objectives, external guidance artifacts |
| Primary outputs | Planning artifacts, constraints, directives, prompt plans |
| Boundary | Defines what should be attempted; downstream personas decide feasibility and execution |

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
- Scenario-level objectives (e.g. difficulty, affinities, success conditions).
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

### Prompt Plan Authoring (LLM)
When using an LLM (e.g. Ollama), the Director owns the prompt plan:
- Decide the questions to ask (level design intent, constraints, roles) and the expected response contract.
- Keep the contract small (design intent/constraints), leaving schema completion and defaults to the Orchestrator.
- Provide a repair prompt strategy for invalid responses (e.g. "return JSON only; fix field X").

The Director does not perform IO; the Orchestrator executes the prompt plan and captures results as artifacts.

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
- **Tick-plane events are `observe` only, unless the run has no plan to consume** (PX.5).
  `bootstrap`/`ingest_intent`/`draft_complete`/`refinement_complete` are the BUILD-plane vocabulary that
  `director-services.js` drives (`beginBuild`, `assembleBuildSpec`), so reaching `ready` asserts a completed
  build round. The runner used to send them on every tick, reporting `ready` with `buildSpecCount: 0` and
  `planId: null` while minting a PlanArtifact mid-run — build-plane work inside a loop whose plan already
  exists and is named by `simConfig.planRef`. A run that already has a plan now gets the state-preserving
  `observe`. **The exception is real and preserved:** a runtime started from a bare `IntentEnvelope` with no
  SimConfig has nothing to consume, and there the Director drafting a plan in-loop is the feature.
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

### It relays the Allocator's pricing answers; it does not compute them (CR.4 M5b.2b)

The Orchestrator's `runLlmBudgetLoop` used to price a build by importing three Allocator internals
(`budget-allocation.js`, `layout-spend.js`, `selection-spend.js`) — pricing policy executing inside the
Orchestrator, which is what *"Economy — Allocator Authority"* forbids. The maintainer's Option 1
(2026-08-07) makes the **Director the loop's sole counterpart**, so the loop asks the Director and the
Director asks the Allocator:

| Director method | Asks the Allocator for |
|---|---|
| `resolveTileCosts({ priceList })` | per-tile layout costs |
| `allocateBudget({ budgetTokens, priceList, poolWeights, … })` | the budget split into pools |
| `evaluateSelectionSpend({ selections, budgetTokens, priceList, normalizeMotivations })` | which selections the remaining budget admits |
| `fitLayoutToBudget({ layout, remainingBudgetTokens, priceList, layoutCosts })` | a revised layout that fits the budget (CR.4 M5b.2c) |

Three properties are load-bearing, not incidental:

1. **The call goes through `allocator/persona.js`, the public barrel** — the same seam the CR.1 hazard
   pool split already uses. Because that edge is *not* an allowlist row, the loop's crossings **die
   rather than move**. (Routing *Configurator* answers through here would launder instead of fix: the
   Director reaches the Configurator through internals — the open D8 cycle.)
2. **All three are gated on `PLANNED_STATES`, like `mapPool`.** Pricing a build no round has begun is
   the same "artifact produced with no round" defect as CR.4's `producedBy` stamp. The gate is the
   substance; re-pointing the import alone would satisfy the boundary rule and leave the authority
   defect untouched.
3. **The caller's price list is forwarded, never defaulted away.** The Allocator is constructed per
   call with the caller's `priceList`. A persona built once without one would answer against the
   *default* list, and a silently defaulted price is still a well-formed number — nothing would report it.

The Director **does not** decide any of these; it holds the build round they are asked within.

---

## Relationship to core-ts

The Director does **not**:
- Apply simulation rules.
- Assemble world state or layouts.
- Modify actors or state directly.
- Interpret or emit simulation events.

`core-ts` remains the sole authority on legality, state transitions, and outcomes.

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
- Canonical source: `controller.js` + `state-machine.js` + `contracts.ts`. The 1-line `.mts` re-export shims were deleted 2026-08-01; consumers import `persona.js` (the controller barrel), not the state machine.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.js`. There is no `.mts` twin (no `ts-node/esm` required).
