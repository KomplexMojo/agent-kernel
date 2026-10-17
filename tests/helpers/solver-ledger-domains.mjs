/**
 * The two adopted solver domains, posed to the shared ledger (#298). Cases come from the
 * same enumerators as `scripts/testing/logic-value-ledger.mjs`; answers come through the
 * real persona surface and host glue, with the real Z3 hybrid adapter for the solver and a
 * deferring adapter (the persona's characterized fallback) for the other side.
 */
import {
  createDeferringAdapter,
  enumerateAllocatorPoints,
  enumerateConfiguratorPoints,
  outcomeRank,
  placementKeepsPathOpen,
  placementOf,
} from "../../scripts/testing/logic-value-ledger.mjs";
import {
  solveAllocatorBudgetFitExhaustive,
  solveObjectPlacementExhaustive,
} from "../../scripts/testing/logic-oracles.mjs";
import { createAllocatorPersona } from "../../packages/runtime/src/personas/allocator/persona.js";
import { createConfiguratorPersona } from "../../packages/runtime/src/personas/configurator/persona.js";
import { createHostedLayoutBudgetFitter, createHostedObjectPlacer } from "../../packages/runtime/src/commands/solver-host.js";
import { createHybridConstraintSolverAdapter } from "../../packages/adapters-cli/src/adapters/z3/index.js";

const FIXED_CLOCK = () => "2026-10-17T00:00:00.000Z";

function* take(iterable, limit) {
  let count = 0;
  for (const value of iterable) {
    if (limit && count >= limit) return;
    count += 1;
    yield value;
  }
}

/** allocator_budget_fit: retained layout under budget, ranked by the Allocator's objective. */
export function budgetFitDomain(bounds, { limit = 0 } = {}) {
  const allocator = createAllocatorPersona({ clock: FIXED_CLOCK });
  const hosted = (adapter) => createHostedLayoutBudgetFitter({
    prepare: allocator.prepareLayoutBudgetFit,
    complete: allocator.completeLayoutBudgetFit,
    adapter,
    clock: FIXED_CLOCK,
  });
  const solverFit = hosted(createHybridConstraintSolverAdapter());
  const fallbackFit = hosted(createDeferringAdapter("allocator_budget_fit"));
  const cases = (function* decisionPoints() {
    for (const { point } of enumerateAllocatorPoints(bounds)) {
      // Only points where the Allocator has a choice; a bypass poses no problem.
      if (allocator.prepareLayoutBudgetFit(point).status !== "bypass") yield point;
    }
  })();
  return {
    domain: "allocator_budget_fit",
    cases: take(cases, limit),
    fallback: (point) => fallbackFit(point),
    solver: (point) => solverFit(point),
    rank: (answer, point) => outcomeRank(answer, point.layout),
    oracle: (point) => {
      const best = solveAllocatorBudgetFitExhaustive({
        requestedLayout: point.layout,
        tileCosts: point.layoutCosts,
        budgetTokens: point.remainingBudgetTokens,
      });
      return best.status === "fulfilled" ? best.rank : null;
    },
    // Tiles of the requested layout kept beyond what the other answer kept.
    gap: (solverRank, fallbackRank) => (solverRank?.[0] ?? 0) - (fallbackRank?.[0] ?? 0),
  };
}

/**
 * configurator_satisfiability: an answer that places every object AND keeps spawn connected
 * to exit ranks [1]; one that seals the route ranks [0]; a refusal ranks null.
 */
export function objectPlacementDomain(bounds, { limit = 0 } = {}) {
  const configurator = createConfiguratorPersona({ clock: FIXED_CLOCK });
  const hosted = (adapter) => createHostedObjectPlacer({
    prepare: configurator.prepareObjectPlacement,
    complete: configurator.completeObjectPlacement,
    adapter,
    clock: FIXED_CLOCK,
  });
  const solverPlace = hosted(createHybridConstraintSolverAdapter());
  const fallbackPlace = hosted(createDeferringAdapter("configurator_satisfiability"));
  const cases = (function* readyPoints() {
    for (const point of enumerateConfiguratorPoints(bounds)) {
      const prepared = configurator.prepareObjectPlacement(point);
      // Unsat and bypass points pose no choice; counting them as agreement would flatter both.
      if (prepared.status === "ready") yield { point, prepared };
    }
  })();
  return {
    domain: "configurator_satisfiability",
    cases: take(cases, limit),
    fallback: ({ point }) => fallbackPlace(point),
    solver: ({ point }) => solverPlace(point),
    rank: (answer, { prepared }) => {
      if (!answer?.ok) return null;
      return [placementKeepsPathOpen(prepared, placementOf(answer)) ? 1 : 0];
    },
    oracle: ({ prepared }) => (solveObjectPlacementExhaustive({ prepared }).status === "fulfilled" ? [1] : null),
  };
}
