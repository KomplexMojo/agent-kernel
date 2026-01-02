const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/level-strategy-map-v1-basic.json"), "utf8"));
const modulePath = moduleUrl("packages/runtime/src/personas/configurator/level-strategy-map.js");

test("level strategy mapping applies deterministic overrides", () => {
  const script = `
import assert from "node:assert/strict";
import { applyLevelStrategy } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(fixture)};
fixture.cases.forEach((entry) => {
  const result = applyLevelStrategy(entry.input.levelGen, entry.input.plan);
  assert.deepEqual(result, entry.expected);
});
`;
  runEsm(script);
});
