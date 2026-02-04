const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const loopModulePath = moduleUrl("packages/runtime/src/personas/orchestrator/llm-budget-loop.js");

const script = `
import assert from "node:assert/strict";
import { runLlmBudgetLoop } from ${JSON.stringify(loopModulePath)};

const prompts = [];
const responses = [
  {
    response: JSON.stringify({
      phase: "layout_only",
      remainingBudgetTokens: 800,
      layout: { wallTiles: 50, floorTiles: 100, hallwayTiles: 50 },
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 800,
      actors: [{ motivation: "attacking", affinity: "fire", count: 1000 }],
      missing: [],
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 800,
      actors: [{ motivation: "attacking", affinity: "fire", count: 1 }],
      missing: [],
      stop: "done",
    }),
    done: true,
  },
  {
    response: JSON.stringify({
      phase: "actors_only",
      remainingBudgetTokens: 400,
      actors: [{ motivation: "attacking", affinity: "fire", count: 2 }],
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
assert.equal(result.captures.length, 4);
assert.equal(result.summary.actors.length, 2);
assert.ok(prompts.some((prompt) => prompt.includes("insufficient_walkable_tiles")));
assert.equal(prompts.length, 4);
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
