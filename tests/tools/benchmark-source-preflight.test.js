const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const { runBenchmarkAgent } = require('../../tools/remote-ollama-control/scripts/benchmark-agent');
const {
  prepareBenchmarkSource,
  removeOwnedWorktree,
} = require('../../tools/remote-ollama-control/scripts/lib/benchmark-source');
const { loadTriggerPolicy } = require('../../tools/remote-ollama-control/scripts/lib/benchmark-trigger');

const TOOL_ROOT = resolve(__dirname, '../../tools/remote-ollama-control');
const POLICY = loadTriggerPolicy(TOOL_ROOT);

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function setupRepository() {
  const root = mkdtempSync(join(tmpdir(), 'ak-benchmark-source-'));
  const remote = join(root, 'remote.git');
  const operator = join(root, 'operator');
  git(root, ['init', '--bare', remote]);
  git(root, ['clone', remote, operator]);
  git(operator, ['config', 'user.email', 'benchmark@example.invalid']);
  git(operator, ['config', 'user.name', 'Benchmark Fixture']);
  writeFileSync(join(operator, 'marker.txt'), 'source-v1\n');
  git(operator, ['add', 'marker.txt']);
  git(operator, ['commit', '-m', 'source v1']);
  git(operator, ['branch', '-M', 'main']);
  git(operator, ['push', '-u', 'origin', 'main']);
  const firstCommit = git(operator, ['rev-parse', 'HEAD']);
  const firstTree = git(operator, ['rev-parse', 'HEAD^{tree}']);
  writeFileSync(join(operator, 'marker.txt'), 'source-v2\n');
  git(operator, ['commit', '-am', 'source v2']);
  git(operator, ['push', 'origin', 'main']);
  const secondTree = git(operator, ['rev-parse', 'HEAD^{tree}']);
  writeFileSync(join(operator, 'operator-dirty.txt'), 'preserve\n');
  return { root, remote, operator, firstCommit, firstTree, secondTree };
}

function markerStep(expected = 'source-v1') {
  return [{
    id: 'marker',
    command: process.execPath,
    args: ['-e', [
      "const fs=require('fs')",
      `if(fs.readFileSync('marker.txt','utf8').trim()!==${JSON.stringify(expected)})process.exit(9)`,
      "process.stdout.write('x'.repeat(4096))",
    ].join(';')],
  }];
}

test('source preflight uses the exact detached commit, bounds logs, and preserves the operator checkout', async () => {
  const repo = setupRepository();
  const stateDir = join(repo.root, 'state');
  const prepared = await prepareBenchmarkSource({
    sourceRepo: repo.remote,
    sourceCommit: repo.firstCommit,
    sourceTree: repo.firstTree,
    stateDir,
    runKey: 'a'.repeat(64),
    steps: markerStep(),
    maxLogBytes: 256,
  });
  assert.equal(git(prepared.worktreePath, ['rev-parse', 'HEAD']), repo.firstCommit);
  assert.equal(git(prepared.worktreePath, ['rev-parse', 'HEAD^{tree}']), repo.firstTree);
  assert.equal(readFileSync(join(prepared.worktreePath, 'marker.txt'), 'utf8'), 'source-v1\n');
  assert.equal(prepared.preflight.status, 'passed');
  assert.equal(prepared.preflight.steps[0].exitCode, 0);
  assert.ok(statSync(join(stateDir, prepared.preflight.steps[0].log)).size <= 256);
  assert.equal(readFileSync(join(repo.operator, 'operator-dirty.txt'), 'utf8'), 'preserve\n');
  assert.throws(() => removeOwnedWorktree(
    repo.remote, join(stateDir, 'source-worktrees'), repo.operator,
  ), /refusing to remove non-owned worktree/i);
  prepared.cleanup();
  assert.equal(existsSync(prepared.worktreePath), false);
  assert.equal(git(repo.operator, ['status', '--short']), '?? operator-dirty.txt');
});

test('source identity mismatch fails before configured commands and cleans the owned worktree', async () => {
  const repo = setupRepository();
  const stateDir = join(repo.root, 'state');
  const sentinel = join(repo.root, 'preflight-command-ran');
  let failure;
  try {
    await prepareBenchmarkSource({
      sourceRepo: repo.remote,
      sourceCommit: repo.firstCommit,
      sourceTree: repo.secondTree,
      stateDir,
      runKey: 'd'.repeat(64),
      steps: [{ id: 'must_not_run', command: process.execPath,
        args: ['-e', `require('fs').writeFileSync(${JSON.stringify(sentinel)},'bad')`] }],
    });
  } catch (error) {
    failure = error;
  }
  assert.match(failure?.message || '', /source identity mismatch/i);
  assert.equal(existsSync(sentinel), false);
  assert.equal(existsSync(failure.worktreePath), false);
});

test('source preflight recovers an owned stale worktree and retains a failed gate without running onward', async () => {
  const repo = setupRepository();
  const stateDir = join(repo.root, 'state');
  const stale = await prepareBenchmarkSource({
    sourceRepo: repo.remote, sourceCommit: repo.firstCommit, sourceTree: repo.firstTree,
    stateDir, runKey: 'b'.repeat(64), steps: markerStep(),
  });
  writeFileSync(join(stale.worktreePath, 'stale-untracked.txt'), 'discardable owned state\n');
  const recovered = await prepareBenchmarkSource({
    sourceRepo: repo.remote, sourceCommit: repo.firstCommit, sourceTree: repo.firstTree,
    stateDir, runKey: 'b'.repeat(64), steps: markerStep(),
  });
  assert.equal(existsSync(join(recovered.worktreePath, 'stale-untracked.txt')), false);
  recovered.cleanup();

  let failure;
  try {
    await prepareBenchmarkSource({
      sourceRepo: repo.remote, sourceCommit: repo.firstCommit, sourceTree: repo.firstTree,
      stateDir, runKey: 'c'.repeat(64),
      steps: [{ id: 'fail', command: process.execPath,
        args: ['-e', "process.stderr.write('fixture gate failed');process.exit(7)"] }],
    });
  } catch (error) {
    failure = error;
  }
  assert.match(failure?.message || '', /preflight fail failed/i);
  assert.equal(failure.preflight.status, 'failed');
  assert.equal(failure.preflight.steps[0].exitCode, 7);
  assert.match(readFileSync(join(stateDir, failure.preflight.steps[0].log), 'utf8'), /fixture gate failed/);
  assert.equal(existsSync(failure.worktreePath), false);
});

test('benchmark agent never invokes the benchmark callback after a source preflight failure', async () => {
  const repo = setupRepository();
  let benchmarkCalls = 0;
  const result = await runBenchmarkAgent({
    sourceRepo: repo.remote,
    sourceRef: 'main',
    resultsRemote: repo.remote,
    resultBranch: 'benchmark-results',
    stateDir: join(repo.root, 'agent-state'),
    policy: POLICY,
    scenarioSetHash: 'scenario-a',
    matrixHash: 'matrix-a',
    executionSuiteHash: 'execution-a',
    prepareSource: async () => {
      const error = new Error('dependency gate failed');
      error.preflight = { status: 'failed', retentionId: 'preflights/fixture', steps: [] };
      throw error;
    },
    runBenchmark: async () => { benchmarkCalls += 1; return { status: 'completed', qualifies: true }; },
  });
  assert.equal(result.status, 'published');
  assert.equal(result.record.run.status, 'infrastructure_error');
  assert.equal(result.record.artifacts.retentionId, 'preflights/fixture');
  assert.equal(benchmarkCalls, 0);
});

// ## TODO: Test Permutations
// - cleanup failure becomes infrastructure evidence and never advances completed state
// - a command killed by signal retains the signal and bounded stderr
