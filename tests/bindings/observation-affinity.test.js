const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const bindingsModule = moduleUrl("packages/bindings-ts/src/index.js");
const wasmUrl = moduleUrl("build/core-as.wasm");

const script = `
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadCore, readObservation } from ${JSON.stringify(bindingsModule)};

const wasmUrl = new URL(${JSON.stringify(wasmUrl)});
const fixture = JSON.parse(
  fs.readFileSync(path.resolve("tests/fixtures/personas/affinity-resolution-v1-basic.json"), "utf8"),
);

const core = await loadCore({ wasmUrl });
core.init(1337);
core.loadMvpScenario();

const baseObs = readObservation(core);
assert.deepEqual(baseObs.actors[0].affinities, []);
assert.deepEqual(baseObs.actors[0].abilities, []);
assert.equal(baseObs.traps, undefined);

const obs = readObservation(core, { affinityEffects: fixture.expected });
assert.deepEqual(obs.actors[0].affinities, [
  { kind: "fire", expression: "push", stacks: 2 },
  { kind: "life", expression: "pull", stacks: 1 },
]);
assert.deepEqual(obs.actors[0].abilities, fixture.expected.actors[0].abilities);
assert.equal(obs.traps.length, 1);
assert.deepEqual(obs.traps[0].position, fixture.expected.traps[0].position);
assert.deepEqual(obs.traps[0].affinities, [
  { kind: "fire", expression: "push", stacks: 2 },
]);
assert.deepEqual(obs.traps[0].abilities, fixture.expected.traps[0].abilities);
assert.deepEqual(obs.traps[0].vitals, fixture.expected.traps[0].vitals);
`;

test("bindings observation includes affinity metadata when provided", () => {
  runEsm(script);
});
