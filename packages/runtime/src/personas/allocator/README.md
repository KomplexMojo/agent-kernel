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

## Ownership status (A1–A5)

Ownership is not "the call goes through the controller". The charter defines it as **A1–A5**
(`docs/architecture-charter.md` → *Ownership — what "belongs to a persona" means*), and **a chartered
behavior with no G1 test is not owned**. The rows below mirror
`tests/architecture/persona-authority-registry.js`, which is the single origin for that status;
`tests/architecture/persona-readme-authority.test.js` fails if this table and the registry disagree.

<!-- A1-A5-STATUS:allocator -->

| Behavior | Criteria | Status | Proof |
|---|---|---|---|
| `allocator/pricing-single-origin` — every token cost has one author, inside the Allocator | A1 | ✅ owned (CR.1, closed at CR.9 M5) | `tests/architecture/single-origin.test.js` |
| `allocator/judges-not-authors` — it prices a config it did not author, from the artifact's published fields | A1 | ✅ owned (CR.9 M3) | `tests/personas/allocator/allocator-judges-not-authors.test.js` |
| `allocator/spend-authority` — a build it will not fund does not happen: the receipt gates production | A2 | ✅ owned (P1 / CR.1) | `tests/adapters-cli/ak-hazard-resource-plan.test.js` |
| `allocator/budget-maximization` — maximizing against a budget spends its prices, never an assumed one | A1 | ✅ owned (CR.7 / WP-5 D10) | `tests/personas/configurator/configurator-maximizer-prices-from-allocator.test.js` |
| `allocator/reconciliation` — reconciling actual spend against the issued budget | A1 | 🔴 blocked — P5.5 | none; the behavior is not implemented |

<!-- /A1-A5-STATUS -->

⚠️ **Three of the five rows are A1 — sole implementation — because that is the criterion this
persona keeps losing.** A second price table does not fail an output test when its numbers happen to
agree: the D10 finding caught a private fallback price of `1` against an Allocator price of `1`,
where quadrupling the real price changed nothing observable. Which is why the guards are a **census
over the tree** rather than tests over a result, and why unpriced inputs are refusals that name the
missing key instead of defaults.

**`allocator/spend-authority` is the A2 row, and it runs through the real CLI:** when this persona
denies the receipt, the build throws `Budget receipt denied: …` and the command exits non-zero.

⚠️ **The citation on that row is itself a finding.** It first named `ak-warden-plan.test.js` — the
obvious candidate, which mentions the denial string and asserts a non-zero exit. Perturb the refusal
away and that test stays **green**: its regex accepts three different messages
(`/budget|minimum_cost_exceeds_budget|Budget receipt denied/i`) and its scenario actually fails at an
earlier gate. *A test that mentions a behavior is not a test that pins it.* The proof that does fail
is `ak-hazard-resource-plan.test.js`, and finding it required neutralizing **both** throw sites in
`orchestrate-build.js` — one is a superset of the other, so removing one left the entire suite green
and briefly read as "nothing guards this at all".

🔴 **`allocator/reconciliation` is chartered, described below under "Reconciliation and Adjustment",
and NOT IMPLEMENTED.** `rg reconcil` over `packages/runtime/src` finds only the Configurator's layout
tile reconciliation — a different word for a different thing. It is registered as blocked (P5.5) so
the gap is counted rather than merely described; read that section as intent, not as behavior.

🟢 **THERE IS NOW ONE PRICE MODEL. P1.4 landed 2026-08-12.** The second one —
`configurator/cost-model.js`'s affinity base 30, `Σ(10+8(n-1)²)` stacks, `2·H` vital points and
quadratic regen — is deleted, along with its only consumer (`actor-config-generation.js`, which had
no production importers), the `actorModel` / `motivationFallback` groups in `base-costs.json`, and
the eight tests that pinned the divergence as tolerated.

⚠️ **It was dead when it was deleted, and it had been dead for an unknown stretch while three
documents said otherwise** — including an earlier version of this paragraph. Prices now have exactly
one home, and two guards keep it that way: the older one forbids price-shaped constants in code, and
a new one forbids reading `base-costs.json` from outside this directory. That second guard exists
because the first was structurally blind to the model it was meant to stop — once P1.2 moved the
numbers into JSON, the divergent declarations held no literals to match.

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

### Three vocabularies name these pools, and two of them are mapped from one file

The pools have ids (`rooms`, `hazards`, `wardens`, `resources`, `delver`). Two other
vocabularies refer to them and neither matches:

| Vocabulary | Example | Mapped by |
|---|---|---|
| **Card types** | `room`, `hazard`, `warden` | `POOL_ID_BY_CARD_TYPE` (`budget-allocation.js`) |
| **Spend categories** | `floor_tiles`, `delvers`, `shared_system` | `POOL_ID_BY_SPEND_CATEGORY` (`budget-allocation.js`) |

Both maps live beside the pools they name, for the reason the split itself does: the pools are
declared here, so the translation onto them is this file's formula.

**The `rooms` row of `scenarioSpendReport` is a POOL rollup, not the `rooms` category.** Its
target is the rooms pool's allocation, so its actual is every category drawing on that pool —
`rooms + floor_tiles + shared_system`, derived from the map rather than restated. Categories
with their own pool keep their own row and are **not** folded in.

⚠️ **That rollup was hand-written as `floor_tiles + hazards + shared_system` and had gone
stale**, so hazards were reported in two rows and compared against a target that excluded
them. Golden `create-g1` recorded it: `rooms.actual` was 67 for a build whose only rooms-pool
spend was 25 tokens of floor tiles. Fixed 2026-08-11; that golden was regenerated in the same
diff and **only that row moved** — `totalSpend`, `remaining` and every line item are unchanged,
because the money was always right and only the reporting was not.

⚠️ **`POOL_ID_BY_SPEND_CATEGORY` was declared verbatim in two modules until 2026-08-11**
(`incentive-model.js` and `validate-spend.js`, under the name `CATEGORY_POOL_IDS`) **and that
copy is why one defect existed twice.** Both carried `hazards: "rooms"` shadowed by a later
`hazards: "hazards"` — a dead mapping from before hazards had their own 15% pool, kept alive
only by JS taking the last duplicate key. Fixing one file would have left the other.
`tests/architecture/single-origin.test.js` now forbids a second declaration under `packages/`,
**matching the old name as well as the new one** — a revert would reintroduce the copy under
the spelling it originally had.

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

> **✅ CLOSED — the motivation fallback that silently overcharged is GONE.** It read: on a price-map
> miss, `resolveMotivationUnitCost` fell back to `DEFAULT_MOTIVATION_COSTS`, which disagreed with
> the list by up to 12× (list `exploring = 2`, fallback `25`) and charged it with no error and no
> warning. Today that function returns `null` on a miss and `calculateMotivationStackCost` pushes
> `motivation "<kind>" has no price list entry` — a refusal that names the missing key, which is the
> contract the note said was "not yet implemented".
> ⚠️ The note also cited `tests/personas/motivation-price-fallback-strict.test.js` as its pin. **That
> file does not exist** — it was renamed or absorbed and the citation was never updated, so the doc
> pointed at a guard nobody could run. Verified 2026-08-12 against the code, not the citation.

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

> **✅ CLOSED BY DELETION — P1.4, 2026-08-12. There is no second price model.**
> This note used to describe `configurator/cost-model.js` as holding cost constants that disagreed
> with this price list on nearly every value (vital points `2·H` vs `1`, regen `12·R²`, affinity base
> `30` vs `10`, stacks `Σ(10+8(n-1)²)`) and reaching real receipts through
> `spend-proposal.js#calculateActorConfigurationUnitCost`.
>
> **The first half was true and the second half stopped being true, and nothing noticed.** The census
> at `05e27e43` found that function reading the price list through `requireEntry` and erroring on a
> miss, and found the divergent constants reachable only from `configurator/actor-config-generation.js`
> — a module with zero production importers. P1.4 deleted both, plus the `actorModel` and
> `motivationFallback` groups in `base-costs.json` that fed them, and the eight tests that pinned the
> divergence as tolerated.
>
> ⚠️ **The old single-origin guard could not have caught this, and that is the lesson worth keeping.**
> `PRICE_OR_BUDGET_CONSTANT` matches a price-shaped name assigned to a numeric literal;
> `VITAL_MAX_COST_MULTIPLIER` matched the name perfectly but held `ACTOR_MODEL.vital_max_health`,
> because P1.2 had moved the numbers into JSON. **Complying with "numbers live in JSON" is what made
> the second model invisible.** The new guard forbids reading `base-costs.json` from outside
> `personas/allocator/` at all — the concept is "a price model with a second author", not "a number
> in code".
>
> The third table the old note named — `configurator/motivation-rules.js#profileCosts` — is design
> data inside the DEFAULT rules artifact; its derived `MOTIVATION_COST_DEFAULTS` has no consumers
> anywhere in the repo, so it prices nothing. Left in place deliberately: deleting authored design
> numbers is a content decision, not a pricing one.

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

#### Judging a proposed layout: `evaluateLayoutSpend` (CR.4 M5b.2d)

`layout-spend.js` — `evaluateLayoutSpend({ layout, budgetTokens, priceList, tileCosts })`, published as
`allocator.evaluateLayoutSpend` and reached through `director.evaluateLayoutSpend`.

It answers what a layout costs and whether it fits; `fitLayoutToBudget` above *revises* a layout that
does not. They stay separate answers because only one of them decides anything: judging is a lookup,
revising is a policy.

✅ **The `llm-budget-loop.js → layout-spend.js` allowlist row is GONE (2026-08-08).** With these two
calls threaded, the loop imports nothing from this persona and the row died rather than moved.

⇒ *One allowlist row is not one fix.* That row absorbed **four** separate pieces of work before it
finally cleared — M5b.2b's `resolveLayoutTileCosts`, M5b.2c's whole auto-fit search, D8-V's move of
`normalizeLayoutCounts`/`sumLayoutTiles` out to `contracts/domain-constants.js`, and finally these two
calls — because a row records who imports the module *today*, not what is left to do about it. Three
consecutive dispositions read "absorbed by finding X" while a different importer still stood behind it.

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
