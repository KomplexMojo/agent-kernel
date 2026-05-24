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
