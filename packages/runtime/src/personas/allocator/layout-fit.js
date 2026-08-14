/**
 * Auto-fit: revise a layout until its cost fits a budget (CR.4 M5b.2c).
 *
 * This search lived in `personas/orchestrator/llm-budget-loop.js` until 2026-08-08, where it
 * was the loop's largest remaining piece of Allocator work — six `evaluateLayoutSpend` calls
 * plus its own selection helpers. Threading only the `evaluateLayoutSpend` calls would have
 * missed the actual defect: **`pickCheapestField` and `selectReductionField` choose which
 * tile to drop BY ITS PRICE**, which is pricing policy, and it was executing inside the
 * Orchestrator. The calls were the symptom; deciding what a token is best spent on is the
 * thing that belongs here.
 *
 * Moved VERBATIM. A revision loop is the easiest thing in this repo to change by accident:
 * a reordered comparison or a differently-rounded scale still returns a well-formed layout,
 * still under budget, just a *different* one — and no schema, guard or golden would report
 * it. `tests/personas/allocator/allocator-layout-fit.test.js` replays 660 cases captured from
 * the pre-move implementation; that fixture, not review, is what licenses this relocation.
 *
 * `remainingBudgetTokens` keeps its caller-side name rather than being normalized to this
 * persona's usual `budgetTokens`. The rename is exactly the kind of silent mismatch the
 * characterization exists to prevent, and it buys nothing.
 */
import { evaluateLayoutSpend } from "./layout-spend.js";
// D8-V: layout vocabulary comes from contracts, not from a persona. `LAYOUT_TILE_FIELDS`
// was reaching this file via a re-export in `layout-spend.js` — a laundering hop within
// the persona, harmless to the allowlist and misleading to a reader.
import {
  LAYOUT_TILE_FIELDS,
  normalizeLayoutCounts,
  sumLayoutTiles,
} from "../../contracts/domain-constants.js";

function isWalkableField(field) {
  return field === "floorTiles" || field === "hallwayTiles";
}

function resolveTileCost(costs, field) {
  const value = costs && Number.isInteger(costs[field]) && costs[field] > 0 ? costs[field] : 1;
  return value;
}

function pickCheapestField({ costs, fields, budgetTokens }) {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const affordable = Number.isInteger(budgetTokens)
    ? fields.filter((field) => resolveTileCost(costs, field) <= budgetTokens)
    : fields.slice();
  const pool = affordable.length > 0 ? affordable : fields;
  return pool.reduce((best, field) => {
    if (!best) return field;
    const currentCost = resolveTileCost(costs, field);
    const bestCost = resolveTileCost(costs, best);
    if (currentCost < bestCost) return field;
    return best;
  }, null);
}

function selectReductionField(layout, costs) {
  const fieldsWithTiles = LAYOUT_TILE_FIELDS.filter((field) => Number.isInteger(layout?.[field]) && layout[field] > 0);
  if (fieldsWithTiles.length === 0) return null;
  const walkableTiles = (layout.floorTiles || 0) + (layout.hallwayTiles || 0);
  const safeCandidates = fieldsWithTiles.filter((field) => {
    if (!isWalkableField(field)) return true;
    return walkableTiles > 1;
  });
  const pool = safeCandidates.length > 0 ? safeCandidates : fieldsWithTiles;
  return pool.reduce((best, field) => {
    if (!best) return field;
    const currentCost = resolveTileCost(costs, field);
    const bestCost = resolveTileCost(costs, best);
    if (currentCost > bestCost) return field;
    if (currentCost < bestCost) return best;
    return layout[field] > layout[best] ? field : best;
  }, null);
}

export function fitLayoutToBudget({
  layout,
  remainingBudgetTokens,
  priceList,
  layoutCosts,
} = {}) {
  if (!Number.isInteger(remainingBudgetTokens) || remainingBudgetTokens < 0) {
    return { ok: false };
  }
  const normalized = normalizeLayoutCounts(layout);
  if (!normalized) {
    return { ok: false };
  }

  let working = { ...normalized };
  let spend = evaluateLayoutSpend({
    layout: working,
    budgetTokens: remainingBudgetTokens,
    priceList,
    tileCosts: layoutCosts,
  });
  if (!spend.overBudget && sumLayoutTiles(working) > 0) {
    return { ok: true, layout: spend.layout || working, layoutSpend: spend, adjusted: false };
  }

  const costs = spend.tileCosts || layoutCosts || {};
  const originalSpent = spend.spentTokens;
  const scale = originalSpent > 0 ? remainingBudgetTokens / originalSpent : 0;
  if (scale > 0 && scale < 1) {
    LAYOUT_TILE_FIELDS.forEach((field) => {
      const count = Number.isInteger(working[field]) ? working[field] : 0;
      working[field] = Math.max(0, Math.floor(count * scale));
    });
  }

  const cheapestWalkableField = pickCheapestField({
    costs,
    fields: ["floorTiles", "hallwayTiles"],
    budgetTokens: remainingBudgetTokens,
  });
  const cheapestAnyField = pickCheapestField({
    costs,
    fields: LAYOUT_TILE_FIELDS,
    budgetTokens: remainingBudgetTokens,
  });
  const ensureNonEmpty = () => {
    if (sumLayoutTiles(working) > 0) return;
    if (cheapestAnyField) {
      working[cheapestAnyField] = (working[cheapestAnyField] || 0) + 1;
    }
  };

  ensureNonEmpty();
  spend = evaluateLayoutSpend({
    layout: working,
    budgetTokens: remainingBudgetTokens,
    priceList,
    tileCosts: layoutCosts,
  });

  let guard = 0;
  const maxGuard = Math.max(100, sumLayoutTiles(working) * 2 + 10);
  while (spend.overBudget && guard < maxGuard) {
    const field = selectReductionField(working, costs);
    if (!field) break;
    working[field] -= 1;
    if (working[field] < 0) working[field] = 0;
    ensureNonEmpty();
    spend = evaluateLayoutSpend({
      layout: working,
      budgetTokens: remainingBudgetTokens,
      priceList,
      tileCosts: layoutCosts,
    });
    guard += 1;
  }

  const walkableTiles = (working.floorTiles || 0) + (working.hallwayTiles || 0);
  if (walkableTiles <= 0 && cheapestWalkableField) {
    const walkableCost = resolveTileCost(costs, cheapestWalkableField);
    while (spend.spentTokens + walkableCost > remainingBudgetTokens) {
      const field = selectReductionField(working, costs);
      if (!field) break;
      working[field] -= 1;
      if (working[field] < 0) working[field] = 0;
      spend = evaluateLayoutSpend({
        layout: working,
        budgetTokens: remainingBudgetTokens,
        priceList,
        tileCosts: layoutCosts,
      });
    }
    if (spend.spentTokens + walkableCost <= remainingBudgetTokens) {
      working[cheapestWalkableField] = (working[cheapestWalkableField] || 0) + 1;
      spend = evaluateLayoutSpend({
        layout: working,
        budgetTokens: remainingBudgetTokens,
        priceList,
        tileCosts: layoutCosts,
      });
    }
  }

  if (spend.overBudget || sumLayoutTiles(working) <= 0) {
    return { ok: false };
  }
  return { ok: true, layout: spend.layout || working, layoutSpend: spend, adjusted: true };
}
