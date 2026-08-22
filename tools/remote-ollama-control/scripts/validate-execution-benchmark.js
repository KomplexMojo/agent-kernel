#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { loadExecutionCatalog } = require('./lib/execution-catalog');
const { evaluateExecutionArtifacts } = require('./lib/execution-evaluator');
const { createGeneratedBuildResolver } = require('./lib/execution-integration');
const { planExecutionSchedule, runExecutionSchedule } = require('./lib/execution-runner');
const { pipelineComponents, validateRouteManifestDocument } = require('./lib/benchmark-pipeline');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..');
const RUNTIME_ROUTES = path.join(
  'tools', 'remote-ollama-control', 'benchmarks', 'execution', 'runtime-build-routes.json',
);
const GENERATED_ROUTES = path.join(
  'tools', 'remote-ollama-control', 'benchmarks', 'execution', 'generated-content-routes.json',
);

function fixtureExecutionArtifacts({ ticks = 4 } = {}) {
  const boundedTicks = Math.max(1, Math.min(ticks, 4));
  const positions = [{ x: 2, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }];
  const tickFrames = [];
  for (let tick = 1; tick <= boundedTicks; tick += 1) {
    for (const phaseDetail of ['observe', 'decide', 'apply', 'emit', 'summarize']) {
      const acceptedActions = phaseDetail === 'apply' ? [{
        schema: 'agent-kernel/Action', schemaVersion: 1, actorId: 'delver_1', tick,
        kind: tick === 2 ? 'wait' : 'move',
        params: tick === 2 ? {} : { to: positions[tick - 1] },
      }] : [];
      tickFrames.push({
        schema: 'agent-kernel/TickFrame', schemaVersion: 1,
        meta: { id: `witness_${tick}_${phaseDetail}`, runId: 'execution_validation_witness',
          createdAt: '1970-01-01T00:00:00.000Z', producedBy: 'deterministic-fixture' },
        tick, phase: 'execute', phaseDetail, acceptedActions,
        emittedEvents: [], emittedEffects: [], fulfilledEffects: [], preCoreRejections: [],
      });
    }
  }
  return {
    simConfig: {
      schema: 'agent-kernel/SimConfigArtifact', schemaVersion: 1,
      layout: { kind: 'grid', data: { width: 4, height: 3, tiles: ['####', '#..#', '####'],
        rooms: [{ id: 'R1', x: 1, y: 1, width: 2, height: 1 }] } },
    },
    initialState: {
      schema: 'agent-kernel/InitialStateArtifact', schemaVersion: 1,
      actors: [{ id: 'delver_1', kind: 'ambulatory', position: { x: 1, y: 1 },
        motivation: { kind: 'exploring' },
        vitals: { health: { current: 10, max: 10, regen: 0 } } }],
    },
    tickFrames,
    effectLog: [],
    actionLog: { schema: 'agent-kernel/ActionSequence', schemaVersion: 1, actions: [] },
    runSummary: { schema: 'agent-kernel/RunSummary', schemaVersion: 1, outcome: 'success',
      metrics: { ticks: boundedTicks, frames: tickFrames.length, effects: 0 } },
    worldStateCheckpoints: { states: [] },
    requestedTicks: boundedTicks,
    wallTimeMs: 1,
  };
}

function readinessForScenario(scenario, result) {
  const invariants = scenario.invariants.map((id) => ({ id, ...result.invariants[id] }));
  const objectives = Object.entries(scenario.objectives).map(([id, objective]) => ({
    id, evidence: objective.evidence, ...result.score.objectives[id],
  }));
  const gates = result.requiredGates.map((gate) => ({ ...gate }));
  const scopes = [...new Set(scenario.requiredGates.map((gate) => gate.scope))].sort().map((scope) => ({
    scope,
    status: gates.filter((gate) => gate.scope === scope).some((gate) => gate.status === 'evidence_unavailable')
      ? 'evidence_unavailable' : 'available',
  }));
  const ready = [...invariants, ...objectives, ...gates, ...scopes]
    .every((entry) => entry.status !== 'evidence_unavailable');
  return { scenarioId: scenario.id, ready, invariants, objectives, gates, scopes };
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function eligibleHardwareProfiles() {
  const document = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config', 'llm-profiles.json'), 'utf8'));
  if (!document.profiles || typeof document.profiles !== 'object') throw new Error('invalid hardware profile catalog');
  return Object.entries(document.profiles)
    .filter(([, profile]) => Array.isArray(profile.benchmarkModels) && profile.benchmarkModels.length > 0)
    .map(([name]) => name).sort();
}

async function generatedContentCanaries(catalog, outputRoot) {
  const scenario = catalog.scenarios[0];
  const canaries = [];
  let scenarioIndex = 900;
  for (const profile of eligibleHardwareProfiles()) {
    scenarioIndex += 1;
    const configurationId = `fixture-${profile}`;
    const buildDir = path.join(outputRoot, 'generated-canaries', profile, 'create');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'sim-config.json'), '{}\n');
    fs.writeFileSync(path.join(buildDir, 'initial-state.json'), '{}\n');
    const resolveBuild = createGeneratedBuildResolver({
      records: [{ recordKind: 'content_gen_attempt', configurationId, scenarioIndex, repeat: 1,
        execSucceeded: true, scenarioVerdict: { passed: true }, outDir: buildDir }],
      configurationId,
      routes: { [scenario.id]: { scenarioIndex, repeat: 1 } },
    });
    const resolved = await resolveBuild({ scenario, variant: null });
    canaries.push({ profile, scenarioId: scenario.id, configurationId,
      requiredArtifacts: ['sim-config.json', 'initial-state.json'], passed: resolved === buildDir });
  }
  return canaries.sort((left, right) => left.profile.localeCompare(right.profile));
}

async function runCanonicalFixtureValidation({ outputRoot, catalog = loadExecutionCatalog() } = {}) {
  if (typeof outputRoot !== 'string' || !outputRoot) throw new Error('outputRoot is required');
  const catalogSummary = {
    scenarios: catalog.scenarios.length,
    families: new Set(catalog.scenarios.map((scenario) => scenario.family)).size,
    requiredGates: catalog.scenarios.reduce((sum, scenario) => sum + scenario.requiredGates.length, 0),
  };
  if (catalogSummary.scenarios !== 25 || catalogSummary.families !== 5 || catalogSummary.requiredGates !== 70) {
    throw new Error(`canonical catalog drift: ${JSON.stringify(catalogSummary)}`);
  }
  const plan = planExecutionSchedule({ catalog });
  const schedule = await runExecutionSchedule({
    catalog,
    outputRoot: path.join(outputRoot, 'schedule'),
    resolveBuild: ({ scenario, variant }) => path.join('fixture-builds', scenario.id, variant || 'default'),
    execute: async (request) => ({
      status: 'completed',
      result: evaluateExecutionArtifacts({
        artifacts: fixtureExecutionArtifacts(request), scenario: request.scenarioId, catalog,
        seed: request.seed, repeat: request.repeat, variant: request.variant,
      }),
      command: { command: 'deterministic-evaluator-witness', args: [] },
    }),
    now: () => '1970-01-01T00:00:00.000Z',
  });
  const readiness = catalog.scenarios.map((scenario) => {
    const witness = schedule.attempts.find((attempt) => attempt.scenarioId === scenario.id)?.result;
    if (!witness) throw new Error(`canonical evaluator witness missing for ${scenario.id}`);
    return readinessForScenario(scenario, witness);
  });
  const canaries = await generatedContentCanaries(catalog, outputRoot);
  const expectedHardwareProfiles = eligibleHardwareProfiles();
  const record = {
    schemaVersion: 'agent-kernel-execution-validation/v2',
    mode: 'deterministic_evaluator_witness',
    identity: plan.identity,
    catalog: catalogSummary,
    schedule: {
      status: schedule.status,
      declaredRuns: plan.scenarios.reduce((sum, scenario) => sum + scenario.full.length, 0),
      executedAttempts: schedule.attempts.length,
      scenarios: schedule.scenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        profile: scenario.profile,
        stage: scenario.fullStage,
        declaredPopulation: plan.scenarios.find((entry) => entry.scenarioId === scenario.scenarioId).full.length,
        completedPopulation: scenario.aggregate?.runs || 0,
        aggregateQualified: scenario.aggregate?.verdict?.qualifies === true,
      })),
    },
    generatedContentCanaries: canaries,
    qualification: {
      ready: readiness.every((scenario) => scenario.ready),
      scenarios: readiness.length,
      blockedScenarios: readiness.filter((scenario) => !scenario.ready).length,
    },
    readiness,
    publication: false,
    limitations: [
      'evaluator witnesses validate evidence reachability, not gameplay quality',
      'no LLM, GPU, remote host, result branch, or timer was used',
    ],
  };
  if (canaries.some((canary) => !canary.passed)
    || JSON.stringify(canaries.map((canary) => canary.profile).sort()) !== JSON.stringify(expectedHardwareProfiles)) {
    throw new Error('canonical execution fixture validation failed');
  }
  atomicWriteJson(path.join(outputRoot, 'execution-validation.json'), record);
  return record;
}

async function probeResourceRuntimeLoading(sourceWorktree) {
  const setupPath = path.join(sourceWorktree, 'packages', 'runtime', 'src', 'runner', 'core-setup.mjs');
  const moduleUrl = `${pathToFileURL(setupPath).href}?resource-probe=${process.hrtime.bigint()}`;
  const { applySimConfigToCore } = await import(moduleUrl);
  if (typeof applySimConfigToCore !== 'function') {
    return { status: 'failed', vitalPlacements: 0, affinityPlacements: 0 };
  }
  const calls = { vital: 0, affinity: 0 };
  const core = {
    configureGrid: () => 0,
    setTileAt: () => 0,
    placeResourceAt: () => { calls.vital += 1; return 0; },
    placeAffinityResourceAt: () => { calls.affinity += 1; return 0; },
  };
  const result = applySimConfigToCore(core, {
    layout: {
      kind: 'grid',
      data: {
        width: 3,
        height: 3,
        tiles: ['###', '#.#', '###'],
        resources: [
          {
            id: 'probe-vital', position: { x: 1, y: 1 }, permanenceMode: 'consumable',
            vitals: [{ key: 'health', delta: 1, regen: 0 }],
          },
          {
            id: 'probe-affinity', position: { x: 1, y: 1 }, permanenceMode: 'consumable', vitals: [],
            affinity: { kind: 'fire', expression: 'emit', stacks: 1, mana: 3, manaRegen: 0 },
          },
        ],
      },
    },
  });
  return {
    status: result?.ok === true && calls.vital > 0 && calls.affinity > 0 ? 'passed' : 'failed',
    vitalPlacements: calls.vital,
    affinityPlacements: calls.affinity,
  };
}

function loadJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid ${label} JSON: ${error.message}`);
  }
}

function runtimeArtifactSetEvidence(sourceWorktree, routes) {
  const digest = crypto.createHash('sha256');
  const builds = [];
  for (const key of Object.keys(routes).sort()) {
    const buildDir = path.resolve(sourceWorktree, routes[key]);
    const artifacts = {};
    const expectedRunId = `benchmark_${key.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    for (const [name, schema] of [
      ['sim-config.json', 'agent-kernel/SimConfigArtifact'],
      ['initial-state.json', 'agent-kernel/InitialStateArtifact'],
    ]) {
      const bytes = fs.readFileSync(path.join(buildDir, name));
      const document = JSON.parse(bytes.toString('utf8'));
      if (document.schema !== schema || document.schemaVersion !== 1) {
        throw new Error(`runtime route ${key} has invalid ${name} schema`);
      }
      if (document.meta?.runId !== expectedRunId) {
        throw new Error(`runtime route ${key} resolves to mismatched ${name} identity`);
      }
      const artifactHash = crypto.createHash('sha256').update(bytes).digest('hex');
      artifacts[name] = artifactHash;
      digest.update(key).update('\0').update(name).update('\0').update(artifactHash).update('\0');
    }
    builds.push({ routeKey: key, artifacts });
  }
  return { runtimeArtifactSetHash: digest.digest('hex'), builds };
}

async function runCorpusIntegrationValidation({
  outputRoot,
  sourceWorktree = REPOSITORY_ROOT,
  runtimeRouteDocument,
  generatedRouteDocument,
  probeResourceCapability = probeResourceRuntimeLoading,
  runFixtureValidation = runCanonicalFixtureValidation,
} = {}) {
  if (typeof outputRoot !== 'string' || !outputRoot) throw new Error('outputRoot is required');
  const sourceRoot = fs.realpathSync(sourceWorktree);
  const catalog = loadExecutionCatalog(path.join(
    sourceRoot, 'tools', 'remote-ollama-control', 'benchmarks', 'execution',
  ));
  const components = pipelineComponents(sourceRoot, catalog);
  const runtimeDocument = runtimeRouteDocument
    || loadJson(path.join(sourceRoot, RUNTIME_ROUTES), 'runtime route manifest');
  const generatedDocument = generatedRouteDocument
    || loadJson(path.join(sourceRoot, GENERATED_ROUTES), 'generated route manifest');
  const scenarioSetHash = components.contentCatalog.sha256;
  const runtimeRoutes = validateRouteManifestDocument(runtimeDocument, {
    kind: 'runtime', components, catalog, sourceWorktree: sourceRoot, scenarioSetHash,
  });
  const generatedRoutes = validateRouteManifestDocument(generatedDocument, {
    kind: 'generated', components, catalog, sourceWorktree: sourceRoot, scenarioSetHash,
  });
  const runtimeKeys = Object.keys(runtimeRoutes).sort();
  const generatedKeys = Object.keys(generatedRoutes).sort();
  if (JSON.stringify(runtimeKeys) !== JSON.stringify(generatedKeys)) {
    throw new Error('runtime and generated route keys do not align');
  }
  const scenariosByIndex = new Map(components.contentCatalog.scenarios
    .map((scenario) => [scenario.index, scenario]));
  for (const key of generatedKeys) {
    const scenario = scenariosByIndex.get(generatedRoutes[key].scenarioIndex);
    if (!scenario?.prompt?.includes(`[${key}]`)) {
      throw new Error(`generated route ${key} lacks its explicit prompt contract marker`);
    }
  }
  const artifactEvidence = runtimeArtifactSetEvidence(sourceRoot, runtimeRoutes);
  const resourceRuntimeCapability = await probeResourceCapability(sourceRoot);
  if (resourceRuntimeCapability?.status !== 'passed') {
    throw new Error('resource runtime loading capability is not proven; refusing deterministic scheduling');
  }
  const fixtureValidation = await runFixtureValidation({
    outputRoot: path.join(outputRoot, 'fixture-schedule'), catalog,
  });
  const record = {
    schemaVersion: 'agent-kernel-execution-corpus-validation/v1',
    mode: 'deterministic_fixture_with_corpus_preflight',
    identity: {
      executionSuiteHash: catalog.sha256,
      scenarioSetHash,
      runtimeArtifactSetHash: artifactEvidence.runtimeArtifactSetHash,
    },
    corpus: {
      routeKeys: runtimeKeys.length,
      runtimeBuilds: artifactEvidence.builds.length,
      generatedMappings: generatedKeys.length,
      runtimeArtifactSetHash: artifactEvidence.runtimeArtifactSetHash,
      resourceRuntimeCapability,
    },
    fixtureValidation,
    publication: false,
    limitations: [
      'fixture scheduling validates corpus integration and orchestration, not gameplay quality',
      'no LLM, GPU, remote host, result branch, or timer was used',
    ],
  };
  atomicWriteJson(path.join(outputRoot, 'corpus-integration-validation.json'), record);
  return record;
}

function parseOutputRoot(argv) {
  const index = argv.indexOf('--out');
  if (index < 0 || !argv[index + 1] || argv[index + 1].startsWith('--')) {
    throw new Error('Usage: validate-execution-benchmark.js --out <directory>');
  }
  return path.resolve(argv[index + 1]);
}

function optionValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? path.resolve(argv[index + 1]) : fallback;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const action = argv.includes('--corpus')
    ? runCorpusIntegrationValidation({
      outputRoot: parseOutputRoot(argv),
      sourceWorktree: optionValue(argv, '--source-root', REPOSITORY_ROOT),
    })
    : runCanonicalFixtureValidation({ outputRoot: parseOutputRoot(argv) });
  action
    .then((record) => process.stdout.write(`${JSON.stringify(record, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`ERROR: ${error.message}\n`); process.exitCode = 1; });
}

module.exports = {
  fixtureExecutionArtifacts,
  probeResourceRuntimeLoading,
  runCanonicalFixtureValidation,
  runCorpusIntegrationValidation,
};
