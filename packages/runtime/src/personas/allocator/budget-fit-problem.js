/**
 * Z7.1 — Allocator-owned budget-fit problem and result consumer.
 *
 * The platform adapter compiles opaque integer expressions. Prices, the required floor,
 * and the lexicographic meaning stay here with the persona that owns economy policy.
 */
import {
  buildConstraintProblem,
  CONSTRAINT_DOMAINS,
  normalizeConstraintResult,
} from "../../contracts/constraint-problem.js";
import { LAYOUT_TILE_FIELDS } from "../../contracts/domain-constants.js";
import { UNUSED_CLOCK } from "../_shared/require-clock.js";
import { evaluateLayoutSpend } from "./layout-spend.js";
import { fitLayoutToBudget as fitLayoutToBudgetLegacy } from "./layout-fit.js";

const DOMAIN = CONSTRAINT_DOMAINS.ALLOCATOR_BUDGET_FIT;

function error(reason) {
  return { status: "error", reason };
}

function validateInputs({ layout, remainingBudgetTokens }) {
  if (!Number.isInteger(remainingBudgetTokens) || remainingBudgetTokens < 0) {
    return error("invalid_budget_tokens");
  }
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return error("invalid_layout");
  }
  if (LAYOUT_TILE_FIELDS.some((field) => !Number.isInteger(layout[field]) || layout[field] < 0)) {
    return error("invalid_tile_count");
  }
  if (layout.floorTiles < 1) return error("empty_layout");
  return null;
}

function objectiveValues(layout, requestedLayout) {
  return [
    layout.floorTiles + layout.hallwayTiles,
    Math.abs(
      (layout.floorTiles * requestedLayout.hallwayTiles)
      - (layout.hallwayTiles * requestedLayout.floorTiles),
    ),
    layout.floorTiles,
    layout.hallwayTiles,
  ];
}

/** Validate inputs and author the exact Z7.0 problem. Invalid input never reaches an adapter. */
export function buildAllocatorBudgetFitProblem({
  layout,
  remainingBudgetTokens,
  priceList,
  layoutCosts,
  meta,
} = {}) {
  const invalid = validateInputs({ layout, remainingBudgetTokens });
  if (invalid) return invalid;

  let spend;
  try {
    spend = evaluateLayoutSpend({
      layout,
      budgetTokens: remainingBudgetTokens,
      priceList,
      tileCosts: layoutCosts,
    });
  } catch (cause) {
    return error(cause?.code || "allocator_tile_price_required");
  }

  // The public promise-based surface still returns the legacy value byte-for-byte here.
  if (!spend.overBudget) {
    return {
      status: "bypass",
      result: fitLayoutToBudgetLegacy({ layout, remainingBudgetTokens, priceList, layoutCosts }),
    };
  }

  const requestedLayout = Object.fromEntries(
    LAYOUT_TILE_FIELDS.map((field) => [field, layout[field]]),
  );
  const tileCosts = Object.fromEntries(
    LAYOUT_TILE_FIELDS.map((field) => [field, spend.tileCosts[field]]),
  );
  const problem = buildConstraintProblem({
    domain: DOMAIN,
    posedBy: "allocator",
    meta,
    variables: LAYOUT_TILE_FIELDS.map((field) => ({
      id: field,
      kind: "integer",
      min: 0,
      max: requestedLayout[field],
    })),
    constraints: [
      {
        id: "minimum_floor",
        kind: "linear",
        relation: ">=",
        rightHandSide: 1,
        terms: [{ variableId: "floorTiles", coefficient: 1 }],
      },
      {
        id: "budget_cap",
        kind: "linear",
        relation: "<=",
        rightHandSide: remainingBudgetTokens,
        terms: LAYOUT_TILE_FIELDS.map((field) => ({
          variableId: field,
          coefficient: tileCosts[field],
        })),
      },
    ],
    objective: {
      kind: "lexicographic",
      priorities: [
        {
          id: "retained_total",
          sense: "maximize",
          expression: {
            kind: "linear",
            terms: LAYOUT_TILE_FIELDS.map((field) => ({ variableId: field, coefficient: 1 })),
          },
        },
        {
          id: "layout_mix_distortion",
          sense: "minimize",
          expression: {
            kind: "absolute_linear",
            terms: [
              { variableId: "floorTiles", coefficient: requestedLayout.hallwayTiles },
              { variableId: "hallwayTiles", coefficient: -requestedLayout.floorTiles },
            ],
          },
        },
        ...LAYOUT_TILE_FIELDS.map((field) => ({
          id: field,
          sense: "maximize",
          expression: { kind: "variable", variableId: field },
        })),
      ],
    },
    context: { requestedLayout, tileCosts, budgetTokens: remainingBudgetTokens },
  });
  return { status: "ready", problem, requestedLayout, tileCosts };
}

/**
 * Turn a ready problem into a solver effect. This remains data: the persona never
 * receives or invokes an adapter. Command glue dispatches the effect and returns its result.
 */
export function prepareAllocatorBudgetFit({ clock = UNUSED_CLOCK, meta, ...args } = {}) {
  const prepared = buildAllocatorBudgetFitProblem({ ...args, meta });
  if (prepared.status !== "ready") return prepared;

  const problemMeta = prepared.problem.meta || {
    id: [
      "allocator_budget_fit",
      args.layout.floorTiles,
      args.layout.hallwayTiles,
      prepared.tileCosts.floorTiles,
      prepared.tileCosts.hallwayTiles,
      args.remainingBudgetTokens,
    ].join("_"),
    runId: "allocator_budget_fit",
    createdAt: clock(),
    producedBy: "allocator",
  };
  prepared.problem.meta = problemMeta;
  const request = {
    id: problemMeta.id,
    requestId: problemMeta.id,
    targetAdapter: "solver",
    meta: problemMeta,
    problem: prepared.problem,
  };
  return {
    ...prepared,
    request,
    effect: {
      kind: "solver_request",
      request,
      requestId: request.requestId,
      targetAdapter: request.targetAdapter,
      personaRef: "allocator",
    },
  };
}

/** Re-check every Allocator invariant before a solver model becomes a layout. */
export function consumeAllocatorBudgetFitResult({ prepared, rawResult, priceList, layoutCosts } = {}) {
  const result = normalizeConstraintResult(rawResult, {
    domain: DOMAIN,
    meta: prepared?.problem?.meta,
  });
  if (result.status === "unsat") {
    return {
      ok: false,
      status: "unsat",
      reason: "allocator_minimum_floor_unaffordable",
    };
  }
  if (result.status !== "fulfilled") {
    return { ok: false, status: result.status, reason: result.reason || "allocator_solver_failed" };
  }

  const assignments = result.model?.assignments;
  const requested = prepared?.requestedLayout;
  const costs = prepared?.tileCosts;
  const assignmentKeys = assignments && typeof assignments === "object" && !Array.isArray(assignments)
    ? Object.keys(assignments).sort()
    : [];
  const exactAssignments = assignmentKeys.length === LAYOUT_TILE_FIELDS.length
    && assignmentKeys.every((field, index) => field === [...LAYOUT_TILE_FIELDS].sort()[index]);
  const candidate = assignments && {
    floorTiles: assignments.floorTiles,
    hallwayTiles: assignments.hallwayTiles,
  };
  const validCounts = candidate && LAYOUT_TILE_FIELDS.every((field) => (
    Number.isInteger(candidate[field])
    && candidate[field] >= 0
    && candidate[field] <= requested[field]
  ));
  const spentTokens = validCounts
    ? LAYOUT_TILE_FIELDS.reduce((sum, field) => sum + candidate[field] * costs[field], 0)
    : Infinity;
  const expectedObjectives = validCounts ? objectiveValues(candidate, requested) : null;
  const reportedObjectives = result.model?.objectiveValues;
  if (!exactAssignments
    || !validCounts
    || candidate.floorTiles < 1
    || spentTokens > prepared.problem.context.budgetTokens
    || !Array.isArray(reportedObjectives)
    || reportedObjectives.length !== expectedObjectives.length
    || reportedObjectives.some((value, index) => value !== expectedObjectives[index])) {
    return { ok: false, status: "error", reason: "allocator_solver_model_invalid" };
  }

  const layoutSpend = evaluateLayoutSpend({
    layout: candidate,
    budgetTokens: prepared.problem.context.budgetTokens,
    priceList,
    tileCosts: layoutCosts || costs,
  });
  return { ok: true, layout: candidate, layoutSpend, adjusted: true };
}

/** Consume a host-dispatched result, or take the exact fallback when no result was fulfilled. */
export function completeAllocatorBudgetFit({ prepared: supplied, solverResult, ...args } = {}) {
  const prepared = supplied || prepareAllocatorBudgetFit(args);
  if (prepared.status === "error") return { ok: false, ...prepared };
  if (prepared.status === "bypass") return prepared.result;
  if (!solverResult || solverResult.status === "deferred" || solverResult.status === "error") {
    return fitLayoutToBudgetLegacy(args);
  }
  return consumeAllocatorBudgetFitResult({
    prepared,
    rawResult: solverResult,
    priceList: args.priceList,
    layoutCosts: args.layoutCosts,
  });
}
