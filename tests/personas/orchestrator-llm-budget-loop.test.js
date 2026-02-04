const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");
const { readFixture } = require("../helpers/fixtures");

const loopModulePath = moduleUrl("packages/runtime/src/personas/orchestrator/llm-budget-loop.js");

const catalogPath = resolve(__dirname, "../fixtures/pool/catalog-basic.json");
const catalogFixture = JSON.parse(readFileSync(catalogPath, "utf8"));
const tilePriceList = readFixture("price-list-artifact-v1-tiles.json");

const script = `
import assert from "node:assert/strict";
import { runLlmBudgetLoop } from ${JSON.stringify(loopModulePath)};

const responses = [
  {
    response: JSON.stringify({
      phase: "layout_only",
      remainingBudgetTokens: 300,
      layout: { wallTiles: 50, floorTiles: 100, hallwayTiles: 50 },
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 100,
      actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
      missing: [],
    }),
    done: true,
  },
];

const adapter = {
  async generate() {
    return responses.shift();
  },
};

const result = await runLlmBudgetLoop({
  adapter,
  model: "fixture",
  catalog: ${JSON.stringify(catalogFixture)},
  goal: "Budget loop test",
  budgetTokens: 300,
  poolWeights: [
    { id: "player", weight: 0 },
    { id: "layout", weight: 0.7 },
    { id: "defenders", weight: 0.3 },
    { id: "loot", weight: 0 },
  ],
  runId: "run_budget_loop",
  clock: () => "2025-01-01T00:00:00Z",
});

assert.equal(result.ok, true);
assert.equal(result.captures.length, 2);
assert.equal(result.summary.layout.wallTiles, 50);
assert.equal(result.summary.actors.length, 1);
assert.equal(result.remainingBudgetTokens, 20);
assert.equal(result.stopReason, "no_viable_spend");
assert.ok(result.trace[0].startedAt);
assert.ok(result.trace[0].endedAt);
assert.equal(typeof result.trace[0].durationMs, "number");
`;

test("orchestrator budget loop sequences layout then actors", () => {
  runEsm(script);
});

const priceListScript = `
import assert from "node:assert/strict";
import { runLlmBudgetLoop } from ${JSON.stringify(loopModulePath)};

const responses = [
  {
    response: JSON.stringify({
      phase: "layout_only",
      remainingBudgetTokens: 100,
      layout: { wallTiles: 2, floorTiles: 3, hallwayTiles: 1 },
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 90,
      actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
      missing: [],
    }),
    done: true,
  },
];

const adapter = {
  async generate() {
    return responses.shift();
  },
};

const result = await runLlmBudgetLoop({
  adapter,
  model: "fixture",
  catalog: ${JSON.stringify(catalogFixture)},
  priceList: ${JSON.stringify(tilePriceList)},
  goal: "Budget loop with tile costs",
  budgetTokens: 100,
  poolWeights: [
    { id: "player", weight: 0 },
    { id: "layout", weight: 0.5 },
    { id: "defenders", weight: 0.5 },
    { id: "loot", weight: 0 },
  ],
  runId: "run_budget_loop_tiles",
  clock: () => "2025-01-01T00:00:00Z",
});

assert.equal(result.ok, true);
assert.equal(result.trace[0].spentTokens, 10);
assert.equal(result.trace[0].remainingBudgetTokens, 90);
assert.equal(result.remainingBudgetTokens, 10);
`;

test("orchestrator budget loop applies tile price list costs", () => {
  runEsm(priceListScript);
});
