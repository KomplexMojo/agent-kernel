const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/configurator/feasibility.js");

const script = `
import assert from "node:assert/strict";
import { validateLayoutAndActors, validateLayoutCountsAndActors } from ${JSON.stringify(modulePath)};

const levelGen = { width: 5, height: 5, shape: {} };
const ok = validateLayoutAndActors({ levelGen, actorCount: 1 });
assert.equal(ok.ok, true);

const insufficient = validateLayoutAndActors({ levelGen, actorCount: 999 });
assert.equal(insufficient.ok, false);
assert.ok(insufficient.errors.find((err) => err.code === "insufficient_walkable_tiles"));

const invalid = validateLayoutAndActors({ levelGen: { width: 0, height: 0 }, actorCount: 1 });
assert.equal(invalid.ok, false);
assert.ok(invalid.errors.length > 0);

const countsOk = validateLayoutCountsAndActors({
  layout: { floorTiles: 10, hallwayTiles: 5 },
  actorCount: 2,
});
assert.equal(countsOk.ok, true);

const countsInvalid = validateLayoutCountsAndActors({
  layout: { floorTiles: -1, hallwayTiles: 0 },
  actorCount: 1,
});
assert.equal(countsInvalid.ok, false);
assert.ok(countsInvalid.errors.find((err) => err.code === "invalid_tile_count"));
`;

test("configurator feasibility validation checks layout and actor placement", () => {
  runEsm(script);
});
