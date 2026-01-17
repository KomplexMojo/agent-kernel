const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(ROOT, relativePath), "utf8"));
}

function createStubCore() {
  const state = {
    width: 0,
    height: 0,
    grid: [],
    actor: { x: 0, y: 0, vitals: [] },
  };

  return {
    configureGrid(width, height) {
      state.width = width;
      state.height = height;
      state.grid = Array.from({ length: height }, () => Array.from({ length: width }, () => 1));
      return 0;
    },
    setTileAt(x, y, value) {
      if (state.grid[y]) state.grid[y][x] = value;
    },
    spawnActorAt(x, y) {
      state.actor.x = x;
      state.actor.y = y;
    },
    setActorVital(index, current, max, regen) {
      state.actor.vitals[index] = { current, max, regen };
    },
    getMapWidth() {
      return state.width;
    },
    getMapHeight() {
      return state.height;
    },
  };
}

test("e2e trace wires prompt -> summary -> build -> runtime", async () => {
  const scenario = readJson("tests/fixtures/e2e/e2e-scenario-v1-basic.json");
  const catalog = readJson(scenario.catalogPath);
  const llmFixture = readJson("tests/fixtures/e2e/llm-summary-response.json");
  const summaryFixture = readJson(scenario.summaryPath);

  const { buildMenuPrompt, capturePromptResponse } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );
  const { mapSummaryToPool } = await import(
    moduleUrl("packages/runtime/src/personas/director/pool-mapper.js")
  );
  const { buildBuildSpecFromSummary } = await import(
    moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js")
  );
  const { orchestrateBuild } = await import(
    moduleUrl("packages/runtime/src/build/orchestrate-build.js")
  );
  const { initializeCoreFromArtifacts } = await import(
    moduleUrl("packages/runtime/src/runner/core-setup.mjs")
  );

  const prompt = buildMenuPrompt({ goal: scenario.goal, budgetTokens: scenario.budgetTokens });
  assert.equal(prompt, llmFixture.prompt);

  const capture = capturePromptResponse({ prompt, responseText: llmFixture.responseRaw });
  assert.equal(capture.errors.length, 0);
  assert.ok(capture.summary);
  assert.equal(capture.summary.budgetTokens, scenario.budgetTokens);
  assert.equal(capture.summary.dungeonTheme, summaryFixture.dungeonTheme);

  const mapped = mapSummaryToPool({ summary: capture.summary, catalog });
  assert.equal(mapped.ok, true);
  assert.ok(mapped.selections.length > 0);

  const buildSpecResult = buildBuildSpecFromSummary({
    summary: capture.summary,
    catalog,
    selections: mapped.selections,
    runId: "run_e2e_trace",
    createdAt: "2025-01-01T00:00:00Z",
    source: "integration-test",
  });
  assert.equal(buildSpecResult.ok, true);
  assert.equal(buildSpecResult.spec.schema, "agent-kernel/BuildSpec");
  assert.equal(buildSpecResult.spec.intent.hints.budgetTokens, scenario.budgetTokens);

  const buildResult = await orchestrateBuild({ spec: buildSpecResult.spec, producedBy: "runtime-build" });
  assert.ok(buildResult.simConfig);
  assert.ok(buildResult.initialState);

  const core = createStubCore();
  const runtimeLoad = initializeCoreFromArtifacts(core, {
    simConfig: buildResult.simConfig,
    initialState: buildResult.initialState,
  });
  assert.equal(runtimeLoad.layout.ok, true);
  assert.equal(runtimeLoad.actor.ok, true);

  const trace = {
    budgetTokens: scenario.budgetTokens,
    prompt,
    summary: capture.summary,
    buildSpec: buildSpecResult.spec,
    artifacts: {
      simConfig: buildResult.simConfig,
      initialState: buildResult.initialState,
    },
    runtimeReady: runtimeLoad.layout.ok && runtimeLoad.actor.ok,
  };

  assert.equal(trace.runtimeReady, true);
  assert.equal(core.getMapWidth(), runtimeLoad.layout.dimensions.width);
  assert.equal(core.getMapHeight(), runtimeLoad.layout.dimensions.height);
});

test("e2e trace exercises room layouts for tiered scenario", async () => {
  const scenario = readJson("tests/fixtures/e2e/e2e-scenario-v1-tier3-rooms.json");
  const catalog = readJson(scenario.catalogPath);
  const summaryFixture = readJson(scenario.summaryPath);

  const { normalizeSummary } = await import(
    moduleUrl("packages/runtime/src/personas/orchestrator/prompt-contract.js")
  );
  const { mapSummaryToPool } = await import(
    moduleUrl("packages/runtime/src/personas/director/pool-mapper.js")
  );
  const { buildBuildSpecFromSummary } = await import(
    moduleUrl("packages/runtime/src/personas/director/buildspec-assembler.js")
  );
  const { orchestrateBuild } = await import(
    moduleUrl("packages/runtime/src/build/orchestrate-build.js")
  );

  const normalized = normalizeSummary(summaryFixture);
  assert.equal(normalized.ok, true);

  const mapped = mapSummaryToPool({ summary: normalized.value, catalog });
  assert.equal(mapped.ok, true);

  const buildSpecResult = buildBuildSpecFromSummary({
    summary: normalized.value,
    catalog,
    selections: mapped.selections,
    runId: "run_e2e_rooms",
    createdAt: "2025-01-01T00:00:00Z",
    source: "integration-test",
  });
  assert.equal(buildSpecResult.ok, true);

  const levelGen = buildSpecResult.spec.configurator?.inputs?.levelGen;
  assert.ok(levelGen);
  levelGen.width = scenario.levelSize.width;
  levelGen.height = scenario.levelSize.height;
  levelGen.seed = Number.isInteger(scenario.levelSeed) ? scenario.levelSeed : 0;
  levelGen.shape = {
    profile: scenario.layoutProfile || "rooms",
    roomCount: scenario.roomCount,
  };

  const buildResult = await orchestrateBuild({ spec: buildSpecResult.spec, producedBy: "runtime-build" });
  assert.ok(buildResult.simConfig);

  const layout = buildResult.simConfig.layout?.data || {};
  assert.equal(layout.width, scenario.levelSize.width);
  assert.equal(layout.height, scenario.levelSize.height);
  assert.ok(Array.isArray(layout.rooms));
  assert.ok(layout.rooms.length >= scenario.roomCount);
  assert.ok(layout.connectivity);
  assert.equal(layout.connectivity.rooms, layout.rooms.length);
  assert.equal(layout.connectivity.connectedRooms, layout.rooms.length);
  assert.equal(layout.connectivity.spawnReachable, true);
  assert.equal(layout.connectivity.exitReachable, true);
});
