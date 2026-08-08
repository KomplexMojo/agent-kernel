# Allocator Persona

The Allocator is the **budgeting and resource-policy persona** for the simulation.

It acts as a deterministic “banker” that evaluates proposed simulation configurations and behaviors against explicit cost models, ensuring that runs remain bounded, auditable, and comparable.

This document defines the Allocator as a **policy and coordination role**. Detailed rule enforcement and state mutation remain the responsibility of the simulation core (`core-ts`).

---

## At a Glance

| Area | Allocator responsibility |
| --- | --- |
| Owns | Budgets, price lists, spend proposals, allocation decisions, receipts |
| Does not own | Simulation state mutation, action legality, or direct resource deduction |
| Primary inputs | Budget artifacts, price lists, proposed actor/layout/action costs, three injected Configurator capabilities (`deriveRoomLayout`, `authorCandidates`, `normalizeMotivations`) and one injected Director capability (`resolveSummary`) |
| Primary outputs | Budget receipts, approval/rejection decisions, reconciliation signals |
| Boundary | `core-ts` enforces provided caps; Allocator defines policy |

## Persona Scope

The Allocator persona is responsible for **deciding whether proposed activity is affordable**, not for enforcing the effects of that activity.

At a high level, the Allocator:
- Owns budget policies and cost models.
- Evaluates requests for resources or complexity.
- Issues validated budget receipts.
- Signals approval, rejection, or required reconciliation.

The simulation core (`core-ts`) remains responsible for applying costs to state and enforcing consequences.

---

## Responsibilities

### It prices room geometry; it does not derive it (CR.9 M2)

`createAllocatorPersona({ deriveRoomLayout })` takes the Configurator's room-geometry derivation as an
**injected capability** — the mirror of CR.6's `createActorPersona({ admitProposals })`, where this persona
is the one injecting. Room tile counts (small 24 / medium 48 / large 96) are Configurator geometry and live
in `configurator/card-model.js`; the Allocator used to import that module and compute the tile count itself,
which is a persona authoring structure it does not own purely to have something to charge for.

Surfaces that price a room card — `evaluateRoomCardLayoutSpend`, `calculateRoomCardUnitCost`,
`buildDesignSpendLedger`, `assessFeasibility`, `maximizeFulfillment` — **refuse** with
`allocator_room_geometry_required` when the capability is absent. Deliberately no default: a second,
silently-diverging answer to "how big is this card set" is the CR.1 defect class, and it would be invisible
because the output stays well-formed. Most Allocator surfaces never price a room card, so the parameter is
optional at construction and enforced at the point of use.

### It judges configurations; it does not author them (CR.9 M3)

Budget maximization is Allocator policy, but *building the thing being priced* is not. The maximizer used
to enumerate `(manaRegen, manaMax)` pairs, assemble candidate cards, fill their vitals and encode validity
rules such as "a mobility motivation requires stamina" — then price its own output. That is why it imported
Configurator internals at all: the import was the symptom, the mis-assignment was the cause.

The loop CR.9 asked for was not missing, it was **fused**. M3 split it across the persona line:

| Direction | Contract | Contents |
|---|---|---|
| Allocator → Configurator | `BudgetEnvelope` | `capTokens`, `perUnitCapTokens`, `count`. **No prices.** |
| Configurator → Allocator | `ConfigurationCandidate` | the assembled card, a `priceable` projection (normalized motivations, affinities, vitals), and an opaque `preference` tuple |
| Allocator → Configurator | `SpendVerdict` | `approved` + cost + `remainingTokens`, or a structured `reason` |

Revision is a **round trip**, not a field: the fill step spends `perUnitCap − cost`, so the revised card is
a function of the price and the author cannot supply it up front without pricing. The Allocator judges,
publishes the remaining room, and asks the Configurator to revise.

### The refusal vocabulary is published, and every member has a producer (CR.9 M4)

The protocol's **values** live in `contracts/spend-protocol.js`, which both personas import;
`contracts/artifacts.ts` remains the definition of record for the **shapes**. M3 left the values homeless,
so the schema strings were restated at each point of use and the authoring-validation outcomes were
declared three times — once, wrongly, inside this persona. Two vocabularies, deliberately not merged:

| Vocabulary | Answers | Members |
|---|---|---|
| `SPEND_VERDICT_REJECT_REASONS` | why ONE candidate was refused (`judgeCandidate`) | `over_cap`, `not_priceable` |
| `AUTHORING_VALIDATION_OUTCOMES` | why a WHOLE request cannot be fulfilled (`assessFeasibility`) | `valid`, `conflicting_requirements`, `insufficient_budget`, `invalid_requirements` |

A candidate is never `insufficient_budget` — the budget is the thing it is being judged against — and a
request is never `over_cap`. `rejectSpend` throws on a reason outside its set, so a free-form refusal
cannot be written; `invalid_requirements` has no producer here and says so in place, because it is an
accepted *input* value on `AgentCommandRequest` rather than dead code.
`tests/personas/allocator/allocator-spend-verdict-reasons.test.js` asserts every published reason is
reachable and that the `artifacts.ts` mirrors agree member-for-member; `tests/architecture/single-origin.test.js`
fails if either vocabulary is declared anywhere else under `packages/`.

`createAllocatorPersona({ authorCandidates, normalizeMotivations })` takes both capabilities from the
Configurator's public surface. `assessFeasibility` and `maximizeFulfillment` **refuse** with
`allocator_candidate_authoring_required`; the pricing surface refuses raw motivations with
`allocator_motivation_vocabulary_required`. No defaults, for the same reason as room geometry above.

Three properties keep this real rather than cosmetic, and the gate
(`tests/personas/allocator/allocator-judges-not-authors.test.js`) asserts each:
- The Allocator reads only `candidate.priceable` — never `candidate.card`, which is the Configurator's
  product and is simply handed back if it wins.
- The `preference` tuple is compared lexicographically as plain numbers; the Allocator never learns that
  index 0 means "mana regen", which is what keeps `optimizationGoals` out of its policy.
- Termination is structural: the outer walk is one fixed pass, and candidate bounds are pure functions of
  the cap. `assertJudgementBudget` is a backstop that must never fire.

### It prices a summary; it does not read a card set (D8, 2026-08-08)

The same rule pointed at the Director. `buildDesignSpendLedger` used to call the Director's
`extractSummaryFromCardSet` to turn a card set into rooms, hazards, resources and actors before pricing
them — reading another persona's input vocabulary and importing its tools to do so. Under the order D8
settled (`orchestrator → director → configurator → allocator`) that import also pointed **backwards**.

The translation is now the injected `resolveSummary`, and the ledger **refuses** with
`allocator_summary_resolution_required` when it is handed a card set without one. Both spellings the
Director accepts — `summary.cardSet` and `summary.cards` — trigger the refusal; a guard that knew only
the first would quietly price an untranslated summary.

A summary that carries **no** card set needs no capability at all and prices as before. That is not a
loophole: it is the shape the Director already hands back, and a refusal that fires on every input
would be an outage rather than a boundary.

### Every tile is charged, and tile prices have one origin (CR.1 closed, CR.9 M5)

CR.1's last census entry was `DEFAULT_LAYOUT_TILE_COSTS` in `contracts/domain-constants.js`:
a second tile-price table that had already drifted from `base-costs.json` (hallways 1 vs 3). It
was **deleted**, not aligned — picking a winner leaves the second table free to diverge again.
Tile prices now come from a PriceList: a caller's list overrides per id, and `base-costs.json`
answers where it is silent. An override is not a second origin; a second table is.

Two charging defects went with it, both invisible under a green suite:

| Was | Now |
|---|---|
| `connectorFloorTiles` (8/16/24 per small/medium/large room card) were excluded from `billableFloorTiles` | charged as `tile_hallway` line items — a medium room card costs 64, not 48 |
| `hallwayTiles` counts were zeroed before pricing (`deprecated_hallway_tiles_ignored`) while the price list still published `tile_hallway: 3` | charged; a hallway tile costs what a floor tile costs (1) |

A price the system publishes and cannot charge is dead vocabulary — the same defect as M4's
published reject reason with no producer, one layer down.
`tests/personas/allocator/allocator-tile-charging.test.js` holds the census that fails if a
tile price becomes unchargeable again.

### EVERYTHING COSTS SOMETHING — the rule, and why it is a rule

**Maintainer rule, 2026-08-05: everything in the game has a cost, even if only the 1-token
base. An economy exists partly to prevent economic exploitation, so anything obtainable for
zero tokens is not a pricing gap — it is an exploit.**

Auditing against that rule found four free surfaces, none of which failed anything:

| Free surface | Now |
|---|---|
| A hazard's **affinity payload** cost nothing on the real `ak create` path. The pricer tested `typeof affinity === "object"`, but the CLI writes `affinity: "fire"` beside `affinityStacks: [...]` — the branch never matched | charged: base + stacks + expression, the same as a delver's. In the g1 golden the delver's fire/emit affinity cost 46 tokens and the hazard's identical one cost **0**; a hazard is now 42 rather than 5 |
| A hazard's **vitals** likewise: the pricer read `{ max, current, regen }`, the CLI writes `{ kind: "one-time", amount }` | charged as vital points |
| `motivation_stationary` was priced at **0** | 1 — a level of stationary wardens is no longer free behavior |
| `hazard_base` (10) was published and charged by nothing | deleted; `hazard_basic` (5) is the enforced base every hazard pays |

⇒ **A charging path that matches one SHAPE of a payload is not a charging path for that
payload.** This is the guard-spelling lesson arriving in the economy: both hazard defects
were shape mismatches, invisible because a missing charge produces a smaller, well-formed
receipt. `readHazardAffinityStacks` / `readHazardVitalCharges` read every known shape in one
place so a third shape has one home rather than a second charging site.

`tests/personas/allocator/allocator-everything-costs.test.js` is the standing gate: no
published price may be zero, every published price id must be charged by some real payload
(with a written exception list), and a bare entity must still pay its base.

### The budget split follows the prices (CR.9 M5 retune)

`levelBudgetSplitPercent` moved **room 44 → 41, hazard 12 → 15**. The old split was set when
a hazard cost 5 tokens with its payload free; hazards now cost ~52, and three of them no
longer fit a 12% share — the content-gen benchmark refused `hazards: 157/156`. The share
follows the prices, not the other way around.

**It is one number in one place now, and that took three deletions.** The same percentages
were also declared as `DEFAULT_POOLS` and `REFERENCE_TARGETS` in `budget-allocation.js`
(numbers in code, tied to the JSON only by a comment) and — the one that mattered — as
`AUTHORING_POOL_WEIGHT_DEFAULTS` in `adapters-cli/src/cli/ak-impl.mjs`, which is the copy
`ak create` actually used. All three now derive from `base-costs.json`.

⚠️ **That fourth copy is why the single-origin guard's scope is now `packages`, not
`packages/runtime/src`.** It sat in an adapter, outside the guard's reach, through the
entire milestone that closed CR.1 — and the proof it was load-bearing is that retuning the
canonical split changed nothing on the real path until it was removed. An economy that ends
at a package boundary is not a single origin; neither is the guard that protects it.

### The base-cost standard: numbers in JSON, formulas in code

**Every element with a token cost follows this split, without exception.**

| | Where | What |
|---|---|---|
| **Data** | `base-costs.json` | Base cost per price id. Numbers only. Tunable — edit this to reprice the game. |
| **Logic** | `default-price-list.js` | Which ids scale quadratically (`QUADRATIC_IDS`), and the resource free-floating premium (`buildResourceItems`). |

A base cost must never appear in JavaScript. If it does, the JSON stops being the single source of
truth and the two drift silently — nothing fails, the numbers just quietly disagree.
`tests/runtime/base-cost-standard.test.js` fails the build if a literal `unitCost` reappears in the
price-list code, if a cost value in the JSON is anything but a number, or if an emitted item is not
backed by the JSON.

Adding a priced element:
1. Add its base cost to `base-costs.json` (number only).
2. Add a description to `DESCRIPTIONS` in `default-price-list.js`.
3. If it scales quadratically, add its id to `QUADRATIC_IDS`. Otherwise it is linear by default.
4. Do **not** write the number anywhere in code.

Formulas applied to each item (`validate-spend.js`):
- `linear` — `totalCost = unitCost × quantity`
- `quadratic` — `totalCost = unitCost × quantity²`

Resource items (`resource_*`) are **derived in code** from the ids they mirror at
`round(freeFloatingPremium × base)`, inheriting the mirrored id's linear/quadratic shape — the
premium changes price, never scaling. Hazards pay no premium: a hazard threatens, a resource grants.

> **Known bug — the motivation fallback silently overcharges.** `resolveMotivationUnitCost` consults
> the price list first and, on a miss, falls back to `DEFAULT_MOTIVATION_COSTS`. The two disagree by
> up to 12× (list `exploring = 2`, fallback `25`). A caller holding a price map without motivation
> entries is charged the fallback with **no error and no warning**. This fires in production today:
> the budget maximizer charges 25 for `attacking`, which the list prices at 3 — an ~8× overcharge
> that silently costs a delver ~18 tokens of mana.
>
> The right contract is to reject an incomplete price list. It is not yet implemented because doing
> so changes what the maximizer can afford (`mana.max` 29 → 47), which needs its own milestone and a
> benchmark re-baseline. The fix order is: give the maximizer a complete price map so `attacking`
> resolves to 3, *then* reject incomplete lists. Pinned by
> `tests/personas/motivation-price-fallback-strict.test.js`.

> **Known bug — `ak create` does not charge affinity-only resources.** Found 2026-07-18 while
> building P0.2 goldens: `create` charges an affinity-only resource **zero tokens** (empty receipt)
> while `resource-plan` charges the identical payload 538. The two commands assemble spend
> proposals through different glue paths and only resource-plan's extracts the affinity payload.
> Pinned by `tests/personas/allocator/allocator-golden-receipts.test.js` (g2 vs g4). Fix lands in
> the Persona Enforcement Program P1 (single Allocator entry point) — do not spot-patch the create
> path separately; that would add a sixth divergence.
>
> **Dead code DELETED (P1.2, 2026-07-18).** `calculateMotivationStackCostFromCore` and core-ts's
> entire motivation cost surface (unit/profile/design cost lookups, the cost accumulator,
> `readMotivationCost`) had zero production consumers and are gone. Pricing is Allocator policy;
> core keeps only the codebook (kinds, families, tiers, flags) and the evaluation accumulator.
> The remaining in-code cost tables (`cost-model.js`, `DEFAULT_MOTIVATION_COSTS`) now source their
> numbers from `base-costs.json` (`actorModel` / `motivationFallback` groups) — same values, one
> home — until P1.4 unifies the models themselves. Note: a THIRD motivation price table exists in
> `configurator/motivation-rules.js` (`profileCosts`: exploring 1, attacking 5, strategy 20…),
> embedded in the behavior-rules document — P1.4 must reconcile all three.

> **Known divergence — `configurator/cost-model.js` DOES charge live paths.** (An earlier revision
> of this note claimed it charges nobody; that was wrong.) *(`spend-proposal.js` named below is an
> **Allocator** file as of 2026-08-04 — CR.9 M1 moved it here from `configurator/`; this note predates
> the move and described it by its old address.)* It holds a second set of cost constants
> that disagree with this price list on nearly every value (vital points `2·H` vs `1`, regen
> `12·R²` vs `n²`, affinity base `30` vs `10`, stacks `Σ(10+8(n-1)²)` vs `n²`), and those constants
> reach real receipts through `spend-proposal.js#calculateActorConfigurationUnitCost` — used by
> card authoring, `selection-spend.js`, and the CLI delver-card maximizer. Inside that function:
> vital points and expression costs consult the price list first and silently fall back to
> cost-model constants; **affinity base + stacks never consult the price list at all** (always
> `30 + Σ(10+8(n-1)²)`); regen is linear when the list has an entry but quadratic
> (`REGEN_COST_COEFFICIENT · R²`) on a miss. `budget-maximizer.js` prices regen exclusively from
> `REGEN_COST_COEFFICIENT`, never from the list. So an actor's affinity and a resource's affinity
> are charged by two different models today. Unification is planned work (see
> `local-codex/Plan.md` M18–M21); until then do not add costs to `cost-model.js`.

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

#### The budget loop asks; it no longer computes (CR.4 M5b.2b)

`personas/orchestrator/llm-budget-loop.js` used to import `budget-allocation.js`, `layout-spend.js`
and `selection-spend.js` directly and price the build itself. Three controller methods replace that:

| Controller method | Fronts | Replaced the loop's call to |
|---|---|---|
| `resolveTileCosts(args)` | `layout-spend.js` | `resolveLayoutTileCosts(priceList)` |
| `allocateBudget(args)` | `budget-allocation.js` | `buildBudgetAllocation({ … })` |
| `evaluateSelectionSpend(args)` | `selection-spend.js` | `evaluateSelectionSpend({ … })` |

The loop reaches them **through the Director**, which is its sole counterpart (Option 1, maintainer
decision 2026-08-07) — see the Director README. Two rows left the persona-boundary allowlist as a
result (**48 → 46**); one of them had been sitting as `UNDECIDED` since CR.1 relocated
`budget-allocation.js` into this persona, and threading it *is* the ownership answer it was waiting for.

Like `pricing.*` and the two layout evaluators, all three are **read-only policy over caller-supplied
args**: available in any FSM state, not gated behind `registerBudget`, issuing no receipt and never
touching the ledger. Each defaults `priceList` from the persona via `withPersonaDefaults`, so an
explicit per-call price list wins and `priceList: undefined` cannot clobber the persona's own — the
CR.9 M5 precedence lesson, and the reason a mispriced build would otherwise be invisible.

#### The auto-fit search: revising a layout to fit a budget (CR.4 M5b.2c)

`layout-fit.js` — `fitLayoutToBudget({ layout, remainingBudgetTokens, priceList, layoutCosts })`,
published as `allocator.fitLayoutToBudget` and reached through `director.fitLayoutToBudget`.

It lived in `llm-budget-loop.js` until 2026-08-08. **Threading its six `evaluateLayoutSpend` calls
would have missed the point:** its helpers `pickCheapestField` and `selectReductionField` chose which
tile to drop *by that tile's price*. Calling pricing is one thing; **deciding what a token is best
spent on is this persona's job**, and that decision was executing inside the Orchestrator.

The search: price the layout → if it fits, accept unchanged → otherwise scale all tile counts
proportionally, then reduce the most expensive field one tile at a time until it fits (guarded), then
guarantee at least one walkable tile, buying it back by reducing elsewhere if needed.

⚠️ **It moved verbatim, and `tests/personas/allocator/allocator-layout-fit.test.js` is why that is
checkable.** A revision loop is the easiest thing here to break silently: a flipped tie-break or a
changed rounding still returns a well-formed layout, still under budget, just a *different* one — no
schema, guard or golden would report it. The test replays **660 cases** captured from the pre-move
implementation, and both of those perturbations were confirmed to fail it. **If a case fails, do not
re-record the fixture** — that deletes the only evidence the search still converges where it did.

⚠️ **The `llm-budget-loop.js → layout-spend.js` allowlist row SURVIVES, but it is now HALF the row it
was.** It used to carry two different jobs. The layout *vocabulary* half is gone: **D8-V (2026-08-08)
moved `normalizeLayoutCounts` and `sumLayoutTiles` out of this persona** into
`contracts/domain-constants.js`, by maintainer decision — they normalize and count, they price nothing,
and routing a data reader through an FSM-gated controller would be ceremony. What keeps the row alive
is the other half: two remaining `evaluateLayoutSpend` calls validating an LLM-proposed layout against
a budget. Those are plain threading and still unclaimed.

⇒ *One allowlist row is not one fix.* This row has now absorbed four separate pieces of work
(M5b.2b's `resolveLayoutTileCosts`, M5b.2c's whole auto-fit search, D8-V's vocabulary move) without
moving, because a row records who imports the module today, not what is left to do about it.

---

### Budget Receipts
When a request is accepted, the Allocator issues a **budget receipt** that:
- Caps allowed spending.
- Encodes limits and constraints.
- Is passed downstream as a validated artifact.

Downstream personas must operate within the bounds of the receipt.

Budget receipts are emitted as `agent-kernel/BudgetReceiptArtifact` and reference
the originating `BudgetArtifact` and `PriceList` for auditability.

#### Proposal admissibility (CR.6)

Judging a receipt against proposed actions is this persona's call, and lives in
`proposal-admissibility.js` — published on the controller as `admitProposals(proposals, { budgetReceipt,
budgetAllocation })`. It is pure and stateless: proposals and budget in, the admitted subset out.

It used to live in `actor/controller.js` and run inline inside the Actor's `advance()`. The give-away was
the vocabulary — the ids it resolves (`motivation_reflexive`, `affinity_expression_*`, `affinity_stack`)
are priced in this persona's own `base-costs.json`, so the Actor was reading the Allocator's price-list
keys to judge its own proposals.

The runner wires this persona's `admitProposals` into the Actor at construction (`buildDefaultPersonas`),
so the Actor applies the Allocator's judgement without defining it and cannot reach a different verdict.
An Actor handed a budget with no judge attached **throws** (`actor_admissibility_required`) rather than
silently admitting everything.

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

Note: Sensing can be modeled as an affinity kind with mana drain; externalize (push) enables long-range fog piercing, localized (emit) extends local visibility radius, and internalized (pull) can represent self-focused detection (e.g., hazard awareness within normal sight). Composite costs should be derived from atomic affinity + expression + mana/regen pricing.

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
- **Two vocabularies, one FSM** (PX.5). `budget` → `allocate` is BUILD-plane: `allocator-services.js`
  drives it (`registerBudget`, `validateSpend`), so `budgeting`/`allocating` assert a registered budget and
  a validated spend. `observe` · `monitor` → `rebalance` is the TICK-plane loop — no service method sends
  those, so they claim nothing about build-plane work. The runner used to send `budget`/`allocate` directly,
  reporting `allocating` with `budgetTokens: null` and `receiptCount: 0`; it now sends only the tick
  vocabulary, and `monitor` may be entered from `idle` so the loop no longer starts with a false claim.
  `observe` is a state-preserving self-loop: the Allocator's tick work (turning payload effects into
  budget-limited request actions, emitting solver/external-fact requests) is payload-driven, so it needs a
  round but not a state change.
- Outputs: budget policies/receipts as data; no IO or direct state mutation.

## Relationship to core-ts

The Allocator does **not**:
- Deduct resources from simulation state.
- Enforce movement, action, or solver costs directly.
- Modify world or actor state.

Instead, it supplies **constraints and receipts** that the runtime and core respect.

`core-ts` maintains the authoritative budget ledger (caps, spend, availability) and emits
limit events when caps are reached or violated.

### What this implies for core-ts

The following concepts may exist in `core-ts`, but only as **data and rule enforcement**, not policy:

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
- Canonical source: `controller.js` + `state-machine.js` + `contracts.ts`. The 1-line `.mts` re-export shims were deleted 2026-08-01; consumers import `persona.js` (the controller barrel), not the state machine.
- Keep README, contracts, fixtures, and any state-diagram metadata in sync when states/events/subscriptions change.
- Table-driven persona tests (phase/transition fixtures) are the safety net; turn off `TS_NODE_TRANSPILE_ONLY` in CI to catch signature drift.
- Entry points are `.js`. There is no `.mts` twin (no `ts-node/esm` required).
