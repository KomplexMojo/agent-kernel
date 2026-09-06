const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  DEFAULT_BRANCH,
  HEARTBEAT_NAME,
  INSTALL_MANIFEST_NAME,
  composeHeartbeat,
  publishHeartbeat,
  readInstallManifest,
} = require('../../tools/remote-ollama-control/scripts/lib/benchmark-heartbeat');

const AT = '2026-08-23T12:00:00.000Z';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function remoteRepository() {
  const root = mkdtempSync(join(tmpdir(), 'ak-heartbeat-'));
  const remote = join(root, 'remote.git');
  git(root, ['init', '--bare', '--quiet', remote]);
  return { root, remote };
}

function published(remote, ref = DEFAULT_BRANCH) {
  return JSON.parse(git(remote, [`--git-dir=${remote}`, 'show', `refs/heads/${ref}:${HEARTBEAT_NAME}`]));
}

test('a heartbeat must carry the timestamp the whole alarm depends on', () => {
  assert.throws(() => composeHeartbeat({ status: 'idle' }), /timestamp/);
  assert.throws(() => composeHeartbeat({ publishedAt: AT }), /status/);
});

// The nine-day dry-run stall was invisible because "idle, nothing changed" and "pinned to dry-run"
// looked the same from outside the box. The flag is explicit so a reader never has to infer it.
test('dry-run is stated outright rather than inferred from an absent run', () => {
  const beat = composeHeartbeat({ publishedAt: AT, status: 'dry_run', dryRun: true });
  assert.equal(beat.dryRun, true);
  assert.equal(beat.progress, null);
  const live = composeHeartbeat({ publishedAt: AT, status: 'idle' });
  assert.equal(live.dryRun, false);
});

// The document lands on a branch of a public repository. Topology has leaked into tracked files
// here before, so the composer emits a fixed shape and silently drops anything else.
test('host and route detail cannot ride along into the published document', () => {
  const beat = composeHeartbeat({
    publishedAt: AT,
    status: 'running',
    internalHost: '192.0.2.10',
    externalHost: 'example.invalid',
    route: 'external',
    sshPort: 2222,
  });
  const serialized = JSON.stringify(beat);
  for (const leak of ['192.0.2.10', 'example.invalid', '2222', 'external']) {
    assert.ok(!serialized.includes(leak), `heartbeat leaked ${leak}: ${serialized}`);
  }
  // Exhaustive on purpose: a new field must be added here deliberately, which is the moment to ask
  // whether it can carry topology. `agent` was added 2026-08-23 and carries a commit hash only.
  assert.deepEqual(Object.keys(beat).sort(), [
    'agent', 'dryRun', 'error', 'identity', 'lastPublishedRunId', 'progress',
    'publishedAt', 'runKey', 'schemaVersion', 'source', 'status', 'triggerReasons',
  ]);
});

test('an in-flight run carries its progress, and an idle agent reports null rather than omitting it', () => {
  const progress = { schemaVersion: 'agent-kernel-benchmark-progress/v1', attempts: { recorded: 12 } };
  const running = composeHeartbeat({ publishedAt: AT, status: 'running', progress });
  assert.deepEqual(running.progress, progress);
  const idle = composeHeartbeat({ publishedAt: AT, status: 'idle' });
  assert.ok('progress' in idle);
  assert.equal(idle.progress, null);
});

test('the heartbeat reaches the branch and reads back as published', () => {
  const { root, remote } = remoteRepository();
  const beat = composeHeartbeat({ publishedAt: AT, status: 'idle', sourceCommit: 'abc123' });
  const result = publishHeartbeat({ remote, workDir: join(root, 'beat'), heartbeat: beat });
  assert.equal(result.branch, DEFAULT_BRANCH);
  assert.deepEqual(published(remote), beat);
});

// A beat that dies after `checkout --orphan` and before the first commit leaves the worktree with
// no HEAD. The next timer fire used to hit "You are on a branch yet to be born" forever — silence,
// which is the one failure the alarm cannot distinguish from a dead box. Recover by wiping.
test('a worktree left on an unborn orphan branch still publishes the next beat', () => {
  const { root, remote } = remoteRepository();
  const workDir = join(root, 'beat');
  mkdirSync(workDir, { recursive: true });
  git(workDir, ['init', '--quiet', '.']);
  git(workDir, ['config', 'user.email', 'benchmark-agent@example.invalid']);
  git(workDir, ['config', 'user.name', 'Benchmark Agent']);
  git(workDir, ['checkout', '--quiet', '--orphan', 'beat-stranded']);
  writeFileSync(join(workDir, HEARTBEAT_NAME), '{}\n');
  git(workDir, ['add', '--', HEARTBEAT_NAME]);
  // Staged, no commit — the exact stranded shape seen on the runner for #133.
  assert.throws(() => git(workDir, ['rev-parse', '--verify', 'HEAD']), /Needed a single revision|unknown revision/);

  const beat = composeHeartbeat({ publishedAt: AT, status: 'idle' });
  publishHeartbeat({ remote, workDir, heartbeat: beat });
  assert.deepEqual(published(remote), beat);
});

// Thousands of beats a year, each superseding the last. History here would be pure noise, and the
// results branch -- which must stay append-only -- has to be unaffected by that choice.
test('republishing replaces the branch instead of growing it', () => {
  const { root, remote } = remoteRepository();
  const workDir = join(root, 'beat');
  for (const at of ['2026-08-23T12:00:00.000Z', '2026-08-23T12:05:00.000Z', '2026-08-23T12:10:00.000Z']) {
    publishHeartbeat({ remote, workDir, heartbeat: composeHeartbeat({ publishedAt: at, status: 'idle' }) });
  }
  const commits = git(remote, [`--git-dir=${remote}`, 'rev-list', '--count', `refs/heads/${DEFAULT_BRANCH}`]);
  assert.equal(commits, '1', 'the heartbeat branch must hold exactly one commit');
  assert.equal(published(remote).publishedAt, '2026-08-23T12:10:00.000Z');
});

test('the heartbeat branch is separate from the results branch', () => {
  const { root, remote } = remoteRepository();
  publishHeartbeat({
    remote, workDir: join(root, 'beat'), heartbeat: composeHeartbeat({ publishedAt: AT, status: 'idle' }),
  });
  const branches = git(remote, [`--git-dir=${remote}`, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  assert.deepEqual(branches.split('\n').filter(Boolean), [DEFAULT_BRANCH]);
});

// ## TODO: Test Permutations
// - publishing when the remote already holds an unrelated heartbeat branch with a longer history
// - a heartbeat carrying an error string from a failed poll
// - identity hashes partially absent
// - workDir that exists but is not a git repository

// The box runs an installed file copy, so a merge updates the source it checks out per run and
// never the agent itself. Nothing on the box can notice that, so the beacon carries the installed
// commit off-box for the alarm to compare against the default branch.
test('the beacon reports which agent code is running, not just which commit it polls', () => {
  const beat = composeHeartbeat({
    publishedAt: AT,
    status: 'running',
    dryRun: false,
    sourceCommit: 'ffffffffffffffffffffffffffffffffffffffff',
    agent: { installedCommit: '1111111111111111111111111111111111111111', installedAt: AT },
  });

  // The two are deliberately different values in this fixture: conflating them is the whole defect.
  assert.equal(beat.agent.installedCommit, '1111111111111111111111111111111111111111');
  assert.equal(beat.source.commit, 'ffffffffffffffffffffffffffffffffffffffff');
  assert.equal(beat.agent.installedAt, AT);
});

test('a runner with no install manifest reports null provenance rather than failing to beat', () => {
  const beat = composeHeartbeat({ publishedAt: AT, status: 'idle', dryRun: false });
  // Null, not absent: the checker distinguishes "predates this reporting" from "field missing".
  assert.equal(beat.agent, null);
  assert.equal('agent' in beat, true);

  const empty = mkdtempSync(join(tmpdir(), 'ak-no-manifest-'));
  assert.equal(readInstallManifest(empty), null);

  const corrupt = mkdtempSync(join(tmpdir(), 'ak-bad-manifest-'));
  writeFileSync(join(corrupt, INSTALL_MANIFEST_NAME), 'not json at all');
  // An unreadable manifest must not silence the beacon: losing liveness to report staleness is a
  // strictly worse trade than reporting unknown provenance.
  assert.equal(readInstallManifest(corrupt), null);
});

test('install provenance is read from the manifest the installer writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-manifest-'));
  writeFileSync(join(dir, INSTALL_MANIFEST_NAME), JSON.stringify({
    schemaVersion: 'agent-kernel-install-manifest/v1',
    installedAt: AT,
    sourceCommit: 'abc123abc123abc123abc123abc123abc123abcd',
    sourceRef: 'main',
  }));

  assert.deepEqual(readInstallManifest(dir), {
    installedCommit: 'abc123abc123abc123abc123abc123abc123abcd',
    installedAt: AT,
  });
});

test('provenance carries no address, port or route into the public document', () => {
  const beat = composeHeartbeat({
    publishedAt: AT,
    status: 'idle',
    dryRun: false,
    agent: {
      installedCommit: 'abc123abc123abc123abc123abc123abc123abcd',
      installedAt: AT,
      internalHost: '192.168.1.170',
      sshPort: 2222,
    },
  });

  const serialized = JSON.stringify(beat);
  assert.equal(serialized.includes('192.168.1.170'), false);
  assert.equal(serialized.includes('2222'), false);
  assert.deepEqual(Object.keys(beat.agent).sort(), ['installedAt', 'installedCommit']);
});
