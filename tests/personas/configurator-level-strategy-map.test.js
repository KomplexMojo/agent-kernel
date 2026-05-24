const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/level-strategy-map-v1-basic.json"), "utf8"));

test("level strategy mapping applies deterministic overrides", async () => {const { applyLevelStrategy } = await import("../../packages/runtime/src/personas/configurator/level-strategy-map.js");

fixture.cases.forEach((entry) => {
  const result = applyLevelStrategy(entry.input.levelGen, entry.input.plan);
  assert.deepEqual(result, entry.expected);
});
});
