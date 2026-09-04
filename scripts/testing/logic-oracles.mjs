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

// ---------------------------------------------------------------------------
// configurator_satisfiability — object placement
// ---------------------------------------------------------------------------

const cellKey = ({ x, y }) => `${x},${y}`;

/**
 * Independent reachability check. Deliberately a SECOND implementation of what
 * `object-placement.js` calls `pathExists`, because an oracle that imported the
 * production one would agree with it by construction and could not catch it being
 * wrong. Four-neighbour BFS over the walkable cells, minus the blocked ones.
 */
export function pathExistsOracle(cells, spawn, exit, blocked = new Set()) {
  if (!spawn || !exit) return false;
  const open = new Set(cells.map(cellKey).filter((key) => !blocked.has(key)));
  const start = cellKey(spawn);
  const target = cellKey(exit);
  if (!open.has(start) || !open.has(target)) return false;
  const queue = [spawn];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (cellKey(current) === target) return true;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = cellKey(next);
      if (open.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return false;
}

/**
 * Exhaustive optimal object placement.
 *
 * The Configurator's objective is a lexicographic MINIMIZE of each pending object's
 * chosen cell index, in authored order. Candidate lists arrive sorted ascending, so a
 * depth-first search that tries candidates in order and returns the first complete
 * feasible assignment IS the lexicographic optimum — no scoring pass needed. That is
 * worth stating because it is also exactly what makes the greedy fallback look correct
 * until it isn't: greedy takes the same first-fit cells but never backtracks, so it
 * cannot discover that its choice made the rest infeasible.
 *
 * Feasible means: every object on a distinct cell, and — once any object declaring
 * `blocking: true` is placed — spawn still reaches exit.
 *
 * Takes the persona's own `prepared` context rather than re-deriving candidates,
 * rooms or occupancy. Re-deriving them here would make this a second placement
 * policy, which is the defect the Configurator authority guards exist to prevent.
 * What the oracle supplies independently is the SEARCH and the feasibility test.
 */
export function solveObjectPlacementExhaustive({ prepared }) {
  const { pending, candidates, cells, blocking, spawn, exit } = prepared;
  const staticBlocked = new Set(blocking);
  const used = new Set();
  const chosen = new Array(pending.length).fill(-1);

  const feasibleSoFar = () => {
    const blocked = new Set(staticBlocked);
    pending.forEach((object, index) => {
      if (chosen[index] >= 0 && object.value?.blocking === true) {
        blocked.add(cellKey(cells[chosen[index]]));
      }
    });
    return pathExistsOracle(cells, spawn, exit, blocked);
  };

  const descend = (index) => {
    if (index === pending.length) return feasibleSoFar();
    for (const cellIndex of candidates[index]) {
      if (used.has(cellIndex)) continue;
      used.add(cellIndex);
      chosen[index] = cellIndex;
      // Prune on the path constraint as soon as a blocker is placed: a severed level
      // cannot be repaired by placing more objects.
      if (!(pending[index].value?.blocking === true) || feasibleSoFar()) {
        if (descend(index + 1)) return true;
      }
      used.delete(cellIndex);
      chosen[index] = -1;
    }
    return false;
  };

  if (!descend(0)) return { status: "unsat", reason: "no_feasible_placement" };
  return {
    status: "fulfilled",
    model: Object.fromEntries(pending.map((object, index) => [object.id, cellKey(cells[chosen[index]])])),
    cellIndices: [...chosen],
  };
}
