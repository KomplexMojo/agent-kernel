const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const {
  fixtureExecutionArtifacts,
  runCanonicalFixtureValidation,
  runCorpusIntegrationValidation,
} = require('../../tools/remote-ollama-control/scripts/validate-execution-benchmark');

const ROOT = resolve(__dirname, '../..');

test('canonical evaluator witnesses expose qualification readiness without fabricated results', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-validation-test-'));
  const record = await runCanonicalFixtureValidation({ outputRoot });

  assert.equal(record.schemaVersion, 'agent-kernel-execution-validation/v2');
  assert.equal(record.mode, 'deterministic_evaluator_witness');
  assert.equal(record.publication, false);
  assert.deepEqual(record.catalog, { scenarios: 25, families: 5, requiredGates: 70 });
  assert.equal(record.schedule.scenarios.length, 25);
  assert.equal(record.qualification.ready, false);
  assert.equal(record.qualification.scenarios, 25);
  assert.ok(record.qualification.blockedScenarios > 0);
  assert.equal(record.readiness.length, 25);
  assert.ok(record.readiness.every((scenario) => (
    scenario.invariants.length > 0 && scenario.gates.length > 0 && scenario.objectives.length > 0
  )));
  assert.ok(record.readiness.some((scenario) => scenario.invariants.some((entry) => (
    entry.id === 'finite_bounds' && entry.status === 'evidence_unavailable'
  ))));
  assert.ok(record.readiness.some((scenario) => scenario.objectives.some((entry) => (
    entry.evidence === 'observation' && entry.status === 'evidence_unavailable'
  ))));
  assert.ok(record.readiness.some((scenario) => scenario.scopes.some((entry) => (
    entry.scope !== 'seed' && entry.status === 'evidence_unavailable'
  ))));
  assert.deepEqual(record.generatedContentCanaries.map((entry) => entry.profile).sort(), ['dual', 'primary']);
  assert.ok(record.generatedContentCanaries.every((entry) => (
    entry.passed === true && entry.requiredArtifacts.join(',') === 'sim-config.json,initial-state.json'
  )));
  assert.deepEqual(record.limitations, [
    'evaluator witnesses validate evidence reachability, not gameplay quality',
    'no LLM, GPU, remote host, result branch, or timer was used',
  ]);
  assert.doesNotMatch(JSON.stringify(record), /\/private\/|\/var\/folders\/|\/tmp\//);

  const persisted = JSON.parse(readFileSync(join(outputRoot, 'execution-validation.json'), 'utf8'));
  assert.deepEqual(persisted, record);
});

test('validation witness artifacts flow through the real execution evaluator', () => {
  const { evaluateExecutionArtifacts } = require(
    '../../tools/remote-ollama-control/scripts/lib/execution-evaluator',
  );
  const { loadExecutionCatalog } = require(
    '../../tools/remote-ollama-control/scripts/lib/execution-catalog',
  );
  const catalog = loadExecutionCatalog();
  const result = evaluateExecutionArtifacts({
    artifacts: fixtureExecutionArtifacts({ ticks: 4, checkpoints: [] }),
    scenario: 'EX-CB-01',
    catalog,
  });

  assert.equal(result.schemaVersion, 'agent-kernel-execution-result/v1');
  assert.equal(result.identity.executionSuiteHash, catalog.sha256);
  assert.equal(result.invariants.finite_bounds.status, 'evidence_unavailable');
  assert.notEqual(result.metrics.unique_tile_coverage.status, undefined);
});

test('corpus integration binds all committed/generated routes before deterministic scheduling', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-corpus-test-'));
  const record = await runCorpusIntegrationValidation({
    outputRoot,
    sourceWorktree: ROOT,
  });

  assert.equal(record.schemaVersion, 'agent-kernel-execution-corpus-validation/v1');
  assert.equal(record.mode, 'deterministic_fixture_with_corpus_preflight');
  assert.equal(record.corpus.routeKeys, 26);
  assert.equal(record.corpus.runtimeBuilds, 26);
  assert.equal(record.corpus.generatedMappings, 26);
  assert.match(record.corpus.runtimeArtifactSetHash, /^[a-f0-9]{64}$/);
  assert.notEqual(record.fixtureValidation.schedule.status, 'completed');
  assert.equal(record.fixtureValidation.schedule.scenarios.length, 25);
  assert.equal(record.fixtureValidation.qualification.ready, false);
  assert.equal(record.publication, false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(outputRoot, 'corpus-integration-validation.json'), 'utf8')),
    record,
  );
});

test('a complete but semantically misrouted runtime build fails before scheduling', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-corpus-misroute-'));
  const manifest = JSON.parse(readFileSync(join(
    ROOT, 'tools/remote-ollama-control/benchmarks/execution/runtime-build-routes.json',
  ), 'utf8'));
  manifest.routes['EX-TR-01'] = manifest.routes['EX-TR-02'];
  let schedulerCalls = 0;
  await assert.rejects(() => runCorpusIntegrationValidation({
    outputRoot,
    sourceWorktree: ROOT,
    runtimeRouteDocument: manifest,
    runFixtureValidation: async () => { schedulerCalls += 1; },
  }), /mismatched sim-config\.json identity/i);
  assert.equal(schedulerCalls, 0);
});

// ## TODO: Test Permutations
// - a missing generated canary artifact fails the validation before a record is written
// - a newly eligible hardware profile requires its own explicit handoff canary
// - an incomplete declared population cannot be summarized as completed
// - a runtime artifact byte change produces a different runtimeArtifactSetHash
