const test = require("node:test");
const { readFileSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const layoutModule = moduleUrl("packages/runtime/src/personas/configurator/level-layout.js");
const levelGenModule = moduleUrl("packages/runtime/src/personas/configurator/level-gen.js");

const fixturesDir = resolve(__dirname, "../fixtures");
const fixtures = readdirSync(fixturesDir)
  .filter((name) => name.startsWith("level-gen-fixture-") && name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")));

test("level layout generator produces deterministic layouts", () => {
const script = `
import assert from "node:assert/strict";
import { normalizeLevelGenInput } from ${JSON.stringify(levelGenModule)};
import { generateGridLayout } from ${JSON.stringify(layoutModule)};

const fixtures = ${JSON.stringify(fixtures)};
fixtures.forEach((fixture) => {
  assert.equal(fixture.schema, "agent-kernel/LevelGenFixture");
  assert.equal(fixture.schemaVersion, 1);
  const normalized = normalizeLevelGenInput(fixture.input);
  assert.equal(normalized.ok, true);
  const layout = generateGridLayout(normalized.value);
  assert.deepEqual(layout, fixture.expected);
  const layoutAgain = generateGridLayout(normalized.value);
  assert.deepEqual(layoutAgain, fixture.expected);
  const spawn = layout.spawn;
  const exit = layout.exit;
  assert.equal(layout.kinds[spawn.y][spawn.x], 0);
  assert.equal(layout.kinds[exit.y][exit.x], 0);
  layout.tiles.forEach((row, y) => {
    row.split("").forEach((cell, x) => {
      const kind = layout.kinds[y][x];
      if (cell === "#") assert.equal(kind, 1);
      if (cell === "." || cell === "S" || cell === "E") assert.ok(kind === 0 || kind === 2);
    });
  });
});
`;
  runEsm(script);
});
