const test = require("node:test");
const { runEsm, moduleUrl, ROOT } = require("../helpers/esm-runner");
const { resolve } = require("node:path");

const orchestratorModule = moduleUrl("packages/runtime/src/build/orchestrate-build.js");
const specBasicPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-basic.json");
const specConfiguratorPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json");

const script = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orchestrateBuild } from ${JSON.stringify(orchestratorModule)};

const specBasic = JSON.parse(readFileSync(${JSON.stringify(specBasicPath)}, "utf8"));
const specConfigurator = JSON.parse(readFileSync(${JSON.stringify(specConfiguratorPath)}, "utf8"));

const solverAdapter = {
  async solve(request) {
    return { status: "fulfilled", result: { note: "fixture" } };
  }
};

const resultBasic = await orchestrateBuild({
  spec: specBasic,
  producedBy: "runtime-test",
  solver: { adapter: solverAdapter, scenario: "scenario", options: { kind: "basic" }, clock: () => specBasic.meta.createdAt },
});

assert.equal(resultBasic.intent.schema, "agent-kernel/IntentEnvelope");
assert.equal(resultBasic.plan.schema, "agent-kernel/PlanArtifact");
assert.equal(resultBasic.plan.intentRef.id, resultBasic.intent.meta.id);
assert.equal(resultBasic.solverRequest.schema, "agent-kernel/SolverRequest");
assert.equal(resultBasic.solverResult.schema, "agent-kernel/SolverResult");
assert.equal(resultBasic.solverResult.meta.createdAt, specBasic.meta.createdAt);

const resultConfigurator = await orchestrateBuild({
  spec: specConfigurator,
  producedBy: "runtime-test",
});

assert.equal(resultConfigurator.simConfig.schema, "agent-kernel/SimConfigArtifact");
assert.equal(resultConfigurator.initialState.schema, "agent-kernel/InitialStateArtifact");
`;

test("orchestrateBuild uses runtime modules for solver and configurator", () => {
  runEsm(script);
});
