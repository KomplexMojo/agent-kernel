const test = require("node:test");
const { runEsm, moduleUrl, ROOT } = require("../helpers/esm-runner");
const { resolve } = require("node:path");

const orchestratorModule = moduleUrl("packages/runtime/src/build/orchestrate-build.js");
const specBasicPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-basic.json");
const specConfiguratorPath = resolve(ROOT, "tests/fixtures/artifacts/build-spec-v1-configurator.json");
const scenarioPath = resolve(ROOT, "tests/fixtures/e2e/e2e-scenario-v1-basic.json");

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

const actorPlacementScript = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { orchestrateBuild } from ${JSON.stringify(orchestratorModule)};
import { buildBuildSpecFromSummary } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js"))};
import { mapSummaryToPool } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/director/pool-mapper.js"))};
import { normalizeSummary } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js"))};

const ROOT = ${JSON.stringify(ROOT)};
const scenario = JSON.parse(readFileSync(${JSON.stringify(scenarioPath)}, "utf8"));
const summary = JSON.parse(readFileSync(resolve(ROOT, scenario.summaryPath), "utf8"));
const catalog = JSON.parse(readFileSync(resolve(ROOT, scenario.catalogPath), "utf8"));

const normalized = normalizeSummary(summary);
assert.equal(normalized.ok, true);

const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
assert.equal(mapped.ok, true);

const result = buildBuildSpecFromSummary({
  summary: normalized.value,
  catalog,
  selections: mapped.selections,
  runId: "run_spawn_check",
  createdAt: "2025-01-01T00:00:00Z",
  source: "runtime-test",
});
assert.equal(result.ok, true);

const buildResult = await orchestrateBuild({ spec: result.spec, producedBy: "runtime-test" });
const spawn = buildResult.simConfig.layout.data.spawn;
const tiles = buildResult.simConfig.layout.data.tiles;
assert.ok(spawn);

const actors = buildResult.initialState.actors;
assert.ok(actors.length > 0);
assert.deepEqual(actors[0].position, spawn);

const used = new Set();
actors.forEach((actor) => {
  const { x, y } = actor.position;
  const row = String(tiles[y] ?? "");
  const char = row[x];
  assert.ok(char && char !== "#" && char !== "B");
  const key = \`\${x},\${y}\`;
  assert.equal(used.has(key), false);
  used.add(key);
});
`;

test("orchestrateBuild uses runtime modules for solver and configurator", () => {
  runEsm(script);
});

test("orchestrateBuild aligns actors to walkable layout positions", () => {
  runEsm(actorPlacementScript);
});
