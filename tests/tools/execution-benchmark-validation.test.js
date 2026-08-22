const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const {
  probeResourceRuntimeLoading,
  runCanonicalFixtureValidation,
  runCorpusIntegrationValidation,
} = require('../../tools/remote-ollama-control/scripts/validate-execution-benchmark');

const ROOT = resolve(__dirname, '../..');

test('canonical fixture validation covers all scenarios, populations, and generated handoff profiles', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-validation-test-'));
  const record = await runCanonicalFixtureValidation({ outputRoot });

  assert.equal(record.schemaVersion, 'agent-kernel-execution-validation/v1');
  assert.equal(record.mode, 'deterministic_fixture');
  assert.equal(record.publication, false);
  assert.deepEqual(record.catalog, { scenarios: 25, families: 5, requiredGates: 70 });
  assert.equal(record.schedule.status, 'completed');
  assert.equal(record.schedule.scenarios.length, 25);
  assert.ok(record.schedule.scenarios.every((scenario) => (
    scenario.aggregateQualified === true
    && scenario.completedPopulation === scenario.declaredPopulation
  )));
  assert.deepEqual(record.generatedContentCanaries.map((entry) => entry.profile).sort(), ['dual', 'primary']);
  assert.ok(record.generatedContentCanaries.every((entry) => (
    entry.passed === true && entry.requiredArtifacts.join(',') === 'sim-config.json,initial-state.json'
  )));
  assert.deepEqual(record.limitations, [
    'fixture evidence validates orchestration contracts, not gameplay quality',
    'no LLM, GPU, remote host, result branch, or timer was used',
  ]);
  assert.doesNotMatch(JSON.stringify(record), /\/private\/|\/var\/folders\/|\/tmp\//);

  const persisted = JSON.parse(readFileSync(join(outputRoot, 'execution-validation.json'), 'utf8'));
  assert.deepEqual(persisted, record);
});

test('corpus integration binds all committed/generated routes before deterministic scheduling', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-corpus-test-'));
  const record = await runCorpusIntegrationValidation({
    outputRoot,
    sourceWorktree: ROOT,
    probeResourceCapability: async () => ({
      status: 'passed', vitalPlacements: 1, affinityPlacements: 1,
    }),
  });

  assert.equal(record.schemaVersion, 'agent-kernel-execution-corpus-validation/v1');
  assert.equal(record.mode, 'deterministic_fixture_with_corpus_preflight');
  assert.equal(record.corpus.routeKeys, 26);
  assert.equal(record.corpus.runtimeBuilds, 26);
  assert.equal(record.corpus.generatedMappings, 26);
  assert.match(record.corpus.runtimeArtifactSetHash, /^[a-f0-9]{64}$/);
  assert.equal(record.corpus.resourceRuntimeCapability.status, 'passed');
  assert.equal(record.fixtureValidation.schedule.status, 'completed');
  assert.equal(record.fixtureValidation.schedule.scenarios.length, 25);
  assert.equal(record.publication, false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(outputRoot, 'corpus-integration-validation.json'), 'utf8')),
    record,
  );
});

test('missing resource loading fails before deterministic scheduling', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'ak-execution-corpus-blocked-'));
  let schedulerCalls = 0;
  await assert.rejects(() => runCorpusIntegrationValidation({
    outputRoot,
    sourceWorktree: ROOT,
    probeResourceCapability: async () => ({
      status: 'failed', vitalPlacements: 0, affinityPlacements: 0,
    }),
    runFixtureValidation: async () => { schedulerCalls += 1; },
  }), /resource runtime loading capability/i);
  assert.equal(schedulerCalls, 0);
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
    probeResourceCapability: async () => ({
      status: 'passed', vitalPlacements: 1, affinityPlacements: 1,
    }),
    runFixtureValidation: async () => { schedulerCalls += 1; },
  }), /mismatched sim-config\.json identity/i);
  assert.equal(schedulerCalls, 0);
});

test('resource capability probe behaviorally requires vital and affinity placement calls', async () => {
  const sourceWorktree = mkdtempSync(join(tmpdir(), 'ak-resource-loader-probe-'));
  const runnerDir = join(sourceWorktree, 'packages/runtime/src/runner');
  mkdirSync(runnerDir, { recursive: true });
  writeFileSync(join(runnerDir, 'core-setup.mjs'), `
    export function applySimConfigToCore(core, simConfig) {
      for (const resource of simConfig.layout.data.resources) {
        if (resource.affinity) core.placeAffinityResourceAt(resource.position.x, resource.position.y);
        else core.placeResourceAt(resource.position.x, resource.position.y);
      }
      return { ok: true };
    }
  `);
  assert.deepEqual(await probeResourceRuntimeLoading(sourceWorktree), {
    status: 'passed', vitalPlacements: 1, affinityPlacements: 1,
  });

  writeFileSync(join(runnerDir, 'core-setup.mjs'), `
    export function applySimConfigToCore() { return { ok: true }; }
  `);
  assert.deepEqual(await probeResourceRuntimeLoading(sourceWorktree), {
    status: 'failed', vitalPlacements: 0, affinityPlacements: 0,
  });
});

// ## TODO: Test Permutations
// - a missing generated canary artifact fails the validation before a record is written
// - a newly eligible hardware profile requires its own explicit handoff canary
// - an incomplete declared population cannot be summarized as completed
// - a runtime artifact byte change produces a different runtimeArtifactSetHash
