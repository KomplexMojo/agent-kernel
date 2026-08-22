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
