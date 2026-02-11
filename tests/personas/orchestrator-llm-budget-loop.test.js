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
      roomDesign: {
        rooms: [
          { id: "R1", size: "large", width: 10, height: 10 },
          { id: "R2", size: "small", width: 5, height: 5 },
        ],
        connections: [{ from: "R1", to: "R2", type: "hallway" }],
        hallways: "Single spine hallway.",
      },
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
assert.equal(result.summary.roomDesign.rooms.length, 2);
assert.equal(result.summary.roomDesign.connections.length, 1);
assert.equal(result.summary.roomDesign.hallways, "Single spine hallway.");
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

const phi4OptionsScript = `
import assert from "node:assert/strict";
import { runLlmBudgetLoop } from ${JSON.stringify(loopModulePath)};

const calls = [];
const responses = [
  {
    response: JSON.stringify({
      phase: "layout_only",
      remainingBudgetTokens: 120,
      layout: { wallTiles: 50, floorTiles: 100, hallwayTiles: 50 },
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 80,
      actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
      missing: [],
      stop: "done",
    }),
    done: true,
  },
];

const adapter = {
  async generate({ options, format }) {
    calls.push({ options, format });
    return responses.shift();
  },
};

const result = await runLlmBudgetLoop({
  adapter,
  model: "phi4",
  catalog: ${JSON.stringify(catalogFixture)},
  goal: "Phi4 options",
  budgetTokens: 300,
  poolWeights: [
    { id: "player", weight: 0 },
    { id: "layout", weight: 0.7 },
    { id: "defenders", weight: 0.3 },
    { id: "loot", weight: 0 },
  ],
  runId: "run_budget_loop_phi4_options",
  clock: () => "2025-01-01T00:00:00Z",
});

assert.equal(result.ok, true);
assert.equal(calls.length, 2);
assert.equal(calls[0].format, "json");
assert.equal(calls[0].options.num_ctx, 16384);
assert.equal(calls[0].options.num_predict, 160);
assert.equal(calls[1].options.num_predict, 320);
assert.equal(calls[1].options.temperature, 0.15);
`;

test("orchestrator budget loop uses phi4 option budgets by phase", () => {
  runEsm(phi4OptionsScript);
});

const overBudgetLayoutAutoFitScript = `
import assert from "node:assert/strict";
import { runLlmBudgetLoop } from ${JSON.stringify(loopModulePath)};

const responses = [
  {
    response: JSON.stringify({
      phase: "layout_only",
      remainingBudgetTokens: 400,
      layout: { wallTiles: 1000, floorTiles: 1200, hallwayTiles: 800 },
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 120,
      actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
      missing: [],
      stop: "done",
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
  model: "phi4",
  catalog: ${JSON.stringify(catalogFixture)},
  goal: "Auto-fit over budget layout",
  budgetTokens: 1000,
  poolWeights: [
    { id: "player", weight: 0 },
    { id: "layout", weight: 0.3 },
    { id: "defenders", weight: 0.7 },
    { id: "loot", weight: 0 },
  ],
  runId: "run_budget_loop_autofit",
  clock: () => "2025-01-01T00:00:00Z",
  maxActorRounds: 1,
});

assert.equal(result.ok, true);
assert.equal(result.trace[0].phase, "layout_only");
assert.ok(result.trace[0].spentTokens <= result.poolBudgets.layout);
assert.ok(result.summary.layout.floorTiles + result.summary.layout.hallwayTiles > 0);
assert.equal(result.summary.actors.length, 1);
assert.equal(result.captures.length, 2);
`;

test("orchestrator budget loop auto-fits over-budget layout responses in non-strict mode", () => {
  runEsm(overBudgetLayoutAutoFitScript);
});

const unmatchedCatalogActorFallbackScript = `
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
      remainingBudgetTokens: 140,
      actors: [{ motivation: "defending", affinity: "fire", count: 1, tokenHint: 120 }],
      missing: [],
      stop: "done",
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
  goal: "Fallback unmatched defender pair",
  budgetTokens: 300,
  poolWeights: [
    { id: "player", weight: 0 },
    { id: "layout", weight: 0.7 },
    { id: "defenders", weight: 0.3 },
    { id: "loot", weight: 0 },
  ],
  runId: "run_budget_loop_unmatched_actor_pair",
  clock: () => "2025-01-01T00:00:00Z",
});

assert.equal(result.ok, true);
assert.equal(result.summary.actors.length, 1);
assert.equal(result.summary.actors[0].affinity, "wind");
assert.equal(result.summary.actors[0].motivation, "patrolling");
assert.ok(Array.isArray(result.trace[1].validationWarnings));
assert.ok(result.trace[1].validationWarnings.some((entry) => entry.code === "missing_catalog_match"));
`;

test("orchestrator budget loop recovers actor picks without exact catalog pair in non-strict mode", () => {
  runEsm(unmatchedCatalogActorFallbackScript);
});
