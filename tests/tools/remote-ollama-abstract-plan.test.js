const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const {
  ABSTRACT_CATALOG_PATH,
  evaluateAbstractPlan,
  loadAbstractPlanCatalog,
  mapAbstractPlanToCreateArgs,
} = require("../../tools/remote-ollama-control/scripts/lib/abstract-plan");
const { loadScenarioCatalog } = require("../../tools/remote-ollama-control/scripts/lib/ak-scenarios");
const {
  comparePairedAttempts,
  validateComparisonMetadata,
} = require("../../tools/remote-ollama-control/scripts/lib/abstract-compare");

const ROOT = resolve(__dirname, "../..");
const REMOTE_CONTROL_ROOT = join(ROOT, "tools/remote-ollama-control");
const MAC_SCRIPT = join(REMOTE_CONTROL_ROOT, "scripts/remote-ollama-mac.js");

test("abstract planning catalog exposes a domain-neutral pilot with hidden mappings", () => {
  const catalog = loadAbstractPlanCatalog();
  const source = readFileSync(ABSTRACT_CATALOG_PATH, "utf8");

  assert.equal(catalog.schemaVersion, "agent-kernel-abstract-plan-catalog/v1");
  assert.equal(catalog.scenarios.length, 1);
  assert.match(source, /"mapping"/);
  assert.doesNotMatch(JSON.stringify(catalog.scenarios[0].problem), /room|hazard|delver|warden|dungeon|affinity/i);
  assert.equal(catalog.sha256.length, 64);
});

test("reference solution satisfies every abstract constraint and is uniquely optimal", () => {
  const scenario = loadAbstractPlanCatalog().scenarios[0];
  const result = evaluateAbstractPlan(scenario, scenario.reference.selections);

  assert.equal(result.score, 100);
  assert.equal(result.feasible, true);
  assert.equal(result.optimal, true);
  assert.equal(result.totalCost, scenario.reference.minimumCost);
  assert.deepEqual(result.breakdown, {
    outputStructure: 10,
    knownComponents: 10,
    quantityBounds: 10,
    categoryQuantities: 20,
    capacityRequirements: 10,
    signalCoverage: 20,
    budgetRespected: 5,
    optimalCost: 15,
  });
});

test("feasible but more expensive selections lose only the optimality score", () => {
  const scenario = loadAbstractPlanCatalog().scenarios[0];
  const selections = scenario.reference.selections.map((selection) => ({ ...selection }));
  const fieldIndex = selections.findIndex((selection) => selection.componentId === "F-01");
  selections[fieldIndex] = { componentId: "F-01X", quantity: 1 };

  const result = evaluateAbstractPlan(scenario, selections);

  assert.equal(result.feasible, true);
  assert.equal(result.optimal, false);
  assert.equal(result.score, 85);
  assert.ok(result.totalCost > scenario.reference.minimumCost);
});

test("deterministic mapping places affinities on hazards and never on rooms", () => {
  const scenario = loadAbstractPlanCatalog().scenarios[0];
  const mapped = mapAbstractPlanToCreateArgs(scenario, scenario.reference.selections, {
    outDir: "/tmp/abstract-plan/create",
    runId: "abstract-plan-test",
  });

  assert.deepEqual(mapped.room, [{ size: "large", count: 3 }]);
  assert.equal(mapped.room.some((room) => Object.hasOwn(room, "affinity")), false);
  assert.equal(mapped.hazard.length, 6);
  assert.equal(mapped.hazard.every((hazard) => typeof hazard.affinity === "string"), true);
  assert.equal(mapped.floorTile[0].count, 48);
  assert.equal(mapped.delver.reduce((sum, actor) => sum + actor.count, 0), 3);
  assert.equal(mapped.warden.reduce((sum, actor) => sum + actor.count, 0), 3);
});

test("mapped reference plan compiles and executes through the production create command", async (context) => {
  const { authoringSpec } = await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  const { buildArgv } = await import("../../packages/adapters-cli/src/mcp/tools/shared.mjs");
  const outputRoot = mkdtempSync(join(tmpdir(), "ak-abstract-plan-exec-"));
  context.onTestFinished(() => rmSync(outputRoot, { recursive: true, force: true }));
  const scenario = loadAbstractPlanCatalog().scenarios[0];
  const outDir = join(outputRoot, "create");
  const mapped = mapAbstractPlanToCreateArgs(scenario, scenario.reference.selections, {
    outDir,
    runId: "abstract-plan-execution-test",
  });
  const cli = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
  const result = spawnSync(process.execPath, [cli, "create", ...buildArgv(mapped, authoringSpec)], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const spec = JSON.parse(readFileSync(join(outDir, "spec.json"), "utf8"));
  const cards = spec.plan.hints.cardSet;
  assert.equal(cards.filter((card) => card.type === "room").length > 0, true);
  assert.equal(cards.filter((card) => card.type === "hazard").every((card) => card.affinity), true);
});

test("abstract-plan dry run reports the pilot without exposing its domain mapping", () => {
  const result = spawnSync(process.execPath, [MAC_SCRIPT, "run-abstract-plan", "--dry-run"], {
    cwd: REMOTE_CONTROL_ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.command, "run-abstract-plan");
  assert.equal(output.scenarios.length, 1);
  assert.deepEqual(output.settings, { contextTokens: 32768, outputTokens: 4096 });
  assert.equal(Object.hasOwn(output.scenarios[0], "mapping"), false);
  assert.equal(Object.hasOwn(output.scenarios[0], "reference"), false);
});

test("parallel abstract catalog aligns one-to-one with all 100 content scenarios", () => {
  const content = loadScenarioCatalog();
  const parallel = loadAbstractPlanCatalog("parallel");

  assert.equal(parallel.scenarios.length, 100);
  assert.deepEqual(parallel.sourceScenarioSet, { count: 100, sha256: content.sha256 });
  assert.deepEqual(
    parallel.scenarios.map((scenario) => scenario.sourceScenario.index),
    content.scenarios.map((scenario) => scenario.index),
  );
  assert.deepEqual(
    parallel.scenarios.map((scenario) => scenario.expectedOutcome),
    content.scenarios.map((scenario) => scenario.expectedOutcome),
  );
  assert.equal(parallel.scenarios.every((scenario) => (
    !/room|hazard|delver|warden|dungeon|affinity/i.test(JSON.stringify(scenario.problem))
    && evaluateAbstractPlan(scenario, scenario.reference.selections).score === 100
  )), true);
});

test("parallel hidden mappings reconstruct every canonical content payload", () => {
  const content = loadScenarioCatalog();
  const parallel = loadAbstractPlanCatalog("parallel");
  const fields = ["room", "floorTile", "hazard", "resource", "delver", "warden"];

  for (const abstractScenario of parallel.scenarios) {
    const source = content.scenarios[abstractScenario.sourceScenario.index - 1];
    const mapped = mapAbstractPlanToCreateArgs(abstractScenario, abstractScenario.reference.selections, {
      outDir: "/tmp/parallel/create",
      runId: `parallel-${source.index}`,
    });
    assert.equal(mapped.text, source.prompt);
    assert.equal(mapped.budgetTokens, source.budgetMode === "constrained" ? source.budget : undefined);
    assert.equal(mapped.dungeonAffinity, source.payload.dungeonAffinity);
    for (const field of fields) assert.deepEqual(mapped[field], source.payload[field] || []);
  }
});

test("parallel abstract catalog rejects a stale content-catalog identity", (context) => {
  const outputRoot = mkdtempSync(join(tmpdir(), "ak-abstract-stale-"));
  context.onTestFinished(() => rmSync(outputRoot, { recursive: true, force: true }));
  const document = JSON.parse(readFileSync(join(
    REMOTE_CONTROL_ROOT, "benchmarks/abstract-plan/parallel.json",
  ), "utf8"));
  document.sourceScenarioSet.sha256 = "0".repeat(64);
  const stalePath = join(outputRoot, "parallel.json");
  writeFileSync(stalePath, `${JSON.stringify(document)}\n`);

  assert.throws(() => loadAbstractPlanCatalog(stalePath), /source scenario set is stale/);
});

test("parallel dry run exposes 100 abstract questions without hidden answers", () => {
  const result = spawnSync(process.execPath, [
    MAC_SCRIPT, "run-abstract-plan", "--abstract-set", "parallel", "--dry-run",
  ], { cwd: REMOTE_CONTROL_ROOT, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.scenarios.length, 100);
  assert.equal(output.scenarioSet.count, 100);
  assert.equal(output.scenarios.every((scenario) => (
    !Object.hasOwn(scenario, "mapping") && !Object.hasOwn(scenario, "reference")
  )), true);
});

test("paired comparison keeps planning, mapping, execution, and latency distinct", () => {
  const content = [
    { profile: "primary", model: "m", scenarioIndex: 1, repeat: 1, scenarioTier: "simple", toolCallProduced: true, execSucceeded: true, scenarioVerdict: { passed: true }, score: 90, llmMs: 100 },
    { profile: "primary", model: "m", scenarioIndex: 2, repeat: 1, scenarioTier: "complex", toolCallProduced: true, execSucceeded: false, scenarioVerdict: { passed: true }, score: 60, llmMs: 200 },
  ];
  const abstract = [
    { profile: "primary", model: "m", scenarioIndex: 1, repeat: 1, scenarioTier: "simple", toolCallProduced: true, planning: { score: 100 }, mappingSucceeded: true, execSucceeded: true, executionVerdictPassed: true, passed: true, llmMs: 50 },
    { profile: "primary", model: "m", scenarioIndex: 2, repeat: 1, scenarioTier: "complex", toolCallProduced: true, planning: { score: 85 }, mappingSucceeded: true, execSucceeded: false, executionVerdictPassed: true, passed: false, llmMs: 150 },
  ];

  const comparison = comparePairedAttempts(content, abstract);

  assert.equal(comparison.pairs, 2);
  assert.equal(comparison.content.averageScore, 75);
  assert.equal(comparison.abstract.averagePlanningScore, 92.5);
  assert.equal(comparison.abstract.planningExact.rate, 0.5);
  assert.equal(comparison.abstract.expectedOutcome.rate, 1);
  assert.equal(comparison.abstract.endToEnd.rate, 0.5);
  assert.equal(comparison.delta.endToEndRate, -0.5);
  assert.equal(comparison.delta.averageLlmMs, -50);
  assert.equal(Object.hasOwn(comparison.delta, "averageQualityScore"), false);
  assert.deepEqual(Object.keys(comparison.byTier), ["simple", "complex"]);
});

test("paired comparison metadata requires the same source catalog and model settings", () => {
  const hash = "a".repeat(64);
  const settings = { contextTokens: 32768, outputTokens: 4096 };
  const content = {
    scenarioSet: { catalogCount: 100, sha256: hash },
    configurations: [{
      profile: { id: "primary" },
      model: { id: "qwen3.5:9b" },
      settings,
    }],
  };
  const abstract = {
    profile: "primary",
    model: "qwen3.5:9b",
    settings,
    sourceScenarioSet: { count: 100, sha256: hash },
  };

  assert.deepEqual(validateComparisonMetadata(content, abstract), {
    profile: "primary",
    model: "qwen3.5:9b",
    settings,
    sourceScenarioSet: { count: 100, sha256: hash },
  });
  assert.throws(() => validateComparisonMetadata(content, {
    ...abstract,
    sourceScenarioSet: { count: 100, sha256: "b".repeat(64) },
  }), /source scenario hash mismatch/);
  assert.throws(() => validateComparisonMetadata(content, {
    ...abstract,
    settings: { contextTokens: 65536, outputTokens: 4096 },
  }), /context\/output settings mismatch/);
});

// ## TODO: Test Permutations
// - reject duplicate component ids and quantities beyond component bounds
// - score missing category quantities, capacities, signals, and budget independently
// - reject mappings that put affinity on a room or omit affinity from a hazard
// - preserve deterministic mapped argument ordering for equivalent selection orderings
// - reject a stale parallel catalog when its source content-catalog hash changes
