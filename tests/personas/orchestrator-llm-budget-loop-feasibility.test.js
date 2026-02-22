const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const loopModulePath = moduleUrl("packages/runtime/src/personas/orchestrator/llm-budget-loop.js");
const catalogFixturePath = resolve(__dirname, "../fixtures/pool/catalog-basic.json");
const catalogFixture = JSON.parse(readFileSync(catalogFixturePath, "utf8"));

const script = `
import assert from "node:assert/strict";
import { runLlmBudgetLoop } from ${JSON.stringify(loopModulePath)};

const prompts = [];
const ambulatoryVitals = {
  health: { current: 8, max: 8, regen: 0 },
  mana: { current: 4, max: 4, regen: 1 },
  stamina: { current: 4, max: 4, regen: 1 },
  durability: { current: 2, max: 2, regen: 0 },
};
const responses = [
  {
    response: JSON.stringify({
      phase: "layout_only",
      remainingBudgetTokens: 800,
      layout: { floorTiles: 100, hallwayTiles: 50 },
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 800,
      actors: [{ motivation: "attacking", affinity: "fire", count: 1000, vitals: ambulatoryVitals }],
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 800,
      actors: [{ motivation: "attacking", affinity: "fire", count: 1, vitals: ambulatoryVitals }],
      missing: [],
      stop: "done",
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 400,
      actors: [{ motivation: "attacking", affinity: "fire", count: 2, vitals: ambulatoryVitals }],
      missing: [],
      stop: "done",
    }),
    done: true,
  },
];

const adapter = {
  async generate({ prompt }) {
    prompts.push(prompt);
    return responses.shift();
  },
};

const catalog = {
  entries: [
    {
      id: "actor_stationary_fire_200",
      type: "actor",
      subType: "static",
      motivation: "stationary",
      affinity: "fire",
      cost: 200,
    },
    {
      id: "actor_attacking_fire_200",
      type: "actor",
      subType: "dynamic",
      motivation: "attacking",
      affinity: "fire",
      cost: 200,
    },
  ],
};

const result = await runLlmBudgetLoop({
  adapter,
  model: "fixture",
  catalog,
  goal: "Feasibility repair",
  budgetTokens: 800,
  runId: "run_budget_loop_feasibility",
  clock: () => "2025-01-01T00:00:00Z",
});

assert.equal(result.ok, true);
assert.ok(result.captures.length >= 3);
assert.ok(result.summary.actors.length >= 1);
assert.ok(prompts.some((prompt) => prompt.includes("insufficient_walkable_tiles")));
assert.ok(prompts.length >= 3);
assert.ok(
  result.trace.some((entry) =>
    Array.isArray(entry.validationWarnings)
      && entry.validationWarnings.some((warn) => warn.code === "insufficient_walkable_tiles")
  )
);
`;

test("budget loop repairs feasibility failures via repair prompt", () => {
  runEsm(script);
});

const scaleSweepScript = `
import assert from "node:assert/strict";
import { runLlmBudgetLoop } from ${JSON.stringify(loopModulePath)};

const totalBudgets = [10000, 25000, 50000, 100000, 250000, 500000, 750000, 1000000];
const walkabilityAllocationPercent = 55;

for (const totalBudgetTokens of totalBudgets) {
  const expectedWalkabilityBudget = Math.floor((totalBudgetTokens * walkabilityAllocationPercent) / 100);
  let callCount = 0;
  const adapter = {
    async generate() {
      callCount += 1;
      return {
        response: JSON.stringify({
          phase: "layout_only",
          remainingBudgetTokens: expectedWalkabilityBudget,
          layout: {
            floorTiles: expectedWalkabilityBudget,
            hallwayTiles: 0,
          },
          missing: [],
          stop: "done",
        }),
        done: true,
      };
    },
  };

  const result = await runLlmBudgetLoop({
    adapter,
    model: "fixture",
    catalog: ${JSON.stringify(catalogFixture)},
    goal: "Walkability token sweep feasibility at 55 percent allocation",
    budgetTokens: totalBudgetTokens,
    poolWeights: [
      { id: "player", weight: 20 },
      { id: "layout", weight: 55 },
      { id: "defenders", weight: 25 },
      { id: "loot", weight: 0 },
    ],
    runId: "run_budget_loop_walkability_sweep_" + totalBudgetTokens,
    clock: () => "2025-01-01T00:00:00Z",
    maxActorRounds: 0,
  });

  assert.equal(result.ok, true, "expected ok for total budget " + totalBudgetTokens);
  assert.equal(result.poolBudgets.layout, expectedWalkabilityBudget, "unexpected layout budget for total budget " + totalBudgetTokens);
  assert.ok(result.poolBudgets.layout <= 550000, "walkability budget exceeded 550000 at total budget " + totalBudgetTokens);
  if (totalBudgetTokens === 1000000) {
    assert.equal(result.poolBudgets.layout, 550000, "expected 550000 walkability budget at max total budget");
  }
  assert.equal(callCount, 1, "expected no repair retries for total budget " + totalBudgetTokens);
  assert.equal(result.captures.length, 1, "expected one capture for total budget " + totalBudgetTokens);
  assert.equal(result.trace.length, 1, "expected one trace entry for total budget " + totalBudgetTokens);
  const walkableTiles = (result.summary?.layout?.floorTiles || 0) + (result.summary?.layout?.hallwayTiles || 0);
  assert.ok(walkableTiles > 0, "expected non-empty walkable layout for total budget " + totalBudgetTokens);
  assert.equal(walkableTiles, expectedWalkabilityBudget, "expected walkable tiles to match budget-backed target for total budget " + totalBudgetTokens);
}
`;

test("budget loop benchmarks walkability budget scaling up to 550000 at 1M total budget", () => {
  runEsm(scaleSweepScript);
});

const billionBudgetScript = `
import assert from "node:assert/strict";
import { runLlmBudgetLoop } from ${JSON.stringify(loopModulePath)};

const totalBudgetTokens = 1000000000;
const walkabilityAllocationPercent = 55;
const expectedWalkabilityBudget = Math.floor((totalBudgetTokens * walkabilityAllocationPercent) / 100);

const adapter = {
  async generate() {
    return {
      response: JSON.stringify({
        phase: "layout_only",
        remainingBudgetTokens: expectedWalkabilityBudget,
        layout: {
          floorTiles: 1000,
          hallwayTiles: 500,
        },
        missing: [],
        stop: "done",
      }),
      done: true,
    };
  },
};

const result = await runLlmBudgetLoop({
  adapter,
  model: "fixture",
  catalog: ${JSON.stringify(catalogFixture)},
  goal: "Billion token budget support",
  budgetTokens: totalBudgetTokens,
  poolWeights: [
    { id: "player", weight: 20 },
    { id: "layout", weight: 55 },
    { id: "defenders", weight: 25 },
    { id: "loot", weight: 0 },
  ],
  runId: "run_budget_loop_billion_budget",
  clock: () => "2025-01-01T00:00:00Z",
  maxActorRounds: 0,
});

assert.equal(result.ok, true);
assert.equal(result.poolBudgets.layout, 550000000);
assert.equal(result.poolBudgets.defenders, 250000000);
assert.equal(result.poolBudgets.player, 200000000);
assert.equal((result.summary?.layout?.floorTiles || 0) + (result.summary?.layout?.hallwayTiles || 0), 1500);
`;

test("budget loop supports one billion token budgets without imposed ceiling", () => {
  runEsm(billionBudgetScript);
});

const largeLayoutFastPathScript = `
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { runLlmBudgetLoop } from ${JSON.stringify(loopModulePath)};

const totalBudgetTokens = 20000000;
const walkabilityAllocationPercent = 55;
const expectedWalkabilityBudget = Math.floor((totalBudgetTokens * walkabilityAllocationPercent) / 100);
let callCount = 0;

const adapter = {
  async generate() {
    callCount += 1;
    return {
      response: JSON.stringify({
        phase: "layout_only",
        remainingBudgetTokens: expectedWalkabilityBudget,
        layout: {
          floorTiles: expectedWalkabilityBudget,
          hallwayTiles: 0,
        },
        missing: [],
        stop: "done",
      }),
      done: true,
    };
  },
};

const started = performance.now();
const result = await runLlmBudgetLoop({
  adapter,
  model: "fixture",
  catalog: ${JSON.stringify(catalogFixture)},
  goal: "Large layout feasibility fast path",
  budgetTokens: totalBudgetTokens,
  poolWeights: [
    { id: "player", weight: 20 },
    { id: "layout", weight: 55 },
    { id: "defenders", weight: 25 },
    { id: "loot", weight: 0 },
  ],
  runId: "run_budget_loop_large_layout_fast_path",
  clock: () => "2025-01-01T00:00:00Z",
  maxActorRounds: 0,
});
const elapsedMs = performance.now() - started;

assert.equal(result.ok, true);
assert.equal(result.poolBudgets.layout, expectedWalkabilityBudget);
assert.equal(callCount, 1);
assert.ok(elapsedMs < 20000, "expected 20M benchmark run to complete in under 20s, got " + elapsedMs + "ms");
`;

test("budget loop avoids full-grid feasibility slowdown for very large walkability counts", () => {
  runEsm(largeLayoutFastPathScript);
});
