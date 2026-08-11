'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const { hasCompletedRunKey, publishResult } = require('./lib/benchmark-publisher');
const { acquireAgentLock, loadAgentState, saveAgentState } = require('./lib/benchmark-state');
const { classifyTrigger, computeRunKey, loadTriggerPolicy } = require('./lib/benchmark-trigger');

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function resolveSourceCommit(sourceRepo, sourceRef) {
  return git(sourceRepo, ['rev-parse', `refs/heads/${sourceRef}`]);
}

function resolveTree(sourceRepo, sourceCommit) {
  return git(sourceRepo, ['rev-parse', `${sourceCommit}^{tree}`]);
}

function changedPaths(sourceRepo, previousCommit, sourceCommit) {
  if (!previousCommit || previousCommit === sourceCommit) return [];
  return git(sourceRepo, ['diff', '--name-only', previousCommit, sourceCommit])
    .split('\n')
    .filter(Boolean);
}

function runId(sourceCommit, runKey, startedAt) {
  return `${startedAt.replace(/[:.]/g, '-')}-${sourceCommit.slice(0, 12)}-${runKey.slice(0, 12)}`;
}

function completed(state, remote, resultBranch, key) {
  return Boolean(state.completedRunKeys[key]) || hasCompletedRunKey(remote, resultBranch, key);
}

function markEvaluated(state, sourceCommit, scenarioSetHash, matrixHash) {
  state.lastEvaluatedCommit = sourceCommit;
  state.scenarioSetHash = scenarioSetHash;
  state.matrixHash = matrixHash;
  state.queuedCommit = null;
}

function publicationRecord({
  outcome, sourceCommit, sourceTree, sourceRef, sourceRepository, key,
  startedAt, completedAt, policy, trigger, previousEvaluatedCommit,
  scenarioSetHash, matrixHash,
}) {
  const status = outcome.status || 'infrastructure_error';
  const defaultFailures = status === 'infrastructure_error'
    ? { infrastructure: { count: 1, reasons: [outcome.error || 'benchmark infrastructure error'] } }
    : {};
  return {
    schemaVersion: 'agent-kernel-benchmark-result/v1',
    run: {
      id: runId(sourceCommit, key, startedAt),
      key,
      status,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      runnerContractVersion: policy.runnerContractVersion,
    },
    source: { repository: sourceRepository, ref: sourceRef, commit: sourceCommit, tree: sourceTree },
    trigger: {
      previousEvaluatedCommit,
      reasons: trigger.reasons,
      relevantPaths: trigger.relevantPaths || [],
      scenarioHashChanged: trigger.reasons.includes('scenario_hash'),
      matrixHashChanged: trigger.reasons.includes('matrix_hash'),
    },
    scenarioSet: outcome.scenarioSet || {
      catalogPath: 'tools/remote-ollama-control/benchmarks/content-gen',
      count: 0,
      sha256: scenarioSetHash,
      tierCounts: {},
    },
    matrix: outcome.matrix || {
      sha256: matrixHash,
      configurationIds: [],
      repeatPolicy: {},
    },
    thresholds: outcome.thresholds || {},
    configurations: outcome.configurations || [],
    execution: outcome.execution || { status: 'not_run' },
    minimumSuccessfulConfiguration: outcome.minimumSuccessfulConfiguration ?? null,
    paretoFrontier: outcome.paretoFrontier || [],
    comparison: outcome.comparison || { comparable: false, incomparabilityReasons: ['no prior comparable result'] },
    failures: outcome.failures || defaultFailures,
    artifacts: outcome.artifacts || { retentionId: null },
    qualifies: outcome.qualifies === true,
  };
}

async function runBenchmarkAgent(options) {
  const {
    sourceRepo,
    resultsRemote,
    stateDir,
    scenarioSetHash,
    matrixHash,
    runBenchmark,
    now = () => new Date(),
  } = options;
  const policy = options.policy || loadTriggerPolicy(path.resolve(__dirname, '..'));
  const sourceRef = options.sourceRef || policy.sourceRef;
  const resultBranch = options.resultBranch || policy.resultBranch;
  const sourceRepository = options.sourceRepository || 'agent-kernel';
  if (!sourceRepo || !resultsRemote || !stateDir || typeof runBenchmark !== 'function') {
    throw new Error('sourceRepo, resultsRemote, stateDir, and runBenchmark are required');
  }

  const lock = acquireAgentLock(stateDir);
  if (!lock.acquired) return { status: 'locked' };

  try {
    const state = loadAgentState(stateDir);
    const sourceCommit = resolveSourceCommit(sourceRepo, sourceRef);
    const previousEvaluatedCommit = state.lastEvaluatedCommit;
    const trigger = classifyTrigger({
      policy,
      polledRef: sourceRef,
      initial: state.lastEvaluatedCommit === null,
      changedPaths: changedPaths(sourceRepo, state.lastEvaluatedCommit, sourceCommit),
      scenarioHashChanged: state.scenarioSetHash !== null && state.scenarioSetHash !== scenarioSetHash,
      matrixHashChanged: state.matrixHash !== null && state.matrixHash !== matrixHash,
    });
    const key = computeRunKey({
      sourceCommit,
      scenarioSetHash,
      matrixHash,
      runnerContractVersion: policy.runnerContractVersion,
    });

    if (!trigger.required) {
      markEvaluated(state, sourceCommit, scenarioSetHash, matrixHash);
      saveAgentState(stateDir, state);
      return { status: 'no_trigger', sourceCommit, trigger };
    }

    if (completed(state, resultsRemote, resultBranch, key)) {
      markEvaluated(state, sourceCommit, scenarioSetHash, matrixHash);
      state.completedRunKeys[key] = sourceCommit;
      saveAgentState(stateDir, state);
      return { status: 'deduplicated', sourceCommit, runKey: key };
    }

    const startedAt = now().toISOString();
    state.inFlight = { sourceCommit, runKey: key, startedAt };
    saveAgentState(stateDir, state);

    let outcome;
    try {
      outcome = await runBenchmark({ sourceCommit, sourceRef, runKey: key, trigger });
    } catch (error) {
      outcome = { status: 'infrastructure_error', qualifies: false, error: error.message };
    }
    const completedAt = now().toISOString();
    const record = publicationRecord({
      outcome,
      sourceCommit,
      sourceTree: resolveTree(sourceRepo, sourceCommit),
      sourceRef,
      sourceRepository,
      key,
      startedAt,
      completedAt,
      policy,
      trigger,
      previousEvaluatedCommit,
      scenarioSetHash,
      matrixHash,
    });
    await publishResult({
      remote: resultsRemote,
      branch: resultBranch,
      workDir: path.join(stateDir, 'results-worktree'),
      record,
      beforePush: options.beforePush,
    });

    state.inFlight = null;
    if (record.run.status === 'completed') {
      markEvaluated(state, sourceCommit, scenarioSetHash, matrixHash);
      state.completedRunKeys[key] = record.run.id;
    }
    const newestCommit = resolveSourceCommit(sourceRepo, sourceRef);
    state.queuedCommit = newestCommit !== sourceCommit ? newestCommit : null;
    saveAgentState(stateDir, state);
    return {
      status: 'published',
      record,
      queuedCommit: state.queuedCommit,
    };
  } finally {
    lock.release();
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--') || argv[index + 1] === undefined) {
      throw new Error(`Expected --name value, received ${argv[index]}`);
    }
    values[argv[index].slice(2)] = argv[index + 1];
  }
  return values;
}

async function main() {
  const fs = require('fs');
  const args = parseArgs(process.argv.slice(2));
  if (!args['fixture-result']) throw new Error('M4a CLI requires --fixture-result; live execution arrives in M4b');
  const fixture = JSON.parse(fs.readFileSync(args['fixture-result'], 'utf8'));
  const result = await runBenchmarkAgent({
    sourceRepo: args['source-repo'],
    sourceRef: args['source-ref'],
    resultsRemote: args['results-remote'],
    resultBranch: args['result-branch'],
    stateDir: args['state-dir'],
    scenarioSetHash: args['scenario-hash'],
    matrixHash: args['matrix-hash'],
    runBenchmark: async () => fixture,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { changedPaths, publicationRecord, resolveSourceCommit, runBenchmarkAgent };
