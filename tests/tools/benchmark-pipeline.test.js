const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const { runBenchmarkAgent } = require('../../tools/remote-ollama-control/scripts/benchmark-agent');
const {
  pipelineComponents,
  runBenchmarkPipeline,
  validateRouteManifestDocument,
} = require('../../tools/remote-ollama-control/scripts/lib/benchmark-pipeline');
const { loadExecutionCatalog } = require('../../tools/remote-ollama-control/scripts/lib/execution-catalog');
const { planExecutionSchedule } = require('../../tools/remote-ollama-control/scripts/lib/execution-runner');
const { loadTriggerPolicy } = require('../../tools/remote-ollama-control/scripts/lib/benchmark-trigger');

const TOOL_ROOT = resolve(__dirname, '../../tools/remote-ollama-control');
const POLICY = loadTriggerPolicy(TOOL_ROOT);
const CATALOG = loadExecutionCatalog();

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function setupRepository() {
  const root = mkdtempSync(join(tmpdir(), 'ak-benchmark-pipeline-'));
  const remote = join(root, 'remote.git');
  const operator = join(root, 'operator');
  git(root, ['init', '--bare', remote]);
  git(root, ['clone', remote, operator]);
  git(operator, ['config', 'user.email', 'benchmark@example.invalid']);
  git(operator, ['config', 'user.name', 'Benchmark Fixture']);
  writeFileSync(join(operator, 'README.md'), 'source\n');
  git(operator, ['add', 'README.md']);
  git(operator, ['commit', '-m', 'initial']);
  git(operator, ['branch', '-M', 'main']);
  git(operator, ['push', '-u', 'origin', 'main']);
  return { root, remote, operator };
}

function routeKeys() {
  const plan = planExecutionSchedule({ catalog: CATALOG });
  return plan.scenarios.flatMap((scenario) => scenario.screen.map((request) => (
    request.variant ? `${scenario.scenarioId}#${request.variant}` : scenario.scenarioId
  )));
}

function buildFixture(root) {
  const sourceWorktree = join(root, 'source-worktree');
  const runtimeBuild = join(sourceWorktree, 'fixture-build');
  mkdirSync(runtimeBuild, { recursive: true });
  for (const name of ['sim-config.json', 'initial-state.json']) writeFileSync(join(runtimeBuild, name), '{}\n');
  const configurations = [
    { configurationId: 'cheap', rank: 1 },
    { configurationId: 'large', rank: 2 },
  ];
  const records = [];
  for (const configuration of configurations) {
    const outDir = join(root, 'authoring', configuration.configurationId, 'create');
    mkdirSync(outDir, { recursive: true });
    for (const name of ['sim-config.json', 'initial-state.json']) writeFileSync(join(outDir, name), '{}\n');
    records.push({
      recordKind: 'content_gen_attempt', configurationId: configuration.configurationId,
      scenarioIndex: 1, repeat: 1, execSucceeded: true, scenarioVerdict: { passed: true }, outDir,
    });
  }
  const authoringResult = {
    schemaVersion: 'agent-kernel-content-gen-result/v1',
    scenarioSet: { count: 1, sha256: 'scenario-a', tierCounts: { simple: 1 } },
    matrix: { sha256: 'matrix-a', configurationIds: configurations.map((entry) => entry.configurationId),
      repeatPolicy: { maximumPasses: 1 } },
    thresholds: {},
    configurations: configurations.map((configuration) => ({
      configurationId: configuration.configurationId,
      resourceOrder: { gpuCount: 1, capacityRank: configuration.rank, modelSizeBillions: configuration.rank,
        contextTokens: 8192, outputTokens: 4096 },
      verdict: { qualifies: true, failedGates: [] },
    })),
    minimumSuccessfulConfiguration: { configurationId: 'cheap' },
    paretoFrontier: ['cheap'],
  };
  const keys = routeKeys();
  return {
    sourceWorktree,
    authoringEvidence: { result: authoringResult, records },
    runtimeRoutes: Object.fromEntries(keys.map((key) => [key, 'fixture-build'])),
    generatedRoutes: Object.fromEntries(keys.map((key) => [key, { scenarioIndex: 1, repeat: 1 }])),
  };
}

function scalarValue(predicate, variant) {
  if (predicate.operator === 'changed_in_direction') {
    const baseline = predicate.threshold === 'increase' ? 0 : 1;
    const candidate = predicate.threshold === 'increase' ? 1 : 0;
    return variant === predicate.candidateVariant ? candidate : baseline;
  }
  if (predicate.operator === 'rate') return scalarValue(predicate.condition, variant);
  if (predicate.operator === 'range') return predicate.threshold[0];
  return ['min', 'max', 'exact'].includes(predicate.operator) ? predicate.threshold : 1;
}

function fixtureExecutionResult(request) {
  const scenario = CATALOG.scenarios.find((entry) => entry.id === request.scenarioId);
  const metrics = Object.fromEntries(Object.entries(CATALOG.contract.metrics).map(([name, contract]) => [name, {
    status: 'available', value: 1, unit: contract.unit, evidence: 'artifact',
  }]));
  const apply = (predicate) => {
    if (['all', 'any'].includes(predicate.operator)) return predicate.predicates.forEach(apply);
    if (predicate.source === 'metric' && predicate.ref !== 'seed_sensitivity' && metrics[predicate.ref]) {
      metrics[predicate.ref].value = scalarValue(predicate, request.variant);
    }
    return undefined;
  };
  scenario.requiredGates.forEach((gate) => apply(gate.predicate));
  return {
    schemaVersion: 'agent-kernel-execution-result/v1',
    identity: { executionSuiteHash: CATALOG.sha256, evaluatorVersion: CATALOG.evaluatorVersion,
      seedSetHash: CATALOG.seedSetHash, tickProfileHash: CATALOG.tickProfileHash },
    scenario: { id: scenario.id, family: scenario.family, profile: scenario.profile },
    run: { seed: request.seed, repeat: request.repeat, ...(request.variant ? { variant: request.variant } : {}),
      requestedTicks: request.ticks,
      frameHash: crypto.createHash('sha256').update(`${request.scenarioId}:${request.seed}`).digest('hex') },
    artifactSummary: { frames: request.ticks, actions: 1, effects: 1, fulfilledEffects: 1, bytes: 1,
      worldStateCheckpoints: { expectedTicks: request.checkpoints, loadedTicks: request.checkpoints,
        missingTicks: [], complete: true } },
    metrics,
    invariants: Object.fromEntries(scenario.invariants.map((name) => [name, { status: 'passed' }])),
    requiredGates: scenario.requiredGates.map((gate) => ({ id: gate.id, description: gate.description,
      scope: gate.scope, status: gate.scope === 'seed' ? 'passed' : 'evidence_unavailable' })),
    score: { status: 'scored', value: 80, availableScore: 80, availableWeight: 100, objectives: {} },
    verdict: { status: 'passed', failedInvariants: [], unavailableInvariants: [], failedGates: [],
      unavailableGates: [] },
  };
}

function executionAdapter(request) {
  const result = fixtureExecutionResult(request);
  if (request.buildDir.includes(`${join('', 'cheap')}`)) {
    result.requiredGates[0].status = 'failed';
    result.verdict = { ...result.verdict, status: 'failed', failedGates: [result.requiredGates[0].id] };
  }
  return Promise.resolve({ status: 'completed', result, command: { command: 'fixture', args: [] } });
}

function pipelineOptions(fixture, stateDir, runKey, trigger, runAuthoring) {
  return {
    catalog: CATALOG,
    sourceWorktree: fixture.sourceWorktree,
    stateDir,
    runKey,
    trigger,
    scenarioSetHash: 'scenario-a',
    matrixHash: 'matrix-a',
    executionSuiteHash: CATALOG.sha256,
    runAuthoring,
    runtimeRoutes: fixture.runtimeRoutes,
    generatedRoutes: fixture.generatedRoutes,
    executeExecution: executionAdapter,
  };
}

test('installed agent composes authoring/runtime/generated evidence into a compact publishable minimum', async () => {
  const repo = setupRepository();
  const fixture = buildFixture(repo.root);
  const stateDir = join(repo.root, 'state');
  let authoringCalls = 0;
  const result = await runBenchmarkAgent({
    sourceRepo: repo.remote,
    sourceRef: 'main',
    resultsRemote: repo.remote,
    resultBranch: 'benchmark-results',
    stateDir,
    policy: POLICY,
    scenarioSetHash: 'scenario-a',
    matrixHash: 'matrix-a',
    executionSuiteHash: CATALOG.sha256,
    prepareSource: async () => ({ worktreePath: fixture.sourceWorktree,
      preflight: { status: 'passed', retentionId: 'preflights/fixture' }, cleanup() {} }),
    runBenchmark: (context) => runBenchmarkPipeline(pipelineOptions(
      fixture, stateDir, context.runKey, context.trigger,
      async () => { authoringCalls += 1; return fixture.authoringEvidence; },
    )),
  });
  assert.equal(result.status, 'published');
  assert.equal(result.record.run.status, 'completed');
  assert.equal(result.record.qualifies, true);
  assert.equal(result.record.minimumSuccessfulConfiguration.configurationId, 'large');
  assert.equal(authoringCalls, 1);
  assert.equal(result.record.execution.runtime.status, 'completed');
  assert.equal(result.record.execution.generatedByConfiguration.cheap.status, 'failed');
  assert.equal(result.record.execution.generatedByConfiguration.large.status, 'completed');
  assert.doesNotMatch(JSON.stringify(result.record), new RegExp(repo.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(existsSync(join(stateDir, 'runs', result.record.run.key, 'pipeline-result.json')), true);
});

test('runtime-only pipeline reuses retained authoring without inference and reruns generated execution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ak-benchmark-runtime-only-'));
  const fixture = buildFixture(root);
  const stateDir = join(root, 'state');
  await runBenchmarkPipeline(pipelineOptions(fixture, stateDir, 'a'.repeat(64), {
    modes: { authoring: true, runtimeExecution: true, generatedExecution: true },
  }, async () => fixture.authoringEvidence));
  let authoringCalls = 0;
  const runtimeOnly = await runBenchmarkPipeline(pipelineOptions(fixture, stateDir, 'b'.repeat(64), {
    modes: { authoring: false, runtimeExecution: true, generatedExecution: true },
  }, async () => { authoringCalls += 1; throw new Error('LLM must not run'); }));
  assert.equal(authoringCalls, 0);
  assert.equal(runtimeOnly.minimumSuccessfulConfiguration.configurationId, 'large');
  assert.equal(runtimeOnly.execution.generatedByConfiguration.large.status, 'completed');
});

test('missing cached runtime evidence and missing explicit generated routes fail closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ak-benchmark-pipeline-missing-'));
  const fixture = buildFixture(root);
  const stateDir = join(root, 'state');
  await assert.rejects(() => runBenchmarkPipeline(pipelineOptions(fixture, stateDir, 'c'.repeat(64), {
    modes: { authoring: true, runtimeExecution: false, generatedExecution: true },
  }, async () => fixture.authoringEvidence)), /retained runtime execution evidence/i);

  const missingRoute = { ...fixture, generatedRoutes: { ...fixture.generatedRoutes } };
  delete missingRoute.generatedRoutes['EX-TR-01'];
  let authoringCalls = 0;
  await assert.rejects(() => runBenchmarkPipeline(pipelineOptions(
    missingRoute, join(root, 'second-state'), 'd'.repeat(64), {
    modes: { authoring: true, runtimeExecution: true, generatedExecution: true },
  }, async () => { authoringCalls += 1; return missingRoute.authoringEvidence; })), /route coverage mismatch/i);
  assert.equal(authoringCalls, 0, 'route validation must precede authoring');
});

test('versioned route manifests bind exact identities and cover every scenario variant', () => {
  const root = mkdtempSync(join(tmpdir(), 'ak-benchmark-route-contract-'));
  const fixture = buildFixture(root);
  const components = pipelineComponents(fixture.sourceWorktree, CATALOG);
  assert.deepEqual(validateRouteManifestDocument({
    schemaVersion: 'agent-kernel-runtime-build-routes/v1',
    identity: { executionSuiteHash: CATALOG.sha256 },
    routes: fixture.runtimeRoutes,
  }, { kind: 'runtime', components, catalog: CATALOG, sourceWorktree: fixture.sourceWorktree,
    scenarioSetHash: 'scenario-a' }), fixture.runtimeRoutes);
  assert.deepEqual(validateRouteManifestDocument({
    schemaVersion: 'agent-kernel-generated-content-routes/v1',
    identity: { executionSuiteHash: CATALOG.sha256, scenarioSetHash: 'scenario-a' },
    routes: fixture.generatedRoutes,
  }, { kind: 'generated', components, catalog: CATALOG, sourceWorktree: fixture.sourceWorktree,
    scenarioSetHash: 'scenario-a' }), fixture.generatedRoutes);
  assert.throws(() => validateRouteManifestDocument({
    schemaVersion: 'agent-kernel-generated-content-routes/v1',
    identity: { executionSuiteHash: CATALOG.sha256, scenarioSetHash: 'stale' },
    routes: fixture.generatedRoutes,
  }, { kind: 'generated', components, catalog: CATALOG, sourceWorktree: fixture.sourceWorktree,
    scenarioSetHash: 'scenario-a' }), /scenario-set identity mismatch/i);

  const externalBuild = join(root, 'outside-build');
  mkdirSync(externalBuild);
  for (const name of ['sim-config.json', 'initial-state.json']) writeFileSync(join(externalBuild, name), '{}\n');
  symlinkSync(externalBuild, join(fixture.sourceWorktree, 'escaped-build'));
  const escapedRoutes = Object.fromEntries(Object.keys(fixture.runtimeRoutes)
    .map((key) => [key, 'escaped-build']));
  assert.throws(() => validateRouteManifestDocument({
    schemaVersion: 'agent-kernel-runtime-build-routes/v1',
    identity: { executionSuiteHash: CATALOG.sha256 },
    routes: escapedRoutes,
  }, { kind: 'runtime', components, catalog: CATALOG, sourceWorktree: fixture.sourceWorktree,
    scenarioSetHash: 'scenario-a' }), /source-owned build/i);
});

test('production pipeline components are loaded from the pinned source worktree', () => {
  const sourceWorktree = mkdtempSync(join(tmpdir(), 'ak-benchmark-source-components-'));
  const libRoot = join(sourceWorktree, 'tools', 'remote-ollama-control', 'scripts', 'lib');
  mkdirSync(libRoot, { recursive: true });
  writeFileSync(join(libRoot, 'execution-catalog.js'),
    "exports.loadExecutionCatalog = () => ({ sha256: 'source-catalog' });\n");
  writeFileSync(join(libRoot, 'execution-integration.js'), [
    "exports.combineBenchmarkQualification = function sourceCombine() {};",
    "exports.createGeneratedBuildResolver = function sourceResolver() {};",
    '',
  ].join('\n'));
  writeFileSync(join(libRoot, 'execution-runner.js'), [
    "exports.executeLocalRun = function sourceExecute() {};",
    "exports.planExecutionSchedule = function sourcePlan() { return { scenarios: [] }; };",
    "exports.runExecutionSchedule = function sourceSchedule() {};",
    '',
  ].join('\n'));
  writeFileSync(join(libRoot, 'ak-compare.js'),
    "exports.validateContentResult = function sourceValidate() {};\n");
  writeFileSync(join(libRoot, 'ak-scenarios.js'),
    "exports.loadScenarioCatalog = () => ({ sha256: 'source-content', scenarios: [] });\n");

  const components = pipelineComponents(sourceWorktree);
  assert.equal(components.catalog.sha256, 'source-catalog');
  assert.equal(components.combineBenchmarkQualification.name, 'sourceCombine');
  assert.equal(components.runExecutionSchedule.name, 'sourceSchedule');
  assert.equal(components.planExecutionSchedule.name, 'sourcePlan');
  assert.equal(components.validateContentResult.name, 'sourceValidate');
});

// ## TODO: Test Permutations
// - a generated-only execution trigger refuses authoring evidence with mismatched content identities
// - a runtime route escaping the source worktree fails before execution
// - a cached component with malformed JSON remains retained but is never used
