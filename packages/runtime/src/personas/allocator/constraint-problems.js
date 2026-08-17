/**
 * Z.2 — the Allocator poses its own question: which purchases fit the budget?
 *
 * The site this replaces is `layout-fit.js` — `pickCheapestField` adds the
 * cheapest field that still fits, `selectReductionField` removes the most
 * expensive one when over. That is a greedy knapsack approximation, and greedy
 * knapsack is wrong in the ordinary case, not the exotic one: it will happily
 * take a cheap item that blocks two better ones.
 *
 * Two things it buys beyond optimality:
 *   - an **infeasibility reason**. Greedy returns a truncated selection and says
 *     nothing about why the rest did not fit; a solver can name the binding
 *     constraint. `normalizeConstraintResult` refuses an unexplained `unsat`.
 *   - it runs at BUILD time, where latency is cheap and determinism is easy —
 *     unlike the Actor's, which sits in the tick.
 *
 * PRICING STAYS WITH THE ALLOCATOR. The solver searches over prices the
 * Allocator supplies; it never derives one. That distinction is the charter's
 * (§271: one price model, one author) and it is why `unitCost` is an input here
 * rather than something the problem asks the solver to infer.
 */
import {
  CONSTRAINT_DOMAINS,
  buildConstraintProblem,
  CONSTRAINT_RESULT_STATUS,
} from "../../contracts/constraint-problem.js";

const POSED_BY = "allocator";

/**
 * @param {object} args
 * @param {Array<{id:string, unitCost:number, maxQuantity?:number, category?:string}>} args.items
 *   candidate purchases, each already PRICED by the Allocator
 * @param {number} args.budgetTokens the cap the selection must fit inside
 * @param {object} args.meta
 * @param {string} [args.objectiveSense] "maximize_spend" (spend the rest) or
 *   "maximize_value"; the Allocator decides which, not the solver
 */
export function buildBudgetFitProblem({
  items = [],
  budgetTokens = 0,
  meta,
  objectiveSense = "maximize_spend",
} = {}) {
  const variables = items
    .filter((item) => item && typeof item.id === "string" && Number.isFinite(item.unitCost))
    .map((item) => ({
      id: item.id,
      unitCost: item.unitCost,
      // Absent means unbounded-within-budget rather than "one". Defaulting to 1
      // would silently forbid buying two of something and look like the solver
      // choosing not to.
      maxQuantity: Number.isInteger(item.maxQuantity) ? item.maxQuantity : null,
      category: item.category ?? null,
    }));

  return buildConstraintProblem({
    domain: CONSTRAINT_DOMAINS.ALLOCATOR_BUDGET_FIT,
    posedBy: POSED_BY,
    meta,
    variables,
    constraints: [
      {
        id: "budget_cap",
        type: "linear_le",
        // The cap is HARD. An over-budget selection is not a near-miss to be
        // rounded down later; the Allocator's receipts are an audit trail.
        terms: variables.map((v) => ({ variable: v.id, coefficient: v.unitCost })),
        bound: budgetTokens,
      },
    ],
    objective: { id: "budget_fit", sense: objectiveSense },
    context: { budgetTokens, itemCount: variables.length },
  });
}

/**
 * Consume a normalized result into `{ selections, totalCost }`, or `null`.
 *
 * Re-derives the cost from the Allocator's own `unitCost` rather than trusting a
 * total the adapter reports. A solver reporting a total is reporting arithmetic
 * over numbers we gave it; if the two disagree, the Allocator's price is right
 * and the answer is unusable — which the caller sees as `null` rather than as a
 * receipt that does not add up.
 */
export function resolveSelectionFromConstraintResult(result, items = []) {
  if (result?.status !== CONSTRAINT_RESULT_STATUS.FULFILLED) return null;
  const assignments = result?.model?.assignments;
  if (!assignments || typeof assignments !== "object") return null;

  const priceById = new Map(
    items
      .filter((item) => item && typeof item.id === "string" && Number.isFinite(item.unitCost))
      .map((item) => [item.id, item.unitCost]),
  );

  const selections = [];
  let totalCost = 0;
  for (const [id, rawQuantity] of Object.entries(assignments)) {
    const quantity = Number.isInteger(rawQuantity) ? rawQuantity : 0;
    if (quantity <= 0) continue;
    if (!priceById.has(id)) {
      // The model named something that was never offered. Refuse the whole
      // answer: a partially-recognized selection would be priced against an
      // item list that does not describe it.
      return null;
    }
    selections.push({ id, quantity });
    totalCost += priceById.get(id) * quantity;
  }
  selections.sort((a, b) => a.id.localeCompare(b.id));
  return { selections, totalCost };
}
