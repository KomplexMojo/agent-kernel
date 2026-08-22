const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const { loadExecutionCatalog } = require('../../tools/remote-ollama-control/scripts/lib/execution-catalog');
const {
  aggregateExecutionResults,
  assertComparableExecutionResults,
  evaluateGatePredicateForResult,
  evaluateExecutionArtifacts,
  extractExecutionMetrics,
  loadExecutionArtifacts,
  loadWorldStateCheckpoints,
  scoreObjectives,
  validateExecutionResult,
  writeExecutionResult,
} = require('../../tools/remote-ollama-control/scripts/lib/execution-evaluator');

const catalog = loadExecutionCatalog();

function action(actorId, tick, kind, params = {}) {
  return { schema: 'agent-kernel/Action', schemaVersion: 1, actorId, tick, kind, params };
}

function frame(tick, acceptedActions = [], extras = {}) {
  return {
    schema: 'agent-kernel/TickFrame', schemaVersion: 1,
    meta: { id: `frame_${tick}`, runId: 'fixture', createdAt: '2026-01-01T00:00:00.000Z', producedBy: 'moderator' },
    tick, phase: 'execute', phaseDetail: extras.phaseDetail || 'apply', acceptedActions,
    emittedEvents: extras.emittedEvents || [], emittedEffects: extras.emittedEffects || [],
    fulfilledEffects: extras.fulfilledEffects || [], preCoreRejections: extras.preCoreRejections || [],
  };
}

function phaseFrames(tick, acceptedActions = [], extras = {}) {
  return ['observe', 'decide', 'apply', 'emit', 'summarize'].map((phaseDetail) => frame(
    tick,
    phaseDetail === 'apply' ? acceptedActions : [],
    phaseDetail === (extras.phaseDetail || 'emit') ? { ...extras, phaseDetail } : { phaseDetail },
  ));
}

function artifacts(overrides = {}) {
  const tickFrames = [
    ...phaseFrames(1, [action('delver_1', 1, 'move', { to: { x: 2, y: 1 } })]),
    ...phaseFrames(2, [action('delver_1', 2, 'wait')]),
    ...phaseFrames(3, [action('delver_1', 3, 'move', { to: { x: 1, y: 1 } })]),
    ...phaseFrames(4, [action('delver_1', 4, 'move', { to: { x: 2, y: 1 } })]),
  ];
  return {
    simConfig: {
      schema: 'agent-kernel/SimConfigArtifact', schemaVersion: 1,
      layout: { kind: 'grid', data: { width: 4, height: 3, tiles: ['####', '#..#', '####'],
        rooms: [{ id: 'R1', x: 1, y: 1, width: 2, height: 1 }] } },
    },
    initialState: {
      schema: 'agent-kernel/InitialStateArtifact', schemaVersion: 1,
      actors: [{ id: 'delver_1', kind: 'ambulatory', position: { x: 1, y: 1 },
        motivation: { kind: 'exploring' }, vitals: { health: { current: 10, max: 10, regen: 0 } } }],
    },
    tickFrames,
    effectLog: [],
    actionLog: { schema: 'agent-kernel/ActionSequence', schemaVersion: 1, actions: [] },
    runSummary: { schema: 'agent-kernel/RunSummary', schemaVersion: 1, outcome: 'success', metrics: { ticks: 4, frames: 20, effects: 0 } },
    requestedTicks: 4,
    wallTimeMs: 8,
    ...overrides,
  };
}

function scoredResult(scenario, seed, repeat = 1, score = 80, variant) {
  const result = evaluateExecutionArtifacts({ artifacts: artifacts(), scenario, catalog, seed, repeat, variant });
  result.score = { ...result.score, status: 'scored', value: score, availableScore: score, availableWeight: 100 };
  result.verdict = { status: 'passed', failedInvariants: [], unavailableInvariants: [], failedGates: [], unavailableGates: [] };
  return result;
}

test('black-box extractors measure movement, liveness, participation, recurrence, and performance', () => {
  const { metrics, stats } = extractExecutionMetrics(artifacts(), catalog.contract);
  assert.equal(Object.keys(metrics).length, Object.keys(catalog.contract.metrics).length);
  assert.equal(metrics.unique_tile_coverage.value, 1);
  assert.equal(metrics.active_tick_ratio.value, 1);
  assert.equal(metrics.room_coverage.value, 1);
  assert.equal(metrics.patrol_recurrence.value, 1);
  assert.equal(metrics.participation.value, 1);
  assert.equal(metrics.performance.value, 2);
  assert.equal(metrics.first_action_tick.value, 1);
  assert.equal(metrics.accepted_move_count.value, 3);
  assert.equal(metrics.max_progress_stall.value, 1);
  assert.equal(metrics.visited_room_count.value, 1);
  assert.equal(metrics.movement_count.value, 3);
  assert.equal(metrics.decision_count.value, 4);
  assert.equal(metrics.max_actor_starvation.value, 0);
  assert.equal(metrics.persistent_vital_grant.status, 'evidence_unavailable');
  assert.deepEqual(stats.actorActivity.delver_1, { actions: 4, longestGap: 0 });
  assert.deepEqual(stats.interactionClasses, { movement: 3, combat: 0, hazard: 0, resource: 0 });
});

test('artifact invariants fail before scoring and artifact-backed seed gates execute', () => {
  const valid = evaluateExecutionArtifacts({ artifacts: artifacts(), scenario: 'EX-TR-01', catalog });
  assert.deepEqual(valid.verdict.failedInvariants, []);
  assert.ok(valid.requiredGates.every((gate) => gate.status === 'passed'));
  assert.ok(valid.requiredGates.every((gate) => typeof gate.id === 'string'
    && typeof gate.description === 'string' && typeof gate.scope === 'string'));
  assert.deepEqual(valid.artifactSummary.worldStateCheckpoints, {
    expectedTicks: [0, 10, 25, 50], loadedTicks: [], missingTicks: [0, 10, 25, 50], complete: false,
  });

  const brokenFrames = artifacts().tickFrames;
  const brokenApply = brokenFrames.findIndex((entry) => entry.tick === 3 && entry.phaseDetail === 'apply');
  brokenFrames[brokenApply] = frame(2, [action('delver_1', 2, 'move', { to: { x: 99, y: 99 } })]);
  const broken = evaluateExecutionArtifacts({ artifacts: artifacts({ tickFrames: brokenFrames }), scenario: 'EX-TR-01', catalog });
  assert.equal(broken.score.status, 'hard_fail');
  assert.equal(broken.score.value, 0);
  assert.deepEqual(broken.verdict.failedInvariants.sort(), ['actor_legality', 'tick_monotonicity']);
});

test('leaf and composite predicates propagate pass, failure, and unavailable evidence', () => {
  const result = evaluateExecutionArtifacts({ artifacts: artifacts(), scenario: 'EX-TR-01', catalog });
  const passed = { source: 'metric', ref: 'accepted_move_count', operator: 'min', threshold: 1, unit: 'count' };
  const failed = { source: 'metric', ref: 'accepted_move_count', operator: 'min', threshold: 99, unit: 'count' };
  const unavailable = { source: 'metric', ref: 'persistent_vital_grant', operator: 'exact', threshold: 1, unit: 'ratio' };
  assert.equal(evaluateGatePredicateForResult({ operator: 'all', predicates: [passed, failed] }, result).status, 'failed');
  assert.equal(evaluateGatePredicateForResult({ operator: 'any', predicates: [failed, passed] }, result).status, 'passed');
  assert.equal(evaluateGatePredicateForResult({ operator: 'all', predicates: [passed, unavailable] }, result).status,
    'evidence_unavailable');
});

test('phase completeness, participation, stationary fidelity, and reconciliation fail closed', () => {
  const stationaryState = { ...artifacts().initialState, actors: [
    artifacts().initialState.actors[0],
    { id: 'warden_1', kind: 'stationary', position: { x: 1, y: 1 }, motivation: { kind: 'stationary' } },
  ] };
  const tickFrames = artifacts().tickFrames;
  tickFrames.find((entry) => entry.tick === 1 && entry.phaseDetail === 'apply')
    .acceptedActions.push(action('warden_1', 1, 'move', { to: { x: 2, y: 1 } }));
  const result = evaluateExecutionArtifacts({
    artifacts: artifacts({ initialState: stationaryState, tickFrames,
      effectLog: [{}], runSummary: { outcome: 'success', metrics: { ticks: 4, frames: 20, effects: 0 } } }),
    scenario: 'EX-TR-05', catalog,
  });
  assert.ok(result.verdict.failedInvariants.includes('stationary_fidelity'));

  const incomplete = artifacts();
  incomplete.tickFrames.find((entry) => entry.tick === 3 && entry.phaseDetail === 'emit').phase = '';
  const incompleteResult = evaluateExecutionArtifacts({ artifacts: incomplete, scenario: 'EX-TR-01', catalog });
  assert.ok(incompleteResult.verdict.failedInvariants.includes('tick_monotonicity'));
});

test('damage and effect metrics use emitted public facts without reconstructing game rules', () => {
  const attack = action('delver_1', 1, 'attack', { targetId: 'warden_1' });
  const damageEvent = { tick: 1, kind: 'damage_applied', actorId: 'delver_1', data: { targetId: 'warden_1', damage: 3 } };
  const effect = { tick: 1, kind: 'damage', data: { sourceId: 'delver_1', targetId: 'warden_1', damage: 2 } };
  const initialState = { ...artifacts().initialState, actors: [
    artifacts().initialState.actors[0],
    { id: 'warden_1', kind: 'stationary', position: { x: 2, y: 1 }, vitals: { health: { current: 10, max: 10, regen: 0 } } },
  ] };
  const tickFrames = phaseFrames(1, [attack, action('warden_1', 1, 'wait')], {
    emittedEvents: [damageEvent], emittedEffects: [effect],
    fulfilledEffects: [{ effect, status: 'fulfilled', result: { targetId: 'warden_1' } }],
  });
  const { metrics } = extractExecutionMetrics(artifacts({ initialState, tickFrames, requestedTicks: 1,
    runSummary: { outcome: 'success', metrics: { ticks: 1, frames: 5, effects: 1 } } }), catalog.contract);
  assert.equal(metrics.interaction_damage.value, 5);
  assert.equal(metrics.combat_activity.value, 6);
  assert.equal(metrics.target_interaction.value, 1);
  assert.equal(metrics.impact_evidence.value, 2);
});

test('weighted scorer preserves observation gaps and hard thresholds', () => {
  const scenario = catalog.scenarios.find((entry) => entry.id === 'EX-CB-02');
  const metrics = Object.fromEntries(Object.entries(catalog.contract.metrics).map(([name, value]) => [name,
    { status: 'available', value: 1, unit: value.unit, evidence: 'artifact' }]));
  const score = scoreObjectives(scenario, metrics);
  assert.equal(score.status, 'evidence_unavailable');
  assert.equal(score.objectives.affinity_sensitivity.status, 'evidence_unavailable');
  assert.equal(score.objectives.combat_activity.status, 'scored');
});

test('aggregate reports the worst seed and unavailable evidence outranks partial averages', () => {
  const results = [70, 90, 80, 75, 85].map((value, seed) => scoredResult('EX-TR-01', seed, 1, value));
  const aggregate = aggregateExecutionResults(results, catalog.contract);
  assert.deepEqual(aggregate.distribution, { mean: 80, median: 80, minimum: 70, maximum: 90 });
  assert.deepEqual(aggregate.worstSeed, { seed: 0, repeat: 1, score: 70, verdict: 'passed' });
  assert.equal(aggregate.verdict.qualifies, true);
  results[2].score.value = null;
  results[2].verdict.status = 'evidence_unavailable';
  assert.equal(aggregateExecutionResults(results, catalog.contract).verdict.status, 'evidence_unavailable');
});

test('aggregate rate gates require four of five seeds, never three of five', () => {
  const results = [2, 2, 2, 2, 1].map((rooms, seed) => {
    const result = scoredResult('EX-TR-02', seed);
    result.metrics.visited_room_count = { status: 'available', value: rooms, unit: 'count', evidence: 'artifact' };
    return result;
  });
  const passing = aggregateExecutionResults(results, catalog.contract);
  assert.equal(passing.requiredGates.find((gate) => gate.id === 'EX-TR-02-G01').status, 'passed');
  results[3].metrics.visited_room_count.value = 1;
  const failing = aggregateExecutionResults(results, catalog.contract);
  assert.equal(failing.requiredGates.find((gate) => gate.id === 'EX-TR-02-G01').status, 'failed');
  assert.equal(failing.verdict.qualifies, false);
});

test('paired gates require named comparable variants for every seed', () => {
  const results = [];
  for (const seed of [0, 1, 2, 3, 4]) {
    for (const [variant, value] of [['neutral', 0.2], ['advantaged', 0.4]]) {
      const result = scoredResult('EX-CB-02', seed, 1, 80, variant);
      result.metrics.affinity_sensitivity = { status: 'available', value, unit: 'ratio', evidence: 'observation' };
      results.push(result);
    }
  }
  const passing = aggregateExecutionResults(results, catalog.contract);
  assert.equal(passing.requiredGates.find((gate) => gate.id === 'EX-CB-02-G03').status, 'passed');
  const missing = results.filter((result) => !(result.run.seed === 4 && result.run.variant === 'advantaged'));
  const unavailable = aggregateExecutionResults(missing, catalog.contract);
  assert.equal(unavailable.requiredGates.find((gate) => gate.id === 'EX-CB-02-G03').status, 'evidence_unavailable');
  const duplicate = [...results, structuredClone(results[0])];
  assert.equal(aggregateExecutionResults(duplicate, catalog.contract).requiredGates
    .find((gate) => gate.id === 'EX-CB-02-G03').status, 'evidence_unavailable');
  const nonComparable = structuredClone(results);
  nonComparable.find((result) => result.run.seed === 0 && result.run.variant === 'advantaged')
    .metrics.affinity_sensitivity.unit = 'ticks';
  assert.equal(aggregateExecutionResults(nonComparable, catalog.contract).requiredGates
    .find((gate) => gate.id === 'EX-CB-02-G03').status, 'evidence_unavailable');
});

test('replay gates compare repeats within a seed while seed sensitivity compares across seeds', () => {
  const results = [];
  for (const seed of [0, 1, 2, 3, 4]) {
    for (const repeat of [1, 2]) {
      const result = scoredResult('EX-ST-05', seed, repeat);
      result.run.frameHash = String(seed + 1).repeat(64).slice(0, 64);
      results.push(result);
    }
  }
  const passing = aggregateExecutionResults(results, catalog.contract);
  assert.ok(passing.requiredGates.every((gate) => gate.status === 'passed'));
  results.find((result) => result.run.seed === 2 && result.run.repeat === 2).run.frameHash = 'f'.repeat(64);
  const mismatch = aggregateExecutionResults(results, catalog.contract);
  assert.equal(mismatch.requiredGates.find((gate) => gate.id === 'EX-ST-05-G01').status, 'failed');
  results.find((result) => result.run.seed === 2 && result.run.repeat === 2).run.frameHash = '3'.repeat(64);
  const missing = results.filter((result) => !(result.run.seed === 4 && result.run.repeat === 2));
  assert.equal(aggregateExecutionResults(missing, catalog.contract).requiredGates
    .find((gate) => gate.id === 'EX-ST-05-G01').status, 'evidence_unavailable');
});

test('gate descriptions are reporting-only and cannot change verdicts', () => {
  const results = [0, 1, 2, 3, 4].map((seed) => scoredResult('EX-TR-01', seed));
  const original = aggregateExecutionResults(results, catalog.contract);
  const scenario = structuredClone(catalog.scenarios.find((entry) => entry.id === 'EX-TR-01'));
  scenario.requiredGates.forEach((gate) => { gate.description = 'always fail regardless of evidence'; });
  const changed = aggregateExecutionResults(results, catalog.contract, scenario);
  assert.deepEqual(changed.requiredGates.map((gate) => gate.status), original.requiredGates.map((gate) => gate.status));
});

test('loader, atomic writer, and comparison guards preserve result identities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-execution-evaluator-'));
  const value = artifacts();
  for (const [name, file] of Object.entries({
    simConfig: 'sim-config.json', initialState: 'initial-state.json', tickFrames: 'tick-frames.json',
    effectLog: 'effects-log.json', runSummary: 'run-summary.json', actionLog: 'action-log.json',
  })) writeFileSync(join(dir, file), `${JSON.stringify(value[name])}\n`);
  const loaded = loadExecutionArtifacts(dir);
  const result = evaluateExecutionArtifacts({ artifacts: { ...loaded, requestedTicks: 4 }, scenario: 'EX-TR-01', catalog });
  const output = join(dir, 'result.json');
  writeExecutionResult(output, result);
  assert.equal(validateExecutionResult(JSON.parse(readFileSync(output, 'utf8'))).scenario.id, 'EX-TR-01');
  assert.equal(assertComparableExecutionResults(result, structuredClone(result)), true);
  const replay = structuredClone(value.tickFrames);
  replay.forEach((entry) => { entry.meta.runId = 'different-output-run'; entry.meta.createdAt = '2099-01-01T00:00:00.000Z'; });
  const replayResult = evaluateExecutionArtifacts({ artifacts: { ...value, replayTickFrames: replay }, scenario: 'EX-TR-01', catalog });
  assert.equal(replayResult.metrics.determinism.value, 1);
  const changed = structuredClone(result);
  changed.identity.tickProfileHash = '0'.repeat(64);
  assert.throws(() => assertComparableExecutionResults(result, changed), /tickProfileHash/);

  const malformed = structuredClone(result);
  malformed.metrics.unique_tile_coverage.value = Number.NaN;
  assert.throws(() => validateExecutionResult(malformed), /metric unique_tile_coverage/);
  assert.throws(() => validateExecutionResult({ ...result, requiredGates: null }), /requiredGates/);
  assert.throws(() => validateExecutionResult({ ...result, verdict: { ...result.verdict, status: 'maybe' } }), /verdict/);

  const publicFrame = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/artifacts/tick-frame-v1-basic.json'), 'utf8'));
  const publicSummary = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/artifacts/run-summary-v1-basic.json'), 'utf8'));
  assert.doesNotThrow(() => extractExecutionMetrics({ ...loaded, tickFrames: [publicFrame], runSummary: publicSummary }, catalog.contract));
});

test('checkpoint reader consumes only declared WorldStateArtifact ticks and reports gaps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-execution-checkpoints-'));
  const checkpointDir = join(dir, 'world-state-checkpoints');
  mkdirSync(checkpointDir, { recursive: true });
  const checkpoint = (tick) => ({
    schema: 'agent-kernel/WorldStateArtifact',
    schemaVersion: 2,
    meta: { id: `state_${tick}`, runId: 'fixture', createdAt: '2026-01-01T00:00:00.000Z', producedBy: 'annotator' },
    tick,
    dimensions: { width: 4, height: 3 },
    actors: [],
    hazards: [],
    resources: [],
  });
  for (const tick of [0, 2, 99]) {
    writeFileSync(join(checkpointDir, `tick-${String(tick).padStart(6, '0')}.json`), `${JSON.stringify(checkpoint(tick))}\n`);
  }

  const loaded = loadWorldStateCheckpoints(dir, [0, 1, 2]);
  assert.deepEqual(loaded.expectedTicks, [0, 1, 2]);
  assert.deepEqual(loaded.loadedTicks, [0, 2]);
  assert.deepEqual(loaded.missingTicks, [1]);
  assert.deepEqual(loaded.states.map((entry) => entry.tick), [0, 2]);
  assert.equal(loaded.states.some((entry) => entry.tick === 99), false, 'undeclared checkpoint files are ignored');

  writeFileSync(join(checkpointDir, 'tick-000001.json'), `${JSON.stringify(checkpoint(7))}\n`);
  assert.throws(() => loadWorldStateCheckpoints(dir, [1]), /expected tick 1, found 7/);
  writeFileSync(join(checkpointDir, 'tick-000001.json'), '{bad json\n');
  assert.throws(() => loadWorldStateCheckpoints(dir, [1]), /invalid world-state checkpoint JSON/);
});

// ## TODO: Test Permutations
// - malformed artifact JSON and absent required files fail closed
// - an empty actor roster leaves participation evidence unavailable
// - replay normalization ignores generated metadata but not behavioral differences
