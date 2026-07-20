/**
 * P1.5b — runtime action costs are Allocator policy, injected into core.
 *
 * Before this, core hardcoded `budgetCost = kind === RequestSolver ? 2 : 1`,
 * putting pricing inside core (charter violation: "Economy — Allocator
 * Authority" — core may enforce caps, never author prices).
 *
 * Core now defaults every action to 1 unit (counting actions is enforcement
 * mechanics) and the 2x solver premium is injected by the runtime port from
 * base-costs.json.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const CORE = "../../../packages/core-ts/src/index.ts";
const PORT = "../../../packages/runtime/src/ports/budget.js";
const ALLOCATOR = "../../../packages/runtime/src/personas/allocator/persona.js";
const BASE_COSTS_JSON = resolve(__dirname, "../../../packages/runtime/src/personas/allocator/base-costs.json");

const REQUEST_SOLVER = 5;
const REQUEST_EXTERNAL_FACT = 4;

async function freshCore() {
  const { createCore } = await import(CORE);
  const core = createCore();
  core.init(0);
  return core;
}

test("the Allocator owns the numbers; base-costs.json is their only home", async () => {
  const { createAllocatorPersona } = await import(ALLOCATOR);
  const base = JSON.parse(readFileSync(BASE_COSTS_JSON, "utf8"));
  const costs = createAllocatorPersona().pricing.actionBudgetCosts();
  assert.equal(costs.default, base.actionBudget.action_default);
  assert.equal(costs.requestSolver, base.actionBudget.action_request_solver);

  // The numbers must not be restated in core.
  const coreSrc = readFileSync(
    resolve(__dirname, "../../../packages/core-ts/src/index.ts"),
    "utf8",
  );
  assert.equal(
    /RequestSolver\s*\?\s*2\s*:\s*1/.test(coreSrc),
    false,
    "core must not hardcode action prices — inject them from the Allocator",
  );
});

test("core defaults to 1 unit per action when nothing is injected", async () => {
  const { BudgetCategory } = await import(CORE);
  const core = await freshCore();
  core.applyAction(REQUEST_SOLVER, 0);
  assert.equal(
    core.getBudgetUsage(BudgetCategory.Effects),
    1,
    "unpriced solver request costs the plain unit, not core's old 2",
  );
});

test("injecting Allocator costs makes a solver request cost 2", async () => {
  const { BudgetCategory } = await import(CORE);
  const { applyActionBudgetCosts } = await import(PORT);
  const { createAllocatorPersona } = await import(ALLOCATOR);
  const core = await freshCore();

  const applied = applyActionBudgetCosts(core, createAllocatorPersona().pricing.actionBudgetCosts());
  assert.equal(applied.length, 1);
  assert.equal(applied[0].kind, REQUEST_SOLVER);

  core.applyAction(REQUEST_SOLVER, 0);
  assert.equal(core.getBudgetUsage(BudgetCategory.Effects), 2, "solver premium applied");

  core.applyAction(REQUEST_EXTERNAL_FACT, 0);
  assert.equal(core.getBudgetUsage(BudgetCategory.Effects), 3, "other effect actions stay at 1");
});

test("injected costs survive core.init (they are policy, not per-run state)", async () => {
  const { BudgetCategory } = await import(CORE);
  const { applyActionBudgetCosts } = await import(PORT);
  const core = await freshCore();
  applyActionBudgetCosts(core, { default: 1, requestSolver: 2 });

  core.init(0); // resets caps and spend
  core.applyAction(REQUEST_SOLVER, 0);
  assert.equal(core.getBudgetUsage(BudgetCategory.Effects), 2, "cost survived the reset");
});

test("a custom price list changes what actions cost — the data is load-bearing", async () => {
  const { BudgetCategory } = await import(CORE);
  const { applyActionBudgetCosts } = await import(PORT);
  const core = await freshCore();
  applyActionBudgetCosts(core, { default: 3, requestSolver: 7 });

  core.applyAction(REQUEST_SOLVER, 0);
  assert.equal(core.getBudgetUsage(BudgetCategory.Effects), 7);
  core.applyAction(REQUEST_EXTERNAL_FACT, 0);
  assert.equal(core.getBudgetUsage(BudgetCategory.Effects), 10, "default applied to other kinds");
});

test("malformed cost input is ignored rather than zeroing the ledger", async () => {
  const { applyActionBudgetCosts } = await import(PORT);
  const core = await freshCore();
  assert.deepEqual(applyActionBudgetCosts(core, null), []);
  assert.deepEqual(applyActionBudgetCosts(core, { default: -5 }), []);
  assert.deepEqual(applyActionBudgetCosts({}, { default: 1 }), [], "core without the setter");
});

// ## TODO: Test Permutations
// - cost 0 for an action kind: charges nothing, emits no limit event
// - out-of-range action kind passed to setActionBudgetCost returns 0
// - injected costs interacting with a cap: LimitViolated fires a charge earlier
// - runtime-fsm end-to-end: a solver-heavy run consumes budget at 2/request
