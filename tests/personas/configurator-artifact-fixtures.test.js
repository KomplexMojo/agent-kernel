const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

const simConfig = readFixture("sim-config-artifact-v1-configurator-trap.json");
const initialState = readFixture("initial-state-artifact-v1-configurator-affinity.json");

test("configurator artifact fixtures include traps and affinity traits", () => {
  assert.equal(simConfig.schema, "agent-kernel/SimConfigArtifact");
  assert.equal(simConfig.schemaVersion, 1);
  assert.equal(simConfig.layout.kind, "grid");
  assert.equal(simConfig.layout.data.traps.length, 1);
  assert.deepEqual(simConfig.layout.data.traps[0].affinity, {
    kind: "fire",
    expression: "push",
    stacks: 2,
  });
  assert.equal(simConfig.layout.data.kinds[2][2], 2);

  assert.equal(initialState.schema, "agent-kernel/InitialStateArtifact");
  assert.equal(initialState.schemaVersion, 1);
  const actorMvp = initialState.actors.find((actor) => actor.id === "actor_mvp");
  assert.deepEqual(actorMvp.traits.affinities, { "fire:push": 2, "life:pull": 1 });
  assert.equal(actorMvp.traits.abilities.length, 2);
});
