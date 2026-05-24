const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("bindings observation includes affinity metadata when provided", async () => {
  const { createCore, readObservation } = await import(
    "../../packages/core-ts/src/index.ts"
  );

  const fixture = JSON.parse(
    fs.readFileSync(path.resolve("tests/fixtures/personas/affinity-resolution-v1-basic.json"), "utf8"),
  );

  const core = createCore();
  core.init(1337);
  core.loadMvpScenario();

  const baseObs = readObservation(core);
  assert.deepEqual(baseObs.actors[0].affinities, []);
  assert.deepEqual(baseObs.actors[0].abilities, []);
  assert.equal(baseObs.traps, undefined);

  const obs = readObservation(core, { affinityEffects: fixture.expected });
  assert.deepEqual(obs.actors[0].affinities, [
    { kind: "fire", expression: "push", targetType: "enemy", stacks: 2 },
    { kind: "life", expression: "pull", targetType: "self", stacks: 1 },
  ]);
  assert.deepEqual(obs.actors[0].abilities, fixture.expected.actors[0].abilities);
  assert.equal(obs.traps.length, 1);
  assert.deepEqual(obs.traps[0].position, fixture.expected.traps[0].position);
  assert.deepEqual(obs.traps[0].affinities, [
    { kind: "fire", expression: "push", targetType: "floor", stacks: 2 },
  ]);
  assert.deepEqual(obs.traps[0].abilities, fixture.expected.traps[0].abilities);
  assert.deepEqual(obs.traps[0].vitals, fixture.expected.traps[0].vitals);
});
