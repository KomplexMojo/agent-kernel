'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { aggregateExecutionResults, evaluateExecutionArtifacts, loadExecutionArtifacts } = require('./execution-evaluator');
const { loadExecutionCatalog } = require('./execution-catalog');

const DEFAULT_CLI = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'adapters-cli', 'src', 'cli', 'ak.mjs');

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-');
}

function variantsForScenario(scenario) {
  const variants = new Set();
  const visit = (predicate) => {
    if (['all', 'any'].includes(predicate.operator)) return predicate.predicates.forEach(visit);
    if (predicate.operator === 'changed_in_direction') {
      variants.add(predicate.baselineVariant);
      variants.add(predicate.candidateVariant);
    }
    return undefined;
  };
  scenario.requiredGates.forEach((gate) => visit(gate.predicate));
  return variants.size ? [...variants] : [null];
}

function checkpointsForTicks(profile, ticks) {
  return profile.checkpoints.filter((checkpoint) => checkpoint <= ticks);
}

function requestFor(scenario, profile, stage, seed, repeat, variant, ticks) {
  return {
    scenarioId: scenario.id,
    family: scenario.family,
    profile: scenario.profile,
    stage,
    seed,
    repeat,
    ...(variant ? { variant } : {}),
    ticks,
    checkpoints: checkpointsForTicks(profile, ticks),
  };
}

function planExecutionSchedule({ catalog = loadExecutionCatalog(), scenarioIds, screenTicks = 50 } = {}) {
  if (!Number.isSafeInteger(screenTicks) || screenTicks < 1) throw new Error('screenTicks must be a positive integer');
  const selectedIds = scenarioIds || catalog.scenarios.map((scenario) => scenario.id);
  if (!Array.isArray(selectedIds) || selectedIds.length === 0 || new Set(selectedIds).size !== selectedIds.length) {
    throw new Error('scenarioIds must be a non-empty unique list');
  }
  const scenarios = selectedIds.map((id) => {
    const scenario = catalog.scenarios.find((entry) => entry.id === id);
    if (!scenario) throw new Error(`unknown execution scenario: ${id}`);
    const profile = catalog.contract.profiles[scenario.profile];
    const variants = variantsForScenario(scenario);
    const boundedTicks = Math.min(screenTicks, profile.ticks);
    const screen = variants.map((variant) => requestFor(
      scenario, profile, 'screen', profile.seeds[0], 1, variant, boundedTicks,
    ));
    const fullStage = profile.ticks >= 250 ? 'stress' : 'qualify';
    const full = profile.seeds.flatMap((seed) => Array.from({ length: profile.repeats }, (_, offset) => offset + 1)
      .flatMap((repeat) => variants.map((variant) => requestFor(
        scenario, profile, fullStage, seed, repeat, variant, profile.ticks,
      ))));
    return { scenarioId: scenario.id, family: scenario.family, profile: scenario.profile,
      purpose: scenario.purpose, fullStage, screen, full };
  });
  return {
    schemaVersion: 'agent-kernel-execution-schedule-plan/v1',
    identity: {
      executionSuiteHash: catalog.sha256,
      evaluatorVersion: catalog.evaluatorVersion,
      seedSetHash: catalog.seedSetHash,
      tickProfileHash: catalog.tickProfileHash,
    },
    scenarios,
  };
}

function buildExecutionCommand(request) {
  const cliPath = request.cliPath || DEFAULT_CLI;
  const variantSuffix = request.variant ? `-${safeSegment(request.variant)}` : '';
  const runId = `execution-${request.scenarioId}-${request.stage}-s${request.seed}-r${request.repeat}${variantSuffix}`;
  const args = [
    cliPath,
    'run',
    '--sim-config', path.join(request.buildDir, 'sim-config.json'),
    '--initial-state', path.join(request.buildDir, 'initial-state.json'),
    '--ticks', String(request.ticks),
    '--seed', String(request.seed),
    '--run-id', runId,
    '--out-dir', request.runDir,
  ];
  if (request.checkpoints.length) args.push('--world-state-checkpoints', request.checkpoints.join(','));
  return { command: process.execPath, args, runId };
}

function executeLocalRun(request, {
  catalog = loadExecutionCatalog(), cliPath = DEFAULT_CLI, spawn = spawnSync, env = process.env,
} = {}) {
  fs.mkdirSync(request.runDir, { recursive: true });
  const command = buildExecutionCommand({ ...request, cliPath });
  const started = process.hrtime.bigint();
  const child = spawn(command.command, command.args, { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
  const wallTimeMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (child.error || child.status !== 0) {
    return {
      status: 'failed', exitCode: child.status ?? null, signal: child.signal ?? null,
      stdout: child.stdout || '', stderr: child.stderr || child.error?.message || '', command,
    };
  }
  try {
    const artifacts = loadExecutionArtifacts(request.runDir, request.buildDir, { checkpointTicks: request.checkpoints });
    const result = evaluateExecutionArtifacts({ artifacts: { ...artifacts, requestedTicks: request.ticks, wallTimeMs },
      scenario: request.scenarioId, catalog, seed: request.seed, repeat: request.repeat, variant: request.variant });
    return { status: 'completed', exitCode: 0, stdout: child.stdout || '', stderr: child.stderr || '', command, result };
  } catch (error) {
    return { status: 'failed', exitCode: 0, stdout: child.stdout || '', stderr: error.message, command };
  }
}

function sameExecution(left, right) {
  return left.scenarioId === right.scenarioId && left.seed === right.seed && left.repeat === right.repeat
    && (left.variant || null) === (right.variant || null) && left.ticks === right.ticks
    && JSON.stringify(left.checkpoints) === JSON.stringify(right.checkpoints);
}

function definitiveFailure(result, minimumSeedScore) {
  if (result.verdict?.failedInvariants?.length || result.score?.status === 'hard_fail') return 'hard_invariant_failed';
  if (result.verdict?.failedGates?.length) return 'required_gate_failed';
  if (result.score?.status === 'scored' && result.score.value < minimumSeedScore) return 'minimum_seed_score_failed';
  return null;
}

function screenFailure(attempt) {
  if (attempt.status !== 'completed' || !attempt.result) return 'execution_failed';
  if (attempt.result.verdict?.failedInvariants?.length || attempt.result.score?.status === 'hard_fail') {
    return 'hard_invariant_failed';
  }
  if (attempt.result.verdict?.failedGates?.length) return 'required_gate_failed';
  return null;
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

async function runExecutionSchedule({
  catalog = loadExecutionCatalog(), scenarioIds, outputRoot, resolveBuild,
  execute = (request) => executeLocalRun(request, { catalog }), screenTicks = 50,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof outputRoot !== 'string' || outputRoot === '') throw new Error('outputRoot is required');
  if (typeof resolveBuild !== 'function') throw new Error('resolveBuild is required');
  if (typeof execute !== 'function') throw new Error('execute is required');
  const plan = planExecutionSchedule({ catalog, scenarioIds, screenTicks });
  const startedAt = now();
  const attempts = [];
  const scenarioSummaries = [];

  const perform = async (request) => {
    const scenario = catalog.scenarios.find((entry) => entry.id === request.scenarioId);
    const runDir = path.join(outputRoot, 'runs', safeSegment(request.scenarioId), request.stage,
      safeSegment(request.variant || 'default'), `seed-${request.seed}-repeat-${request.repeat}`);
    let buildDir = null;
    let execution;
    try {
      buildDir = await resolveBuild({ scenario, variant: request.variant || null, request });
      if (typeof buildDir !== 'string' || buildDir === '') throw new Error(`resolveBuild returned no directory for ${request.scenarioId}`);
      execution = await execute({ ...request, buildDir, runDir });
    } catch (error) {
      execution = { status: 'failed', exitCode: null, stderr: error.message };
    }
    const attempt = { ...request, buildDir, runDir, ...execution };
    attempts.push(attempt);
    return attempt;
  };

  for (const scenarioPlan of plan.scenarios) {
    const scenarioAttempts = [];
    const screenAttempts = [];
    for (const request of scenarioPlan.screen) {
      const attempt = await perform(request);
      scenarioAttempts.push(attempt);
      screenAttempts.push(attempt);
    }
    const screenFailureReason = screenAttempts.map(screenFailure).find(Boolean);
    if (screenFailureReason) {
      scenarioSummaries.push({ ...scenarioPlan, attempts: scenarioAttempts,
        promotion: { status: 'rejected', reason: screenFailureReason }, earlyStop: null, aggregate: null,
        status: 'failed' });
      continue;
    }

    const fullResults = [];
    let earlyStop = null;
    for (const request of scenarioPlan.full) {
      const reusable = screenAttempts.find((attempt) => attempt.status === 'completed' && sameExecution(attempt, request));
      const attempt = reusable || await perform(request);
      if (!reusable) scenarioAttempts.push(attempt);
      if (attempt.status !== 'completed' || !attempt.result) {
        earlyStop = { reason: 'execution_failed', seed: request.seed, repeat: request.repeat,
          ...(request.variant ? { variant: request.variant } : {}) };
        break;
      }
      fullResults.push(attempt.result);
      const reason = definitiveFailure(attempt.result, catalog.contract.qualification.minimumSeedScore);
      if (reason) {
        earlyStop = { reason, seed: request.seed, repeat: request.repeat,
          ...(request.variant ? { variant: request.variant } : {}) };
        break;
      }
    }
    const aggregate = !earlyStop && fullResults.length === scenarioPlan.full.length
      ? aggregateExecutionResults(fullResults, catalog.contract,
        catalog.scenarios.find((entry) => entry.id === scenarioPlan.scenarioId)) : null;
    const status = earlyStop ? 'failed' : aggregate?.verdict.status === 'passed' ? 'completed'
      : aggregate?.verdict.status || 'evidence_unavailable';
    scenarioSummaries.push({ ...scenarioPlan, attempts: scenarioAttempts,
      promotion: { status: 'promoted', to: scenarioPlan.fullStage }, earlyStop, aggregate, status });
  }

  const qualifyingSummaries = scenarioSummaries.filter((entry) => entry.purpose !== 'diagnostic');
  const status = qualifyingSummaries.some((entry) => entry.status === 'failed') ? 'failed'
    : qualifyingSummaries.some((entry) => entry.status === 'evidence_unavailable') ? 'evidence_unavailable' : 'completed';
  const summary = {
    schemaVersion: 'agent-kernel-execution-schedule/v1',
    identity: plan.identity,
    status,
    startedAt,
    finishedAt: now(),
    scenarios: scenarioSummaries,
    attempts,
  };
  atomicWriteJson(path.join(outputRoot, 'execution-schedule.json'), summary);
  return summary;
}

module.exports = {
  DEFAULT_CLI,
  buildExecutionCommand,
  executeLocalRun,
  planExecutionSchedule,
  runExecutionSchedule,
};
