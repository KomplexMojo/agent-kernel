const assert = require("node:assert/strict");
const { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  EXECUTION_CATALOG_DIR,
  loadExecutionCatalog,
} = require("../../tools/remote-ollama-control/scripts/lib/execution-catalog");

const FAMILIES = ["traversal", "combat", "hazards", "resources", "stress"];

function copyCatalog() {
  const dir = mkdtempSync(join(tmpdir(), "ak-execution-catalog-"));
  for (const file of ["contract.json", ...FAMILIES.map((family) => `${family}.json`)]) {
    cpSync(join(EXECUTION_CATALOG_DIR, file), join(dir, file));
  }
  return dir;
}

function mutateCatalog(file, mutator) {
  const dir = copyCatalog();
  const target = join(dir, file);
  const document = JSON.parse(readFileSync(target, "utf8"));
  mutator(document);
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  return dir;
}

test("execution benchmark catalog defines 25 balanced scored archetypes", () => {
  const catalog = loadExecutionCatalog();
  assert.equal(catalog.schemaVersion, "agent-kernel-execution-catalog/v1");
  assert.equal(catalog.evaluatorVersion, "execution-evaluator-v1");
  assert.equal(catalog.count, 25);
  assert.deepEqual(catalog.familyCounts, {
    traversal: 5, combat: 5, hazards: 5, resources: 5, stress: 5,
  });
  assert.match(catalog.sha256, /^[a-f0-9]{64}$/);
  assert.match(catalog.seedSetHash, /^[a-f0-9]{64}$/);
  assert.match(catalog.tickProfileHash, /^[a-f0-9]{64}$/);
  assert.equal(new Set(catalog.scenarios.map((scenario) => scenario.id)).size, 25);
  for (const scenario of catalog.scenarios) {
    assert.equal(Object.values(scenario.objectives).reduce((sum, objective) => sum + objective.weight, 0), 100);
    assert.ok(scenario.invariants.length > 0);
    assert.ok(scenario.requiredGates.length > 0);
  }
});

test("same semantic execution catalog has stable identity across object key order", () => {
  const baseline = loadExecutionCatalog();
  const dir = copyCatalog();
  const file = join(dir, "traversal.json");
  const document = JSON.parse(readFileSync(file, "utf8"));
  document.scenarios[0].objectives = Object.fromEntries(Object.entries(document.scenarios[0].objectives).reverse());
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
  assert.equal(loadExecutionCatalog(dir).sha256, baseline.sha256);
  rmSync(dir, { recursive: true, force: true });
});

test("execution catalog rejects unknown metrics, invariants, and invalid weight totals", () => {
  const unknownMetric = mutateCatalog("traversal.json", (document) => {
    document.scenarios[0].objectives.fake_metric = { weight: 1, evidence: "artifact" };
    document.scenarios[0].objectives.unique_tile_coverage.weight -= 1;
  });
  assert.throws(() => loadExecutionCatalog(unknownMetric), /unknown metric: fake_metric/);

  const unknownInvariant = mutateCatalog("combat.json", (document) => {
    document.scenarios[0].invariants.push("invented_invariant");
  });
  assert.throws(() => loadExecutionCatalog(unknownInvariant), /unknown invariant: invented_invariant/);

  const badWeights = mutateCatalog("hazards.json", (document) => {
    document.scenarios[0].objectives.trigger_correctness.weight = 39;
  });
  assert.throws(() => loadExecutionCatalog(badWeights), /objective weights must total 100/);

  for (const dir of [unknownMetric, unknownInvariant, badWeights]) rmSync(dir, { recursive: true, force: true });
});

test("execution catalog rejects implicit family, undeclared profile, and incomplete count", () => {
  const wrongFamily = mutateCatalog("resources.json", (document) => { document.scenarios[0].family = "stress"; });
  assert.throws(() => loadExecutionCatalog(wrongFamily), /implicit or mismatched family/);

  const badProfile = mutateCatalog("stress.json", (document) => { document.scenarios[0].profile = "infinite_v1"; });
  assert.throws(() => loadExecutionCatalog(badProfile), /unknown profile: infinite_v1/);

  const incomplete = mutateCatalog("traversal.json", (document) => { document.scenarios.pop(); });
  assert.throws(() => loadExecutionCatalog(incomplete), /expected 5 scenarios/);

  for (const dir of [wrongFamily, badProfile, incomplete]) rmSync(dir, { recursive: true, force: true });
});

test("execution catalog rejects duplicate ids, invalid checkpoints, and mismatched units", () => {
  const duplicate = mutateCatalog("combat.json", (document) => { document.scenarios[0].id = "EX-TR-01"; });
  assert.throws(() => loadExecutionCatalog(duplicate), /duplicate or invalid scenario id/);

  const invalidCheckpoint = mutateCatalog("contract.json", (document) => {
    document.profiles.short_v1.checkpoints.push(51);
  });
  assert.throws(() => loadExecutionCatalog(invalidCheckpoint), /checkpoints invalid/);

  const mismatchedUnit = mutateCatalog("hazards.json", (document) => {
    document.scenarios[0].thresholds.trigger_correctness.unit = "ticks";
  });
  assert.throws(() => loadExecutionCatalog(mismatchedUnit), /unit must match metric contract/);

  for (const dir of [duplicate, invalidCheckpoint, mismatchedUnit]) rmSync(dir, { recursive: true, force: true });
});

// ## TODO: Test Permutations
// - qualification scores or rates outside their bounded domains fail closed
// - duplicate seeds and checkpoints fail closed
// - range thresholds require exactly two endpoint values
