'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const { hasCompletedRunKey, publishResult } = require('./lib/benchmark-publisher');
const { runBenchmarkPipeline } = require('./lib/benchmark-pipeline');
const { prepareBenchmarkSource } = require('./lib/benchmark-source');
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

function markEvaluated(state, sourceCommit, scenarioSetHash, matrixHash, executionSuiteHash) {
  state.lastEvaluatedCommit = sourceCommit;
  state.scenarioSetHash = scenarioSetHash;
  state.matrixHash = matrixHash;
  state.executionSuiteHash = executionSuiteHash;
  state.queuedCommit = null;
}

function publicationRecord({
  outcome, sourceCommit, sourceTree, sourceRef, sourceRepository, key,
  startedAt, completedAt, policy, trigger, previousEvaluatedCommit,
  scenarioSetHash, matrixHash, executionSuiteHash,
}) {
  const status = outcome.status || 'infrastructure_error';
  const defaultFailures = status === 'infrastructure_error'
    ? { infrastructure: { count: 1, reasons: [outcome.error || 'benchmark infrastructure error'] } }
    : {};
  const execution = outcome.execution || { status: 'not_run' };
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
      pathClasses: trigger.pathClasses || [],
      modes: trigger.modes,
      scenarioHashChanged: trigger.reasons.includes('scenario_hash'),
      matrixHashChanged: trigger.reasons.includes('matrix_hash'),
      executionSuiteHashChanged: trigger.reasons.includes('execution_suite_hash'),
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
    execution: { ...execution, identity: { executionSuiteHash, ...(execution.identity || {}) } },
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
    executionSuiteHash,
    runBenchmark,
    prepareSource = null,
    now = () => new Date(),
    dryRun = false,
  } = options;
  const policy = options.policy || loadTriggerPolicy(path.resolve(__dirname, '..'));
  const sourceRef = options.sourceRef || policy.sourceRef;
  const resultBranch = options.resultBranch || policy.resultBranch;
  const sourceRepository = options.sourceRepository || 'agent-kernel';
  if (!sourceRepo || !stateDir || (!dryRun && (!resultsRemote || typeof runBenchmark !== 'function'))) {
    throw new Error('sourceRepo and stateDir are required; live runs also require resultsRemote and runBenchmark');
  }
  for (const [name, value] of Object.entries({ scenarioSetHash, matrixHash, executionSuiteHash })) {
    if (typeof value !== 'string' || value === '') throw new Error(`${name} is required`);
  }

  const lock = acquireAgentLock(stateDir);
  if (!lock.acquired) return { status: 'locked' };

  try {
    const state = loadAgentState(stateDir);
    const sourceCommit = resolveSourceCommit(sourceRepo, sourceRef);
    const sourceTree = resolveTree(sourceRepo, sourceCommit);
    const previousEvaluatedCommit = state.lastEvaluatedCommit;
    const trigger = classifyTrigger({
      policy,
      polledRef: sourceRef,
      initial: state.lastEvaluatedCommit === null,
      changedPaths: changedPaths(sourceRepo, state.lastEvaluatedCommit, sourceCommit),
      scenarioHashChanged: state.scenarioSetHash !== null && state.scenarioSetHash !== scenarioSetHash,
      matrixHashChanged: state.matrixHash !== null && state.matrixHash !== matrixHash,
      executionSuiteHashChanged: state.lastEvaluatedCommit !== null
        && state.executionSuiteHash !== executionSuiteHash,
    });
    const key = computeRunKey({
      sourceCommit,
      scenarioSetHash,
      matrixHash,
      executionSuiteHash,
      runnerContractVersion: policy.runnerContractVersion,
    });

    if (dryRun) {
      return { status: 'dry_run', sourceCommit, runKey: key, trigger,
        identity: { scenarioSetHash, matrixHash, executionSuiteHash }, stateMutation: false };
    }

    if (!trigger.required) {
      markEvaluated(state, sourceCommit, scenarioSetHash, matrixHash, executionSuiteHash);
      saveAgentState(stateDir, state);
      return { status: 'no_trigger', sourceCommit, trigger };
    }

    if (completed(state, resultsRemote, resultBranch, key)) {
      markEvaluated(state, sourceCommit, scenarioSetHash, matrixHash, executionSuiteHash);
      state.completedRunKeys[key] = sourceCommit;
      saveAgentState(stateDir, state);
      return { status: 'deduplicated', sourceCommit, runKey: key };
    }

    const startedAt = now().toISOString();
    state.inFlight = { sourceCommit, runKey: key, startedAt };
    saveAgentState(stateDir, state);

    let outcome;
    let prepared = null;
    try {
      if (prepareSource) {
        prepared = await prepareSource({ sourceCommit, sourceTree, sourceRef, runKey: key, trigger });
        if (!prepared || typeof prepared.worktreePath !== 'string' || typeof prepared.cleanup !== 'function'
          || prepared.preflight?.status !== 'passed') {
          throw new Error('prepareSource returned an invalid prepared source');
        }
      }
      outcome = await runBenchmark({ sourceCommit, sourceTree, sourceRef, runKey: key, trigger,
        sourceWorktree: prepared?.worktreePath || null, preflight: prepared?.preflight || null });
    } catch (error) {
      outcome = { status: 'infrastructure_error', qualifies: false, error: error.message,
        ...(error.preflight?.retentionId ? { artifacts: { retentionId: error.preflight.retentionId } } : {}) };
    } finally {
      if (prepared) {
        try {
          prepared.cleanup();
        } catch (error) {
          outcome = { status: 'infrastructure_error', qualifies: false,
            error: `source worktree cleanup failed: ${error.message}`,
            ...(prepared.preflight?.retentionId
              ? { artifacts: { retentionId: prepared.preflight.retentionId } } : {}) };
        }
      }
    }
    const completedAt = now().toISOString();
    const record = publicationRecord({
      outcome,
      sourceCommit,
      sourceTree,
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
      executionSuiteHash,
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
      markEvaluated(state, sourceCommit, scenarioSetHash, matrixHash, executionSuiteHash);
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
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) throw new Error(`Expected option, received ${argv[index]}`);
    const name = argv[index].slice(2);
    if (name === 'dry-run' || name === 'service' || name === 'live') {
      values[name] = true;
      continue;
    }
    if (argv[index + 1] === undefined) throw new Error(`Expected a value after ${argv[index]}`);
    values[name] = argv[index + 1];
    index += 1;
  }
  return values;
}

function envValue(args, name, envName, fallback) {
  return args[name] ?? process.env[envName] ?? fallback;
}

function ensureSourceMirror(remote, sourceRef, mirrorDir) {
  const fs = require('fs');
  fs.mkdirSync(path.dirname(mirrorDir), { recursive: true });
  if (!fs.existsSync(path.join(mirrorDir, 'HEAD'))) {
    execFileSync('git', ['clone', '--mirror', remote, mirrorDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    git(mirrorDir, ['remote', 'set-url', 'origin', remote]);
  }
  git(mirrorDir, ['fetch', '--prune', 'origin', `+refs/heads/${sourceRef}:refs/heads/${sourceRef}`]);
  return mirrorDir;
}

async function main() {
  const fs = require('fs');
  const args = parseArgs(process.argv.slice(2));
  const home = process.env.HOME;
  if (!home) throw new Error('HOME is required');
  const sourceRemote = envValue(args, 'source-remote', 'AK_BENCHMARK_SOURCE_REMOTE');
  const sourceRef = envValue(args, 'source-ref', 'AK_BENCHMARK_SOURCE_REF', 'main');
  const dryRun = Boolean(args['dry-run']) || envValue(args, 'dry-run', 'AK_BENCHMARK_DRY_RUN', '0') === '1';
  const liveEnabled = Boolean(args.live) || envValue(args, 'live', 'AK_BENCHMARK_LIVE', '0') === '1';
  const fixturePath = envValue(args, 'fixture-result', 'AK_BENCHMARK_FIXTURE_RESULT');
  if (!sourceRemote) throw new Error('AK_BENCHMARK_SOURCE_REMOTE or --source-remote is required');
  if (!dryRun && !fixturePath && !liveEnabled) {
    throw new Error('Live pipeline execution is operator-gated; set AK_BENCHMARK_LIVE=1 or use dry-run/fixture evidence');
  }
  const mirrorDir = envValue(
    args,
    'source-mirror',
    'AK_BENCHMARK_SOURCE_MIRROR',
    path.join(home, '.local/share/agent-kernel-benchmark/source.git'),
  );
  const stateDir = envValue(
    args,
    'state-dir',
    'AK_BENCHMARK_STATE_DIR',
    path.join(home, '.local/state/agent-kernel-benchmark'),
  );
  const sourceRepo = ensureSourceMirror(sourceRemote, sourceRef, mirrorDir);
  const fixture = fixturePath ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : null;
  const scenarioSetHash = envValue(args, 'scenario-hash', 'AK_BENCHMARK_SCENARIO_HASH');
  const matrixHash = envValue(args, 'matrix-hash', 'AK_BENCHMARK_MATRIX_HASH');
  const executionSuiteHash = envValue(args, 'execution-suite-hash', 'AK_BENCHMARK_EXECUTION_SUITE_HASH');
  const result = await runBenchmarkAgent({
    sourceRepo,
    sourceRef,
    sourceRepository: envValue(args, 'source-repository', 'AK_BENCHMARK_SOURCE_REPOSITORY', 'agent-kernel'),
    resultsRemote: envValue(args, 'results-remote', 'AK_BENCHMARK_RESULTS_REMOTE'),
    resultBranch: envValue(args, 'result-branch', 'AK_BENCHMARK_RESULT_BRANCH', 'benchmark-results'),
    stateDir,
    scenarioSetHash,
    matrixHash,
    executionSuiteHash,
    dryRun,
    prepareSource: (context) => prepareBenchmarkSource({
      sourceRepo, stateDir, sourceCommit: context.sourceCommit, sourceTree: context.sourceTree,
      runKey: context.runKey,
    }),
    runBenchmark: async (context) => fixture || runBenchmarkPipeline({
      sourceWorktree: context.sourceWorktree,
      stateDir,
      runKey: context.runKey,
      trigger: context.trigger,
      scenarioSetHash,
      matrixHash,
      executionSuiteHash,
    }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  changedPaths,
  ensureSourceMirror,
  publicationRecord,
  resolveSourceCommit,
  runBenchmarkAgent,
};
