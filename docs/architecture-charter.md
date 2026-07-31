# Architecture Charter (Ports & Adapters)

`packages/core-ts` is the deterministic core. It must not depend on UI, network, storage, filesystem, clocks, process state, or Node APIs.

## Core vs Runtime

- **`core-ts`**: simulation state, transition rules, validation, render buffers, affinity field computation, motivation evaluation, and data-only effects.
- **Runtime personas**: long-lived controllers that coordinate planning, tick phases, action ordering, telemetry, and adapter interaction.
- **Adapters/UI**: host-specific IO and presentation. They call runtime or consume artifacts; they do not own simulation rules.

## Persona Model — ENFORCED

The persona model is the primary unit of comprehension for this project. Every piece of domain
logic belongs to exactly one persona; if the maintainer cannot say which persona a behavior
belongs to and why, the code is in the wrong place. All other runtime code — the command kernel,
card-authoring, orchestrate-build, the tick runner — is **glue**: it sequences persona calls and
moves artifacts between them, and it must not contain domain decisions of its own.

| Persona | What it does | Why it exists |
|---|---|---|
| **Orchestrator** | Owns every external interaction seam: LLM sessions, budget loops, prompt contracts, workflow coordination. | So no other persona (and no adapter) talks to the outside world about intent. |
| **Director** | Translates intent into structure: IntentEnvelope → PlanArtifact → BuildSpec. | So "what the user asked for" has one interpreter. |
| **Configurator** | Assembles, validates, and locks configurations: levels, actors, cards, pools, feasibility. | So a locked config has one producer and one meaning. |
| **Allocator** | The economy. Owns price lists, base costs, all pricing formulas, spend validation, budget maximization, receipts, and reconciliation. | So every token cost in the system has one author and receipts are auditable. |
| **Actor** | Proposes actions for simulated agents from observations, motivations, and solver/LLM decisions. | So agent behavior is deterministic, replayable, and separately testable. |
| **Moderator** | Controls the tick: ordering, affinity resolution, effect fulfillment, and pausing — `pausing` is a real gate that refuses to advance `step()`, not a label. | So tick semantics are policy, not accidents of the runner loop. |
| **Annotator** | Captures and normalizes run observability: per-tick TelemetryRecords and the end-of-run RunSummary (including its derived `outcome`). Build-scope `telemetry.json` is **not** its own and never will be — see rule 3 (plane boundary). Spend auditing is likewise **not** Annotator work: it is settled Allocator territory via `scenarioSpendReport` (Plan P3.3, which deleted the never-wired budget ledger rather than routing it here). ⚠️ The RunSummary is currently stamped by an Annotator instance that never observed the run — an **A5** violation, Plan CR.8. | So observability is a contract, not scattered console writes. |

### Ownership — what "belongs to a persona" means (A1–A5)

*Adopted 2026-07-29. The sentence "every piece of domain logic belongs to exactly one persona" was
found to be satisfiable by a **façade**: route the call through the persona, let it stamp the result,
keep the decision in glue. An adversarial review found eight such violations **under a fully green test
suite**, because every gate the project had was an **output** gate — goldens, schemas, integration
results — and a façade produces byte-identical output by construction. A1–A5 replace the ambiguous
sentence with a testable definition.*

**A persona OWNS a behavior if and only if all five hold. Fewer than five is a figurehead, not an owner.**

| # | Criterion | Obligation | Violated when |
|---|---|---|---|
| **A1** | **Sole implementation** | The logic exists in exactly ONE place, inside the owning persona. | The same decision has a second origin — another persona, glue, or core. |
| **A2** | **Necessary path** | Production **cannot** produce the outcome without invoking the persona. | The persona can be neutered and production still works. |
| **A3** | **Real gate** | The persona's FSM state determines whether and how the behavior happens. | The same call in two different states does the same thing. |
| **A4** | **Serializable decision** | The decision is a pure function of (serialized state, event, payload). | Hidden instance state changes the outcome; replay diverges. |
| **A5** | **Honest provenance** | An artifact naming the persona was produced by an instance that actually performed the round. | The stamp is applied by an instance that did no work. |

**A2 is load-bearing.** It is the only criterion no output test can satisfy vacuously, and it is what
"not a figurehead" actually means. A behavior whose ownership cannot be demonstrated by A2 is not owned,
however cleanly it is routed.

**Consequences for review.** "The call goes through the controller" is *not* evidence of ownership —
it establishes routing (structure) and says nothing about authority (semantics). Ask instead: if this
persona were removed, would production break? If the answer is no, the diff does not satisfy this charter
regardless of how it is layered.

**Enforcement.** Each criterion has a mechanical gate family, specified in the Plan's test architecture:
G1 CLI-differential/ablation (A2) · G2 single-origin guards (A1) · G3 state-gate tests (A3) ·
G4 serialization-equivalence (A4) · G5 provenance-lineage (A5). **A chartered behavior with no G1 test is
not owned**, and a milestone closes when its G1 test flips red→green — not when its call sites are threaded.

**Enforcement rules (blocking on every diff):**

1. **Controller-only boundary.** Code outside a persona's directory may import only that persona's
   `controller.js`, `persona.js`, or `contracts.ts` (`controller.mts` resolves to the same module —
   see rule 7). Importing a persona's internal modules (`validate-spend.js`, `cost-model.js`,
   `llm-session.js`, …) from outside its directory is a violation. Adapters never import persona
   internals. Enforced by `tests/architecture/persona-boundary.test.js`, which fails on any NEW
   violation; `persona-boundary-allowlist.json` records today's known debt and must only shrink.
   **TARGET DECIDED 2026-07-29: the allowlist goes to ZERO — no exceptions, including persona→persona.**
   An internal import bypasses the controller, so the persona's FSM never runs: that is an **A2**
   violation by definition. Every entry needs an explicit disposition — thread it through a controller
   or artifact exchange, or delete the dependency. **Silent allowlist membership is not a disposition.**
   The guard becomes a hard error once the list is empty (Phase 5).
   All entries now carry one: dispositions live in `local-codex/allowlist-dispositions.md`, which is the
   working checklist and is regenerated from the allowlist itself. **Do not cite an entry count here** —
   it changes as the list shrinks (it was 74 when the target was set); read
   `jq length tests/architecture/persona-boundary-allowlist.json` instead.
   **Two facts that shape the remaining work.** Only **2** of the original 74 crossings imported a symbol
   that already had a public-surface equivalent, so "thread it through a controller" is a design task per
   entry, not a re-point. And roughly **40%** are owned by CR.1/CR.4/CR.9 rather than by Phase 5 — the
   list largely empties as those land, which is why the enforcement flip depends on the economy work.
2. **Personas own logic; glue owns sequence.** A conditional that encodes a domain rule (a price,
   a validation, an ordering policy) belongs inside a persona. Glue may branch only on artifact
   shape and persona results.
3. **Two planes, same personas.** The simulation tick (observe→decide→emit phases) and the build
   pipeline are both persona rounds.
   - **Build plane (today):** Director (IntentEnvelope → PlanArtifact → BuildSpec) → Configurator
     (level-gen sizing, resource mapping, validation) → Allocator (feasibility, budget maximization,
     receipts). Receipts come from the Allocator.
   - **Tick plane:** Moderator gates advancement, Actor proposes, Allocator prices, Annotator
     summarizes the run.
   - **Not a gap — a plane boundary (settled 2026-07-28, P3.4).** The Annotator persona is fully
     implemented and live *in the tick plane* — it cycles idle→recording→summarizing every tick and
     emits `TelemetryRecord`s plus the end-of-run `RunSummary`. It is **absent from the build plane**
     because `build`/`llm-plan` run no tick at all and the Annotator subscribes only to the
     EMIT/SUMMARIZE tick phases. Build-scope `telemetry.json` therefore comes from glue
     (`build/telemetry.js`): a structural consequence, not a missing persona.
     **RESOLVED:** the real defect was the false label — `build/orchestrate-build.js` stamped
     `producedBy: "annotator"` on an affinity-summary artifact the persona never touched. It now
     stamps the caller's `producedBy` (e.g. `cli-build`), matching every sibling build artifact, and
     `tests/runtime/build/build-provenance.test.js` is a standing guard against any build-plane glue
     hardcoding a persona name. The open decision is closed: build-scope telemetry stays glue-owned,
     and the `TelemetryRecord` contract comment now states producer-by-plane explicitly. Giving
     authoring builds a persona round was considered and rejected as a category error.
   - **The rule this leaves behind:** glue must never claim persona provenance it did not earn.
     Provenance is legitimate only where the persona actually ran — so `producedBy: "annotator"` on
     the run summary (routed through the Annotator controller) and `producedBy: "moderator"` on tick
     frames are correct, while the same labels on any build artifact are not. Check the plane before
     assigning a producer.
4. **Pure FSMs.** `view()` + `advance(event, payload)`, clock injected, context serializable,
   effects returned as data. A persona state must gate real behavior — a state that nothing
   consults is a defect, not a feature (**A3**). "Context serializable" is **A4** and is stronger than
   it reads: any value that influences the next decision must be *in* the serialized context. State
   held in a factory closure and omitted from `view()` breaks replay — two instances with identical
   serialized state can then produce different outcomes — and is a violation even though nothing
   mutates a class instance.
   ⚠️ **A4 is currently UNVERIFIABLE, and that is itself an open defect (Plan PX.4).** Serializable is
   not the same as restorable: every persona factory accepts `{ initialState, clock }` — a state *label* —
   while `view()` returns `{ state, context }`, and no factory accepts a context. **A persona's serialized
   output cannot be fed back in**, so "the decision is a pure function of serialized state" cannot be
   tested today. A `restore(view)` capability is owed on the persona contract; until it exists, treat A4
   as an obligation on new code that cannot yet be mechanically enforced.
5. **Cross-persona interaction** happens through versioned artifacts (`contracts/artifacts.ts`),
   persona events, or effects — never lateral imports of another persona's internals.
6. **Tests align to personas, and must test authority — not routing.** Persona behavior tests live in
   `tests/personas/<persona>/` and are named `<persona>-<behavior>.test.*`. A test that asserts only a
   state label (not behavior the state gates) is a legacy test and must be replaced, not extended.
   **This is not a stylistic preference.** The `<persona>-state-machine` / `<persona>-persona-phase`
   families assert `result.state === expected` and `context.lastEvent === event` — they verify that a
   *label changed*, so "persona tests pass" has never implied "personas decide". Every new persona
   behavior needs a gate from the A1–A5 families above; **G1 (does production break without this
   persona?) is the acceptance criterion**, and byte-identical goldens are not evidence of ownership.
7. **One implementation per module — `.js` is canonical.** Persona controllers and state machines
   are plain `.js`. The matching `.mts` files are 1-line re-export shims retained only for existing
   importers. **Never put code in a `.mts`**: it is a re-export, so anything added there silently
   never runs. Two full copies of a module must never exist — that arrangement previously drifted
   undetected (director/controller by ~100 lines, allocator/controller by 2), which is why the old
   "apply every edit to both files" rule was retired rather than restated.

**Migration status:** enforcement is being phased in per `local-codex/Plan.md` (Persona Enforcement
Program). Until a phase lands, its violations are documented debt, **not license** — new code is held
to the full rules above regardless of phase.

⚠️ **CORRECTED 2026-07-29 — this paragraph previously overstated what had landed, and the overstatement
is exactly the failure A1–A5 exist to prevent.** An adversarial review of the whole program (verdict
NO-SHIP, 8 findings, `local-codex/Plan.md` CR.1–CR.8, plus CR.9 found separately) established that
several phases achieved **structural** routing without **semantic** authority:

- **Phase 1 — the Allocator is NOT yet the sole pricing authority.** Economic values still have three
  origins: pool-split constants inside the *Director's* directory, card-cost constants in glue
  (`commands/card-authoring.js`), and a silent `DEFAULT_ACTION_COST` fallback in `core-ts` (**A1**).
- **Phase 2 — the Configurator assembles, but does not validate or lock.** `validate()`/`lock()`
  perform no schema check and no freeze, and the production authoring path never calls them
  (**A2 + A3**). The Director's persisted PlanArtifact is reconstructed *after* the spec is built by a
  second Director instance; the plan that actually ran is discarded (**A2 + A5**).
- **Phase 3 — one gap left.** The Moderator's pause gate genuinely gates, and as of CR.5 tick
  *ordering* and *effect fulfilment* are its decisions too: the canonical persona order and the
  per-effect disposition are declared only inside the persona, and the runner executes the returned
  plan without keeping a fallback of its own (dispatch itself stays behind `ports/effects.js`).
  Still open: the RunSummary's derived `outcome` is real, but it is stamped by a freshly created
  Annotator that never observed the run (**A5**).
- **Closed by CR.6:** the Actor no longer holds decision-relevant state in a closure — it keeps nothing
  outside its FSM, so its decision is a function of (`view()`, event, payload) (**A4**) — and it no longer
  defines budget admissibility, which now lives in the Allocator and reaches the Actor only as that
  persona's injected judge (**A1**). *A4's other half is still open:* a serialized `view()` cannot yet be
  fed back in, because no persona has `restore(view)` (PX.4).
- **Also open:** the Allocator authors and grows card configurations, which is Configurator work
  (**A1**, see the Economy section).

Still open by design: the Orchestrator inversion (Phase 4) and the enforcement flip that empties the
boundary allowlist to zero (Phase 5). **Consult the Plan for current state; do not treat any claim in
this paragraph as evidence that a behavior is owned — require its G1 test.**

## Economy — Allocator Authority

- There is **one price model**, owned by the Allocator. Base cost numbers live in
  `personas/allocator/base-costs.json` (data, tunable); formulas — linear/quadratic shaping and
  the free-floating resource premium — live in Allocator code. A base cost literal in any other
  file is a violation.
- Every priced element (vitals, regen, affinity, motivations, tiles, hazards, resources, actors)
  is charged through the Allocator's price list. Silent fallbacks to alternate cost tables are
  forbidden: an incomplete price list is a structured error, never a quiet default.
- Receipts (`BudgetReceiptArtifact`) are issued only by the Allocator and are the audit trail for
  every spend. Budget maximization ("spend the rest") is Allocator policy, not adapter code.
- **The Allocator JUDGES; it does not AUTHOR (decided 2026-07-29, not yet implemented — Plan CR.9).**
  Pricing authority does not extend to building the thing being priced. Today
  `personas/allocator/budget-fulfillment.js` constructs and grows cards (`buildMinimumRequiredDelverCard`,
  `fillFlexibleDelverVitals`, `maximize*Card`) and encodes configuration *validity* rules such as "a
  mobility motivation requires stamina" — all of which is Configurator work, and is the reason the
  Allocator imports Configurator internals at all. The import is the symptom; the mis-assignment is the
  cause. **Target protocol:** the Configurator assembles a candidate configuration; the Allocator prices
  it against the price list and returns *approve* or *reject with a structured reason*; the Configurator
  revises. Maximization becomes a bounded, deterministic negotiation rather than a monolith inside the
  Allocator. The exchange is by versioned artifact (rule 5), so the Allocator reads published artifact
  fields and never Configurator functions — which is what allows the boundary allowlist to reach zero
  without a carve-out. This **supersedes** the P2.3.4 D1 decision ("Configurator keeps costing, Allocator
  consults"): D1 asked who owns *costing* when the real seam is who *authors* versus who *judges*.
- `core-ts` may hold invariant enforcement only (caps, spend accounting) fed by Allocator-provided
  data — never prices, tiers, or policy.

## Dependency Direction

```text
adapters-* -> runtime -> core-ts
ui-web     -> runtime -> core-ts
```

All external IO must be implemented behind adapters via narrow ports. Core APIs remain synchronous and deterministic.

## Core Responsibilities

- Canonical simulation state and legal state transitions.
- Pure validation and deterministic rule enforcement.
- Data-only effects with deterministic ids/requestIds and adapter hints.
- Affinity system: 10-kind codebook, spatial formulas, interaction matrix, static hazard and actor field computation.
- Motivation system: 12-kind codebook, behavior flags, and profile derivation. (Motivation
  *pricing* is Allocator policy, not core; core enforces only invariant budget rules — caps and
  spend accounting — when provided by the Allocator.)
- Render buffers and observations derived from canonical state.

## Runtime Responsibilities

- Tick FSM and persona orchestration.
- Action proposal, ordering, replay, and telemetry capture.
- Artifact normalization and schema boundary enforcement.
- Card-authoring glue: card normalization and property application live in
  `packages/runtime/src/commands/card-authoring.js`. Budget receipts are issued by the
  **Allocator persona**; card-authoring requests them, it does not compute them.
- Solver/external fact request routing through ports.
- UI-facing visualization assembly from core outputs and resource bundles.
- UI-facing core access facades for preview/playback setup. Browser UI code must
  call runtime helpers rather than importing `core-ts` directly.

## AdaptiveWorkflowAgent Control Plane

- `AdaptiveWorkflowAgent` (`packages/runtime/src/adaptive-workflow/*`) is a durable, deterministic **application control plane**, not a persona. It coordinates an objective through intake, planning, configuration, validation, execution, verification, repair, escalation, and completion by reusing the existing Orchestrator LLM seams (`runLlmSession`, `runLlmBudgetLoop`) and command kernel.
- The Orchestrator **persona** is unchanged and remains the tick/persona boundary guardian. `AdaptiveWorkflowAgent` does not rename, absorb, or broaden it.
- Dependency direction is preserved: the runner and its contracts, validators, strategy policy, repair controller, and replay envelopes live in `runtime`. All model, hardware-probe, persistence, CLI-execution, and MCP-transport IO lives behind injected ports fulfilled by adapters. The runtime layer imports no adapter, MCP, `node:fs`, `node:child_process`, or `node:crypto` module.
- The LLM proposes plans, configurations, and repairs but is never the authority on validity or completion. Deterministic validators own the `validate` and `verify` gates; a model can never mark a workflow complete.
- Model, MCP, and CLI calls are mockable; deterministic tests use fixtures and never hit a live service. Benchmark measurements are offline evidence only and cannot rewrite routing policy without an explicit, versioned promotion.
- CLI (`ak workflow …`) and MCP (`ak_workflow_*`) surfaces are additive; existing commands and tools are unchanged. See [`adaptive-workflow.md`](adaptive-workflow.md).

## Builder Port

Heavy level synthesis runs behind a builder adapter. UI code hands off summaries, normalized `levelGen`, or direct tile rows to that adapter instead of synthesizing layouts on the main thread.

## Combat Boundary

- `packages/core-ts/src/rules/combat.ts` owns the deterministic combat primitive: `createCombatRules(world).applyAttack(attackerIndex, defenderIndex, damage)`.
- `core.applyAttack` is the only mutation entry point for HP changes caused by an attack. It enforces valid actor indices, rejects self-attacks, requires Chebyshev-1 adjacency, requires positive integer damage, and clamps defender HP to `0`.
- Runtime never mutates HP directly for attacks. `packages/runtime/src/runner/runtime-fsm.mjs` adapts actor `attack` actions into a direct `{ kind: "apply_attack" }` directive, converts runtime actor IDs to core motivated-actor indices, and calls `core.applyAttack`.
- `core-ts` remains IO-free and runtime-ignorant: no adapter imports, no clocks, no process state, and no dependency on persona or runtime action shapes.

## Motivation And Action Flow

- Simple actor motivations are resolved deterministically in `packages/runtime/src/personas/actor/controller.js` (`controller.mts` is a thin re-export of it).
- `buildMotivatedProposals()` reads `motivation.kind` from the observation actor record or `payload.initialState.actors`. It uses `resolveNearestHostile()` to choose the closest other actor by Chebyshev distance.
- Current simple motivation kinds are `attacking`, `defending`, `stationary`, and `random`: attacking actors attack adjacent hostiles or pursue distant hostiles, defending actors attack adjacent hostiles or hold position when distant, stationary actors emit no movement proposal, and random actors move to a seed-derived legal adjacent tile.
- `random` movement is deterministic pseudo-random: the choice derives from `seed:actorId:tick` (FNV/mulberry), never `Math.random()`, and synthesizes a `wait` when no legal adjacent tile exists. Replays of the same seed produce identical movement.
- Multi-actor ticks: `packages/runtime/src/runner/runtime-fsm.mjs` runs the DECIDE phase for every actor each tick and reserves proposed target tiles within the tick so two actors cannot move onto the same tile in the same tick.
- Complex motivation is opt-in. Actors with runtime decisioning enabled, for example `runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" }`, emit a `solver_request` effect instead of directly returning a concrete action.

## Solver Adapter Boundary

- Complex motivation must route through the runtime solver port (`packages/runtime/src/ports/solver.js`) and adapter implementations. Runtime code constructs the request envelope and consumes the normalized result; it does not embed solver-specific logic.
- `packages/runtime/src/personas/_shared/runtime-decision.mts` resolves fulfilled solver results through `resolveActionFromSolverResult()` and maps the selected candidate back to a concrete runtime action.
- The Z3-shaped adapter currently lives in `packages/adapters-test/src/adapters/solver/z3-adapter.js`. It is a deterministic priority-rule adapter for tests, not a real Z3 binding.
- Z3 adapter code must not move into `runtime` or `core-ts`. The dependency direction remains `adapters-* / ui-web -> runtime -> core-ts`.

## UI Sandbox Playback

- The M1 sandbox contract is playback over precomputed `tickFrames`, not live tick execution from Step or Run-To-End controls.
- `packages/ui-web/src/scenario-loader.js` compiles a scenario into a gameplay bundle by running the runtime to completion once, then the UI replays the recorded frames.
- `globalThis.__ak_loadScenario(scenario, options)` compiles and forwards to `globalThis.__ak_loadGameplayBundle(bundle, options)`.
- `packages/ui-web/src/views/gameplay-view.js` implements Step and `runToEnd()` by moving the current frame cursor over `tickFrames`; it does not call runtime step during playback.
- `packages/runtime/src/runner/core-facade.js` is the runtime-owned browser facade for preview/playback helpers that need deterministic core setup, frame rendering, observation reads, and affinity field records.
- Tick playback is keyboard-driven with a fixed binding policy: bare keys belong to the game surface, Cmd/Ctrl+arrows step tick playback, Cmd/Ctrl+`[`/`]` navigate screens back/forward, and Ctrl+digit jumps directly to a screen. Cmd+digit is reserved by browsers and never bound. The gameplay stage exposes the cursor as `data-gameplay-current-tick`.

## Sandbox Bridge (MCP → CLI → UI)

- The `ak_push_to_ui` MCP tool delivers an `agent-kernel/GameplayBundle` to a connected browser UI over the sandbox WebSocket bridge (`packages/adapters-cli/src/mcp/bridge-server.mjs`, default port 38487, override with `AK_SANDBOX_BRIDGE_PORT`).
- The tool accepts an inline `bundle`, a `bundlePath`, or an `outDir` containing `bundle.json`; the browser side is `packages/ui-web/src/sandbox-bridge-client.js`, which loads the bundle into the gameplay Phaser surface via `window.__ak_loadGameplayBundle`.
- `openBrowser: true` lets the MCP bootshazard the whole loop: it serves the canonical `index_c.html` via `scripts/serve-ui.mjs` when nothing answers `/health`, opens the default browser, and pre-stages the bundle for the bridge's replay window so the freshly opened UI loads it on connect.
- CLI `run` stitches a post-run `GameplayBundle` (`bundle.json`) only when its inputs came from an authored `create` outDir; fixture-driven runs stay bundle-free so CLI output remains artifact-for-artifact equivalent to the browser host's run output.
- The bridge is an adapter-layer concern: bundle assembly reuses runtime contracts, and no bridge or WebSocket code lives in `runtime` or `core-ts`.

## Affinity Visualization

- `core-ts` affinity field buffers are the canonical source for tile affinity visualization.
- A hazard is the canonical game element for an affinity danger: it has affinity, expression, stacks, and mana/durability vitals. Hazard is the only public and internal term; no alternate alias or separate concept remains.
- A zero-mana hazard remains in state but contributes no active danger field until mana regenerates; zero durability removes it. Opposed hazard fields, including fire and water, resolve deterministically to a net/cancelled overlap zone in `core-ts`.
- Room affinity wording is derived from the hazards contained in a room. It is a descriptive label (for example, `corrosion affinity room` or `mixed affinity room`), never a room-level affinity property.
- Runtime facades assemble UI-facing tile visuals from core field records and resource bundles.
- `packages/runtime/src/render/affinity-aura.js` and `observation.auras` are retained only as compatibility output for existing renderers/tests. New preview or gameplay surfaces must not recompute JS aura fallbacks in `ui-web`.

## Phaser UI Layer

- `packages/ui-web/src/card-builder-controller.js` is a headless controller around runtime card-authoring commands. It has no DOM dependency; UI surfaces orchestrate view state only, while card semantics, simulation rules, and artifact contracts remain outside `ui-web`.
- `packages/ui-web/src/views/phaser-frame-view.js` is the unified Phaser game frame. It hosts the Card Builder surface and the Gameplay surface, including the existing `createGameplayPhaserRenderer` path.
- `ui-web` renders and emits UI intents only. The current Phaser card-builder intent set is: select chip, apply property to the active card, select card, move card between groups, load bundle, and select tile/entity. Phaser interaction mechanics remain in `ui-web`; card-authoring semantics remain in runtime.
- `packages/ui-web/src/views/card-builder-phaser-renderer.js` renders card-builder interactions for the Phaser surface without owning card semantics or artifact schemas.
- `packages/ui-web/src/phaser-surface-ingestion.js` is a UI-side artifact ingestion boundary. It routes existing versioned artifacts to the correct Phaser surface and introduces no new MCP tool schemas.
