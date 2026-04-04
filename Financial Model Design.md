# Financial Model Design Decisions
**Status:** Approved design baseline  
**Purpose:** Verification reference for agent/code review against intended financial model  
**Scope:** Scenario allocation, agent budgeting, affinity/effect costing, vitals, regeneration, runtime expression costs, and delver/warden incentive alignment

---

## 1. Design Intent

This model defines the intended financial and runtime resource framework for the dungeon system.

It is designed to ensure that:

1. dungeon pressure is driven primarily by room/layout investment,
2. delvers are relatively few and expensive,
3. wardens are generally more numerous than delvers,
4. wardens may be organized as either:
   - a few durable defenders,
   - many low-token minions,
   - minion groups aligned with one or more mid-tier bosses,
   - or a hierarchy culminating in a high-token dungeon boss,
5. affinity depth is expensive,
6. regeneration is expensive,
7. runtime power use remains constrained by mana and sustain economics,
8. attacker/defender incentive is highest when delver and warden allocation remain near the intended relationship.

This document should be treated as the authoritative design reference for validating the codebase.

---

## 2. Scenario-Level Budget Model

### Decision 2.1 — Reference Budget
The reference balancing budget is:

\[
1000
\]

This is a balancing reference, not necessarily a hard universal cap in all scenarios.

### Decision 2.2 — Reference Allocation Split
The reference budget is divided as follows:

- **Rooms / layout / traps:** 55%
- **Delvers:** 20%
- **Wardens:** 25%

Using the 1000-token reference budget, the target allocations are:

- **Rooms:** 550
- **Delvers:** 200
- **Wardens:** 250

### Decision 2.3 — Rooms Are the Primary Spend Area
The dungeon should be expressed primarily through room and layout investment rather than only through agent power.

Room allocation is intended to fund:

- room construction,
- corridors,
- hazards,
- traps,
- affinity-aligned terrain,
- environmental fields,
- chokepoints,
- layout pressure.

### Decision 2.4 — Delver/Warden Force Shape
The intended encounter shape is:

- **few attackers (delvers),**
- **many defenders (wardens).**

It is acceptable for there to be more delvers than wardens in some scenarios, but this is not the intended default.

The intended warden composition is flexible. Warden allocation may fund:

- a few durable defenders,
- many low-token minions,
- minion groups aligned with a medium-token boss,
- and optionally one high-token dungeon boss.

This should be recognized as an explicit design decision, not an accidental outcome.

---

## 3. Incentive Alignment Model

### Decision 3.1 — Incentive Depends on Delver/Warden Spend Relationship
A balancing incentive must be derived from the relationship between delver spend and warden spend.

The incentive is intended to be **highest** when delver and warden investment are near the intended matchup balance.

The incentive is intended to be **lower** when:

- delver spending is too high relative to wardens, or
- warden spending is too high relative to delvers.

### Decision 3.2 — Incentive Uses the Target Delver/Warden Ratio
Given the reference split:

- Delver target = 200
- Warden target = 250

The target spend ratio is:

\[
0.8
\]

That is:

\[
\frac{200}{250} = 0.8
\]

### Decision 3.3 — Incentive Formula
Let:

- `D` = actual delver spend
- `W` = actual warden spend

Define incentive multiplier as:

\[
\text{IncentiveMultiplier} =
\max\left(0,\ 1 - 1.25\left|\frac{D}{W}-0.8\right|\right)
\]

This is the approved first-pass formula.

### Decision 3.4 — Incentive Is a Derived Balance Signal
The incentive multiplier is a balancing and reward signal. It should not automatically invalidate builds unless a future strict mode explicitly requires it.

Recommended uses include:

- reward scaling,
- essence yield scaling,
- encounter quality evaluation,
- planning feedback.

---

## 4. Agent Budget Model

### Decision 4.1 — Same Cost Model for Delvers and Wardens
Delvers and wardens use the same internal financial model.

Each agent budget may be spent on:

- affinities,
- affinity stacks,
- expressions,
- motivations,
- health max,
- health regen,
- mana max,
- mana regen,
- stamina max,
- stamina regen,
- durability max,
- durability regen.

### Decision 4.2 — Soft and Hard Allocation Modes
Two validation modes are recommended:

#### Soft Allocation Mode
An agent or side may exceed its reference target, but this should reduce efficiency or incentive quality.

#### Hard Allocation Mode
An agent or side may not exceed its assigned cap.

Both modes should exist in the implementation.

---

## 5. Affinity Package Rules

### Decision 5.1 — Affinities Are Not Valid Alone
An affinity is not valid unless it includes all of the following:

- the affinity itself,
- at least 1 stack,
- at least 1 expression.

Examples of valid affinity packages:

- `fire +1 + push`
- `fire +1 + pull`
- `fire +1 + emit`
- `fire +1 + draw`

Examples of invalid affinity packages:

- `fire`
- `fire +1`
- `fire +push`

### Decision 5.2 — Affinity Stacks Represent Magnitude
Stacks magnify the effect of the affinity-expression pairing.

They affect:

- build-time token cost,
- runtime geometric reach or field size,
- runtime mana burden,
- effective power.

---

## 6. Build-Time Cost Decisions

### Decision 6.1 — Affinity Base Cost
Each affinity costs:

\[
30
\]

### Decision 6.2 — Affinity Stack Cost Formula
For stack number `n` within a specific affinity:

\[
\text{StackCost}(n)=10+8(n-1)^2
\]

This is the approved stack cost function.

#### Per-stack purchase costs

| Stack Number | Cost |
|---|---:|
| 1 | 10 |
| 2 | 18 |
| 3 | 42 |
| 4 | 82 |
| 5 | 138 |
| 6 | 210 |

#### Cumulative stack totals

| Total Stacks in One Affinity | Total Cost |
|---|---:|
| 1 | 10 |
| 2 | 28 |
| 3 | 70 |
| 4 | 152 |
| 5 | 290 |
| 6 | 500 |

### Decision 6.3 — Expression Families
Expressions are divided into two groups.

#### External Expressions
- `push`
- `pull`

These are active, directional, stronger, and per-use.

#### Internal Expressions
- `emit`
- `draw`

These are sustained or passive, lower-cost, and ambient.

### Decision 6.4 — Expression Token Costs
External expressions cost:

\[
35
\]

Internal expressions cost:

\[
25
\]

### Decision 6.5 — Minimum Affinity Package Costs
Minimum external package:

\[
30 + 10 + 35 = 75
\]

Minimum internal package:

\[
30 + 10 + 25 = 65
\]

### Decision 6.6 — Motivation Costs
Motivations are flat-cost and independent from affinities.

Simple motivation cost:

\[
25
\]

Advanced motivation cost:

\[
50
\]

---

## 7. Vital Maximum Cost Decisions

Let:

- `H` = health max
- `M` = mana max
- `S` = stamina max
- `D` = durability max

### Decision 7.1 — Health Max Cost
\[
2H
\]

### Decision 7.2 — Mana Max Cost
\[
2M
\]

### Decision 7.3 — Stamina Max Cost
\[
S
\]

### Decision 7.4 — Durability Max Cost
\[
2D
\]

---

## 8. Vital Regeneration Cost Decisions

Let:

- `R_h` = health regen per turn
- `R_m` = mana regen per turn
- `R_s` = stamina regen per turn
- `R_d` = durability regen per turn

### Decision 8.1 — Health Regen Cost
\[
12R_h^2
\]

### Decision 8.2 — Mana Regen Cost
\[
5R_m^2
\]

### Decision 8.3 — Stamina Regen Cost
\[
4R_s^2
\]

### Decision 8.4 — Durability Regen Cost
\[
10R_d^2
\]

These regen formulas are approved and are intentionally quadratic.

---

## 9. Runtime Expression Decisions

### Decision 9.1 — External Expressions Are Per-Use
`push` and `pull` consume mana on use and are directional.

Their mana cost for stack `s` is:

\[
\text{ExternalManaUse}(s)=5+4(s-1)^2
\]

#### External mana table

| Stack | Mana Use |
|---|---:|
| 1 | 5 |
| 2 | 9 |
| 3 | 21 |
| 4 | 41 |
| 5 | 69 |

### Decision 9.2 — Internal Expressions Are Continuous
`emit` and `draw` consume mana continuously while active.

Their upkeep for stack `s` is:

\[
\text{InternalManaUpkeep}(s)=2+s
\]

#### Internal upkeep table

| Stack | Mana Upkeep / Turn |
|---|---:|
| 1 | 3 |
| 2 | 4 |
| 3 | 5 |
| 4 | 6 |
| 5 | 7 |

---

## 10. Runtime Geometry Decisions

There is a **1-tile effect buffer around the acting agent**.

### Decision 10.1 — External Reach Formula
For `push` and `pull`:

\[
\text{ExternalRange}(s)=1+s
\]

Examples:

- `fire +1 + push` → range 2
- `fire +3 + push` → range 4
- `fire +3 + pull` → range 4

### Decision 10.2 — Internal Radius Formula
For `emit` and `draw`:

\[
\text{InternalRadius}(s)=1+s
\]

Examples:

- `fire +1 + draw` → radius 2
- `fire +3 + draw` → radius 4
- `fire +3 + emit` → radius 4

### Decision 10.3 — Draw and Pull Are Intentionally Not Equivalent
`draw` and `pull` may share the same nominal stack-based reach equation, but they are not equivalent in power.

`fire +3 + draw`:
- is radial,
- is passive/continuous,
- gathers from the environment,
- reaches within radius 4,
- does not have the same force or projection value as `fire +3 + pull`.

`fire +3 + pull`:
- is directional,
- is active,
- has stronger magnified effect,
- uses much higher mana,
- is tactically stronger than draw.

This distinction is a required design decision.

---

## 11. Draw Environmental Model Decisions

### Decision 11.1 — Environmental Strength Scale
Environmental affinity strength uses:

- `0` = none
- `1` = weak
- `2` = moderate
- `3` = strong
- `4` = dominant

### Decision 11.2 — Environmental Gain Formula
For matching affinity strength `e` and stack `s`:

\[
\text{EnvironmentalGain}(s,e)=3\min(s,e)
\]

### Decision 11.3 — Draw Net Mana Formula
Net draw result is:

\[
\text{DrawNet}(s,e)=3\min(s,e)-(2+s)
\]

This means draw:

- is usually neutral or weak at low stack,
- becomes useful when the environment is rich,
- becomes more efficient with deeper stack,
- should not be a universal free-mana engine.

#### Example: `fire +1 + draw`
Upkeep:

\[
2+1=3
\]

If `e=1`:

\[
3\min(1,1)-3=0
\]

#### Example: `fire +3 + draw`
Upkeep:

\[
2+3=5
\]

If `e=2`:

\[
3\min(3,2)-5=1
\]

If `e=4`:

\[
3\min(3,4)-5=4
\]

---

## 12. Emit Model Decisions

### Decision 12.1 — Emit Radius
\[
\text{EmitRadius}(s)=1+s
\]

### Decision 12.2 — Emit Strength
\[
\text{EmitStrength}(s)=s
\]

### Decision 12.3 — Emit Upkeep
\[
\text{EmitManaPerTurn}(s)=2+s
\]

Emit is intended to model a self-centered field, aura, or shield that can affect other affinity expressions.

---

## 13. Full Agent Cost Formula

Let:

- `A` = number of affinities
- `s_i` = stacks in affinity `i`
- `E_x` = total external expressions
- `E_i` = total internal expressions
- `M_s` = simple motivations
- `M_a` = advanced motivations
- `H, M, S, D` = max health, mana, stamina, durability
- `R_h, R_m, R_s, R_d` = respective regen values

### Decision 13.1 — Approved Agent Cost Formula
\[
\text{AgentCost}=
30A
+\sum_{i=1}^{A}\sum_{n=1}^{s_i}(10+8(n-1)^2)
+35E_x
+25E_i
+25M_s
+50M_a
+2H
+2M
+S
+2D
+12R_h^2
+5R_m^2
+4R_s^2
+10R_d^2
\]

### Decision 13.2 — Validation Constraints
The implementation must enforce:

- every affinity has `s_i \ge 1`,
- every affinity has at least one expression,
- all maxima and regen values are non-negative integers,
- expression types are restricted to:
  - `push`
  - `pull`
  - `emit`
  - `draw`

---

## 14. Scenario Verification Rules

### Decision 14.1 — Scenario Spend Tracking
The code should expose scenario-level spend totals for:

- rooms,
- delvers,
- wardens.

### Decision 14.2 — Scenario Target Tracking
The code should expose target reference values:

- rooms target = 550,
- delvers target = 200,
- wardens target = 250.

### Decision 14.3 — Target Usage Metrics
The code should report:

- actual spend,
- target spend,
- target usage percentage,
- total budget usage percentage.

### Decision 14.4 — Incentive Reporting
The code should report:

- actual delver/warden ratio,
- target ratio,
- mismatch,
- incentive multiplier.

---

## 15. Recommended Verification Checklist for the Agent

The verification agent should confirm the following.

### Scenario Layer
- The reference budget is 1000.
- The default target split is 55/20/25.
- Room target is 550.
- Delver target is 200.
- Warden target is 250.
- Incentive uses target ratio 0.8.
- Incentive formula matches the approved design.

### Force Shape Layer
- The design allows few delvers and many wardens.
- The code does not assume equal attacker/defender counts.
- The code allows warden token allocation across:
  - minions,
  - tougher elites,
  - boss-aligned groups,
  - a dungeon boss.

### Agent Cost Layer
- Affinity base cost is 30.
- External expression cost is 35.
- Internal expression cost is 25.
- Simple motivation cost is 25.
- Advanced motivation cost is 50.
- Stack formula matches:
  \[
  10+8(n-1)^2
  \]

### Vitals Layer
- Health max cost is `2H`.
- Mana max cost is `2M`.
- Stamina max cost is `S`.
- Durability max cost is `2D`.

### Regen Layer
- Health regen cost is `12R_h^2`.
- Mana regen cost is `5R_m^2`.
- Stamina regen cost is `4R_s^2`.
- Durability regen cost is `10R_d^2`.

### Runtime Layer
- External mana use matches:
  \[
  5+4(s-1)^2
  \]
- Internal upkeep matches:
  \[
  2+s
  \]
- External range matches:
  \[
  1+s
  \]
- Internal radius matches:
  \[
  1+s
  \]
- Draw net matches:
  \[
  3\min(s,e)-(2+s)
  \]
- Emit strength matches:
  \[
  s
  \]

### Validation Layer
- Affinity-only purchase is invalid.
- Affinity plus stack but no expression is invalid.
- Affinity plus expression but no stack is invalid.
- Every affinity package requires stack >= 1 and expression count >= 1.

---

## 16. Final Decisions Summary

The following are the final approved decisions for implementation verification:

1. The balancing reference budget is **1000**.
2. The default allocation split is **55% rooms, 20% delvers, 25% wardens**.
3. The intended force shape is **few attackers and many defenders**.
4. Warden spending may be distributed across **minions, elite defenders, boss-aligned groups, and a dungeon boss**.
5. Incentive alignment is based on the **delver/warden spend relationship**, not raw equality.
6. The target delver/warden ratio is **0.8**.
7. The incentive multiplier is:
   \[
   \max\left(0,\ 1 - 1.25\left|\frac{D}{W}-0.8\right|\right)
   \]
8. Affinities require **at least one stack and at least one expression**.
9. Affinity stack cost is quadratic:
   \[
   10+8(n-1)^2
   \]
10. External expressions cost more than internal expressions.
11. External runtime use is expensive and directional.
12. Internal runtime use is continuous and lower-cost.
13. Draw is **radial, passive, and weaker** than pull.
14. Pull is **directional, magnified, and stronger** than draw.
15. Vital maximums are linear-cost.
16. Vital regeneration is quadratic-cost.
17. The full agent-cost formula in this document is the baseline for verification.

---
End of design file.