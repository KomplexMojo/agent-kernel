const assert = require("node:assert/strict");

const {
  CollapseError,
  DEFAULT_BREAKER,
  evaluateCollapse,
  resolveBreaker,
} = require("../../tools/remote-ollama-control/scripts/lib/collapse-breaker");
const { executeContentGenMatrix } = require("../../tools/remote-ollama-control/scripts/lib/ak-matrix");

// Attempts carry only the fields the breaker reads, so a shape change upstream fails here loudly
// rather than being silently absorbed by a permissive fixture.
const attempt = (overrides = {}) => ({
  toolCallProduced: true,
  score: 80,
  scenarioVerdict: { passed: true },
  ...overrides,
});
const attempts = (count, overrides) => Array.from({ length: count }, () => attempt(overrides));

test("no trip before the minimum sample, however bad the attempts are", () => {
  const dire = attempts(DEFAULT_BREAKER.minimumAttempts - 1, {
    toolCallProduced: false,
    score: 0,
    scenarioVerdict: { passed: false },
  });
  assert.equal(evaluateCollapse(dire), null);
});

test("a near-zero tool-call rate trips as harness breakage", () => {
  const trip = evaluateCollapse(attempts(20, { toolCallProduced: false, score: 0 }));
  assert.equal(trip.reason, "tool_call_collapse");
  assert.equal(trip.metric, "toolCallRate");
  assert.equal(trip.observed, 0);
  assert.equal(trip.floor, DEFAULT_BREAKER.toolCallFloor);
  assert.equal(trip.attempts, 20);
});

test("the score floor trips only on collapse, never on an ordinary weak result", () => {
  // The matrix models score in the 30s-40s against a 75 qualification bar in normal operation.
  // A run at that level is evidence, not breakage, and must survive.
  assert.equal(evaluateCollapse(attempts(40, { score: 37 })), null);

  const trip = evaluateCollapse(attempts(40, { score: 4 }));
  assert.equal(trip.reason, "score_collapse");
  assert.equal(trip.metric, "averageScore");
  assert.equal(trip.floor, DEFAULT_BREAKER.averageScoreFloor);
});

test("tool-call collapse is reported ahead of score collapse", () => {
  // Both floors are breached; the tool-call signal names the cause far more precisely.
  const trip = evaluateCollapse(attempts(20, { toolCallProduced: false, score: 0 }));
  assert.equal(trip.reason, "tool_call_collapse");
});

test("a trip on the canary model says harness rather than model", () => {
  const records = attempts(20, { toolCallProduced: false, score: 0 });
  const canary = evaluateCollapse(records, { model: DEFAULT_BREAKER.canaryModel });
  const other = evaluateCollapse(records, { model: "qwen3.8:27b" });

  assert.equal(canary.canary, true);
  assert.equal(other.canary, false);
  assert.match(canary.message, /control model/i);
  assert.doesNotMatch(other.message, /control model/i);
});

test("a disabled breaker never trips", () => {
  const breaker = resolveBreaker({ enabled: false });
  assert.equal(evaluateCollapse(attempts(50, { toolCallProduced: false, score: 0 }), { breaker }), null);
});

test("resolveBreaker overrides only what it is given and rejects nonsense floors", () => {
  assert.equal(resolveBreaker({ averageScoreFloor: 10 }).toolCallFloor, DEFAULT_BREAKER.toolCallFloor);
  assert.equal(resolveBreaker({ averageScoreFloor: 10 }).averageScoreFloor, 10);
  assert.throws(() => resolveBreaker({ toolCallFloor: 1.5 }), /toolCallFloor/);
  assert.throws(() => resolveBreaker({ minimumAttempts: 0 }), /minimumAttempts/);
});

test("the breaker aborts a live matrix run and names the configuration it tripped on", async () => {
  const scenarios = Array.from({ length: 25 }, (_, index) => ({
    index: index + 1, title: `s${index + 1}`, tier: "simple", expectedOutcome: "success",
  }));
  const matrix = {
    repeatPolicy: { minimumCompletePasses: 1, maximumPasses: 3, earlyStop: "mathematically_lossless" },
    configurations: [
      {
        configurationId: "cg-broken",
        profile: { id: "primary", hardwareClass: "single-primary", gpuCount: 1, capacityRank: 2 },
        model: { id: "qwen3.5:9b", family: "qwen3.5", parameterBillions: 9.7 },
        settings: { contextTokens: 32768, outputTokens: 4096 },
      },
      {
        configurationId: "cg-expensive",
        profile: { id: "dual", hardwareClass: "dual", gpuCount: 2, capacityRank: 3 },
        model: { id: "qwen3.8:27b", family: "qwen3.8", parameterBillions: 27 },
        settings: { contextTokens: 65536, outputTokens: 32768 },
      },
    ],
  };

  const seen = [];
  const error = await executeContentGenMatrix({
    matrix,
    scenarios,
    runAttempt: async ({ configuration }) => {
      seen.push(configuration.configurationId);
      return { toolCallProduced: false, score: 0, execSucceeded: false, executionOutcome: "execution_failed" };
    },
  }).then(() => null, (caught) => caught);

  assert.ok(error instanceof CollapseError, "expected the run to abort with a CollapseError");
  assert.equal(error.trip.reason, "tool_call_collapse");
  assert.equal(error.trip.configurationId, "cg-broken");
  assert.equal(error.trip.canary, true);
  // The expensive dual configuration is exactly what the breaker exists to protect.
  assert.ok(!seen.includes("cg-expensive"), "aborted before spending GPU time on the dual configuration");
  assert.equal(seen.length, DEFAULT_BREAKER.minimumAttempts);
});

test("a healthy run is untouched by the breaker", async () => {
  const scenarios = Array.from({ length: 25 }, (_, index) => ({
    index: index + 1, title: `s${index + 1}`, tier: "simple", expectedOutcome: "success",
  }));
  const matrix = {
    repeatPolicy: { minimumCompletePasses: 1, maximumPasses: 1, earlyStop: "mathematically_lossless" },
    configurations: [{
      configurationId: "cg-ok",
      profile: { id: "primary", hardwareClass: "single-primary", gpuCount: 1, capacityRank: 2 },
      model: { id: "qwen3.8:27b", family: "qwen3.8", parameterBillions: 27 },
      settings: { contextTokens: 32768, outputTokens: 4096 },
    }],
  };

  const records = await executeContentGenMatrix({
    matrix,
    scenarios,
    runAttempt: async () => ({ toolCallProduced: true, score: 80, execSucceeded: true, executionOutcome: "success" }),
  });
  assert.equal(records.length, 25);
});
