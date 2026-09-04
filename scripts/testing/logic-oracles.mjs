/**
 * Z10 Phase 0 — exhaustive reference oracles for the solver value ledger.
 *
 * WHAT THESE ARE. An oracle answers "what is the CORRECT answer for this input"
 * by brute force over the whole bounded domain. It is the third leg of the
 * differential sweep: production solver, production greedy fallback, and this.
 * Without it a divergence tells you the two implementations disagree but not
 * which one is wrong.
 *
 * WHAT THESE ARE NOT. They are never a second production implementation. They
 * are deliberately the slowest possible correct thing, they live outside every
 * package, and nothing in `packages/` may import them. `logic-harness-boundary`
 * (Z10 Phase 4) enforces that.
 *
 * PROVENANCE. `solveAllocatorBudgetFitExhaustive` is promoted verbatim in
 * behavior from `solveApprovedReference`, the Z7.0 policy-lock oracle that has
 * lived test-local in
 * `tests/personas/allocator/allocator-budget-fit-problem.test.js` since 2026-08-28.
 * It was called at four hand-picked points there and never swept; promoting it
 * is the whole reason Phase 0 is cheap. The test keeps its own copy for now —
 * de-duplicating it is Phase 2 work, and doing it here would change a passing
 * policy lock in the same commit that first exercises the oracle at scale.
 */

/** The Allocator's two tile fields, in the canonical order. Mirrors LAYOUT_TILE_FIELDS. */
export const ALLOCATOR_FIELDS = Object.freeze(["floorTiles", "hallwayTiles"]);

/**
 * The Allocator's lexicographic objective, as a comparable rank vector, all
 * members MAXIMIZED left to right.
 *
 * Priority 2 (`layout_mix_distortion`) is a MINIMIZE in the problem, so it is
 * negated here. Getting that sign backwards silently inverts the second-most
 * important objective and still produces plausible-looking layouts, which is
 * exactly the kind of defect this ledger exists to catch — so it is written
 * once, here, and every comparison in the ledger goes through it.
 */
export function allocatorObjectiveRank(layout, requestedLayout) {
  return [
    layout.floorTiles + layout.hallwayTiles,
    -Math.abs(
      (layout.floorTiles * requestedLayout.hallwayTiles)
      - (layout.hallwayTiles * requestedLayout.floorTiles),
    ),
    layout.floorTiles,
    layout.hallwayTiles,
  ];
}

/** Lexicographic comparison of two rank vectors: >0 when `left` is strictly better. */
export function compareRank(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    throw new TypeError("compareRank requires two rank vectors");
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

/**
 * Exhaustive optimal budget fit. Enumerates every legal (floorTiles, hallwayTiles)
 * pair within the requested counts, keeps those inside the budget, and returns the
 * lexicographic best under `allocatorObjectiveRank`.
 *
 * Error vs unsat is a real distinction and is preserved: invalid INPUT is an
 * error the solver must never be asked about, while a valid request whose minimum
 * floor is unaffordable is a genuine `unsat` with a reason.
 */
export function solveAllocatorBudgetFitExhaustive({ requestedLayout, tileCosts, budgetTokens }) {
  if (!Number.isInteger(budgetTokens) || budgetTokens < 0) {
    return { status: "error", reason: "invalid_budget_tokens" };
  }
  if (!requestedLayout || typeof requestedLayout !== "object" || Array.isArray(requestedLayout)) {
    return { status: "error", reason: "invalid_layout" };
  }
  if (ALLOCATOR_FIELDS.some((field) => (
    !Number.isInteger(requestedLayout[field]) || requestedLayout[field] < 0
  ))) {
    return { status: "error", reason: "invalid_tile_count" };
  }
  if (ALLOCATOR_FIELDS.some((field) => (
    !Number.isInteger(tileCosts?.[field]) || tileCosts[field] <= 0
  ))) {
    return { status: "error", reason: "allocator_tile_price_required" };
  }
  if (requestedLayout.floorTiles < 1) {
    return { status: "error", reason: "empty_layout" };
  }

  let best = null;
  let bestRank = null;
  for (let floorTiles = 1; floorTiles <= requestedLayout.floorTiles; floorTiles += 1) {
    for (let hallwayTiles = 0; hallwayTiles <= requestedLayout.hallwayTiles; hallwayTiles += 1) {
      const spentTokens = (floorTiles * tileCosts.floorTiles)
        + (hallwayTiles * tileCosts.hallwayTiles);
      if (spentTokens > budgetTokens) continue;
      const candidate = { floorTiles, hallwayTiles, spentTokens };
      const rank = allocatorObjectiveRank(candidate, requestedLayout);
      if (best === null || compareRank(rank, bestRank) > 0) {
        best = candidate;
        bestRank = rank;
      }
    }
  }
  if (best === null) {
    return { status: "unsat", reason: "allocator_minimum_floor_unaffordable" };
  }
  return { status: "fulfilled", model: best, rank: bestRank };
}

/**
 * The Actor "solver" reference: a stable lexicographic sort, rank members
 * maximized left to right, input index as the final tie-break.
 *
 * This is a reference for a REFUSAL, not for a search. If the hybrid adapter's
 * answer ever differs from this over the swept domain, the adapter is doing
 * something beyond sorting; if it never differs — the Z10 prediction — then
 * `actor_action_selection` is an evaluation wearing a constraint domain, and the
 * ledger says so with a number instead of an opinion.
 */
export function solveActorSelectionExhaustive({ candidateIds, ranks }) {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    return { status: "unsat", reason: "z3_no_candidates" };
  }
  const rows = candidateIds.map((id, index) => ({ id, index, rank: ranks[index] }));
  let winner = rows[0];
  for (const row of rows.slice(1)) {
    const verdict = compareRank(row.rank, winner.rank);
    if (verdict > 0) winner = row;
  }
  return { status: "fulfilled", model: { selectedActionId: winner.id } };
}
