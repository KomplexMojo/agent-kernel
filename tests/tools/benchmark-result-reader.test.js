const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const {
  RESULT_SCHEMA_VERSION,
  currentBenchmarkIdentity,
  readPublishedBenchmarkResult,
  validateCanonicalScenarioCountDocumentation,
  validatePublishedBenchmarkResult,
} = require('../../tools/remote-ollama-control/scripts/lib/benchmark-result-reader');

const ROOT = resolve(__dirname, '../..');
const identity = currentBenchmarkIdentity(resolve(ROOT, 'tools/remote-ollama-control'));

function record(overrides = {}) {
  return {
    schemaVersion: 'agent-kernel-benchmark-result/v2',
    run: { id: 'fixture', status: 'completed' },
    scenarioSet: { ...identity.scenarioSet },
    matrix: { ...identity.matrix },
    execution: { identity: { ...identity.execution } },
    qualifies: true,
    ...overrides,
  };
}

const legacyV1 = JSON.parse(readFileSync(resolve(
  ROOT, 'tests/fixtures/benchmarks/published-result-v1-legacy.json',
), 'utf8'));

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('published result validation refuses schema, scenario, matrix, and execution identity drift', () => {
  const schema = JSON.parse(readFileSync(resolve(
    ROOT, 'tools/remote-ollama-control/benchmarks/result.schema.json',
  ), 'utf8'));
  assert.equal(schema.$id, RESULT_SCHEMA_VERSION);
  assert.equal(schema.properties.schemaVersion.const, RESULT_SCHEMA_VERSION);
  assert.equal(validatePublishedBenchmarkResult(record(), identity).run.id, 'fixture');
  assert.throws(() => validatePublishedBenchmarkResult(record({ schemaVersion: 'v0' }), identity), /schema/);
  assert.throws(() => validatePublishedBenchmarkResult(record({
    scenarioSet: { count: identity.scenarioSet.count - 1, sha256: identity.scenarioSet.sha256 },
  }), identity), /scenario count mismatch/);
  assert.throws(() => validatePublishedBenchmarkResult(record({
    scenarioSet: { count: identity.scenarioSet.count, sha256: '0'.repeat(64) },
  }), identity), /scenario-set hash mismatch/);
  assert.throws(() => validatePublishedBenchmarkResult(record({
    matrix: { sha256: '1'.repeat(64) },
  }), identity), /matrix hash mismatch/);
  assert.throws(() => validatePublishedBenchmarkResult(record({
    execution: { identity: { ...identity.execution, executionSuiteHash: '2'.repeat(64) } },
  }), identity), /execution-suite hash mismatch/);
  assert.throws(() => validatePublishedBenchmarkResult(record({ execution: { identity: {} } }), identity),
    /published execution-suite hash/);
  assert.throws(() => validatePublishedBenchmarkResult(record({ qualifies: 'yes' }), identity), /qualification verdict/);
  assert.throws(() => validatePublishedBenchmarkResult(record({ run: { status: 'completed' } }), identity), /run status/);
});

test('reader distinguishes the latest attempt from the latest qualifying result', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ak-result-reader-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'benchmark@example.invalid']);
  git(repo, ['config', 'user.name', 'Benchmark Fixture']);
  writeFileSync(join(repo, 'latest.json'), `${JSON.stringify(record({
    run: { id: 'failed-latest', status: 'infrastructure_error' },
    qualifies: false,
  }))}\n`);
  writeFileSync(join(repo, 'latest-success.json'), `${JSON.stringify(record({
    run: { id: 'qualified-prior', status: 'completed' },
  }))}\n`);
  git(repo, ['add', 'latest.json', 'latest-success.json']);
  git(repo, ['commit', '-m', 'fixture results']);

  assert.equal(readPublishedBenchmarkResult({
    repoRoot: repo, ref: 'HEAD', selection: 'latest_attempt', expectedIdentity: identity,
  }).record.run.id, 'failed-latest');
  assert.equal(readPublishedBenchmarkResult({
    repoRoot: repo, ref: 'HEAD', selection: 'latest_success', expectedIdentity: identity,
  }).record.run.id, 'qualified-prior');
  assert.throws(() => readPublishedBenchmarkResult({
    repoRoot: repo, ref: 'HEAD', selection: 'unknown', expectedIdentity: identity,
  }), /unknown benchmark result selection/);
});

test('legacy v1 remains readable only as historical incomparable evidence', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ak-result-reader-v1-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'benchmark@example.invalid']);
  git(repo, ['config', 'user.name', 'Benchmark Fixture']);
  writeFileSync(join(repo, 'latest.json'), `${JSON.stringify(legacyV1)}\n`);
  git(repo, ['add', 'latest.json']);
  git(repo, ['commit', '-m', 'legacy fixture']);

  const result = readPublishedBenchmarkResult({
    repoRoot: repo, ref: 'HEAD', selection: 'latest_attempt', expectedIdentity: identity,
  });
  assert.equal(result.record.run.id, legacyV1.run.id);
  assert.equal(result.compatibility.status, 'historical_incomparable');
  assert.match(result.compatibility.reasons.join(' '), /legacy v1.*execution identity/i);
});

test('missing latest success reports no qualifying evidence', () => {
  const repo = mkdtempSync(join(tmpdir(), 'ak-result-reader-empty-success-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'benchmark@example.invalid']);
  git(repo, ['config', 'user.name', 'Benchmark Fixture']);
  writeFileSync(join(repo, 'latest.json'), `${JSON.stringify(record({ qualifies: false }))}\n`);
  git(repo, ['add', 'latest.json']);
  git(repo, ['commit', '-m', 'attempt only']);

  const result = readPublishedBenchmarkResult({
    repoRoot: repo, ref: 'HEAD', selection: 'latest_success', expectedIdentity: identity,
  });
  assert.equal(result.record, null);
  assert.equal(result.compatibility.status, 'no_qualifying_evidence');
});

test('benchmark consumption docs derive the canonical count from the catalog', () => {
  assert.match(identity.execution.executionSuiteHash, /^[a-f0-9]{64}$/);
  assert.equal(identity.execution.evaluatorVersion, 'execution-evaluator-v2');
  const paths = ['AGENTS.md', 'CLAUDE.md', 'tools/remote-ollama-control/README.md', 'tools/benchmark/README.md'];
  for (const filePath of paths) {
    validateCanonicalScenarioCountDocumentation(
      readFileSync(resolve(ROOT, filePath), 'utf8'), identity.scenarioSet.count, filePath,
    );
  }
  assert.throws(() => validateCanonicalScenarioCountDocumentation(
    'Canonical content-gen scenario count: 64 (source: `loadScenarioCatalog()`)',
    identity.scenarioSet.count,
    'stale.md',
  ), /stale canonical scenario count/);
});

// ## TODO: Test Permutations
// - a missing latest-success.json reports that no qualifying evidence exists
// - malformed Git result JSON fails without falling back to latest attempt
// - uppercase or truncated identity hashes are rejected
