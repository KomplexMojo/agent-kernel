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

const defenderGroupingScript = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { orchestrateBuild } from ${JSON.stringify(orchestratorModule)};
import { buildBuildSpecFromSummary } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js"))};
import { mapSummaryToPool } from ${JSON.stringify(moduleUrl("packages/runtime/src/personas/director/pool-mapper.js"))};

const ROOT = ${JSON.stringify(ROOT)};
const catalog = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/pool/catalog-basic.json"), "utf8"));

const summary = {
  dungeonAffinity: "fire",
  budgetTokens: 1400,
  layout: { wallTiles: 80, floorTiles: 240, hallwayTiles: 80 },
  roomDesign: {
    profile: "rooms",
    rooms: [
      { id: "R1", size: "large", width: 10, height: 10 },
      { id: "R2", size: "medium", width: 8, height: 8 },
      { id: "R3", size: "small", width: 5, height: 5 }
    ],
    connections: [
      { from: "R1", to: "R2", type: "hallway" },
      { from: "R2", to: "R3", type: "hallway" }
    ]
  },
  rooms: [{ motivation: "stationary", affinity: "fire", count: 1, tokenHint: 200 }],
  actors: [
    { motivation: "attacking", affinity: "fire", count: 2, tokenHint: 200 },
    { motivation: "defending", affinity: "earth", count: 4, tokenHint: 120 },
    { motivation: "patrolling", affinity: "wind", count: 2, tokenHint: 80 }
  ]
};

const mapped = mapSummaryToPool({ summary, catalog });
assert.equal(mapped.ok, true);

const buildSpecResult = buildBuildSpecFromSummary({
  summary,
  catalog,
  selections: mapped.selections,
  runId: "run_grouping_check",
  createdAt: "2025-01-01T00:00:00Z",
  source: "runtime-test",
});
assert.equal(buildSpecResult.ok, true);

const buildResult = await orchestrateBuild({ spec: buildSpecResult.spec, producedBy: "runtime-test" });
const actors = buildResult.spec.configurator.inputs.actors;
assert.equal(actors.length, 8);

const tiles = buildResult.simConfig.layout.data.tiles;
const positionKeys = new Set();
actors.forEach((actor) => {
  const key = \`\${actor.position.x},\${actor.position.y}\`;
  assert.equal(positionKeys.has(key), false);
  positionKeys.add(key);
  const row = String(tiles[actor.position.y] ?? "");
  const cell = row[actor.position.x];
  assert.ok(cell && cell !== "#" && cell !== "B");
});

const power = (actor) => {
  if (Number.isInteger(actor.tokenCost) && actor.tokenCost > 0) return actor.tokenCost;
  const match = String(actor.id || "").match(/_(\\d+)_(\\d+)$/);
  return match ? Number(match[1]) : 1;
};
const sortedByPower = actors
  .slice()
  .sort((a, b) => (power(b) - power(a)) || String(a.id).localeCompare(String(b.id)));
const leaders = sortedByPower.slice(0, 2);
assert.equal(power(leaders[0]), 200);
assert.equal(power(leaders[1]), 200);

const distance = (a, b) => Math.abs(a.position.x - b.position.x) + Math.abs(a.position.y - b.position.y);
assert.ok(distance(leaders[0], leaders[1]) >= 6);

leaders.forEach((leader) => {
  const nearbySupports = actors.filter((actor) => (
    actor.id !== leader.id
    && power(actor) < power(leader)
    && distance(actor, leader) <= 3
  ));
  assert.ok(nearbySupports.length >= 2, \`leader \${leader.id} should have nearby lower-cost defenders\`);
});
`;

test("orchestrateBuild uses runtime modules for solver and configurator", () => {
  runEsm(script);
});

test("orchestrateBuild aligns actors to walkable layout positions", () => {
  runEsm(actorPlacementScript);
});

test("orchestrateBuild clusters high-cost defenders with lower-cost nearby supports", () => {
  runEsm(defenderGroupingScript);
});
