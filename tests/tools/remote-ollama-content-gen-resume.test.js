const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  assertResumable,
  readCompletedRunIds,
  readPriorRecords,
  writeRunManifest,
  readRunManifest,
} = require("../../tools/remote-ollama-control/scripts/lib/content-gen-checkpoint");
const { executeContentGenMatrix } = require("../../tools/remote-ollama-control/scripts/lib/ak-matrix");

const MATRIX = {
  sha256: "matrix-hash",
  repeatPolicy: { minimumCompletePasses: 1, maximumPasses: 2, earlyStop: "mathematically_lossless" },
  configurations: [
    {
      configurationId: "cfg-a",
      profile: { id: "primary", hardwareClass: "single", gpuCount: 1, capacityRank: 1 },
      model: { id: "model-a", family: "a", parameterBillions: 7 },
      settings: { contextTokens: 4096, outputTokens: 1024 },
      resourceOrder: { gpuCount: 1, capacityRank: 1, modelSizeBillions: 7, contextTokens: 4096, outputTokens: 1024 },
    },
  ],
};
const SCENARIOS = [
  { index: 1, title: "one", tier: "simple", expectedOutcome: "success" },
  { index: 2, title: "two", tier: "simple", expectedOutcome: "success" },
];
const IDENTITY = {
  scenarioSet: { count: 100, sha256: "catalog-hash", tierCounts: { simple: 25 } },
  matrix: { sha256: "matrix-hash", maximumPasses: 2, configurationIds: ["cfg-a"] },
  scenarioIds: [1, 2],
};

function passingAttempt() {
  return {
    toolCallProduced: true,
    execSucceeded: true,
    score: 100,
    executionOutcome: "success",
    failureClass: null,
  };
}

test("a completed attempt is not run again, and still counts toward the result", async () => {
  const prior = [{
    recordKind: "content_gen_attempt",
    runId: "cg--cfg-a--s001--r1",
    configurationId: "cfg-a",
    scenarioIndex: 1,
    scenarioTier: "simple",
    repeat: 1,
    ...passingAttempt(),
    scenarioVerdict: { passed: true, expected: "success", actual: "success" },
  }];
  const attempted = [];
  const announced = [];
  const records = await executeContentGenMatrix({
    matrix: MATRIX,
    scenarios: SCENARIOS,
    priorRecords: prior,
    runAttempt: async ({ runId }) => {
      attempted.push(runId);
      return passingAttempt();
    },
    onRecord: async (record) => { announced.push(record.runId); },
  });

  assert.ok(!attempted.includes("cg--cfg-a--s001--r1"), "the completed attempt was run a second time");
  assert.equal(attempted.length, 3, "the three outstanding attempts should run");
  assert.ok(!announced.includes("cg--cfg-a--s001--r1"), "a skipped attempt must not be written again");
  assert.equal(records.length, 4, "the returned set must cover the whole run, prior work included");
  assert.equal(records[0].runId, "cg--cfg-a--s001--r1", "prior records come first, in order");
});

test("early stop reads prior records, so a doomed configuration stops without re-running it", async () => {
  const prior = [1, 2].map((index) => ({
    recordKind: "content_gen_attempt",
    runId: `cg--cfg-a--s00${index}--r1`,
    configurationId: "cfg-a",
    scenarioIndex: index,
    scenarioTier: "simple",
    repeat: 1,
    toolCallProduced: true,
    execSucceeded: false,
    score: 0,
    executionOutcome: "execution_failed",
    failureClass: null,
    scenarioVerdict: { passed: false, expected: "success", actual: "execution_failed" },
  }));
  const attempted = [];
  await executeContentGenMatrix({
    matrix: MATRIX,
    scenarios: SCENARIOS,
    priorRecords: prior,
    runAttempt: async ({ runId }) => {
      attempted.push(runId);
      return passingAttempt();
    },
  });
  assert.deepEqual(attempted, [], "a configuration already past saving must not burn a second pass");
});

test("resume refuses evidence that cannot be merged", () => {
  const dir = mkdtempSync(join(tmpdir(), "cg-resume-"));
  writeRunManifest(dir, { route: "internal", ...IDENTITY });
  const manifest = readRunManifest(dir);
  assert.equal(manifest.scenarioSet.sha256, "catalog-hash");

  assert.doesNotThrow(() => assertResumable(manifest, IDENTITY));
  assert.throws(
    () => assertResumable(manifest, { ...IDENTITY, scenarioSet: { ...IDENTITY.scenarioSet, sha256: "other" } }),
    /scenario catalog/i,
    "a different catalog must not merge into an existing run",
  );
  assert.throws(
    () => assertResumable(manifest, { ...IDENTITY, matrix: { ...IDENTITY.matrix, sha256: "other" } }),
    /matrix/i,
    "a different matrix must not merge into an existing run",
  );
  assert.throws(
    () => assertResumable(manifest, { ...IDENTITY, scenarioIds: [1, 2, 3] }),
    /scenario/i,
    "resuming must not silently widen the scenario set",
  );
});

test("a run killed mid-write resumes from its last intact record", () => {
  const dir = mkdtempSync(join(tmpdir(), "cg-resume-"));
  const path = join(dir, "runs.jsonl");
  writeFileSync(path, [
    JSON.stringify({ runId: "cg--cfg-a--s001--r1", configurationId: "cfg-a", score: 100 }),
    JSON.stringify({ runId: "cg--cfg-a--s002--r1", configurationId: "cfg-a", score: 90 }),
    '{"runId":"cg--cfg-a--s003--r1","configu',   // the process died here
  ].join("\n"));

  assert.deepEqual(
    [...readCompletedRunIds(path)],
    ["cg--cfg-a--s001--r1", "cg--cfg-a--s002--r1"],
    "a torn final line is not a completed attempt",
  );
  assert.equal(readPriorRecords(path).length, 2);
});

test("a configuration with nothing left to run does not pay for a profile reset", async () => {
  // Resume reset the remote profile and loaded a 7B model for a configuration whose 31 attempts
  // were all already recorded, then ran nothing — minutes of model load per finished configuration.
  // Setup must be demanded by an attempt, not by reaching the configuration in the loop.
  // The real shape: every scenario has a repeat-1 record and they failed, so early stop ends the
  // configuration immediately. maximumPasses is the default 2, so a naive "have I recorded
  // scenarios x maximumPasses attempts?" guard does not fire — which is exactly what happened.
  const prior = SCENARIOS.map((scenario) => ({
    recordKind: "content_gen_attempt",
    runId: `cg--cfg-a--s00${scenario.index}--r1`,
    configurationId: "cfg-a",
    scenarioIndex: scenario.index,
    scenarioTier: "simple",
    repeat: 1,
    toolCallProduced: true,
    execSucceeded: false,
    score: 0,
    executionOutcome: "execution_failed",
    failureClass: null,
    scenarioVerdict: { passed: false, expected: "success", actual: "execution_failed" },
  }));
  const prepared = [];
  await executeContentGenMatrix({
    matrix: MATRIX,
    scenarios: SCENARIOS,
    priorRecords: prior,
    beforeConfiguration: async (configuration) => { prepared.push(configuration.configurationId); },
    runAttempt: async () => passingAttempt(),
  });
  assert.deepEqual(prepared, [], "no attempt remained, so nothing should have been prepared");
});

test("setup still runs exactly once for a configuration that has work left", async () => {
  const prior = [{
    recordKind: "content_gen_attempt",
    runId: "cg--cfg-a--s001--r1",
    configurationId: "cfg-a",
    scenarioIndex: 1,
    scenarioTier: "simple",
    repeat: 1,
    ...passingAttempt(),
    scenarioVerdict: { passed: true, expected: "success", actual: "success" },
  }];
  const prepared = [];
  await executeContentGenMatrix({
    matrix: MATRIX,
    scenarios: SCENARIOS,
    priorRecords: prior,
    beforeConfiguration: async (configuration) => { prepared.push(configuration.configurationId); },
    runAttempt: async () => passingAttempt(),
  });
  assert.deepEqual(prepared, ["cfg-a"], "setup must happen once, before the first attempt that needs it");
});

test("a diagnostic run keeps every pass, because early stop would delete the repeats it needs", async () => {
  // An adversarial subset cannot qualify by construction — the first miss makes the 99% gates
  // arithmetically unreachable — so early stop ends every configuration after one pass. That is
  // correct for qualification and useless for diagnosis, where the repeats ARE the measurement.
  const failing = SCENARIOS.map((scenario) => ({
    recordKind: "content_gen_attempt",
    runId: `cg--cfg-a--s00${scenario.index}--r1`,
    configurationId: "cfg-a",
    scenarioIndex: scenario.index,
    scenarioTier: "simple",
    repeat: 1,
    toolCallProduced: true,
    execSucceeded: false,
    score: 0,
    executionOutcome: "execution_failed",
    failureClass: null,
    scenarioVerdict: { passed: false, expected: "success", actual: "execution_failed" },
  }));
  const attempted = [];
  await executeContentGenMatrix({
    matrix: MATRIX,
    scenarios: SCENARIOS,
    priorRecords: failing,
    stopWhenHopeless: false,
    runAttempt: async ({ runId }) => {
      attempted.push(runId);
      return { toolCallProduced: true, execSucceeded: false, score: 0, executionOutcome: "execution_failed", failureClass: null };
    },
  });
  assert.deepEqual(attempted, ["cg--cfg-a--s001--r2", "cg--cfg-a--s002--r2"],
    "pass 2 must still run when early stop is disabled");
});

test("a diagnostic run says so in its manifest, so it cannot be quoted as qualification later", () => {
  const dir = mkdtempSync(join(tmpdir(), "cg-diag-"));
  writeRunManifest(dir, { route: "internal", diagnostic: true, ...IDENTITY });
  assert.equal(readRunManifest(dir).diagnostic, true);
  writeRunManifest(dir, { route: "internal", ...IDENTITY });
  assert.equal(readRunManifest(dir).diagnostic, false, "a normal run must record diagnostic:false, not undefined");
});
