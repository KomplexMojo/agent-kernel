const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const budgetModule = moduleUrl("packages/runtime/src/ports/budget.js");
const effectsModule = moduleUrl("packages/runtime/src/ports/effects.js");
const solverModule = moduleUrl("packages/runtime/src/ports/solver.js");

const budgetScript = `
import assert from "node:assert/strict";
import { applyBudgetCaps } from ${JSON.stringify(budgetModule)};

const calls = [];
const core = { setBudget(category, cap) { calls.push({ category, cap }); } };
const simConfig = {
  constraints: {
    categoryCaps: {
      caps: {
        movement: 5,
        unknown: 2,
        "2": 7
      }
    }
  }
};
const applied = applyBudgetCaps(core, simConfig);
assert.equal(applied.length, 2);
assert.equal(calls.length, 2);
const categories = calls.map((entry) => entry.category).sort();
assert.deepEqual(categories, [0, 2]);
const capsByCategory = Object.fromEntries(calls.map((entry) => [entry.category, entry.cap]));
assert.equal(capsByCategory[0], 5);
assert.equal(capsByCategory[2], 7);
`;

const effectsScript = `
import assert from "node:assert/strict";
import { dispatchEffect, EffectKind } from ${JSON.stringify(effectsModule)};

const noLogger = dispatchEffect({}, EffectKind.Log, 1);
assert.equal(noLogger.status, "deferred");

const logs = [];
const adapters = { logger: { log(value) { logs.push(value); } } };
const result = dispatchEffect(adapters, EffectKind.Log, 2);
assert.equal(result.status, "fulfilled");
assert.equal(logs[0], 2);
`;

const solverScript = `
import assert from "node:assert/strict";
import { createSolverPort } from ${JSON.stringify(solverModule)};

const adapter = {
  async solve(request) {
    return { request, status: "fulfilled" };
  }
};

const request = { meta: { runId: "run_test", correlationId: "corr", id: "solver_req" } };
const solver = createSolverPort({ clock: () => "fixed-time" });
const result = await solver.solve(adapter, request);
assert.equal(result.status, "fulfilled");
assert.ok(result.meta);
assert.equal(result.meta.runId, "run_test");
assert.equal(result.meta.correlationId, "corr");
assert.equal(result.meta.id, "solver_req");
assert.equal(result.meta.createdAt, "fixed-time");
`;

test("applyBudgetCaps applies known caps", () => {
  runEsm(budgetScript);
});

test("dispatchEffect handles log path", () => {
  runEsm(effectsScript);
});

test("solver port populates meta", () => {
  runEsm(solverScript);
});
