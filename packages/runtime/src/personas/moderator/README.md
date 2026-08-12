# Moderator Persona

The Moderator is the **execution and sequencing persona** for the simulation.

It is responsible for running the simulation loop in a controlled, deterministic manner. The Moderator advances time, sequences and applies actions, and ensures that the simulation progresses according to a well-defined execution model.

This document defines the Moderator as a **runtime execution role**. Simulation rules, legality, and state transitions are enforced by the simulation core (`core-ts`), while planning, configuration, and policy are handled by other personas.

---

## At a Glance

| Area | Moderator responsibility |
| --- | --- |
| Owns | Tick advancement, phase order, action sequencing, effect routing |
| Does not own | Strategy, configuration assembly, external IO, or rule legality |
| Primary inputs | Configuration artifacts, actor action proposals, execution policies |
| Primary outputs | Ordered action batches, TickFrames, effects logs, run summaries |
| Boundary | Calls `core-ts`; does not replace `core-ts` rule enforcement |

## Ownership status (A1–A5)

Ownership is not "the call goes through the controller". The charter defines it as **A1–A5**
(`docs/architecture-charter.md` → *Ownership — what "belongs to a persona" means*), and **a chartered
behavior with no G1 test is not owned**. The rows below mirror
`tests/architecture/persona-authority-registry.js`, which is the single origin for that status;
`tests/architecture/persona-readme-authority.test.js` fails if this table and the registry disagree.

<!-- A1-A5-STATUS:moderator -->

| Behavior | Criteria | Status | Proof |
|---|---|---|---|
| `moderator/tick-ordering` — ordering strategy and effect fulfilment are the Moderator's decision | A1, A2 | ✅ owned (CR.5) | `tests/architecture/persona-authority.test.js` |
| `all/port-contract-single-origin` — one effect codebook; the port contract is not redeclared | A1 | ✅ owned (PX.1) | `tests/architecture/single-origin.test.js` |
| `all/injected-clock` — no persona reads a clock; time is injected, never defaulted | A4 | ✅ owned (PX.3 M6) | `tests/architecture/single-origin.test.js` |
| `all/restorable-from-view` — a persona can be rebuilt from its own serialized `view()` | A4 | ✅ owned (PX.4) | `tests/architecture/persona-serialization-equivalence.test.js` |
| `all/controller-only-boundary` — external code imports persona controllers only | A1, A2 | 🔴 blocked — CR.7 | none yet; the boundary guard is still a soft allowlist |

<!-- /A1-A5-STATUS -->

**Four of these five are cross-persona infrastructure, registered here rather than owned here.**
The registry files them under the Moderator because they are tick-plane invariants that no single
domain persona could hold — not because the Moderator implements them. `moderator/tick-ordering` is
the one row about this persona's own decisions.

🔴 **`all/controller-only-boundary` is the last open finding on the board.** The guard
(`tests/architecture/persona-boundary.test.js`) fails on *new* violations and on *stale* allowlist
rows, but the allowlist is not yet empty, so the rule is recorded debt rather than enforced law. It
becomes a hard error at zero — read the live count with
`jq length tests/architecture/persona-boundary-allowlist.json` rather than trusting a number written
in prose.

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
- Submits actions to `core-ts` for validation and application.

The Moderator does not decide *which* actions actors choose—only *when* and *in what order* they are applied.

---

### Action Sequencing and Conflict Preparation
When multiple actions interact (e.g. simultaneous movement or competing interactions), the Moderator is responsible for:

- Collecting unordered action proposals.
- Transforming them into a deterministic, ordered execution sequence.
- Optionally rejecting or deferring actions procedurally (e.g. capacity limits, phase rules).

The Moderator does **not** decide whether an action is legal or what its effects are.
It supplies an ordered sequence of actions to `core-ts`, which enforces legality
and produces authoritative outcomes (accepted, rejected, or state-changing).

In short:
- The Moderator decides **when and in what order** actions are applied.

## State machine & phases
- States: initializing → ticking → pausing → stopping.
- Subscribed tick phases: all (init, observe, decide, apply, emit, summarize).
- Outputs: ordered actions and execution records (data-only); IO stays at adapters.
- `core-ts` decides **what happens** when each ordered action is applied.

---

### Event and Effect Handling
The Moderator:
- Receives events and effects emitted by `core-ts`.
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

## Relationship to core-ts

The Moderator does **not**:
- Implement simulation rules.
- Mutate state directly.
- Decide action legality.
- Interpret simulation outcomes.

Instead, the Moderator:
- Calls into `core-ts` to apply actions and advance state.
- Treats `core-ts` as the sole authority on state transitions and outcomes.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Moderator state-machine
inputs/outputs belong in `packages/runtime/src/personas/moderator/contracts.ts`.

The runtime runner module is owned by the Moderator and exists to execute Moderator-controlled ticks.

**Where the tick policies live (CR.5).** Until CR.5 the two policies below were declared inside
`runner/runtime-fsm.mjs`, so the runner decided them without ever consulting this persona. They now
have exactly one origin each, and `runtime-fsm.mjs` asks for a plan and executes it:

| Policy | Module | Planning event |
|---|---|---|
| Persona execution order | `tick-ordering.js` | `plan_persona_order` (INIT phase) |
| Effect fulfilment + emission order | `effect-fulfillment.js` | `plan_effect_fulfillment` (EMIT phase) |
| Affinity target resolution | `affinity-target-effects.js` | `resolve_affinity` (APPLY phase) |

These are **planning** events: they answer a question as data and deliberately do not transition the
FSM, because deciding an order or a disposition is not a lifecycle change. The persona decides; the
runner does the IO, with dispatch staying behind `ports/effects.js`. The runner keeps no fallback copy
of either policy — a Moderator that will not answer is a hard error, not a silent reversion to glue.
Because ordering is Moderator policy, a runtime that runs ticks always has a Moderator: one is
supplied even if a caller-provided persona registry omits it.

This separation ensures that:
- Execution mechanics are isolated from planning and policy.
- The simulation loop remains inspectable and testable.
- Deterministic behavior is preserved even as strategies and policies evolve.

The Moderator is therefore the **timekeeper and referee coordinator**, responsible for orderly execution while deferring all rule enforcement to the simulation core.

## Drift guardrails
- Canonical source: `controller.js` + `state-machine.js` + `contracts.ts`. The 1-line `.mts` re-export shims were deleted 2026-08-01; consumers import `persona.js` (the controller barrel), not the state machine.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.js`. There is no `.mts` twin (no `ts-node/esm` required).
