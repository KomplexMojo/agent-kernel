const assert = require('node:assert/strict');

const { summarizeProgress } = require('../../tools/remote-ollama-control/scripts/lib/benchmark-progress');

const START = '2026-08-23T00:00:00.000Z';
const HOUR_MS = 60 * 60 * 1000;

const MATRIX = {
  sha256: 'matrix-hash',
  repeatPolicy: { minimumCompletePasses: 1, maximumPasses: 3, earlyStop: 'mathematically_lossless' },
  configurations: [
    {
      configurationId: 'cheap',
      profile: { id: 'primary' },
      model: { id: 'qwen3.5:9b' },
    },
    {
      configurationId: 'large',
      profile: { id: 'dual' },
      model: { id: 'qwen3.8:27b' },
    },
  ],
};

function attempt(configurationId, overrides = {}) {
  return {
    recordKind: 'content_gen_attempt',
    configurationId,
    model: configurationId === 'cheap' ? 'qwen3.5:9b' : 'qwen3.8:27b',
    profile: configurationId === 'cheap' ? 'primary' : 'dual',
    scenarioIndex: 1,
    scenarioTier: 'simple',
    toolCallProduced: true,
    execSucceeded: true,
    score: 80,
    scoreMax: 100,
    llmMs: 40000,
    execMs: 2000,
    executionOutcome: 'success',
    failureClass: null,
    scenarioVerdict: { passed: true, expected: 'success', actual: 'success' },
    ...overrides,
  };
}

function summarize(records, { elapsedHours = 1, scenarioCount = 10 } = {}) {
  return summarizeProgress(records, {
    matrix: MATRIX,
    scenarioCount,
    startedAt: START,
    now: Date.parse(START) + elapsedHours * HOUR_MS,
  });
}

test('bounds are a range, because early stop means recorded attempts do not predict the remainder', () => {
  const progress = summarize([attempt('cheap')]);
  // 10 scenarios x 2 configurations = 20 at one pass each; x3 passes = 60.
  assert.equal(progress.attempts.floor, 20);
  assert.equal(progress.attempts.ceiling, 60);
  assert.equal(progress.attempts.recorded, 1);
});

test('an empty run reports zero rates rather than dividing by zero', () => {
  const progress = summarize([]);
  assert.equal(progress.attempts.recorded, 0);
  assert.equal(progress.overall.toolCallRate, 0);
  assert.equal(progress.overall.averageScore, 0);
  assert.equal(progress.configurations.length, 2);
  for (const configuration of progress.configurations) assert.equal(configuration.attempts, 0);
});

test('quality is reported per configuration, because collapse and early stop are per configuration', () => {
  const progress = summarize([
    attempt('cheap', { score: 90 }),
    attempt('cheap', { score: 70 }),
    attempt('large', { score: 10, toolCallProduced: false, scenarioVerdict: { passed: false } }),
  ]);
  const cheap = progress.configurations.find((entry) => entry.configurationId === 'cheap');
  const large = progress.configurations.find((entry) => entry.configurationId === 'large');
  assert.equal(cheap.attempts, 2);
  assert.equal(cheap.averageScore, 80);
  assert.equal(cheap.toolCallRate, 1);
  assert.equal(large.averageScore, 10);
  assert.equal(large.toolCallRate, 0);
  assert.equal(large.scenarioVerdictRate, 0);
});

test('overall quality is measured against the qualification bars', () => {
  const progress = summarize([attempt('cheap', { score: 80 })]);
  assert.equal(progress.overall.meets.averageScore, true);
  assert.equal(progress.overall.meets.toolCallRate, true);
  const weak = summarize([attempt('cheap', { score: 40 })]);
  assert.equal(weak.overall.meets.averageScore, false);
});

// The single highest-value interim signal: a configuration that cannot reach the bar even if every
// remaining attempt is perfect. Reported, never acted on -- early stop is the runner's decision.
test('a configuration that can no longer qualify is surfaced', () => {
  const doomed = Array.from({ length: 10 }, () => attempt('cheap', {
    score: 0, toolCallProduced: false, scenarioVerdict: { passed: false },
  }));
  const progress = summarize(doomed, { scenarioCount: 10 });
  const cheap = progress.configurations.find((entry) => entry.configurationId === 'cheap');
  assert.equal(cheap.canStillQualify, false);
  assert.ok(
    progress.alerts.some((alert) => /cheap/.test(alert) && /qualify/i.test(alert)),
    `expected a qualification alert naming the configuration, got ${JSON.stringify(progress.alerts)}`,
  );
});

// Distance to the collapse floors is the difference between "this model is weak" (a finding) and
// "the rig is broken" (an abort). A human watching a multi-day run needs the margin, not just the trip.
test('collapse margins are reported before the breaker trips', () => {
  const records = Array.from({ length: 25 }, () => attempt('cheap', {
    score: 30, toolCallProduced: true,
  }));
  const progress = summarize(records);
  const cheap = progress.configurations.find((entry) => entry.configurationId === 'cheap');
  assert.equal(cheap.collapse.armed, true, 'past minimumAttempts the breaker is live');
  // averageScore 30 against a floor of 25 leaves 5 points of headroom.
  assert.equal(cheap.collapse.scoreMargin, 5);
  assert.ok(cheap.collapse.toolCallMargin > 0);
});

test('the collapse breaker is not armed below its minimum sample', () => {
  const progress = summarize([attempt('cheap', { score: 1 })]);
  const cheap = progress.configurations.find((entry) => entry.configurationId === 'cheap');
  assert.equal(cheap.collapse.armed, false);
});

test('an infrastructure failure is surfaced as an alert', () => {
  const progress = summarize([attempt('large', {
    failureClass: 'infrastructure', executionOutcome: 'infrastructure_error', llmError: 'connection reset',
  })]);
  assert.ok(
    progress.alerts.some((alert) => /infrastructure/i.test(alert)),
    `expected an infrastructure alert, got ${JSON.stringify(progress.alerts)}`,
  );
});

test('throughput and elapsed come from the injected clock, never a read one', () => {
  const progress = summarize([attempt('cheap'), attempt('cheap')], { elapsedHours: 2 });
  assert.equal(progress.elapsedMs, 2 * HOUR_MS);
  assert.equal(progress.performance.attemptsPerHour, 1);
});

test('the eta is a range and widens with the remaining ceiling', () => {
  const progress = summarize([attempt('cheap'), attempt('cheap')], { elapsedHours: 2, scenarioCount: 10 });
  // 1 attempt/hour observed; 18 outstanding at the floor, 58 at the ceiling.
  assert.equal(progress.performance.etaFloorMs, 18 * HOUR_MS);
  assert.equal(progress.performance.etaCeilingMs, 58 * HOUR_MS);
});

test('no eta is claimed before any attempt has completed', () => {
  const progress = summarize([]);
  assert.equal(progress.performance.etaFloorMs, null);
  assert.equal(progress.performance.etaCeilingMs, null);
});

test('the summary is serializable, since it crosses a process and a git branch', () => {
  const progress = summarize([attempt('cheap')]);
  assert.deepEqual(JSON.parse(JSON.stringify(progress)), progress);
  assert.equal(progress.schemaVersion, 'agent-kernel-benchmark-progress/v1');
});

// ## TODO: Test Permutations
// - median llmMs with an even and an odd number of records
// - a record whose configurationId is absent from the matrix
// - scenarioCount of 0
// - mixed tiers, asserting the tier breakdown
// - a configuration where every attempt is an infrastructure failure
