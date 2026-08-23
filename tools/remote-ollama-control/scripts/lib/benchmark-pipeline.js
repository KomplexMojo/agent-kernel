'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { ROOT_DIR, parseEnvFile } = require('./config');
const { validateContentResult } = require('./ak-compare');
const { loadScenarioCatalog } = require('./ak-scenarios');
const { MANIFEST_NAME, latestResultDir } = require('./content-gen-checkpoint');
const { createGeneratedBuildResolver, combineBenchmarkQualification } = require('./execution-integration');
const { executeLocalRun, planExecutionSchedule, runExecutionSchedule } = require('./execution-runner');

function pipelineComponents(sourceWorktree, injectedCatalog) {
  if (injectedCatalog) {
    return {
      catalog: injectedCatalog,
      contentCatalog: loadScenarioCatalog(),
      combineBenchmarkQualification,
      createGeneratedBuildResolver,
      executeLocalRun,
      planExecutionSchedule,
      runExecutionSchedule,
      validateContentResult,
    };
  }
  const libRoot = path.join(sourceWorktree, 'tools', 'remote-ollama-control', 'scripts', 'lib');
  const sourceCatalog = require(path.join(libRoot, 'execution-catalog.js'));
  const sourceIntegration = require(path.join(libRoot, 'execution-integration.js'));
  const sourceRunner = require(path.join(libRoot, 'execution-runner.js'));
  const sourceCompare = require(path.join(libRoot, 'ak-compare.js'));
  const sourceScenarios = require(path.join(libRoot, 'ak-scenarios.js'));
  return {
    catalog: sourceCatalog.loadExecutionCatalog(path.join(
      sourceWorktree, 'tools', 'remote-ollama-control', 'benchmarks', 'execution',
    )),
    contentCatalog: sourceScenarios.loadScenarioCatalog(path.join(
      sourceWorktree, 'tools', 'remote-ollama-control', 'benchmarks', 'content-gen',
    )),
    combineBenchmarkQualification: sourceIntegration.combineBenchmarkQualification,
    createGeneratedBuildResolver: sourceIntegration.createGeneratedBuildResolver,
    executeLocalRun: sourceRunner.executeLocalRun,
    planExecutionSchedule: sourceRunner.planExecutionSchedule,
    runExecutionSchedule: sourceRunner.runExecutionSchedule,
    validateContentResult: sourceCompare.validateContentResult,
  };
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid ${label} JSON ${filePath}: ${error.message}`);
  }
}

function assertRunInputs({ sourceWorktree, stateDir, runKey, trigger }) {
  if (typeof sourceWorktree !== 'string' || !sourceWorktree) throw new Error('sourceWorktree is required');
  if (typeof stateDir !== 'string' || !stateDir || path.resolve(stateDir) === path.parse(path.resolve(stateDir)).root) {
    throw new Error('stateDir must be a specific directory');
  }
  if (!/^[a-f0-9]{64}$/.test(runKey || '')) throw new Error('runKey must be a SHA-256 identity');
  const modes = trigger?.modes;
  if (!modes || !['authoring', 'runtimeExecution', 'generatedExecution']
    .every((name) => typeof modes[name] === 'boolean') || !Object.values(modes).some(Boolean)) {
    throw new Error('trigger modes are required');
  }
}

function validateAuthoringEvidence(evidence, scenarioSetHash, matrixHash, validateResult) {
  if (!evidence || !Array.isArray(evidence.records)) throw new Error('authoring evidence records are required');
  validateResult(evidence.result);
  if (evidence.result.scenarioSet.sha256 !== scenarioSetHash || evidence.result.matrix.sha256 !== matrixHash) {
    throw new Error('authoring evidence identity mismatch');
  }
  return evidence;
}

function validateExecutionSchedule(schedule, executionSuiteHash, label) {
  if (schedule?.schemaVersion !== 'agent-kernel-execution-schedule/v1'
    || schedule.identity?.executionSuiteHash !== executionSuiteHash
    || !Array.isArray(schedule.scenarios) || !Array.isArray(schedule.attempts)) {
    throw new Error(`${label} execution evidence identity is invalid`);
  }
  return schedule;
}

function componentPaths(stateDir, { scenarioSetHash, matrixHash, executionSuiteHash }) {
  return {
    authoring: path.join(stateDir, 'evidence', 'authoring', `${scenarioSetHash}-${matrixHash}.json`),
    runtime: path.join(stateDir, 'evidence', 'runtime', `${executionSuiteHash}.json`),
  };
}

function loadRetained(pathname, label) {
  if (!fs.existsSync(pathname)) throw new Error(`No retained ${label} evidence is available`);
  return readJson(pathname, `retained ${label}`);
}

function routeKey(scenario, variant) {
  return variant ? `${scenario.id}#${variant}` : scenario.id;
}

function createCommittedBuildResolver({ sourceWorktree, routes }) {
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) {
    throw new Error('runtime build routes are required');
  }
  const sourceRoot = fs.realpathSync(sourceWorktree);
  return async ({ scenario, variant = null }) => {
    const key = routeKey(scenario, variant);
    const relative = routes[key];
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
      throw new Error(`No explicit committed-build route for ${key}`);
    }
    const unresolvedBuildDir = path.resolve(sourceRoot, relative);
    if (!unresolvedBuildDir.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`Committed-build route escapes source for ${key}`);
    const buildDir = fs.realpathSync(unresolvedBuildDir);
    if (!buildDir.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`Committed-build route escapes source for ${key}`);
    if (!['sim-config.json', 'initial-state.json'].every((name) => fs.existsSync(path.join(buildDir, name)))) {
      throw new Error(`Committed build for ${key} is incomplete`);
    }
    return buildDir;
  };
}

function compactSchedule(schedule) {
  return {
    status: schedule.status,
    identity: schedule.identity,
    attempts: schedule.attempts.length,
    scenarios: schedule.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      status: scenario.status,
      aggregateQualifies: scenario.aggregate?.verdict?.qualifies === true,
    })),
  };
}

function routeManifestDocument(sourceWorktree, envName) {
  const configured = process.env[envName];
  if (!configured) throw new Error(`${envName} is required for live pipeline execution`);
  const sourceRoot = fs.realpathSync(sourceWorktree);
  const manifestPath = path.resolve(sourceRoot, configured);
  if (!manifestPath.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`${envName} must resolve inside sourceWorktree`);
  const realManifestPath = fs.realpathSync(manifestPath);
  if (!realManifestPath.startsWith(`${sourceRoot}${path.sep}`)) throw new Error(`${envName} must resolve inside sourceWorktree`);
  return readJson(realManifestPath, envName);
}

function expectedRouteKeys(components, catalog) {
  return [...new Set(components.planExecutionSchedule({ catalog }).scenarios
    .flatMap((scenario) => scenario.screen.map((request) => (
      request.variant ? `${scenario.scenarioId}#${request.variant}` : scenario.scenarioId
    ))))].sort();
}

function validateRouteManifestDocument(document, {
  kind, components, catalog, sourceWorktree, scenarioSetHash, requireEnvelope = true,
}) {
  const schemaVersion = kind === 'runtime'
    ? 'agent-kernel-runtime-build-routes/v1'
    : 'agent-kernel-generated-content-routes/v1';
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`${kind} route manifest must be an object`);
  }
  if (requireEnvelope) {
    if (document.schemaVersion !== schemaVersion || !document.identity || !document.routes) {
      throw new Error(`${kind} route manifest envelope is invalid`);
    }
    if (document.identity.executionSuiteHash !== catalog.sha256) {
      throw new Error(`${kind} route manifest execution-suite identity mismatch`);
    }
    if (kind === 'generated' && document.identity.scenarioSetHash !== scenarioSetHash) {
      throw new Error('generated route manifest scenario-set identity mismatch');
    }
  }
  const routes = requireEnvelope ? document.routes : document;
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) {
    throw new Error(`${kind} routes must be an object`);
  }
  const expected = expectedRouteKeys(components, catalog);
  const actual = Object.keys(routes).sort();
  const missing = expected.filter((key) => !Object.hasOwn(routes, key));
  const unexpected = actual.filter((key) => !expected.includes(key));
  if (missing.length || unexpected.length) {
    throw new Error(`${kind} route coverage mismatch: missing=${missing.join(',') || 'none'}; unexpected=${unexpected.join(',') || 'none'}`);
  }
  if (kind === 'runtime') {
    const root = fs.realpathSync(sourceWorktree);
    for (const [key, relative] of Object.entries(routes)) {
      if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
        throw new Error(`runtime route ${key} must be a relative path`);
      }
      const unresolvedBuildDir = path.resolve(root, relative);
      let buildDir = null;
      try {
        buildDir = fs.realpathSync(unresolvedBuildDir);
      } catch {}
      if (!unresolvedBuildDir.startsWith(`${root}${path.sep}`) || !buildDir
        || !buildDir.startsWith(`${root}${path.sep}`)
        || !['sim-config.json', 'initial-state.json'].every((name) => fs.existsSync(path.join(buildDir, name)))) {
        throw new Error(`runtime route ${key} does not resolve to a complete source-owned build`);
      }
    }
  } else {
    const scenarios = new Map(components.contentCatalog.scenarios.map((scenario) => [scenario.index, scenario]));
    for (const [key, route] of Object.entries(routes)) {
      const scenario = scenarios.get(route?.scenarioIndex);
      if (!scenario || scenario.expectedOutcome !== 'success'
        || !Number.isSafeInteger(route.repeat) || route.repeat < 1) {
        throw new Error(`generated route ${key} must select a successful authoring scenario and positive repeat`);
      }
    }
  }
  return routes;
}

function boundedLog(filePath, stdout, stderr, maxBytes = 1024 * 1024) {
  const value = Buffer.from(`[stdout]\n${stdout || ''}\n[stderr]\n${stderr || ''}`, 'utf8');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value.subarray(0, maxBytes));
}

// The full matrix is 7 configurations x 100 scenarios x up to 3 passes: 700 attempts at the floor
// and 2100 at the ceiling. The last recorded run averaged 58s per attempt while including the cheap
// 9B canary, and the real matrix is weighted toward 27-30B, so the ceiling sits well past a day.
// This was 24h until 2026-08-23, which meant the guard rail would SIGTERM the run it protects --
// and because spawnSync kills the child, the failure arrives as an opaque "content generation
// failed" after a day of GPU time. Resume (below) makes a kill recoverable; this makes it rare.
const AUTHORING_TIMEOUT_MS = 72 * 60 * 60 * 1000;

// Only a directory that carries a manifest can be resumed -- without one the child refuses and
// exits, so detecting it here turns an unactionable error into an ordinary fresh run.
function resumableAuthoringDir(resultsDir) {
  const candidate = latestResultDir(resultsDir);
  if (!candidate || !fs.existsSync(path.join(candidate, MANIFEST_NAME))) return null;
  return candidate;
}

// The content-gen child runs inside the isolated SOURCE WORKTREE, where config/llm-host.env does
// not exist: site addresses are operator data and are deliberately never committed. So the child
// loaded no host config at all and every value fell back to its default — no internal host, no
// external host, and sshPort 22 while this box's sshd is on 2222. That surfaced as
// "Route auto-detection failed ... answered on port 22", a message about the network for a fault
// that is a missing file, and the run published infrastructure_error before any GPU work.
//
// Site addressing is INSTALLATION data, not revision data, so it comes from the installed package
// this agent is itself running from — not from the worktree, whose source isolation stays intact.
// process.env still wins over the file, matching loadConfig's own precedence.
function hostEnvironmentForChild(rootDir = ROOT_DIR) {
  const file = path.join(rootDir, 'config', 'llm-host.env');
  const hostEnv = {};
  for (const [key, value] of Object.entries(parseEnvFile(file))) {
    if (key.startsWith('LLM_')) hostEnv[key] = value;
  }
  const haveHost = hostEnv.LLM_INTERNAL_HOST || hostEnv.LLM_EXTERNAL_HOST
    || process.env.LLM_INTERNAL_HOST || process.env.LLM_EXTERNAL_HOST;
  if (!haveHost) {
    // Fail here, naming the file. The alternative is the child's route probe reporting a plausible
    // network failure, which sends the reader to check the LAN instead of the configuration.
    throw new Error(
      `content generation has no host configuration: ${file} defines neither LLM_INTERNAL_HOST nor `
      + 'LLM_EXTERNAL_HOST, and neither is set in the environment. Populate that file on the runner '
      + '(it is gitignored by design) rather than expecting it from the source checkout.'
    );
  }
  return hostEnv;
}

// Split out from the spawn so the composed command is assertable without running a benchmark.
function authoringInvocation({ sourceWorktree, retentionDir, timeoutMs }) {
  const resultsDir = path.join(retentionDir, 'authoring');
  const script = path.join(sourceWorktree, 'tools', 'remote-ollama-control', 'scripts', 'remote-ollama-mac.js');
  const args = [script, 'run-content-gen', '--route', process.env.LLM_DEFAULT_ROUTE || 'auto'];
  // retentionDir is keyed by runKey, which already covers the source commit and all three identity
  // hashes -- so anything found here belongs to this exact run and cannot blend two catalogs.
  // Name the directory explicitly rather than passing bare `--resume`: "latest" is resolved against
  // LLM_RESULTS_DIR by the child, and being wrong about which run is being finished is the one
  // mistake that silently produces an uninterpretable number.
  const resumeDir = resumableAuthoringDir(resultsDir);
  if (resumeDir) args.push('--resume', resumeDir);
  return {
    script, args, resultsDir, resumeDir,
    timeoutMs: timeoutMs === undefined ? AUTHORING_TIMEOUT_MS : timeoutMs,
  };
}

async function runContentGenerationProcess({ sourceWorktree, retentionDir, timeoutMs }) {
  const invocation = authoringInvocation({ sourceWorktree, retentionDir, timeoutMs });
  const { resultsDir } = invocation;
  const child = spawnSync(process.execPath, invocation.args, {
    cwd: sourceWorktree,
    env: { ...hostEnvironmentForChild(), ...process.env, LLM_RESULTS_DIR: resultsDir },
    encoding: 'utf8', timeout: invocation.timeoutMs, maxBuffer: 32 * 1024 * 1024,
  });
  boundedLog(path.join(retentionDir, 'authoring-command.log'), child.stdout, child.stderr);
  if (child.error || child.status !== 0) {
    // A timeout kill arrives as SIGTERM with an errno that says nothing about duration. Naming it
    // matters more here than anywhere else in the pipeline: the reader is looking at a failure that
    // consumed days, and "killed at the 72h ceiling" and "the rig broke" call for opposite
    // responses. The attempts already recorded survive, and the next poll resumes them.
    const timedOut = child.error?.code === 'ETIMEDOUT' || child.signal === 'SIGTERM';
    const detail = timedOut
      ? `killed after ${Math.round(invocation.timeoutMs / 3600000)}h at the authoring ceiling; `
        + `${invocation.resumeDir ? 'resuming' : 'starting'} evidence is retained under ${resultsDir} `
        + 'and the next poll will resume it'
      : child.error?.message || String(child.stderr || `exit ${child.status}`).slice(-2000);
    throw new Error(`content generation failed: ${detail}`);
  }
  const match = /Structured result:\s*(.+)\s*$/m.exec(child.stdout || '');
  if (!match) throw new Error('content generation did not report its structured result path');
  const resultPath = path.resolve(match[1].trim());
  const expectedRoot = path.resolve(resultsDir);
  if (!resultPath.startsWith(`${expectedRoot}${path.sep}`)) throw new Error('content result escaped its retention directory');
  const recordsPath = path.join(path.dirname(resultPath), 'runs.jsonl');
  const records = fs.readFileSync(recordsPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { result: readJson(resultPath, 'content result'), records };
}

async function scheduleExecution({ components, catalog, outputRoot, resolveBuild, executeExecution, sourceWorktree }) {
  const execute = executeExecution || ((request) => components.executeLocalRun(request, {
    catalog,
    cliPath: path.join(sourceWorktree, 'packages', 'adapters-cli', 'src', 'cli', 'ak.mjs'),
  }));
  return components.runExecutionSchedule({ catalog, outputRoot, resolveBuild, execute });
}

async function runBenchmarkPipeline({
  catalog,
  sourceWorktree,
  stateDir,
  runKey,
  trigger,
  scenarioSetHash,
  matrixHash,
  executionSuiteHash,
  runAuthoring = runContentGenerationProcess,
  runtimeRoutes,
  generatedRoutes,
  executeExecution,
} = {}) {
  assertRunInputs({ sourceWorktree, stateDir, runKey, trigger });
  const components = pipelineComponents(sourceWorktree, catalog);
  const selectedCatalog = components.catalog;
  if (selectedCatalog.sha256 !== executionSuiteHash) throw new Error('execution catalog identity mismatch');
  const identities = { scenarioSetHash, matrixHash, executionSuiteHash };
  if (components.contentCatalog.sha256 !== scenarioSetHash && !catalog) {
    throw new Error('content catalog identity mismatch');
  }
  const selectedRuntimeRoutes = trigger.modes.runtimeExecution
    ? validateRouteManifestDocument(runtimeRoutes || routeManifestDocument(
      sourceWorktree, 'AK_BENCHMARK_RUNTIME_ROUTES',
    ), { kind: 'runtime', components, catalog: selectedCatalog, sourceWorktree, scenarioSetHash,
      requireEnvelope: !runtimeRoutes })
    : null;
  const selectedGeneratedRoutes = trigger.modes.generatedExecution
    ? validateRouteManifestDocument(generatedRoutes || routeManifestDocument(
      sourceWorktree, 'AK_BENCHMARK_GENERATED_ROUTES',
    ), { kind: 'generated', components, catalog: selectedCatalog, sourceWorktree, scenarioSetHash,
      requireEnvelope: !generatedRoutes })
    : null;
  const paths = componentPaths(stateDir, identities);
  const retentionId = `runs/${runKey}`;
  const retentionDir = path.join(stateDir, retentionId);
  fs.mkdirSync(retentionDir, { recursive: true });

  let authoringEvidence;
  if (trigger.modes.authoring) {
    authoringEvidence = validateAuthoringEvidence(await runAuthoring({
      sourceWorktree, retentionDir, runKey, trigger,
    }), scenarioSetHash, matrixHash, components.validateContentResult);
    atomicWriteJson(paths.authoring, authoringEvidence);
  } else {
    authoringEvidence = validateAuthoringEvidence(
      loadRetained(paths.authoring, 'authoring'), scenarioSetHash, matrixHash,
      components.validateContentResult,
    );
  }

  let runtimeExecution;
  if (trigger.modes.runtimeExecution) {
    runtimeExecution = await scheduleExecution({
      components,
      catalog: selectedCatalog,
      outputRoot: path.join(retentionDir, 'runtime'),
      resolveBuild: createCommittedBuildResolver({ sourceWorktree, routes: selectedRuntimeRoutes }),
      executeExecution,
      sourceWorktree,
    });
    validateExecutionSchedule(runtimeExecution, executionSuiteHash, 'runtime');
    atomicWriteJson(paths.runtime, runtimeExecution);
  } else {
    runtimeExecution = validateExecutionSchedule(
      loadRetained(paths.runtime, 'runtime execution'), executionSuiteHash, 'retained runtime',
    );
  }

  const generatedExecutionByConfiguration = {};
  if (trigger.modes.generatedExecution) {
    for (const configuration of authoringEvidence.result.configurations
      .filter((entry) => entry.verdict?.qualifies === true)) {
      const resolveBuild = components.createGeneratedBuildResolver({
        records: authoringEvidence.records,
        configurationId: configuration.configurationId,
        routes: selectedGeneratedRoutes,
      });
      generatedExecutionByConfiguration[configuration.configurationId] = await scheduleExecution({
        components,
        catalog: selectedCatalog,
        outputRoot: path.join(retentionDir, 'generated', Buffer.from(configuration.configurationId).toString('base64url')),
        resolveBuild,
        executeExecution,
        sourceWorktree,
      });
    }
  }

  const combined = components.combineBenchmarkQualification({
    authoringResult: authoringEvidence.result,
    runtimeExecution,
    generatedExecutionByConfiguration,
  });
  const generatedCompact = Object.fromEntries(Object.entries(generatedExecutionByConfiguration)
    .map(([configurationId, schedule]) => [configurationId, compactSchedule(schedule)]));
  const outcome = {
    status: 'completed',
    qualifies: combined.minimumSuccessfulConfiguration !== null,
    scenarioSet: combined.scenarioSet,
    matrix: combined.matrix,
    thresholds: combined.thresholds,
    configurations: combined.configurations,
    execution: {
      identity: { executionSuiteHash, evaluatorVersion: selectedCatalog.evaluatorVersion,
        seedSetHash: selectedCatalog.seedSetHash, tickProfileHash: selectedCatalog.tickProfileHash },
      runtime: compactSchedule(runtimeExecution),
      generatedByConfiguration: generatedCompact,
    },
    minimumSuccessfulConfiguration: combined.minimumSuccessfulConfiguration,
    paretoFrontier: combined.paretoFrontier,
    comparison: { comparable: false, incomparabilityReasons: ['pipeline comparison not loaded'] },
    failures: combined.failures,
    artifacts: { retentionId },
  };
  atomicWriteJson(path.join(retentionDir, 'pipeline-result.json'), outcome);
  return outcome;
}

module.exports = {
  hostEnvironmentForChild,
  AUTHORING_TIMEOUT_MS,
  authoringInvocation,
  createCommittedBuildResolver,
  pipelineComponents,
  runBenchmarkPipeline,
  runContentGenerationProcess,
  validateRouteManifestDocument,
};
