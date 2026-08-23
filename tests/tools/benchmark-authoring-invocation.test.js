const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  AUTHORING_TIMEOUT_MS,
  authoringInvocation,
} = require('../../tools/remote-ollama-control/scripts/lib/benchmark-pipeline');
const { MANIFEST_NAME } = require('../../tools/remote-ollama-control/scripts/lib/content-gen-checkpoint');

const DAY_MS = 24 * 60 * 60 * 1000;

function retention() {
  return mkdtempSync(join(tmpdir(), 'ak-authoring-invocation-'));
}

function seedAuthoringRun(retentionDir, name, { manifest = true } = {}) {
  const dir = join(retentionDir, 'authoring', name);
  mkdirSync(dir, { recursive: true });
  if (manifest) {
    writeFileSync(join(dir, MANIFEST_NAME), `${JSON.stringify({
      schemaVersion: 'agent-kernel-content-gen-run-manifest/v1',
      startedAt: '2026-08-23T00:00:00.000Z',
      scenarioSet: { count: 100, sha256: 'catalog', tierCounts: {} },
      matrix: { sha256: 'matrix', maximumPasses: 3, configurationIds: ['cfg-a'] },
      scenarioIds: [1, 2],
    }, null, 2)}\n`);
  }
  return dir;
}

// The full nightly matrix is 7 configurations x 100 scenarios x up to 3 passes (700-2100 attempts).
// At the 58s/attempt rate the last recorded run observed, the ceiling is well past a day, so a 24h
// cap would SIGTERM the run it exists to protect.
test('the authoring timeout leaves room for a full matrix rather than capping it below one day', () => {
  assert.ok(
    AUTHORING_TIMEOUT_MS > DAY_MS,
    `authoring timeout ${AUTHORING_TIMEOUT_MS}ms must exceed 24h; the full matrix routinely runs longer`,
  );
  assert.equal(AUTHORING_TIMEOUT_MS, 72 * 60 * 60 * 1000);
});

test('an explicit timeout still wins over the default', () => {
  const invocation = authoringInvocation({
    sourceWorktree: '/src', retentionDir: retention(), timeoutMs: 1000,
  });
  assert.equal(invocation.timeoutMs, 1000);
});

test('a fresh retention directory starts a new run rather than resuming', () => {
  const invocation = authoringInvocation({ sourceWorktree: '/src', retentionDir: retention() });
  assert.equal(invocation.resumeDir, null);
  assert.ok(!invocation.args.includes('--resume'), 'a run with no prior evidence must not claim to resume');
});

// A killed run leaves a self-describing directory behind. The retention directory is keyed by
// runKey, which already covers source commit and all three identity hashes, so anything found here
// belongs to exactly this run -- resuming it cannot blend two catalogs.
test('a prior run with a manifest is resumed by explicit directory', () => {
  const retentionDir = retention();
  const dir = seedAuthoringRun(retentionDir, '2026-08-23T00-00-00-000Z-content-gen');
  const invocation = authoringInvocation({ sourceWorktree: '/src', retentionDir });
  assert.equal(invocation.resumeDir, dir);
  const flag = invocation.args.indexOf('--resume');
  assert.ok(flag > -1, 'prior attempts must be resumed, not discarded');
  assert.equal(invocation.args[flag + 1], dir, '--resume must name the directory, never rely on "latest"');
});

// Without a manifest the child refuses to resume and exits. Detecting that here keeps the failure
// as "start a fresh run" instead of an error the agent cannot act on.
test('a prior directory without a manifest is not resumable', () => {
  const retentionDir = retention();
  seedAuthoringRun(retentionDir, '2026-08-23T00-00-00-000Z-content-gen', { manifest: false });
  const invocation = authoringInvocation({ sourceWorktree: '/src', retentionDir });
  assert.equal(invocation.resumeDir, null);
  assert.ok(!invocation.args.includes('--resume'));
});

test('the newest prior run is the one resumed', () => {
  const retentionDir = retention();
  seedAuthoringRun(retentionDir, '2026-08-21T00-00-00-000Z-content-gen');
  const newest = seedAuthoringRun(retentionDir, '2026-08-22T00-00-00-000Z-content-gen');
  const invocation = authoringInvocation({ sourceWorktree: '/src', retentionDir });
  assert.equal(invocation.resumeDir, newest);
});

test('the authoring run is confined to its retention directory', () => {
  const retentionDir = retention();
  const invocation = authoringInvocation({ sourceWorktree: '/src', retentionDir });
  assert.equal(invocation.resultsDir, join(retentionDir, 'authoring'));
});

// ## TODO: Test Permutations
// - resume when runs.jsonl exists but is empty (manifest written, no attempt finished)
// - resume when the newest directory is complete and an older one is not
// - a retention directory whose authoring/ exists but holds no content-gen directory
// - timeoutMs of 0 and of a non-finite value
