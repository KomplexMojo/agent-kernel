const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const { loadExecutionCatalog } = require('../../tools/remote-ollama-control/scripts/lib/execution-catalog');
const {
  buildExecutionCommand,
  planExecutionSchedule,
  runExecutionSchedule,
} = require('../../tools/remote-ollama-control/scripts/lib/execution-runner');

const catalog = loadExecutionCatalog();

function passingResult(request) {
  const scenario = catalog.scenarios.find((entry) => entry.id === request.scenarioId);
  const metrics = Object.fromEntries(Object.entries(catalog.contract.metrics).map(([name, contract]) => [name, {
    status: 'available', value: 1, unit: contract.unit, evidence: 'artifact',
  }]));
  return {
    schemaVersion: 'agent-kernel-execution-result/v1',
    identity: {
      executionSuiteHash: catalog.sha256,
      evaluatorVersion: catalog.evaluatorVersion,
      seedSetHash: catalog.seedSetHash,
      tickProfileHash: catalog.tickProfileHash,
    },
    scenario: { id: scenario.id, family: scenario.family, profile: scenario.profile },
    run: { seed: request.seed, repeat: request.repeat, ...(request.variant ? { variant: request.variant } : {}),
      requestedTicks: request.ticks, frameHash: String(request.seed + 1).repeat(64).slice(0, 64) },
    artifactSummary: { frames: request.ticks * 5, actions: 1, effects: 1, fulfilledEffects: 1, bytes: 100,
      worldStateCheckpoints: { expectedTicks: request.checkpoints, loadedTicks: request.checkpoints,
        missingTicks: [], complete: true } },
    metrics,
    invariants: Object.fromEntries(scenario.invariants.map((name) => [name, { status: 'passed' }])),
    requiredGates: scenario.requiredGates.map((gate) => ({ id: gate.id, description: gate.description,
      scope: gate.scope, status: gate.scope === 'seed' ? 'passed' : 'evidence_unavailable' })),
    score: { status: 'scored', value: 80, availableScore: 80, availableWeight: 100, objectives: {} },
    verdict: { status: 'passed', failedInvariants: [], unavailableInvariants: [], failedGates: [], unavailableGates: [] },
  };
}

test('local execution command pins build inputs, seed, ticks, checkpoints, and output identity', () => {
  const command = buildExecutionCommand({
    scenarioId: 'EX-TR-01', stage: 'qualify', seed: 3, repeat: 1, ticks: 50,
    checkpoints: [0, 10, 25, 50], buildDir: '/build', runDir: '/runs/tr-01', cliPath: '/repo/ak.mjs',
  });
  assert.equal(command.command, process.execPath);
  assert.deepEqual(command.args, [
    '/repo/ak.mjs', 'run', '--sim-config', '/build/sim-config.json', '--initial-state', '/build/initial-state.json',
    '--ticks', '50', '--seed', '3', '--run-id', 'execution-EX-TR-01-qualify-s3-r1',
    '--out-dir', '/runs/tr-01', '--world-state-checkpoints', '0,10,25,50',
  ]);
});

test('schedule plan uses one bounded screen then exact declared seed/repeat/variant populations', () => {
  const plan = planExecutionSchedule({ catalog, scenarioIds: ['EX-TR-01', 'EX-CB-02', 'EX-ST-03', 'EX-ST-05'] });
  const traversal = plan.scenarios.find((entry) => entry.scenarioId === 'EX-TR-01');
  assert.deepEqual(traversal.screen.map(({ seed, repeat, ticks }) => ({ seed, repeat, ticks })),
    [{ seed: 0, repeat: 1, ticks: 50 }]);
  assert.equal(traversal.fullStage, 'qualify');
  assert.equal(traversal.full.length, 5);
  const paired = plan.scenarios.find((entry) => entry.scenarioId === 'EX-CB-02');
  assert.equal(paired.purpose, 'qualification');
  assert.equal(paired.screen.length, 2);
  assert.equal(paired.full.length, 10);
  assert.deepEqual([...new Set(paired.full.map((request) => request.variant))], ['neutral', 'advantaged']);
  const stress = plan.scenarios.find((entry) => entry.scenarioId === 'EX-ST-03');
  assert.equal(stress.fullStage, 'stress');
  assert.equal(stress.screen[0].ticks, 50);
  assert.equal(stress.full.length, 3);
  assert.ok(stress.full.every((request) => request.ticks === 250));
  const replay = plan.scenarios.find((entry) => entry.scenarioId === 'EX-ST-05');
  assert.equal(replay.full.length, 10);
  assert.deepEqual([...new Set(replay.full.map((request) => request.repeat))], [1, 2]);
});

test('five-family fixture matrix promotes screens, reuses identical runs, and persists aggregates', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-schedule-'));
  const calls = [];
  const summary = await runExecutionSchedule({
    catalog,
    scenarioIds: ['EX-TR-01', 'EX-CB-01', 'EX-HZ-01', 'EX-RS-04', 'EX-ST-03'],
    outputRoot,
    resolveBuild: ({ scenario, variant }) => join('/fixture-builds', scenario.id, variant || 'default'),
    execute: async (request) => {
      calls.push(request);
      return { status: 'completed', result: passingResult(request), command: { command: 'fixture', args: [] } };
    },
  });
  assert.equal(summary.status, 'completed');
  assert.equal(summary.scenarios.length, 5);
  assert.ok(summary.scenarios.filter((entry) => entry.aggregate?.scenario?.purpose === 'qualification')
    .every((entry) => entry.aggregate.verdict.qualifies));
  assert.ok(summary.scenarios.filter((entry) => entry.aggregate?.scenario?.purpose === 'diagnostic')
    .every((entry) => entry.status === 'diagnostic' && entry.aggregate.verdict.qualifies === false));
  assert.equal(summary.scenarios.find((entry) => entry.scenarioId === 'EX-ST-03').fullStage, 'stress');
  assert.equal(calls.length, 25, 'short-profile seed zero screens are reused as full results');
  const persisted = JSON.parse(readFileSync(join(outputRoot, 'execution-schedule.json'), 'utf8'));
  assert.equal(persisted.scenarios.length, 5);
  assert.equal(persisted.attempts.length, 25);
});

test('failed screen retains evidence and cannot promote', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-screen-fail-'));
  const summary = await runExecutionSchedule({
    catalog, scenarioIds: ['EX-TR-01'], outputRoot,
    resolveBuild: () => '/fixture-build',
    execute: async (request) => ({ status: 'failed', exitCode: 2, stderr: 'fixture crash', request }),
  });
  assert.equal(summary.status, 'failed');
  assert.equal(summary.scenarios[0].promotion.status, 'rejected');
  assert.equal(summary.scenarios[0].attempts.length, 1);
  assert.equal(summary.scenarios[0].attempts[0].stderr, 'fixture crash');
});

test('a diagnostic screen failure remains visible without failing qualification scenarios', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-diagnostic-fail-'));
  const mixedCatalog = structuredClone(catalog);
  mixedCatalog.scenarios.find((scenario) => scenario.id === 'EX-HZ-01').purpose = 'diagnostic';
  const summary = await runExecutionSchedule({
    catalog: mixedCatalog, scenarioIds: ['EX-TR-01', 'EX-HZ-01'], outputRoot,
    resolveBuild: () => '/fixture-build',
    execute: async (request) => request.scenarioId === 'EX-HZ-01'
      ? { status: 'failed', exitCode: 2, stderr: 'diagnostic fixture failure', request }
      : { status: 'completed', result: passingResult(request), command: { command: 'fixture', args: [] } },
  });
  assert.equal(summary.status, 'completed');
  assert.equal(summary.scenarios.find((entry) => entry.scenarioId === 'EX-HZ-01').status, 'failed');
});

test('unavailable observation evidence does not block a structurally valid screen', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-screen-unavailable-'));
  const summary = await runExecutionSchedule({
    catalog, scenarioIds: ['EX-RS-04'], outputRoot,
    resolveBuild: () => '/fixture-build',
    execute: async (request) => {
      const result = passingResult(request);
      if (request.stage === 'screen') {
        result.requiredGates[0].status = 'evidence_unavailable';
        result.verdict = { ...result.verdict, status: 'evidence_unavailable', unavailableGates: [result.requiredGates[0].id] };
      }
      return { status: 'completed', result };
    },
  });
  assert.equal(summary.scenarios[0].promotion.status, 'promoted');
  assert.equal(summary.scenarios[0].aggregate.verdict.status, 'passed');
});

test('executor and build-resolution exceptions become retained infrastructure evidence', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-exception-'));
  const executor = await runExecutionSchedule({
    catalog, scenarioIds: ['EX-TR-01'], outputRoot: join(outputRoot, 'executor'),
    resolveBuild: () => '/fixture-build',
    execute: async () => { throw new Error('executor exploded'); },
  });
  assert.equal(executor.scenarios[0].attempts[0].stderr, 'executor exploded');
  const resolver = await runExecutionSchedule({
    catalog, scenarioIds: ['EX-TR-01'], outputRoot: join(outputRoot, 'resolver'),
    resolveBuild: () => { throw new Error('build missing'); },
  });
  assert.equal(resolver.scenarios[0].attempts[0].stderr, 'build missing');
});

test('definitive full-stage failure stops losslessly and preserves the failing result', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-early-stop-'));
  let calls = 0;
  const summary = await runExecutionSchedule({
    catalog, scenarioIds: ['EX-RS-04'], outputRoot,
    resolveBuild: () => '/fixture-build',
    execute: async (request) => {
      calls += 1;
      const result = passingResult(request);
      if (request.stage === 'qualify') {
        result.requiredGates[0].status = 'failed';
        result.verdict = { ...result.verdict, status: 'failed', failedGates: [result.requiredGates[0].id] };
      }
      return { status: 'completed', result };
    },
  });
  assert.equal(calls, 2, 'one screen and one definitive failing qualification run execute');
  assert.equal(summary.scenarios[0].earlyStop.reason, 'required_gate_failed');
  assert.equal(summary.scenarios[0].attempts.length, 2);
  assert.equal(summary.scenarios[0].aggregate, null);
});

// ## TODO: Test Permutations
// - custom screen horizons retain checkpoint zero even when no later declared checkpoint fits
// - an executor returning malformed result JSON fails before aggregation
