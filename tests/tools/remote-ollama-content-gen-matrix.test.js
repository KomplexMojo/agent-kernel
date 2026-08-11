const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  aggregateContentGenResults,
  compareContentResults,
  validateContentResult,
  writeContentResult,
  writeContentSummary,
} = require("../../tools/remote-ollama-control/scripts/lib/ak-compare");
const {
  createFixtureAttemptWriter,
  executeContentGenMatrix,
} = require("../../tools/remote-ollama-control/scripts/lib/ak-matrix");
const { classifyExecutionOutcome } = require("../../tools/remote-ollama-control/scripts/lib/ak-runner");

const SCENARIOS = [
  { index: 1, title: "success", tier: "simple", expectedOutcome: "success" },
  { index: 2, title: "denial", tier: "constrained", expectedOutcome: "budget_denied" },
];
const CONFIGURATIONS = [
  ["cheap-fail", "secondary", "small-a", 1],
  ["cheap-pass", "primary", "small-b", 2],
  ["large-pass", "dual", "large-a", 3],
  ["large-fail", "dual", "large-b", 4],
].map(([configurationId, profile, model, capacityRank]) => ({
  configurationId,
  profile: { id: profile, gpuCount: profile === "dual" ? 2 : 1, capacityRank },
  model: { id: model, parameterBillions: model.startsWith("large") ? 30 : 7 },
  settings: { contextTokens: 8192, outputTokens: 4096 },
  resourceOrder: {
    gpuCount: profile === "dual" ? 2 : 1,
    capacityRank,
    modelSizeBillions: model.startsWith("large") ? 30 : 7,
    contextTokens: 8192,
    outputTokens: 4096,
  },
}));
const MATRIX = {
  sha256: "matrix-hash",
  configurations: CONFIGURATIONS,
  repeatPolicy: { minimumCompletePasses: 1, maximumPasses: 2, earlyStop: "mathematically_lossless" },
};
const SCENARIO_SET = {
  count: 2,
  sha256: "scenario-hash",
  tierCounts: { simple: 1, affinity: 0, complex: 0, constrained: 1 },
};

function fixtureResult({ configuration, scenario }) {
  const passing = configuration.configurationId.endsWith("pass");
  if (!passing) {
    return {
      toolCallProduced: true,
      execSucceeded: false,
      executionOutcome: scenario.index === 1 ? "budget_denied" : "execution_failed",
      score: 20,
      llmMs: 10,
    };
  }
  return {
    toolCallProduced: true,
    execSucceeded: scenario.expectedOutcome === "success",
    executionOutcome: scenario.expectedOutcome,
    score: 80,
    llmMs: 20,
  };
}

test("fixture matrix preserves model/profile groups, denials, early stop, and minimum selection", async () => {
  const fixtureRecords = [];
  const records = await executeContentGenMatrix({
    matrix: MATRIX,
    scenarios: SCENARIOS,
    runAttempt: createFixtureAttemptWriter(fixtureResult, fixtureRecords),
  });

  assert.equal(records.length, 12, "two failing configs stop after one pass; two passing configs run twice");
  assert.equal(new Set(records.map((record) => record.configurationId)).size, 4);
  assert.equal(fixtureRecords.length, records.length);
  const expectedDenial = records.find((record) => (
    record.configurationId === "cheap-pass" && record.scenarioIndex === 2
  ));
  assert.equal(expectedDenial.execSucceeded, false);
  assert.equal(expectedDenial.scenarioVerdict.passed, true);
  assert.equal(records.find((record) => record.configurationId === "cheap-fail").scenarioVerdict.passed, false);
  assert.equal(classifyExecutionOutcome({
    toolCallProduced: true,
    execResult: { succeeded: false, stderr: "Budget denied: requested 200, available 100" },
  }), "budget_denied");

  const result = aggregateContentGenResults([...records, {
    recordKind: "runtime_execution",
    configurationId: "cheap-pass",
    toolCallProduced: false,
    execSucceeded: false,
    score: 0,
  }], {
    matrix: MATRIX,
    scenarioSet: SCENARIO_SET,
    scorerVersion: "fixture-scorer-v1",
  });
  validateContentResult(result);
  assert.equal(result.minimumSuccessfulConfiguration.configurationId, "cheap-pass");
  assert.deepEqual(result.configurations.map((entry) => entry.configurationId), [
    "cheap-fail", "cheap-pass", "large-pass", "large-fail",
  ]);
  const cheapPass = result.configurations[1];
  assert.equal(cheapPass.scenarioVerdict.pass, 4);
  assert.equal(cheapPass.historicalContentGen.execOk.pass, 2);
  assert.equal(cheapPass.historicalContentGen.execOk.total, 4);
  assert.equal(cheapPass.historicalContentGen.avgScore, 80);
  assert.equal(Object.values(cheapPass.perTier).reduce((sum, tier) => sum + tier.attempts, 0), 4);

  const outputDir = mkdtempSync(join(tmpdir(), "ak-matrix-result-"));
  const resultPath = join(outputDir, "result.json");
  const summaryPath = join(outputDir, "summary.md");
  writeContentResult(resultPath, result);
  writeContentSummary(summaryPath, records, {
    profiles: ["secondary", "primary", "dual"], scenarios: 2, route: "fixture", resultDir: outputDir,
  });
  assert.deepEqual(JSON.parse(readFileSync(resultPath, "utf8")), result);
  const summary = readFileSync(summaryPath, "utf8");
  assert.match(summary, /Profile \| Model \| Scenarios \| Runs \| Avg score \| Tool call ok \| Exec ok/);
  assert.match(summary, /primary \| small-b \| 2 \| 4 \| 80 \| 4\/4 \| 2\/4/);
});

test("no qualifying configuration yields null and identity mismatches suppress comparisons", () => {
  const failedRecords = CONFIGURATIONS.map((configuration, index) => ({
    configurationId: configuration.configurationId,
    profile: configuration.profile.id,
    model: configuration.model.id,
    scenarioIndex: 1,
    scenarioTier: "simple",
    repeat: 1,
    toolCallProduced: false,
    execSucceeded: false,
    executionOutcome: "model_failure",
    scenarioVerdict: { passed: false, expected: "success", actual: "model_failure" },
    score: index,
  }));
  const current = aggregateContentGenResults(failedRecords, {
    matrix: MATRIX, scenarioSet: SCENARIO_SET, scorerVersion: "scorer-v2",
  });
  assert.equal(current.minimumSuccessfulConfiguration, null);

  const incompatible = structuredClone(current);
  incompatible.matrix.sha256 = "different-matrix";
  assert.equal(compareContentResults(current, incompatible).comparable, false);

  const oldScorer = structuredClone(current);
  for (const entry of oldScorer.configurations) {
    entry.historicalContentGen.scorerVersion = "scorer-v1";
  }
  const comparison = compareContentResults(current, oldScorer);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.configurations["cheap-fail"].historicalContentGen.comparable, false);
  assert.match(comparison.configurations["cheap-fail"].historicalContentGen.incomparabilityReasons[0], /scorer/);
  assert.equal(current.configurations[0].historicalContentGen.avgScore, 0);
});

// ## TODO: Test Permutations
// - missing attempts inside a completed pass fail the completeness gate
// - a score-only mathematical early stop preserves all completed-pass records
// - equal resource tuples use configuration id as the deterministic final tie-breaker
