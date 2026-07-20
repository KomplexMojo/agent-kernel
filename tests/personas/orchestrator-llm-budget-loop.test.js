const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");


const catalogPath = resolve(__dirname, "../fixtures/pool/catalog-basic.json");
const catalogFixture = JSON.parse(readFileSync(catalogPath, "utf8"));

async function canonicalPriceList() {
  const { buildDefaultPriceList } = await import(
    "../../packages/runtime/src/personas/allocator/default-price-list.js"
  );
  return buildDefaultPriceList({ createdAt: "2026-07-20T00:00:00.000Z" });
}


test("orchestrator budget loop sequences layout then actors", async () => {
const { runLlmBudgetLoop } = await import("../../packages/runtime/src/personas/orchestrator/llm-budget-loop.js");

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
      remainingBudgetTokens: 300,
      layout: { floorTiles: 100, hallwayTiles: 50 },
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
      actors: [{ motivation: "patrolling", affinity: "wind", count: 1, vitals: ambulatoryVitals }],
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
  catalog: catalogFixture,
  priceList: await canonicalPriceList(),
  goal: "Budget loop test",
  budgetTokens: 320,
  poolWeights: [
    { id: "delver", weight: 0 },
    { id: "rooms", weight: 0.6 },
    { id: "wardens", weight: 0.4 },
    { id: "resources", weight: 0 },
  ],
  runId: "run_budget_loop",
  clock: () => "2025-01-01T00:00:00Z",
  maxActorRounds: 1,
});

assert.equal(result.ok, true);
assert.equal(result.captures.length, 2);
assert.equal(result.summary.layout.floorTiles + result.summary.layout.hallwayTiles, 150);
assert.equal(result.summary.roomDesign.rooms.length, 2);
assert.equal(result.summary.roomDesign.connections.length, 1);
assert.equal(result.summary.roomDesign.hallways, "Single spine hallway.");
assert.equal(result.summary.actors.length, 1);
// Layout 100 + actor base 80 + vitals/regen/motivation (18 + 2 + 3) = 203.
assert.equal(result.remainingBudgetTokens, 117);
// P1.4: under unified list prices, 117 remaining still affords catalog
// entries, so resolveStopReason correctly IGNORES the LLM's premature "done"
// (ignoreDoneIfBudgetRemains) and the single allowed actor round exhausts —
// stopReason stays null by design. Pre-P1.4 prices made 117 unaffordable,
// which is why "done" used to be accepted.
assert.equal(result.stopReason, null);
assert.ok(result.trace[0].startedAt);
assert.ok(result.trace[0].endedAt);
assert.equal(typeof result.trace[0].durationMs, "number");
});


test("orchestrator budget loop applies tile price list costs", async () => {
const { runLlmBudgetLoop } = await import("../../packages/runtime/src/personas/orchestrator/llm-budget-loop.js");

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
      remainingBudgetTokens: 100,
      layout: { floorTiles: 3, hallwayTiles: 1 },
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 90,
      actors: [{ motivation: "patrolling", affinity: "wind", count: 1, vitals: ambulatoryVitals }],
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
  catalog: catalogFixture,
  priceList: await canonicalPriceList(),
  goal: "Budget loop with tile costs",
  budgetTokens: 100,
  poolWeights: [
    { id: "delver", weight: 0 },
    { id: "rooms", weight: 1 },
    { id: "wardens", weight: 0 },
    { id: "resources", weight: 0 },
  ],
  runId: "run_budget_loop_tiles",
  clock: () => "2025-01-01T00:00:00Z",
  maxActorRounds: 0,
});

assert.equal(result.ok, true);
assert.equal(result.trace[0].spentTokens, 3);
assert.equal(result.trace[0].remainingBudgetTokens, 97);
assert.equal(result.remainingBudgetTokens, 97);
});


test("orchestrator budget loop uses phi4 option budgets by phase", async () => {
const { runLlmBudgetLoop } = await import("../../packages/runtime/src/personas/orchestrator/llm-budget-loop.js");

const calls = [];
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
      remainingBudgetTokens: 120,
      layout: { floorTiles: 100, hallwayTiles: 50 },
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 80,
      actors: [{ motivation: "patrolling", affinity: "wind", count: 1, vitals: ambulatoryVitals }],
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
  catalog: catalogFixture,
  priceList: await canonicalPriceList(),
  goal: "Phi4 options",
  budgetTokens: 300,
  poolWeights: [
    { id: "delver", weight: 0 },
    { id: "rooms", weight: 0.6 },
    { id: "wardens", weight: 0.4 },
    { id: "resources", weight: 0 },
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
});


test("orchestrator budget loop auto-fits over-budget layout responses in non-strict mode", async () => {
const { runLlmBudgetLoop } = await import("../../packages/runtime/src/personas/orchestrator/llm-budget-loop.js");

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
      remainingBudgetTokens: 400,
      layout: { floorTiles: 1200, hallwayTiles: 800 },
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 120,
      actors: [{ motivation: "patrolling", affinity: "wind", count: 1, vitals: ambulatoryVitals }],
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
  catalog: catalogFixture,
  priceList: await canonicalPriceList(),
  goal: "Auto-fit over budget layout",
  budgetTokens: 1000,
  poolWeights: [
    { id: "delver", weight: 0 },
    { id: "rooms", weight: 0.3 },
    { id: "wardens", weight: 0.7 },
    { id: "resources", weight: 0 },
  ],
  runId: "run_budget_loop_autofit",
  clock: () => "2025-01-01T00:00:00Z",
  maxActorRounds: 1,
});

assert.equal(result.ok, true);
assert.equal(result.trace[0].phase, "layout_only");
assert.ok(result.trace[0].spentTokens <= result.poolBudgets.rooms);
assert.ok(result.summary.layout.floorTiles + result.summary.layout.hallwayTiles > 0);
assert.equal(result.summary.actors.length, 1);
assert.equal(result.captures.length, 2);
});


test("orchestrator budget loop recovers actor picks without exact catalog pair in non-strict mode", async () => {
const { runLlmBudgetLoop } = await import("../../packages/runtime/src/personas/orchestrator/llm-budget-loop.js");

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
      remainingBudgetTokens: 300,
      layout: { floorTiles: 100, hallwayTiles: 50 },
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 140,
      actors: [{ motivation: "defending", affinity: "fire", count: 1, tokenHint: 120, vitals: ambulatoryVitals }],
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
  catalog: catalogFixture,
  priceList: await canonicalPriceList(),
  goal: "Fallback unmatched defender pair",
  budgetTokens: 500,
  poolWeights: [
    { id: "delver", weight: 0 },
    { id: "rooms", weight: 0.7 },
    { id: "wardens", weight: 0.3 },
    { id: "resources", weight: 0 },
  ],
  runId: "run_budget_loop_unmatched_actor_pair",
  clock: () => "2025-01-01T00:00:00Z",
});

assert.equal(result.ok, true);
assert.equal(result.summary.actors.length, 1);
assert.notEqual(
  `${result.summary.actors[0].motivation}:${result.summary.actors[0].affinity}`,
  "defending:fire",
);
assert.ok(Array.isArray(result.trace[1].validationWarnings));
assert.ok(result.trace[1].validationWarnings.some((entry) => entry.code === "missing_catalog_match"));
});


test("orchestrator budget loop keeps oversized walkable layout when budget allows", async () => {
const { runLlmBudgetLoop } = await import("../../packages/runtime/src/personas/orchestrator/llm-budget-loop.js");

const prompts = [];
const responses = [
  {
    response: JSON.stringify({
      phase: "layout_only",
      remainingBudgetTokens: 10000,
      layout: { floorTiles: 9000, hallwayTiles: 0 },
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

const result = await runLlmBudgetLoop({
  adapter,
  model: "fixture",
  catalog: catalogFixture,
  goal: "Layout feasibility auto-fit without LLM repair",
  budgetTokens: 10000,
  poolWeights: [
    { id: "delver", weight: 0 },
    { id: "rooms", weight: 1 },
    { id: "wardens", weight: 0 },
    { id: "resources", weight: 0 },
  ],
  runId: "run_budget_loop_layout_feasibility_autofit",
  clock: () => "2025-01-01T00:00:00Z",
  maxActorRounds: 0,
});

assert.equal(result.ok, true);
assert.equal(prompts.length, 1);
assert.equal(result.summary.layout.floorTiles, 9000);
assert.equal(result.summary.layout.hallwayTiles, 0);
assert.ok(result.summary.layout.floorTiles + result.summary.layout.hallwayTiles > 0);
assert.ok(!Array.isArray(result.trace[0].validationWarnings) || result.trace[0].validationWarnings.length === 0);
});
