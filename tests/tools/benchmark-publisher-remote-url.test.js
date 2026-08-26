const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  hasCompletedRunKey,
  publishResult,
  readJsonFromBranch,
} = require('../../tools/remote-ollama-control/scripts/lib/benchmark-publisher');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function record(id, key = 'K1') {
  return {
    schemaVersion: 'agent-kernel-benchmark-result/v2',
    run: { id, key, status: 'completed', startedAt: '2026-08-23T00:00:00.000Z' },
  };
}

// The remote is addressed by URL, exactly as AK_BENCHMARK_RESULTS_REMOTE does in production. Every
// pre-existing test in this suite passed a local bare PATH, where `git --git-dir=<path>` happens to
// work -- so the whole class of "cannot read a branch through a URL" was invisible.
function seededRemote() {
  const root = mkdtempSync(join(tmpdir(), 'ak-publisher-url-'));
  const bare = join(root, 'remote.git');
  git(root, ['init', '--bare', '--quiet', bare]);
  const seed = join(root, 'seed');
  git(root, ['clone', '--quiet', bare, seed]);
  git(seed, ['config', 'user.email', 'seed@example.invalid']);
  git(seed, ['config', 'user.name', 'Seed']);
  writeFileSync(join(seed, 'latest.json'), `${JSON.stringify(record('existing', 'K0'), null, 2)}\n`);
  git(seed, ['add', '.']);
  git(seed, ['commit', '--quiet', '-m', 'existing']);
  git(seed, ['branch', '-M', 'benchmark-results']);
  git(seed, ['push', '--quiet', '-u', 'origin', 'benchmark-results']);
  return { root, url: `file://${bare}`, bare };
}

test('a published result lands on a URL remote without discarding what is already there', async () => {
  const { root, url, bare } = seededRemote();
  await publishResult({
    remote: url, branch: 'benchmark-results', workDir: join(root, 'work'), record: record('newrun'),
  });
  // The prior commit must still be an ancestor. An orphan checkout would have replaced the branch,
  // and forcing that through would destroy every published result.
  const history = git(root, [`--git-dir=${bare}`, 'log', '--format=%s', 'refs/heads/benchmark-results']);
  assert.ok(history.includes('existing'), `existing history was discarded:\n${history}`);
  assert.ok(history.includes('benchmark: newrun'));
  const parents = git(root, [`--git-dir=${bare}`, 'rev-list', '--count', 'refs/heads/benchmark-results']);
  assert.equal(parents, '2', 'the new result must build on the existing branch, not replace it');
});

test('a branch on a URL remote is readable', () => {
  const { root, url } = seededRemote();
  const latest = readJsonFromBranch(url, 'benchmark-results', 'latest.json', join(root, 'cache'));
  assert.equal(latest?.run?.id, 'existing');
});

test('a local bare path still reads directly, with no clone', () => {
  const { bare } = seededRemote();
  assert.equal(readJsonFromBranch(bare, 'benchmark-results', 'latest.json')?.run?.id, 'existing');
});

test('an absent branch reads as absent rather than throwing', () => {
  const { root, url } = seededRemote();
  assert.equal(readJsonFromBranch(url, 'no-such-branch', 'latest.json', join(root, 'cache')), null);
});

// Dedup is what stops a multi-day benchmark being re-run for a key already published. Answering
// "false" with confidence through a URL made the remote half of that check dead weight.
test('a completed run key is recognised through a URL remote', () => {
  const { root, url } = seededRemote();
  assert.equal(hasCompletedRunKey(url, 'benchmark-results', 'K0', join(root, 'cache')), true);
  assert.equal(hasCompletedRunKey(url, 'benchmark-results', 'nope', join(root, 'cache')), false);
});

test('publishing twice to a URL remote appends rather than conflicting', async () => {
  const { root, url, bare } = seededRemote();
  const workDir = join(root, 'work');
  await publishResult({ remote: url, branch: 'benchmark-results', workDir, record: record('first', 'K1') });
  await publishResult({ remote: url, branch: 'benchmark-results', workDir, record: record('second', 'K2') });
  assert.equal(git(root, [`--git-dir=${bare}`, 'rev-list', '--count', 'refs/heads/benchmark-results']), '3');
});

// ## TODO: Test Permutations
// - a URL remote whose branch does not exist yet (first ever publication)
// - a cache directory that exists but was cloned from a different remote
// - concurrent publishers racing on the same workDir
// - a remote path that exists locally but is not a git repository

// A bootstrap publish must carry EVIDENCE ONLY.
//
// `git checkout --orphan` starts a new history but keeps the index, and the publisher runs inside a
// mirror of the source repo. So the first ever commit swept the whole source tree onto the evidence
// branch -- 1496 files, 15.9 MB of packages/ tests/ and .github/ against ~0 MB of results -- and
// every commit after it inherited them. Nothing caught it because the branch was never wrong in a
// way that broke a publish.
test("a bootstrap publish commits evidence only, never the source tree", () => {
  const { execFileSync } = require("node:child_process");
  const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { join } = require("node:path");
  const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" });

  // A "source repo" the publisher would be mirroring, with a file that must not travel.
  const repo = mkdtempSync(join(tmpdir(), "pub-src-"));
  git(repo, ["init", "--quiet", "-b", "main", "."]);
  git(repo, ["config", "user.email", "t@t"]); git(repo, ["config", "user.name", "t"]);
  mkdirSync(join(repo, "packages"), { recursive: true });
  writeFileSync(join(repo, "packages", "runtime.js"), "// source, must not reach the evidence branch\n");
  git(repo, ["add", "-A"]); git(repo, ["commit", "--quiet", "-m", "source"]);

  // What prepareCheckout does on the bootstrap path.
  git(repo, ["checkout", "--orphan", "benchmark-results"]);
  git(repo, ["rm", "-rf", "--cached", "--ignore-unmatch", "."]);
  mkdirSync(join(repo, "history", "2026", "08"), { recursive: true });
  writeFileSync(join(repo, "history", "2026", "08", "run.json"), "{}\n");
  writeFileSync(join(repo, "latest.json"), "{}\n");
  git(repo, ["add", "--", "history", "latest.json"]);
  git(repo, ["commit", "--quiet", "-m", "benchmark: run"]);

  const tracked = git(repo, ["ls-tree", "-r", "--name-only", "HEAD"]).trim().split("\n").sort();
  assert.deepEqual(
    tracked, ["history/2026/08/run.json", "latest.json"],
    "the bootstrap commit carried files beyond the evidence — the index was not cleared after the "
    + "orphan checkout, which is how 15.9 MB of source ended up on benchmark-results",
  );
});

// The clearing must NOT happen on the existing-branch path: the publisher's own docblock warns that
// dropping prior results there is "not a failed publish, it is a destroyed archive".
test("the index is cleared only on the orphan path, never for an existing branch", () => {
  const { readFileSync } = require("node:fs");
  const { resolve } = require("node:path");
  const src = readFileSync(
    resolve(__dirname, "../../tools/remote-ollama-control/scripts/lib/benchmark-publisher.js"), "utf8");
  const orphanBlock = src.slice(src.indexOf("checkout', '--orphan'"));
  const existingBlock = src.slice(src.indexOf("'checkout', '-B'"), src.indexOf("checkout', '--orphan'"));
  assert.match(orphanBlock.slice(0, 1400), /rm', '-rf', '--cached'/,
    "the orphan path must clear the index");
  assert.doesNotMatch(existingBlock, /rm', '-rf', '--cached'/,
    "clearing the index on the existing-branch path would destroy every prior result");
});
