const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/configurator-artifacts-v1-basic.json"), "utf8"));
const builderModule = moduleUrl("packages/runtime/src/personas/configurator/artifact-builders.js");

test("configurator artifact builders produce deterministic artifacts", () => {
  const script = `
import assert from "node:assert/strict";
import { buildSimConfigArtifact, buildInitialStateArtifact } from ${JSON.stringify(builderModule)};

const fixture = ${JSON.stringify(fixture)};
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
`;
  runEsm(script);
});
