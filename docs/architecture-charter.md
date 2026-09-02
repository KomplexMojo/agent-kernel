# Architecture Charter (Ports & Adapters)

`packages/core-ts` is the deterministic core. It must not depend on UI, network, storage, filesystem, clocks, process state, or Node APIs.

## Core vs Runtime

- **`core-ts`**: simulation state, transition rules, validation, render buffers, affinity field computation, motivation evaluation, and data-only effects.
- **Runtime personas**: long-lived controllers that coordinate planning, tick phases, action ordering, telemetry, and adapter interaction.
- **Adapters/UI**: host-specific IO and presentation. They call runtime or consume artifacts; they do not own simulation rules.
- **Effect contract:** `core-ts/src/ports/effects.ts` is the sole origin of `EffectKind`. Runtime may
  compatibility-re-export it and map core effects to runtime records, but must not redeclare the codebook
  or silently degrade an unknown core kind; extensions enter only through an explicit injected seam.

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
| **Configurator** | Assembles, validates, and locks configurations: levels, actors, cards, feasibility. | So a locked config has one producer and one meaning. |
| **Allocator** | The economy. Owns price lists, base costs, all pricing formulas, spend validation, budget maximization, receipts, and reconciliation. | So every token cost in the system has one author and receipts are auditable. |
| **Actor** | Proposes actions for simulated agents from observations, motivations, and solver/LLM decisions. | So agent behavior is deterministic, replayable, and separately testable. |
| **Moderator** | Controls the tick: ordering, affinity resolution, effect fulfillment, and pausing — `pausing` is a real gate that refuses to advance `step()`, not a label. | So tick semantics are policy, not accidents of the runner loop. |
| **Annotator** | Captures and normalizes run observability: per-tick TelemetryRecords and the end-of-run RunSummary (including its derived `outcome`). Build-scope `telemetry.json` is **not** its own and never will be — see rule 3 (plane boundary). Spend auditing is likewise **not** Annotator work: it is settled Allocator territory via `scenarioSpendReport` (Plan P3.3, which deleted the never-wired budget ledger rather than routing it here). | So observability is a contract, not scattered console writes. |

### Chartered responsibilities — the machine-readable roster (G1.C)

*Added 2026-08-14.* The table above is prose, and prose cannot be checked. Until this roster existed,
the strongest coverage guard in the tree was *"every charter persona has at least one registered
behavior"* — **one entry per persona, not one per responsibility** — so a chartered responsibility
with no G1 registry entry was invisible and the suite stayed green. That is not hypothetical: it is
exactly how the Orchestrator's post-run side-effect coordination and the Allocator's reconciliation
sat in this charter, and in three READMEs, while **neither existed in the tree at all**, until someone
read the table above by hand.

**This roster is the same table, enumerated.** It adds no responsibility and removes none; it makes
the rows countable. Each id is stable and is what a G1 registry entry names in its `chartered` field.
`tests/architecture/charter-coverage.test.js` enforces the relationship in both directions and fails
when this section and the registry disagree.

⚠️ **Deriving this by parsing the prose above was considered and rejected.** A regex would be a guard
matching a *spelling*: the Annotator row carries **negative** clauses (*"Build-scope `telemetry.json`
is **not** its own"*, *"Spend auditing is likewise **not** Annotator work"*) that a naive split turns
into phantom responsibilities; the Director row is an arrow chain, not a list; the Moderator row
embeds a clarification. So the roster is written out, and the guard instead **fingerprints each
persona row** — reword a row and the suite fails until this roster is revisited. The roster is a
mirror, and something refuses to let it drift.

<!-- CHARTER-ROSTER:BEGIN -->

| Id | Chartered responsibility |
|---|---|
| `orchestrator/llm-sessions` | LLM sessions — the external model interaction seam |
| `orchestrator/budget-loops` | Budget loops over model interaction |
| `orchestrator/prompt-contracts` | Prompt contracts: what a prompt may offer and what a response must satisfy |
| `orchestrator/workflow-coordination` | Workflow coordination, including post-run fulfilment of deferred side effects |
| `director/intent-to-plan` | IntentEnvelope → PlanArtifact |
| `director/plan-to-buildspec` | PlanArtifact → BuildSpec |
| `configurator/levels` | Level configuration |
| `configurator/actors` | Actor configuration |
| `configurator/cards` | Card configuration |
| `configurator/feasibility` | Feasibility of a configuration |
| `configurator/validate-and-lock` | Validating and locking a configuration so it has one meaning |
| `allocator/price-lists` | Price lists |
| `allocator/base-costs` | Base costs |
| `allocator/pricing-formulas` | All pricing formulas |
| `allocator/spend-validation` | Spend validation |
| `allocator/budget-maximization` | Budget maximization ("spend the rest") |
| `allocator/receipts` | Receipts as the audit trail for every spend |
| `allocator/reconciliation` | Reconciling actual spend against the issued budget |
| `actor/action-proposal` | Proposing actions from observations and motivations |
| `actor/runtime-decisioning` | Proposals that route through solver/LLM decisions |
| `moderator/tick-ordering` | Tick ordering |
| `moderator/affinity-resolution` | Affinity resolution |
| `moderator/effect-fulfillment` | Effect fulfilment disposition |
| `moderator/pausing` | Pausing — a real gate that refuses to advance `step()` |
| `annotator/per-tick-telemetry` | Per-tick TelemetryRecords |
| `annotator/run-summary` | The end-of-run RunSummary, including its derived `outcome` |

<!-- CHARTER-ROSTER:END -->

⚠️ **What this roster does NOT claim.** It says a responsibility is *chartered*, not that it is
*owned* — ownership is A1–A5's question and still needs a G1 proof per entry. A roster id with a
registry entry has been **claimed**; whether the claim is true is a separate gate. Conflating the two
would make this read like ownership coverage when it is only registration coverage.

⚠️ **Cross-cutting registry entries (`all/*`) are deliberately outside this roster.** They discharge
the numbered **enforcement rules** below — controller-only boundary, injected clock, restorability —
not a row of the persona table, and forcing them into a persona's roster would misattribute a rule to
whichever persona happened to be listed first.

⚠️ **`configurator/pools` REMOVED 2026-08-18 — the row was stale, not unbuilt.** The Configurator
row and roster both said "pools" from when this table was first written, but decision D8-V
(2026-08-08, `~/vault/decisions/2026-08-08-D8-persona-dependency-order.md`) had already settled
the adjacent question the OTHER way: `normalizePoolCatalog` (a pool catalog's shape validator) was
relocated from `personas/configurator/` to `contracts/pool-catalog.js` specifically *because* it
"prices nothing and decides nothing" — shared vocabulary, not persona authority, the same
reasoning `domain-constants.js` already carries for tile fields. `charter-coverage.test.js`'s
`KNOWN_UNREGISTERED` entry for `configurator/pools` read this as an unbuilt responsibility (*"no
dedicated file... covers it"*) and was correct about the code, but the code was correctly absent —
D8-V had already ruled against giving the Configurator this authority, months before the roster
called its absence a gap. No pool-related responsibility currently exists anywhere in the persona
layer, checked directly: catalog CONTENTS (as opposed to catalog *shape*) are external data, read
from disk by adapter glue (`ak-impl.mjs`'s `--catalog` flag) exactly like a scenario asset — not
unauthored persona work. If a future need arises for the Configurator to actually AUTHOR pool
catalogs (rather than validate their shape), that is new product scope needing its own decision,
not a resurrection of this row. See `local-codex/Plan.md` §POST-AM/Z for the full trail.

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

**G1.C closes the loop between that sentence and this document (2026-08-14).** "A chartered behavior
with no G1 test is not owned" was unenforceable while nothing could enumerate the chartered behaviors:
the registry's own coverage guard asserted only *one entry per persona*, so a responsibility with no
entry was not merely unowned, it was **uncounted**. `tests/architecture/charter-coverage.test.js` reads
the roster above, requires every id to be claimed by a registry entry or explicitly declared
unregistered with a reason, refuses entries citing ids this charter does not declare, and fingerprints
each persona row so the roster cannot fall behind the prose. **Its first run recorded nine chartered
responsibilities with no G1 entry** — none of which was known before it existed.

**Enforcement rules (blocking on every diff):**

1. **Controller-only boundary.** Code outside a persona's directory may import only that persona's
   `controller.js`, `persona.js`, or `contracts.ts`. Importing a persona's internal modules (`validate-spend.js`, `cost-model.js`,
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
   **A4 is mechanically verifiable as of 2026-08-01 (PX.4 / HANDOFF-4).** Every persona factory accepts
   `{ from: view }`; the shared restore boundary validates a state from that persona's state codebook and
   an object context before copying the serialized context into a fresh FSM. G4 drives each of the seven
   personas, JSON-round-trips `view()`, restores a fresh instance, advances both with the same next event,
   and requires identical `{state, actions, effects, telemetry}`. Restorability is a verification and
   snapshot-resume seam; it does not replace deterministic replay from tick zero.
5. **Cross-persona interaction** happens through versioned artifacts (`contracts/artifacts.ts`),
   persona events, or effects — never lateral imports of another persona's internals.
6. **Tests align to personas, and must test authority — not routing.** Persona behavior tests live in
   `tests/personas/<persona>/` and are named `<persona>-<behavior>.test.*`. **The layout half of this
   rule is enforced by `tests/architecture/persona-test-layout.test.js`** — a flat file under
   `tests/personas/`, a misnamed file inside a persona directory, or a directory named for something
   that is not a chartered persona each fail it. Four files span the whole roster (the tick FSM, tick
   orchestrator, tick inspection, and dual-surface shadowing) and are excused **by name** in that guard,
   so a fifth is a deliberate edit rather than a filename that slips a pattern. The *authority* half is
   not path-checkable and is answered by the G1 registry, not by this layout. A test that asserts only a
   state label (not behavior the state gates) is a legacy test and must be replaced, not extended.
   **This is not a stylistic preference.** The `<persona>-state-machine` / `<persona>-persona-phase`
   families assert `result.state === expected` and `context.lastEvent === event` — they verify that a
   *label changed*, so "persona tests pass" has never implied "personas decide". Every new persona
   behavior needs a gate from the A1–A5 families above; **G1 (does production break without this
   persona?) is the acceptance criterion**, and byte-identical goldens are not evidence of ownership.
7. **One implementation per module — `.js` is canonical.** Persona controllers and state machines
   are plain `.js`, with no `.mts` twin: the 1-line re-export shims were deleted 2026-08-01 and every
   importer now uses `persona.js` or `controller.js`. Two full copies of a module must never exist — that arrangement previously drifted
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
- **Phase 3 — closed.** The Moderator's pause gate genuinely gates, and as of CR.5 tick
  *ordering* and *effect fulfilment* are its decisions too: the canonical persona order and the
  per-effect disposition are declared only inside the persona, and the runner executes the returned
  plan without keeping a fallback of its own (dispatch itself stays behind `ports/effects.js`).
  As of CR.8 the RunSummary is produced by the Annotator that actually observed the run: the kernel
  goes through `runtime.summarizeRun()`, which refuses to summarize a ticked run from an instance
  still `idle` (**A5**). Phase 3 has no open gaps.
- **Closed by CR.6 and PX.4:** the Actor no longer holds decision-relevant state in a closure — it keeps nothing
  outside its FSM, so its decision is a function of (`view()`, event, payload) (**A4**) — and it no longer
  defines budget admissibility, which now lives in the Allocator and reaches the Actor only as that
  persona's injected judge (**A1**). All seven personas can now be rebuilt from a serialized `view()` via
  `{ from }`, and the G4 serialization-equivalence gate passes across the full persona set.
- **Also open:** the Allocator authors and grows card configurations, which is Configurator work
  (**A1**, see the Economy section).

Still open by design: the Orchestrator inversion (Phase 4) and the enforcement flip that empties the
boundary allowlist to zero (Phase 5). **Consult the Plan for current state; do not treat any claim in
this paragraph as evidence that a behavior is owned — require its G1 test.**

## Economy — Allocator Authority

- There is **one price model**, owned by the Allocator. Base cost numbers live in
  `personas/allocator/base-costs.json` (data, tunable); formulas — linear/quadratic shaping and
  the free-floating resource premium — live in Allocator code. A base cost literal in any other
  file is a violation, **in any package**. The budget split is a base cost in this sense: the
  per-card-type percentages live in the JSON, and the pool ids, reference targets and authoring
  weights are all derived from them. CR.9 M5 found a fourth copy of that split hardcoded in
  `adapters-cli` — outside the single-origin guard's then-scope of `packages/runtime/src`, and
  the copy the CLI actually used, so retuning the canonical split changed nothing on the real
  path. The guard now scopes to all of `packages`: an economy that stops at a package boundary
  is not a single origin.
- Every priced element (vitals, regen, affinity, motivations, tiles, hazards, resources, actors)
  is charged through the Allocator's price list. Silent fallbacks to alternate cost tables are
  forbidden: an incomplete price list is a structured error, never a quiet default.
- **Everything has a cost, even if only the 1-token base (maintainer rule 2026-08-05).** The
  budget is the only limit on how much content an author can conjure, so a free element is an
  exploit rather than a discount. Two things make an element free and both are defects: a
  published price of **zero**, and a published price with **no charging path**. The second is
  the dangerous one — the price list reads complete, so nobody looks — and it is how hazard
  affinities, hazard vitals, connector tiles and `tile_hallway` were all free under a green
  suite. A charging path that matches one *shape* of a payload is not a charging path for that
  payload. Enforced by `tests/personas/allocator/allocator-everything-costs.test.js`, which
  drives real payloads and compares what was charged against what is published.
- Receipts (`BudgetReceiptArtifact`) are issued only by the Allocator and are the audit trail for
  every spend. Budget maximization ("spend the rest") is Allocator policy, not adapter code.
- **Mixed-room spend is real design-token spend (RB3.0, approved 2026-08-30).** The Configurator
  authors room dimensions and components without prices. The Allocator alone resolves those inputs
  against the versioned price list and returns a reconciled `designTokenSpend` summary with unit
  `design_tokens`, `producedBy: "allocator"`, four non-negative integer components (`defaultTiles`,
  `localizedTiles`, `roomWideOverlay`, `localizedHazards`), and an exact total. Configurator/build glue
  may carry that summary; presentation may validate and display it, but never derive a component or
  repair a missing total. Missing or malformed Allocator data is `unavailable`, not zero. CLI labels
  it `designTokenSpend`/`designTokenUnit`, keeping it distinct from provider tokens and runtime budget
  units. Embedded template `tokenCost` hints and presentation-side arithmetic are forbidden.
- **Budget-fit search is Allocator policy, even when an adapter performs the search.** The Allocator
  supplies requested floor/hallway counts, its own prices, the cap, hard constraints, and the complete
  lexicographic objective. An adapter may solve that opaque problem; it may not invent prices, add a
  cheaper objective, manufacture tiles, or reinterpret why one layout is preferred. Valid inputs require
  integer retained counts within requested bounds, at least one floor tile, and spend within cap. Invalid
  input is an error; `unsat` is reserved for an unaffordable minimum floor. Already-affordable layouts
  bypass solving. The Allocator authors a `solver_request` effect as data and consumes the host-returned
  result; command-layer glue owns solver-port dispatch, so no adapter object enters the persona.
  `fitLayoutToBudget` remains the exact deterministic fallback for adapter absence, `deferred`, or
  `error`.
- **The Allocator JUDGES; it does not AUTHOR (decided 2026-07-29; ENFORCED 2026-08-04, Plan CR.9 M3).**
  Pricing authority does not extend to building the thing being priced. `budget-fulfillment.js` used to
  construct and grow cards (`buildMinimumRequiredDelverCard`, `fillFlexibleDelverVitals`, `maximize*Card`)
  and encode configuration *validity* rules such as "a mobility motivation requires stamina" — all
  Configurator work, and the reason the Allocator imported Configurator internals at all. The import was
  the symptom; the mis-assignment was the cause.
  **The protocol, now in force:** the Configurator assembles a candidate configuration
  (`configurator/candidate-authoring.js`); the Allocator prices it and returns *approve with a cost* or
  *reject with a structured reason*; the Configurator revises. The exchange uses versioned contracts
  (rule 5) — `BudgetEnvelope`, `ConfigurationCandidate`, `SpendVerdict`, whose **shapes** are declared in
  `contracts/artifacts.ts` and whose **values and builders** live in `contracts/spend-protocol.js` — and
  the Allocator reads only a candidate's published `priceable` projection, never a Configurator function.
  Maximization is a bounded deterministic negotiation, not a monolith inside the Allocator.
  Four rules make this checkable rather than aspirational:
  1. **The cap is visible; prices are not.** The Configurator must see the budget or its enumeration is
     unbounded and termination stops being structural. It must never see prices, or it is pricing again.
  2. **Capabilities are injected and their absence is a loud error, never a default.**
     `authorCandidates` and `normalizeMotivations` are passed from the Configurator's public surface at
     the composition root; missing ones raise `allocator_candidate_authoring_required` /
     `allocator_motivation_vocabulary_required`. A default would be a second, silently-diverging author of
     a chartered decision — invisible, because the resulting price stays well-formed.
  3. **Ordering intent stays opaque.** Candidates carry a numeric `preference` tuple that the Allocator
     compares lexicographically without learning what any index means, which keeps `optimizationGoals`
     out of Allocator policy.
  4. **A refusal names a reason from a closed, published set, and every member of that set has a
     producer (CR.9 M4).** The protocol's two vocabularies are declared once, in
     `contracts/spend-protocol.js`: `SPEND_VERDICT_REJECT_REASONS` (what judging one *candidate* can
     conclude — `over_cap`, `not_priceable`) and `AUTHORING_VALIDATION_OUTCOMES` (what assessing a whole
     *request* can conclude). They are **not** one vocabulary and must not be merged: a candidate is never
     short of budget, because the budget is what it is being judged against. The builders refuse an
     unpublished reason, and a published reason nothing emits is dead vocabulary — the defect M4 found,
     one level down from the one CR.9 fixed.
  This **supersedes** the P2.3.4 D1 decision ("Configurator keeps costing, Allocator consults"): D1 asked
  who owns *costing* when the real seam is who *authors* versus who *judges*.
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
- Visibility system: affinity-derived sight radius, deterministic wall/barrier supercover occlusion,
  target-dark concealment, and pure per-observer scoping of actors and hazards. Runtime sequences the
  live tile/field inputs; it does not reimplement perception policy.
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
- **Every schema in this cluster is declared in `packages/runtime/src/contracts/artifacts.ts` and imported from there (CR.4 M7, 2026-08-08).** This is the general artifact rule, recorded here because this cluster is where it was broken worst: twelve of its twenty schemas were declared elsewhere — six in `adaptive-workflow/` modules, one in an *adapter* — and **six had no constant at all**, the string retyped at each use site. `tests/architecture/schema-declaration-origin.test.js` enforces it by matching **literals, not declarations**: a schema with no constant is invisible to any instrument that looks for constants, which is precisely how the cluster was miscounted three times (9 → 15 → 20). The guard's `KNOWN_OUTSTANDING` list enumerated the seven production schemas elsewhere in the tree that still violated the rule; it was an inventory of debt, not a silencer. **M8 (2026-08-11) emptied it** — every production schema literal in the tree is declared in `artifacts.ts`, so the declaration rule has no exemptions left and a new undeclared schema fails on arrival.
- **Declared centrally and *used from* the declaration are different properties, and only the second is single origin.** A file that retypes `"agent-kernel/Whatever"` inline passes a declaration check — the schema *is* declared, it simply is not being read from there — while remaining free to drift from it. Both prior failures were exactly this: `RUNTIME_PROFILE_SNAPSHOT_SCHEMA`, a second origin under a name that read like a different schema, and `GAMEPLAY_BUNDLE_SCHEMA`, declared once in the CLI that writes bundles and once in the browser module that reads them.
- **THE RULE IS NOW ABSOLUTE (M9, 2026-08-11): no production file outside `artifacts.ts` may write an `agent-kernel/*` string literal at all.** M7 and M8 held a *named set* of schemas to this stricter rule while 182 sites across 50 files still retyped a centrally declared schema — 68 of them rival `const` declarations, five inside `contracts/` itself. That backlog is closed, so the guard needs no list: a rule that enumerates what it protects is a rule someone has to remember to extend, and M8's named ten would have covered none of the other 172. The single `KNOWN_OUTSTANDING` list is now the only exemption, is empty, and is honoured by every check — an exemption that silences one check but not another is not an escape hatch, it just looks like one.

## Builder Port

Heavy level synthesis runs behind a builder adapter. UI code hands off summaries, normalized `levelGen`, or direct tile rows to that adapter instead of synthesizing layouts on the main thread.

## Combat Boundary

- `packages/core-ts/src/rules/combat.ts` owns the deterministic combat primitive: `createCombatRules(world).applyAttack(attackerIndex, defenderIndex, damage)`.
- `core.applyAttack` is the only mutation entry point for HP changes caused by an attack. It enforces valid actor indices, rejects self-attacks, requires Chebyshev-1 adjacency, requires positive integer damage, and clamps defender HP to `0`.
- Runtime never mutates HP directly for attacks. `packages/runtime/src/runner/runtime-fsm.mjs` adapts actor `attack` actions into a direct `{ kind: "apply_attack" }` directive, converts runtime actor IDs to core motivated-actor indices, and calls `core.applyAttack`.
- `core-ts` remains IO-free and runtime-ignorant: no adapter imports, no clocks, no process state, and no dependency on persona or runtime action shapes.

## Motivation And Action Flow

- Simple actor motivations are resolved deterministically in `packages/runtime/src/personas/actor/controller.js`.
- `buildMotivatedProposals()` reads `motivation.kind` from the observation actor record or `payload.initialState.actors`. It uses `resolveNearestHostile()` to choose the closest other actor by Chebyshev distance.
- Current simple motivation kinds are `attacking`, `defending`, `stationary`, and `random`: attacking actors attack adjacent hostiles or pursue distant hostiles, defending actors attack adjacent hostiles or hold position when distant, stationary actors emit no movement proposal, and random actors move to a seed-derived legal adjacent tile.
- `random` movement is deterministic pseudo-random: the choice derives from `seed:actorId:tick` (FNV/mulberry), never `Math.random()`, and synthesizes a `wait` when no legal adjacent tile exists. Replays of the same seed produce identical movement.
- Multi-actor ticks: `packages/runtime/src/runner/runtime-fsm.mjs` runs the DECIDE phase for every actor each tick and reserves proposed target tiles within the tick so two actors cannot move onto the same tile in the same tick.
- Complex motivation is opt-in. Actors with runtime decisioning enabled, for example `runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" }`, emit a `solver_request` effect instead of directly returning a concrete action.

## Solver Adapter Boundary

- Complex motivation must route through the runtime solver port (`packages/runtime/src/ports/solver.js`) and adapter implementations. Runtime code constructs the request envelope and consumes the normalized result; it does not embed solver-specific logic.
- `packages/runtime/src/personas/_shared/runtime-decision.mts` resolves fulfilled solver results through `resolveActionFromSolverResult()` and maps the selected candidate back to a concrete runtime action.
- The Actor owns candidate feature meaning and objective order. It emits
  `actor-decision-objective-v1`; adapters validate and stably sort the six-integer lexicographic tuples
  without interpreting domain features. Every live Actor request includes an objective; unknown
  motivation profiles receive an Actor-authored compatibility tuple. Invalid or absent objectives
  defer with typed reasons, after which runtime applies its deterministic Actor fallback. An adapter
  must not recreate the compatibility policy or invent ranked diagnostics for an old envelope.
- The active CLI and web platform copies expose the canonical `hybrid-constraint` adapter for
  `actor_action_selection` and `allocator_budget_fit`. The Actor branch remains a pure tuple validator/
  stable sort and never initializes Z3. Only the Allocator branch initializes Z3 and compiles the
  persona-authored opaque integer expressions. `adapters-test` retains fixture/test doubles separately.
- Allocator budget fit uses the same effect boundary without giving the persona an adapter. The
  Allocator prepares a `solver_request`; `packages/runtime/src/commands/solver-host.js` checks domain
  capability, dispatches it through `createSolverPort`, awaits the result, and invokes the Allocator's
  result consumer. Persona code owns the problem and validation; host glue owns transport only.
- `createRealZ3SolverAdapter`, `createActorLexicographicSolverAdapter`, and
  `AK_SOLVER_ENGINE=z3-real` remain compatibility names; the canonical factory is
  `createHybridConstraintSolverAdapter`. Adapter or domain-capability absence, `deferred`, and `error`
  return control to the Allocator's exact characterized fallback.
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
- **`GAME_COLOR_PALETTE` and `GAME_AFFINITY_COLOR_HEX` in `packages/runtime/src/contracts/game-elements.js` are the single origin for colour** — affinities, tile backgrounds, vitals, types. No surface may declare its own copy. `ui-web` derives Phaser tint integers from these at load; it does not restate values. Three separate duplicates existed before 2026-09-02 and one had silently drifted on three of ten affinities, so board tile tints disagreed with every other surface.
- Affinity colour separation is **load-bearing, not stylistic**: a board sprite spends its silhouette on role, so colour is the only channel carrying affinity. `tests/runtime/affinity-palette-separation.test.js` enforces measured floors for pairwise separation, separation against every tile colour, opposed-pair distance, outline-vs-fill contrast, and WCAG AA for labels. Colour changes go through `scripts/design/derive-affinity-palette.mjs`, not by hand.
- Affinity **text** colours are a separate concern from fills and may diverge from them: a fill is judged against the dark board tiles, a label against the UI panel by contrast ratio.

## Phaser UI Layer

- `packages/ui-web/src/card-builder-controller.js` is a headless controller around runtime card-authoring commands. It has no DOM dependency; UI surfaces orchestrate view state only, while card semantics, simulation rules, and artifact contracts remain outside `ui-web`.
- `packages/ui-web/src/views/phaser-frame-view.js` is the unified Phaser game frame. It hosts the Card Builder surface and the Gameplay surface, including the existing `createGameplayPhaserRenderer` path.
- `ui-web` renders and emits UI intents only. The current Phaser card-builder intent set is: select chip, apply property to the active card, select card, move card between groups, load bundle, and select tile/entity. Phaser interaction mechanics remain in `ui-web`; card-authoring semantics remain in runtime.
- `packages/ui-web/src/views/card-builder-phaser-renderer.js` renders card-builder interactions for the Phaser surface without owning card semantics or artifact schemas.
- `packages/ui-web/src/phaser-surface-ingestion.js` is a UI-side artifact ingestion boundary. It routes existing versioned artifacts to the correct Phaser surface and introduces no new MCP tool schemas.
- **Board sprite semantics live in `runtime`, not `ui-web`.** `packages/runtime/src/render/entity-sprite-composer.js` composes every board entity — delver, warden, hazard, resource — as pixels; `packages/ui-web/src/views/entity-sprite-textures.js` only performs Phaser texture-cache mechanics. Texture keys depend on `{role, affinity, size}` and nothing else.
- **A board sprite carries exactly two channels: role as silhouette, affinity as fill.** Vitals, expression and motivation are not encodable on it, and `EntitySpriteState` has no fields for them. This is enforced by a refusal test, not convention. The retired eight-channel medallion is archived at `docs/design/archive/2026-09-medallion-era/`.
- Silhouettes are guaranteed distinguishable down to **12px**. `MIN_CAMERA_ZOOM` in the gameplay renderer exists to defend that floor and must not be lowered without a new legibility measurement.
- **HUD view-model semantics live in `runtime`** (`packages/runtime/src/render/actor-hud-model.js`): vital ordering, labels, colours, fraction derivation, and which vitals a role has. `ui-web` draws the returned data.
- The selected-entity HUD renders on its **own Phaser camera pinned at zoom 1**. `setScrollFactor(0)` alone is insufficient — Phaser still scales scroll-fixed objects about the camera centre, so a HUD on the main camera is scaled by board zoom.
