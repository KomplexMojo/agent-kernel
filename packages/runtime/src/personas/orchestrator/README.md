# Orchestrator Persona

The Orchestrator is the **integration and boundary persona** between the simulation system and the external world.

It is responsible for receiving external requests, selecting appropriate external services, and coordinating interactions *around* the simulation without compromising determinism. The Orchestrator does not influence simulation outcomes directly; it brokers intent and context across system boundaries.

This document defines the Orchestrator as a **runtime integration role**. Planning, configuration, policy, execution, and observation are handled by other personas and the simulation core (`core-as`).

---

## Persona Scope

The Orchestrator persona is responsible for **managing external interaction**, not for deciding what the simulation should do internally.

At a high level, the Orchestrator:
- Receives requests from external systems (UI, CLI, APIs, automation, AI tools).
- Selects and invokes appropriate external services.
- Translates external inputs into internal requests for downstream personas.
- Coordinates external side effects based on simulation outputs.

The Orchestrator never mutates simulation state and never bypasses internal personas.

---

## Responsibilities

### External Request Intake
The Orchestrator accepts:
- Human-initiated commands.
- Automated or scheduled requests.
- AI-generated prompts or strategies.
- External signals requiring simulation interaction.

All external inputs are normalized into explicit, auditable request envelopes.

### LLM Interaction (Director Prompt Plans)
When LLMs are used for level design or strategy:
- The Director authors the prompt intent and a small response contract (what to ask / what shape to return).
- The Orchestrator executes the call (IO), captures the full prompt + raw response for replay, and surfaces parse/contract errors.
- The Orchestrator normalizes/validates results and translates them into buildable inputs (e.g. BuildSpec/configurator inputs) without inventing strategy content.

---

### Service Selection and Invocation
The Orchestrator is responsible for choosing *which* external services to use, such as:
- AI systems for strategic guidance or content generation.
- Decentralized systems for persistence, anchoring, or verification.
- External APIs for integration with surrounding platforms.

Service choice is explicit and replaceable; no external dependency is assumed to be stable, fast, or authoritative.

---

### Boundary Translation
External requests are translated into internal intents and forwarded to downstream personas:

- Strategic or goal-oriented inputs → Director
- Execution requests or run commands → Moderator (via the Moderator-owned runtime runner)
- Persistence or publication triggers → adapters
- Telemetry consumption requests → Annotator surfaces

The Orchestrator does not interpret or refine intent beyond routing and normalization.

---

### External Side-Effect Coordination
Based on simulation outputs, the Orchestrator is responsible for handling **deferred side effects**
that were explicitly not fulfilled during simulation execution.

This includes effects such as:
- Persistence of artifacts or logs
- Publication, anchoring, or notification actions
- Integration with external systems or platforms

All such effects are initiated **after** execution has completed and simulation facts
(events, effects, snapshots) have been fully produced.

The Orchestrator never performs external IO during the execution phase and never feeds
externally obtained data back into a running simulation.

`need_external_fact` effects that lack a deterministic `sourceRef` are fulfilled post-run by
the Orchestrator and captured as artifacts for future deterministic runs.

---

## Determinism and Replay

To preserve determinism:
- All external interactions are isolated from simulation execution.
- External systems are never queried synchronously during core execution.
- Inputs from external systems are captured as explicit artifacts.
- Deferred effects are executed only after simulation execution completes; any externally
  obtained data must be captured as artifacts if it is to be used in a future run.

---

## Relationship to Other Personas

The Orchestrator:
- **Supplies** external intent to the Director.
- **Triggers** simulation runs via the runtime.
- **Fetches** external budget inputs (e.g., IPFS price lists) for the Allocator.
- **Coordinates** external side effects after execution.
- **Consumes** telemetry via the Annotator.

The Orchestrator does **not**:
- Plan strategy (Director).
- Assemble configuration (Configurator).
- Enforce budgets (Allocator).
- Decide actions (Actor).
- Observe or interpret outcomes (Annotator).

---

## Relationship to core-as

The Orchestrator does **not**:
- Call into the simulation core directly.
- Apply simulation rules.
- Mutate world or actor state.
- Observe simulation internals beyond exposed telemetry.

`core-as` remains fully isolated from external systems.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Orchestrator state-machine
inputs/outputs belong in `packages/runtime/src/personas/orchestrator/contracts.ts`.

This separation ensures that:
- External integration can evolve independently of simulation mechanics.
- New technologies (AI models, blockchains, storage systems) can be swapped without destabilizing the core.
- Determinism and replayability are preserved even in highly asynchronous environments.

The Orchestrator is therefore a **boundary guardian**, responsible for safely interfacing the simulation with the outside world while keeping the inner system pure.

## State machine & phases
- States: idle → planning → running/replaying → completed/errored.
- Subscribed tick phases: observe, decide, emit.
- Outputs: routed intents/requests as data; no direct IO during execution phases.

## Drift guardrails
- Canonical entrypoints: `controller.mts` + `state-machine.mts` + `contracts.ts`; import controllers (not state machines) from consumers.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.mts`; use `ts-node/esm` or a build step before consuming outside the test harness.
