# Benchmark-Exposed Deficiency Remediation Plan

Source: the 2026-06-24 benchmark rewrite + MCP validation run (Codex rescue). All 54 scenarios now
pass CLI + MCP + parity, but only after the generator **normalized away** several authored
intentions to dodge current-code defects. This plan resolves the underlying code so the benchmark
can again exercise the original intent.

Each deficiency is grounded in source (file:line verified during the run). Fixes are ordered by
blast radius. **Tests-first** per repo policy: add a failing test under `tests/**` before each fix.

---

## D1 — Build-level budget maximization inflates user-authored vitals  ⚠️ PRODUCT DECISION REQUIRED

**Symptom:** scenario 01 (and ~50 others) jumped from a baseline spend of `82` to `1280` for the
*identical* authored input — a ~15× change. Receipts now sit near the budget cap regardless of what
the author specified.

**Root cause (verified):**
- `create` sets `built.spec.configurator.inputs.maximizeBudget = true` whenever a budget is supplied
  — `packages/adapters-cli/src/cli/ak-impl.mjs:5109`.
- Build orchestration probes remaining budget and calls `maximizeActorBudget` —
  `packages/runtime/src/build/orchestrate-build.js:1413-1429`.
- `maximizeActorBudget` distributes *all* remaining tokens across *every* actor vital, including
  ones the author set explicitly — `packages/runtime/src/personas/configurator/budget-maximizer.js:66-124`
  (docstring: "Scales actor vitals and regen to exhaust `remaining` unspent budget tokens").

**The decision:** this is working as designed ("spend the whole budget"), but it means *explicit*
authored vitals do not stay fixed. Two coherent intents:

- **(A) Keep maximization as-is** — it is the intended "code-is-law" behavior. Then D1 is *not* a
  bug; instead the benchmark should stop asserting exact authored vitals, and the headline pricing
  drift is expected. (Lowest code risk.)
- **(B) Treat authored vitals as a floor, not a target** — only maximize vitals the author did *not*
  pin; or gate maximization behind an explicit `--maximize-budget` flag rather than auto-on whenever
  a budget exists. Fix at `ak-impl.mjs:5109` (don't auto-set the flag) and/or
  `budget-maximizer.js` (skip author-pinned vital keys). (Restores baseline-like spends; changes a
  user-visible default.)

**Recommendation:** (B) with a flag — `maximizeBudget` should be opt-in, not implied by the presence
of a budget. This makes authored configs deterministic and keeps the maximizer available when wanted.
Needs your call before any edit.

---

## D2 — Layout spend items are always denied (no layout price exists)

**Symptom:** every receipt shows `layout … denied`; layout-only scenarios 03 and 42 are fully
`denied` with spend 0.

**Root cause (verified):**
- `buildSpendItems` emits `layout_grid_${w}x${h}` — `packages/runtime/src/personas/configurator/spend-proposal.js:115-117`.
- The default price list has no `layout` entry (vitals/affinity/motivation/tile/trap/hazard/resource
  only) — `packages/runtime/src/personas/allocator/default-price-list.js` (confirmed: no `layout` id).
- `validateSpendProposal` denies any unknown price id — `packages/runtime/src/personas/allocator/validate-spend.js:90-104`.

**Fix:** decide whether layout is priced.
- If layout should cost tokens: add `layout_grid_*` entries (or a formula-based `layout` kind) to
  `default-price-list.js`.
- If layout is free/structural: stop emitting it as a *priced* spend item in `spend-proposal.js`
  (emit it as a zero-cost/info line, or omit), so receipts aren't perpetually `partial`.

**Recommendation:** add a priced `layout` kind (rooms are a real cost surface) with a per-cell or
per-grid formula, so scenarios 03/42 can actually approve. Low risk, additive.

---

## D3 — Price-list `formula` field is declared but never applied

**Symptom:** receipts don't honor the documented quadratic pricing; cost semantics are split across
comments, the budget-maximizer, and final validation.

**Root cause (verified):**
- The price list declares `formula: "quadratic"` for regen ticks and `affinity_stack`, with a header
  comment defining `linear` vs `quadratic` — `packages/runtime/src/personas/allocator/default-price-list.js:14-31`.
- `validateSpendProposal` always computes flat `totalCost = price.unitCost * quantity` —
  `packages/runtime/src/personas/allocator/validate-spend.js:106`.

**Fix:** make `validateSpendProposal` apply `price.formula` (`linear` → `unitCost*qty`,
`quadratic` → `unitCost*qty²`) as a single source of truth, and have the budget-maximizer reuse the
same cost function instead of its private quadratic logic in `budget-maximizer.js`.

**Risk:** medium — changes computed costs on receipts that *do* approve. Pair with D1's decision
(both touch the cost model). Tests-first: lock expected costs for a known affinity-stack / regen case.

---

## D4 — Blocking traps are accepted by the parser but rejected by layout

**Symptom:** every `blocking=true` trap placement fails downstream with `trap_on_wall`; the generator
had to emit all benchmark traps as `blocking=false`.

**Root cause (verified):**
- `parseTrapSpec` accepts + parses `blocking` — `packages/adapters-cli/src/cli/ak-impl.mjs:847,885-887`.
- Level layout turns blocking trap cells into non-walkable cells
  (`packages/runtime/src/personas/configurator/level-layout.js:1320-1325`), applied before trap
  validation (`:1847`).
- The same cell is then reported `trap_on_wall` (`:1957-1965`).

**Fix:** pick one contract and enforce it end to end.
- **(A) Support blocking traps:** exempt blocking-trap cells from the `trap_on_wall` check (a trap
  *is* the wall here), so the accepted spec actually works.
- **(B) Reject early:** if blocking traps are unsupported, reject in `parseTrapSpec` with a clear
  error instead of accepting then failing deep in layout.

**Recommendation:** (A) — the feature is half-built and benchmark scenarios (39 "Blocking Trap
Choke") want it. If product says no, do (B) so the failure is honest and immediate.

---

## Sequencing

1. **Resolve D1 decision** (A vs B) — it gates D3 and the benchmark's vital assertions.
2. D2 (additive, isolated) and D4 (localized to trap/layout) — independent, can land first.
3. D3 (cost-model unification) — land with D1 so the cost model changes once.
4. After fixes: remove the matching normalizations in `generate-baselines.mjs` (room affinity →
   hazard, small-room upgrade, blocking→nonblocking) so the suite again tests original intent, then
   re-run `pnpm benchmark:mcp:generate && pnpm benchmark:mcp:validate` and refresh the vault copy.

## Architecture notes

- D2/D3 are pure `runtime` (allocator/configurator) — no adapter/core boundary crossings.
- D1 touches the adapter default (`ak-impl.mjs`) and `runtime` (budget-maximizer/orchestrate); the
  decision should be reflected in `packages/adapters-cli/README.md` if `--maximize-budget` becomes a
  flag.
- D4 spans the CLI parser (`ak-impl.mjs`) and `runtime` level-layout; keep the parser permissive only
  if layout supports it (option A).
