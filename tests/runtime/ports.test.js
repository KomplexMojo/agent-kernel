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
import { dispatchEffect, EffectKind, buildEffectFromCore } from ${JSON.stringify(effectsModule)};

const effect = buildEffectFromCore({ tick: 0, index: 0, kind: EffectKind.Log, value: 1 });
const noLogger = dispatchEffect({}, effect);
assert.equal(noLogger.status, "deferred");

const logs = [];
const adapters = { logger: { log(message, data) { logs.push({ message, data }); } } };
const result = dispatchEffect(adapters, effect);
assert.equal(result.status, "fulfilled");
assert.equal(logs.length, 1);
assert.equal(logs[0].message, "log#1");

const factEffect = buildEffectFromCore({ tick: 2, index: 1, kind: EffectKind.NeedExternalFact, value: (2 << 8) | 4 });
assert.equal(factEffect.kind, "need_external_fact");
assert.equal(factEffect.requestId, "fact-2");
assert.ok(factEffect.id.includes("2"));

const repeatA = buildEffectFromCore({ tick: 5, index: 1, kind: EffectKind.Log, value: 0 });
const repeatB = buildEffectFromCore({ tick: 5, index: 1, kind: EffectKind.Log, value: 0 });
assert.equal(repeatA.id, repeatB.id);
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
