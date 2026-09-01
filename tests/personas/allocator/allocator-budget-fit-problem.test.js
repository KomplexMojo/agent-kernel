/**
 * Z7.0 — executable policy lock for the Allocator budget-fit problem.
 *
 * Z7.1 promotes the approved Z7.0 reference into the Allocator's production problem builder and
 * consumer. The exhaustive function below remains test-only: it is an independent optimality oracle,
 * not a second production fitter.
 */
"use strict";

const assert = require("node:assert/strict");

const FIELDS = Object.freeze(["floorTiles", "hallwayTiles"]);
const OBJECTIVE_ORDER = Object.freeze([
  "retained_total",
  "layout_mix_distortion",
  "floorTiles",
  "hallwayTiles",
]);

async function hostedFit(allocator, adapter) {
  const { createHostedLayoutBudgetFitter } = await import(
    "../../../packages/runtime/src/commands/solver-host.js"
  );
  return createHostedLayoutBudgetFitter({
    prepare: allocator.prepareLayoutBudgetFit,
    complete: allocator.completeLayoutBudgetFit,
    adapter,
    clock: () => "2026-08-30T00:00:00.000Z",
  });
}

async function buildApprovedProblem({ requestedLayout, tileCosts, budgetTokens }) {
  const { buildAllocatorBudgetFitProblem } = await import(
    "../../../packages/runtime/src/personas/allocator/budget-fit-problem.js"
  );
  return buildAllocatorBudgetFitProblem({
    layout: requestedLayout,
    layoutCosts: tileCosts,
    remainingBudgetTokens: budgetTokens,
    meta: { id: "z7-policy", runId: "z7-policy", createdAt: "2026-08-28T00:00:00.000Z" },
  });
}

function compareModels(left, right, requestedLayout) {
  const leftRank = [
    left.floorTiles + left.hallwayTiles,
    -Math.abs(
      (left.floorTiles * requestedLayout.hallwayTiles)
      - (left.hallwayTiles * requestedLayout.floorTiles),
    ),
    left.floorTiles,
    left.hallwayTiles,
  ];
  const rightRank = [
    right.floorTiles + right.hallwayTiles,
    -Math.abs(
      (right.floorTiles * requestedLayout.hallwayTiles)
      - (right.hallwayTiles * requestedLayout.floorTiles),
    ),
    right.floorTiles,
    right.hallwayTiles,
  ];
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return rightRank[index] - leftRank[index];
  }
  return 0;
}

function solveApprovedReference({ requestedLayout, tileCosts, budgetTokens }) {
  if (!Number.isInteger(budgetTokens) || budgetTokens < 0) {
    return { status: "error", reason: "invalid_budget_tokens" };
  }
  if (!requestedLayout || typeof requestedLayout !== "object" || Array.isArray(requestedLayout)) {
    return { status: "error", reason: "invalid_layout" };
  }
  if (FIELDS.some((field) => !Number.isInteger(requestedLayout[field]) || requestedLayout[field] < 0)) {
    return { status: "error", reason: "invalid_tile_count" };
  }
  if (FIELDS.some((field) => !Number.isInteger(tileCosts?.[field]) || tileCosts[field] <= 0)) {
    return { status: "error", reason: "allocator_tile_price_required" };
  }
  if (requestedLayout.floorTiles < 1) {
    return { status: "error", reason: "empty_layout" };
  }

  const models = [];
  for (let floorTiles = 1; floorTiles <= requestedLayout.floorTiles; floorTiles += 1) {
    for (let hallwayTiles = 0; hallwayTiles <= requestedLayout.hallwayTiles; hallwayTiles += 1) {
      const spentTokens = (floorTiles * tileCosts.floorTiles)
        + (hallwayTiles * tileCosts.hallwayTiles);
      if (spentTokens <= budgetTokens) models.push({ floorTiles, hallwayTiles, spentTokens });
    }
  }
  if (models.length === 0) {
    return { status: "unsat", reason: "allocator_minimum_floor_unaffordable" };
  }
  models.sort((left, right) => compareModels(left, right, requestedLayout));
  return { status: "fulfilled", model: models[0] };
}

test("the approved problem uses Allocator ownership, bounded integers, and the exact objective", async () => {
  const { validateConstraintProblem } = await import(
    "../../../packages/runtime/src/contracts/constraint-problem.js"
  );
  const prepared = await buildApprovedProblem({
    requestedLayout: { floorTiles: 5, hallwayTiles: 5 },
    tileCosts: { floorTiles: 1, hallwayTiles: 9 },
    budgetTokens: 12,
  });
  assert.equal(prepared.status, "ready");
  const problem = prepared.problem;

  assert.deepEqual(validateConstraintProblem(problem), { ok: true, errors: [] });
  assert.equal(problem.domain, "allocator_budget_fit");
  assert.equal(problem.posedBy, "allocator");
  assert.deepEqual(problem.variables, [
    { id: "floorTiles", kind: "integer", min: 0, max: 5 },
    { id: "hallwayTiles", kind: "integer", min: 0, max: 5 },
  ]);
  assert.deepEqual(problem.constraints.map(({ id }) => id), ["minimum_floor", "budget_cap"]);
  assert.deepEqual(problem.objective.priorities.map(({ id }) => id), OBJECTIVE_ORDER);
  assert.deepEqual(problem.objective.priorities.map(({ sense }) => sense), [
    "maximize", "minimize", "maximize", "maximize",
  ]);
});

test("the Allocator prepares a solver effect as data for host dispatch", async () => {
  const { createAllocatorPersona } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
  );
  const allocator = createAllocatorPersona({ clock: () => "2026-08-30T00:00:00.000Z" });
  const prepared = allocator.prepareLayoutBudgetFit({
    layout: { floorTiles: 5, hallwayTiles: 5 },
    layoutCosts: { floorTiles: 1, hallwayTiles: 9 },
    remainingBudgetTokens: 2,
  });

  assert.equal(prepared.status, "ready");
  assert.equal(prepared.effect.kind, "solver_request");
  assert.equal(prepared.effect.personaRef, "allocator");
  assert.equal(prepared.effect.targetAdapter, "solver");
  assert.strictEqual(prepared.effect.request, prepared.request);
  assert.strictEqual(prepared.request.problem, prepared.problem);
  assert.equal(prepared.problem.domain, "allocator_budget_fit");
});

test("the Allocator public surface uses genuine Z3 search for the pinned greedy defects", async () => {
  const { createAllocatorPersona } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
  );
  const { createHybridConstraintSolverAdapter } = await import(
    "../../../packages/adapters-cli/src/adapters/z3/index.js"
  );
  const allocator = createAllocatorPersona({ clock: () => "2026-08-28T00:00:00.000Z" });
  const solverAdapter = createHybridConstraintSolverAdapter();
  const fitLayout = await hostedFit(allocator, solverAdapter);

  const strictImprovement = await fitLayout({
    layout: { floorTiles: 5, hallwayTiles: 5 },
    layoutCosts: { floorTiles: 1, hallwayTiles: 9 },
    remainingBudgetTokens: 2,
  });
  assert.deepEqual(strictImprovement.layout, { floorTiles: 2, hallwayTiles: 0 });
  assert.equal(strictImprovement.layoutSpend.spentTokens, 2);
  assert.equal(strictImprovement.adjusted, true);

  const falseRefusal = await fitLayout({
    layout: { floorTiles: 5, hallwayTiles: 5 },
    layoutCosts: { floorTiles: 5, hallwayTiles: 2 },
    remainingBudgetTokens: 5,
  });
  assert.deepEqual(falseRefusal.layout, { floorTiles: 1, hallwayTiles: 0 });
  assert.equal(falseRefusal.layoutSpend.spentTokens, 5);
});

test("deferred and capability-absent adapters preserve the exact characterized fallback", async () => {
  const { createAllocatorPersona } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
  );
  const { fitLayoutToBudget: legacyFit } = await import(
    "../../../packages/runtime/src/personas/allocator/layout-fit.js"
  );
  const allocator = createAllocatorPersona({ clock: () => "2026-08-28T00:00:00.000Z" });
  const args = {
    layout: { floorTiles: 5, hallwayTiles: 5 },
    layoutCosts: { floorTiles: 1, hallwayTiles: 9 },
    remainingBudgetTokens: 2,
  };
  const expected = legacyFit(args);
  const deferred = {
    kind: "forced-deferred",
    capabilities: { domains: ["allocator_budget_fit"], deterministic: true },
    solve: async () => ({ status: "deferred", reason: "forced_deferred" }),
  };
  const absent = {
    kind: "actor-only",
    capabilities: { domains: ["actor_action_selection"], deterministic: true },
    solve: async () => assert.fail("a capability-absent adapter must not be called"),
  };

  assert.deepEqual(await (await hostedFit(allocator, deferred))(args), expected);
  assert.deepEqual(await (await hostedFit(allocator, absent))(args), expected);
  assert.deepEqual(await allocator.fitLayoutToBudget(args), expected);
});

test("valid unsat has the Allocator reason and invalid input never reaches the adapter", async () => {
  const { createAllocatorPersona } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
  );
  let calls = 0;
  const solverAdapter = {
    kind: "counting",
    capabilities: { domains: ["allocator_budget_fit"], deterministic: true },
    solve: async () => {
      calls += 1;
      return { status: "unsat", reason: "constraint_unsatisfiable" };
    },
  };
  const allocator = createAllocatorPersona({ clock: () => "2026-08-28T00:00:00.000Z" });
  const fitLayout = await hostedFit(allocator, solverAdapter);
  assert.deepEqual(await fitLayout({
    layout: { floorTiles: 5, hallwayTiles: 5 },
    layoutCosts: { floorTiles: 5, hallwayTiles: 2 },
    remainingBudgetTokens: 4,
  }), { ok: false, status: "unsat", reason: "allocator_minimum_floor_unaffordable" });
  assert.equal(calls, 1);

  assert.deepEqual(await fitLayout({
    layout: { floorTiles: 0, hallwayTiles: 8 },
    layoutCosts: { floorTiles: 1, hallwayTiles: 1 },
    remainingBudgetTokens: 8,
  }), { ok: false, status: "error", reason: "empty_layout" });
  assert.equal(calls, 1);
});

test("fulfilled models reject extra assignments instead of silently dropping them", async () => {
  const {
    buildAllocatorBudgetFitProblem,
    consumeAllocatorBudgetFitResult,
  } = await import(
    "../../../packages/runtime/src/personas/allocator/budget-fit-problem.js"
  );
  const prepared = buildAllocatorBudgetFitProblem({
    layout: { floorTiles: 5, hallwayTiles: 5 },
    layoutCosts: { floorTiles: 1, hallwayTiles: 9 },
    remainingBudgetTokens: 2,
  });
  const result = consumeAllocatorBudgetFitResult({
    prepared,
    layoutCosts: prepared.tileCosts,
    rawResult: {
      status: "fulfilled",
      model: {
        assignments: { floorTiles: 2, hallwayTiles: 0, inventedTiles: 99 },
        objectiveValues: [2, 10, 2, 0],
      },
    },
  });
  assert.deepEqual(result, {
    ok: false,
    status: "error",
    reason: "allocator_solver_model_invalid",
  });
});

test("deterministic request ids distinguish otherwise identical problems with different prices", async () => {
  const { createAllocatorPersona } = await import(
    "../../../packages/runtime/src/personas/allocator/persona.js"
  );
  const requestIds = [];
  const solverAdapter = {
    kind: "request-recorder",
    capabilities: { domains: ["allocator_budget_fit"], deterministic: true },
    solve: async (request) => {
      requestIds.push(request.id);
      return { status: "deferred", reason: "recorded" };
    },
  };
  const allocator = createAllocatorPersona({ clock: () => "2026-08-30T00:00:00.000Z" });
  const fitLayout = await hostedFit(allocator, solverAdapter);
  for (const layoutCosts of [
    { floorTiles: 1, hallwayTiles: 9 },
    { floorTiles: 2, hallwayTiles: 8 },
  ]) {
    await fitLayout({
      layout: { floorTiles: 5, hallwayTiles: 5 },
      layoutCosts,
      remainingBudgetTokens: 2,
    });
  }
  assert.equal(requestIds.length, 2);
  assert.notEqual(requestIds[0], requestIds[1]);
});

test("the hybrid adapter reports both domains and keeps the Actor path Z3-free", async () => {
  const { createHybridConstraintSolverAdapter } = await import(
    "../../../packages/adapters-cli/src/adapters/z3/index.js"
  );
  let initCalls = 0;
  const adapter = createHybridConstraintSolverAdapter({
    init: async () => {
      initCalls += 1;
      throw new Error("Actor path initialized Z3");
    },
  });
  assert.equal(adapter.kind, "hybrid-constraint");
  assert.deepEqual(adapter.capabilities, {
    domains: ["actor_action_selection", "allocator_budget_fit"],
    deterministic: true,
  });

  const actorResult = await adapter.solve({
    problem: {
      data: {
        contract: "runtime-decision-v1",
        candidateActions: [
          { id: "wait", action: { kind: "wait" } },
          { id: "move", action: { kind: "move" } },
        ],
        objectives: {
          actorDecision: {
            contract: "actor-decision-objective-v1",
            order: ["opaque"],
            candidates: [
              { candidateActionId: "wait", rank: [1], features: {}, rationaleTags: ["wait"] },
              { candidateActionId: "move", rank: [2], features: {}, rationaleTags: ["move"] },
            ],
          },
        },
      },
    },
  });
  assert.equal(actorResult.model.selectedActionId, "move");
  assert.equal(initCalls, 0);
});

test("the approved objective improves both pinned greedy defects", async () => {
  const { fitLayoutToBudget } = await import(
    "../../../packages/runtime/src/personas/allocator/layout-fit.js"
  );
  const strictImprovement = {
    requestedLayout: { floorTiles: 5, hallwayTiles: 5 },
    tileCosts: { floorTiles: 1, hallwayTiles: 9 },
    budgetTokens: 2,
  };
  assert.deepEqual(
    fitLayoutToBudget({
      layout: strictImprovement.requestedLayout,
      layoutCosts: strictImprovement.tileCosts,
      remainingBudgetTokens: strictImprovement.budgetTokens,
    }).layout,
    { floorTiles: 1, hallwayTiles: 0 },
  );
  assert.deepEqual(solveApprovedReference(strictImprovement), {
    status: "fulfilled",
    model: { floorTiles: 2, hallwayTiles: 0, spentTokens: 2 },
  });

  const falseRefusal = {
    requestedLayout: { floorTiles: 5, hallwayTiles: 5 },
    tileCosts: { floorTiles: 5, hallwayTiles: 2 },
    budgetTokens: 5,
  };
  assert.equal(fitLayoutToBudget({
    layout: falseRefusal.requestedLayout,
    layoutCosts: falseRefusal.tileCosts,
    remainingBudgetTokens: falseRefusal.budgetTokens,
  }).ok, false);
  assert.deepEqual(solveApprovedReference(falseRefusal), {
    status: "fulfilled",
    model: { floorTiles: 1, hallwayTiles: 0, spentTokens: 5 },
  });
});

test("proportional fidelity precedes canonical field order", () => {
  assert.deepEqual(solveApprovedReference({
    requestedLayout: { floorTiles: 5, hallwayTiles: 5 },
    tileCosts: { floorTiles: 1, hallwayTiles: 1 },
    budgetTokens: 5,
  }), {
    status: "fulfilled",
    model: { floorTiles: 3, hallwayTiles: 2, spentTokens: 5 },
  });
  assert.deepEqual(solveApprovedReference({
    requestedLayout: { floorTiles: 5, hallwayTiles: 5 },
    tileCosts: { floorTiles: 5, hallwayTiles: 2 },
    budgetTokens: 13,
  }).model, { floorTiles: 1, hallwayTiles: 4, spentTokens: 13 });
});

test("invalid input is error; only an unaffordable valid minimum is unsat", () => {
  assert.deepEqual(solveApprovedReference({
    requestedLayout: { floorTiles: 0, hallwayTiles: 8 },
    tileCosts: { floorTiles: 1, hallwayTiles: 1 },
    budgetTokens: 8,
  }), { status: "error", reason: "empty_layout" });
  assert.deepEqual(solveApprovedReference({
    requestedLayout: { floorTiles: 5, hallwayTiles: 5 },
    tileCosts: { floorTiles: 5, hallwayTiles: 2 },
    budgetTokens: 4,
  }), { status: "unsat", reason: "allocator_minimum_floor_unaffordable" });
});

// ## TODO: Test Permutations
// - requested hallway count zero at exact and excess budgets
// - requested floor/hallway ratios with two equal-distortion optima
// - integer caps at one token below, exactly at, and one token above the minimum floor cost
// - fulfilled models with unknown variables, fractional values, or mismatched objective values
