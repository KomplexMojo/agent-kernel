const assert = require("node:assert/strict");
const { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  EXECUTION_CATALOG_DIR,
  loadExecutionCatalog,
} = require("../../tools/remote-ollama-control/scripts/lib/execution-catalog");

const FAMILIES = ["traversal", "combat", "hazards", "resources", "stress"];

function collectPredicateLeaves(predicate) {
  if (["all", "any"].includes(predicate.operator)) {
    return predicate.predicates.flatMap(collectPredicateLeaves);
  }
  return [predicate];
}

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
  assert.equal(catalog.evaluatorVersion, "execution-evaluator-v2");
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

test("execution benchmark gates have stable identities and closed executable predicates", () => {
  const catalog = loadExecutionCatalog();
  const gates = catalog.scenarios.flatMap((scenario) => scenario.requiredGates);
  assert.equal(gates.length, 70);
  assert.equal(new Set(gates.map((gate) => gate.id)).size, 70);
  for (const scenario of catalog.scenarios) {
    for (const gate of scenario.requiredGates) {
      assert.match(gate.id, new RegExp(`^${scenario.id}-G\\d{2}$`));
      assert.ok(gate.description.length > 0);
      assert.ok(["seed", "aggregate", "paired_variant", "replay"].includes(gate.scope));
      assert.ok(["artifact", "observation"].includes(gate.evidence));
      assert.ok(collectPredicateLeaves(gate.predicate).length > 0);
    }
  }
});

test("execution gate populations encode probabilistic, paired, and replay semantics", () => {
  const catalog = loadExecutionCatalog();
  const byId = new Map(catalog.scenarios.map((scenario) => [scenario.id, scenario]));
  const fourOfFive = byId.get("EX-TR-02").requiredGates[0];
  assert.equal(fourOfFive.scope, "aggregate");
  assert.equal(fourOfFive.predicate.operator, "rate");
  assert.equal(fourOfFive.predicate.denominator, "seeds");
  assert.equal(3 / 5 >= fourOfFive.predicate.threshold, false);
  assert.equal(4 / 5 >= fourOfFive.predicate.threshold, true);

  const paired = byId.get("EX-CB-02").requiredGates[2];
  assert.equal(paired.scope, "paired_variant");
  assert.equal(paired.predicate.operator, "changed_in_direction");
  assert.equal(paired.predicate.baselineVariant, "neutral");
  assert.equal(paired.predicate.candidateVariant, "advantaged");

  const replay = byId.get("EX-ST-05").requiredGates[0];
  assert.equal(replay.scope, "replay");
  assert.equal(byId.get("EX-ST-05").profile, "replay_v1");
  assert.equal(catalog.contract.profiles.replay_v1.repeats, 2);
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

test("execution catalog gate predicates fail closed on unknown references and malformed thresholds", () => {
  const unknownMetric = mutateCatalog("traversal.json", (document) => {
    document.scenarios[0].requiredGates[0].predicate.ref = "invented_metric";
  });
  assert.throws(() => loadExecutionCatalog(unknownMetric), /unknown gate metric: invented_metric/);

  const missingThreshold = mutateCatalog("combat.json", (document) => {
    delete document.scenarios[0].requiredGates[0].predicate.threshold;
  });
  assert.throws(() => loadExecutionCatalog(missingThreshold), /threshold required/);

  const wrongUnit = mutateCatalog("hazards.json", (document) => {
    document.scenarios[1].requiredGates[1].predicate.predicates[1].unit = "ticks";
  });
  assert.throws(() => loadExecutionCatalog(wrongUnit), /gate metric .* unit must match metric contract/);

  const unknownInvariant = mutateCatalog("stress.json", (document) => {
    document.scenarios[0].requiredGates[2].predicate.predicates[0].ref = "invented_invariant";
  });
  assert.throws(() => loadExecutionCatalog(unknownInvariant), /unknown gate invariant: invented_invariant/);

  for (const dir of [unknownMetric, missingThreshold, wrongUnit, unknownInvariant]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("execution catalog gate scopes reject impossible population semantics", () => {
  const seedRate = mutateCatalog("traversal.json", (document) => {
    document.scenarios[1].requiredGates[0].scope = "seed";
  });
  assert.throws(() => loadExecutionCatalog(seedRate), /rate operator requires aggregate scope/);

  const unpairedDirection = mutateCatalog("combat.json", (document) => {
    document.scenarios[1].requiredGates[2].scope = "aggregate";
  });
  assert.throws(() => loadExecutionCatalog(unpairedDirection), /changed_in_direction operator requires paired_variant scope/);

  const unnamedPair = mutateCatalog("combat.json", (document) => {
    delete document.scenarios[1].requiredGates[2].predicate.candidateVariant;
  });
  assert.throws(() => loadExecutionCatalog(unnamedPair), /paired variant names required/);

  const unrepeatedReplay = mutateCatalog("combat.json", (document) => {
    document.scenarios[0].requiredGates[0].scope = "replay";
  });
  assert.throws(() => loadExecutionCatalog(unrepeatedReplay), /replay scope requires a profile with at least two repeats/);

  for (const dir of [seedRate, unpairedDirection, unnamedPair, unrepeatedReplay]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ## TODO: Test Permutations
// - qualification scores or rates outside their bounded domains fail closed
// - duplicate seeds and checkpoints fail closed
// - range thresholds require exactly two endpoint values
