# Orchestrator Persona

The Orchestrator is the **integration and boundary persona** between the simulation system and the external world.

It is responsible for receiving external requests, selecting appropriate external services, and coordinating interactions *around* the simulation without compromising determinism. The Orchestrator does not influence simulation outcomes directly; it brokers intent and context across system boundaries.

This document defines the Orchestrator as a **runtime integration role**. Planning, configuration, policy, execution, and observation are handled by other personas and the simulation core (`core-ts`).

---

## At a Glance

| Area | Orchestrator responsibility |
| --- | --- |
| Owns | External request intake, adapter selection, deferred side-effect coordination |
| Does not own | Planning decisions, configuration assembly, action choice, or core state |
| Primary inputs | UI/CLI/API requests, prompts, adapter payloads, deferred effects |
| Primary outputs | Normalized request envelopes, captured external inputs, post-run side effects |
| Boundary | Interacts with the outside world around execution, not inside deterministic core execution |

## Ownership status (A1–A5)

Ownership is not "the call goes through the controller". The charter defines it as **A1–A5**
(`docs/architecture-charter.md` → *Ownership — what "belongs to a persona" means*), and **a chartered
behavior with no G1 test is not owned**. The rows below mirror
`tests/architecture/persona-authority-registry.js`, which is the single origin for that status;
`tests/architecture/persona-readme-authority.test.js` fails if this table and the registry disagree.

<!-- A1-A5-STATUS:orchestrator -->

| Behavior | Criteria | Status | Proof |
|---|---|---|---|
| `orchestrator/llm-session` — the external interaction seam: LLM sessions run as persona rounds | A5 | ✅ owned (CR.4 M1–M7, `2be417d6`) | `tests/architecture/cr4-llm-call-site-inventory.test.js` |

<!-- /A1-A5-STATUS -->

⚠️ **This row read "blocked by CR.4" for two days after CR.4 closed** — while a guard in the same
directory asserted the opposite. Flipped 2026-08-12 on re-derived evidence, not on the finding's
closure note: the inventory guard scans `packages/`, `scripts/` and `tools/` and asserts **zero**
direct `runLlmSession` call sites, and every capture stamped `producedBy: "orchestrator"` is built
inside `llm-round.js`'s `settle()`, which cannot run before a terminal state. The `producedBy` that
`kernel.js` and `ak-impl.mjs` pass is an *option into a round-hosted call*, not glue stamping an
artifact of its own.

**Residue worth knowing before you edit this persona:** `runLlmBudgetLoop` is still a plain function
rather than an FSM round. It performs no IO (the runner is injected) and mints no artifact of its own,
so it does not violate A5 — whether the loop itself becomes a round is WP-4's question.
`runLlmSession` survives only as the differential's reference implementation; its only callers are
tests, and a reintroduced production call fails the inventory guard.

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
- The Orchestrator **decides**: `llm.beginRound()` returns an `llm_request` effect **as data** and awaits
  nothing. Escalation (retry → repair → sanitize) is a sequence of states, not inline `await` branches.
- **Glue dispatches and the adapter performs the IO.** `commands/llm-host.js` routes each request through
  `ports/effects.js` and hands the response back via `fulfill()`. ⚠️ Since CR.4 this persona no longer
  performs the call itself — the older wording here said it did, which described the pre-inversion code.
- The round captures the full prompt + raw response for replay and surfaces parse/contract errors; the
  capture artifact is built in `settle()`, so it cannot exist before the round reaches a terminal state.
- Results are normalized/validated and translated into buildable inputs (e.g. BuildSpec/configurator
  inputs) without inventing strategy content.

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

## Relationship to core-ts

The Orchestrator does **not**:
- Call into the simulation core directly.
- Apply simulation rules.
- Mutate world or actor state.
- Observe simulation internals beyond exposed telemetry.

`core-ts` remains fully isolated from external systems.

---

## Architectural Intent

Cross-persona artifacts live in `packages/runtime/src/contracts/artifacts.ts`. Orchestrator state-machine
inputs/outputs belong in `packages/runtime/src/personas/orchestrator/contracts.ts`.

This separation ensures that:
- External integration can evolve independently of simulation mechanics.
- New technologies (AI models, blockchains, storage systems) can be swapped without destabilizing the core.
- Determinism and replayability are preserved even in highly asynchronous environments.

The Orchestrator is therefore a **boundary guardian**, responsible for safely interfacing the simulation with the outside world while keeping the inner system pure.

## Public surface

`persona.js` (`export * from "./controller.js"`) publishes:

| Export | What |
|---|---|
| `createOrchestratorPersona` | the FSM controller |
| `orchestratorSubscribePhases` | `observe`, `decide`, `emit` |
| `runLlmBudgetLoop` | the LLM budget loop — a plain function, re-exported from `llm-budget-loop.js` |
| `buildLlmCaptureArtifact` | the LLM capture-artifact builder, re-exported from `llm-capture.js` |

`runLlmBudgetLoop` is **published on the controller surface** (CR.7 / WP-5, 2026-08-12) for the same
reason as `FulfillmentDispositions` on the Moderator: callers need it and must not import persona
internals. It is safe to publish as a plain function rather than a controller method because it
takes **no FSM state** — adapter, catalog, priceList, clock and the rest are all injected by the
caller, so nothing about internal state escapes with it.

⚠️ **`commands/llm-host.js` is NOT a substitute for it.** `runLlmSessionHosted` hosts a *session*;
this runs the budget loop. They are different capabilities and two callers legitimately import
both. The allowlist previously carried four rows pointing straight at `llm-budget-loop.js`
(`ak-impl.mjs`, `adaptive-workflow/llm-seams.js`, `commands/kernel.js`, `ui-web/design-guidance.js`)
and CR.4's D4 predicted a use case returning LLM-request effects would replace them; it did not.
Those four now import `persona.js` and the rows are gone (allowlist 35 → 31).

`buildLlmCaptureArtifact` is published for the same reason and on the same terms — a pure builder
with the clock injected. Its consumer is `personas/_shared/tick-orchestrator.mts`, which runs the
**tick plane's** own LLM call and stamps its own capture (`producedBy: "runtime-llm"`): a genuinely
separate exchange from the build plane's rounds, and one that must not grow a second artifact
builder. ⚠️ Note this retires the second reason given in `llm-round.js#settle`'s docblock — that the
builder was persona-internal. The provenance reason stated there still stands and always was the
stronger one: a reachable builder still cannot stamp a round that is not running.

## State machine & phases
- States: idle → planning → running/replaying → completed/errored.
- Subscribed tick phases: observe, decide, emit.
- Outputs: routed intents/requests as data; no direct IO during execution phases.

## Drift guardrails
- Canonical source: `controller.js` + `state-machine.js` + `contracts.ts`. The 1-line `.mts` re-export shims were deleted 2026-08-01; consumers import `persona.js` (the controller barrel), not the state machine.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.js`. There is no `.mts` twin (no `ts-node/esm` required).
