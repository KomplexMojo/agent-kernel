# Actor tactic catalogue (issue #673, tracker #611)

LLM seat runs are a teacher, not a feature. This catalogue lists what a good player did, or should have done, that the Actor lacks. The entries are data in [`actor-tactic-catalogue.json`](actor-tactic-catalogue.json); the benefit gate (#674) consumes them. No Actor code changed here. Design: `notes/ai-strategy-tactics-operations-2026-11-02.md`.

## How an entry is judged

Each entry carries a class: `works`, `doesnt_work`, `z3_solve` (a multi-step plan that may need a solver or A*/BFS) or `list` (data in `strategy.js`, or a rank, is enough). `observed` says how the behaviour went in the run.

Scoring follows Darren's rules (2026-11-02), reported separately and never collapsed:

1. **Token value acquired**, from the Allocator price list.
2. **Non-renewable use**: a vital with regen 0, anything consumed and not replaced, and defeat.
3. **Per vital**: turns under 50% (warning) and under 25% (action needed), the options the low vital removed (stamina: retreat and move; mana: attack and defend casts; health: engaging), and whether the actor changed what it was doing at 25%.
4. Kills and turns are supporting evidence only. Spending a renewable vital is never charged.

## Entries

| Id | Class | Trigger | Covered today by | Gap |
|---|---|---|---|---|
| `leave-hurting-tile` | list | In a harming field or health falling and not moving | `reflexive` (#308), `{vital: health, below: 50} → retreat` | A step needs stamina, which was already 0 |
| `keep-a-step-in-reserve` | list | Stamina under 25% with a caster or field in reach | `{vital: stamina, below: 25} → retreat` | Must fire before retreat is unaffordable |
| `do-not-repeat-a-refused-command` | list | Same command refused or no-op last turn | `moveWasRefused` (#457), NPCs only | Seat and `ai_controlled` actors have no such memory |
| `probe-before-entering-a-guarded-corridor` | z3_solve | Only way on is a corridor with a ranged hostile near | `{hostileWithin: N} → retreat` | Choosing the standing cell is geometry over reach and sight |
| `route-around-a-guards-reach` | z3_solve | No attack and a guard covers the only known route | one-step safety rank | One step cannot see that every route crosses the reach |
| `do-not-burn-your-own-resource` | list | Own emit covers a resource the actor wants | `take` goal | The goal does not know the emit reaches the target |

## Evidence and its limits

Two losing runs on `first-look`, seed 0, fog on: Haiku 5.5 through `agon play-session` (defeated tick 74) and `qwen3.8:27b` through the seat driver (run `20261102-173839`, defeated tick 159). Both are quoted in #670, #671 and #672.

Raw run records are not in the repo (`artifacts/` is ignored), and the seat driver does not record token value or the vital-pressure numbers. Those fields are `null` unless an issue gives the figure. Only the Haiku stamina numbers are filled in, from the #671 turn log: stamina 0 from tick 66, nine turns, no reaction. Recording all three numbers per seat run is a follow-up for the seat-sim output, not part of this change.

No entry here is marked `works`: both runs lost, so the catalogue has no demonstrated good play yet. A winning run is what would add one.

## What the gate should test first

1. `keep-a-step-in-reserve` and `leave-hurting-tile` as `strategy.js` data: if data alone prevents the death spiral, they are list entries and no solver is adopted.
2. `route-around-a-guards-reach` against a BFS oracle, using the 19/45 and 9/45 baseline.

## Benefit gate result (#674, 2026-11-08)

Domain `actor_tactic_benefit` in `scripts/testing/logic-value-ledger.mjs` (harness: `scripts/testing/logic-tactic-benefit.mjs`, run with `pnpm run logic-sweep -- --domain actor_tactic_benefit`). The verdict rule was fixed before the first run: a horizon is adopted only if the gap no cheap control closes (the residual) is at least 10% of the decision points.

Every mover acts through core's own tick (`createActorTurn`: apply, fields, regen, exit dwell), with real emitting hazards and Allocator-priced resources. The policy is the real Actor persona. The cheap controls are the shipped Actor with its candidates expanded, a safety-first rank reorder, one weighted scalar (best single weight over the domain), the take goal stepped by that scalar, and every catalogue entry's `strategy.js` data. The oracle is every action sequence in the horizon, kept as the Pareto frontier of token value and non-renewable use.

| Profile | Points | Policy beaten | Residual | Route boards (no resource) | Fetch boards (one resource) |
|---|---|---|---|---|---|
| gate (1 hazard) | 169 | 144 (85%) | 54 (32%) | 4 of 13 (31%) | 50 of 156 (32%) |
| sweep (1–2 hazards) | 1,093 | 964 (88%) | 460 (42%) | 36 of 90 (40%) | 424 of 1,003 (42%) |

**Verdict.** `route-around-a-guards-reach`: **adopt a horizon.** The residual boards are the ones where every route crosses the reach and the cheapest crossing needs a detour that makes no progress for a step or two, which no one-step chooser takes. Per the z3 review, a single actor's route is a shortest-path problem, so #676 should start with A*/BFS over field cost and use z3 only for multi-actor or multi-resource trade-offs. `probe-before-entering-a-guarded-corridor`: **unmeasured, so no.** A full-sight oracle cannot value looking. The four `list` entries ask no solver question.

**Findings on the way.**
1. The shipped Actor runs the deterministic path, and nothing in the runtime sets `runtimeDecisioning`. An `exploring` delver ranks only its motivation's own proposal, which is one step along its route, so field safety has nothing to choose between. The 2026-09 lookahead probe and the `actor_lookahead` gate drove the solver request path instead, whose expanded candidates the game never ranks. Expanding the candidates and keeping the order closes only 25 of the 964 gaps.
2. No motivation fetches a resource off the route, so the policy acquires no token value on 749 points. The `take` goal fetches, but `strategy.js`'s `stepToward` ignores fields: with the take goal, the delver did worse than with no strategy on 21 of the 169 gate boards.
3. `leave-hurting-tile` as data (`health below 50 → retreat`) closed no gap and was worse than the policy on 12 gate boards: retreating from the nearest hostile is not leaving the field.

**Bounds.** Small open boards (7×5, horizon 9), hazards always lit (no upkeep table), the delver casts nothing, health has regen 0 (so harm is non-renewable), and stamina regenerates. Kills are zero by construction. The vital-pressure columns are recorded for each run but decide nothing here: health never sits under 25% before defeat at 5 harm per hit.
