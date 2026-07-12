const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/configurator-artifacts-v1-basic.json"), "utf8"));

test("configurator artifact builders produce deterministic artifacts", async () => {const { buildSimConfigArtifact, buildInitialStateArtifact } = await import("../../packages/runtime/src/personas/configurator/artifact-builders.js");

assert.equal(fixture.schema, "agent-kernel/ConfiguratorArtifactsFixture");
assert.equal(fixture.schemaVersion, 1);

const simConfig = buildSimConfigArtifact(fixture.input.simConfig);
const initialState = buildInitialStateArtifact(fixture.input.initialState);
assert.deepEqual({ simConfig, initialState }, fixture.expected);

const second = {
  simConfig: buildSimConfigArtifact(fixture.input.simConfig),
  initialState: buildInitialStateArtifact(fixture.input.initialState),
};
assert.deepEqual(second, fixture.expected);
});

test("initial-state builder rejects duplicate actor ids before emitting an artifact", async () => {
  const { buildInitialStateArtifact } = await import("../../packages/runtime/src/personas/configurator/artifact-builders.js");
  const actor = {
    id: "actor_duplicate",
    kind: "ambulatory",
    position: { x: 1, y: 1 },
  };

  assert.throws(
    () => buildInitialStateArtifact({ actors: [actor, { ...actor, position: { x: 2, y: 1 } }] }),
    /duplicate_actor_id: actor_duplicate/,
  );
});

// ## TODO: Test Permutations
// - duplicate IDs in unsorted input should report the duplicated value deterministically
// - resolved effects containing duplicate actor references should not hide duplicate actor inputs
