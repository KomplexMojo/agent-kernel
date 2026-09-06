const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { readFileSync, existsSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const HOOKS = join(ROOT, '.githooks');
const DECIDER = join(HOOKS, 'protected-branch.sh');

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

function decide(branch, action = 'commit') {
  const result = spawnSync('bash', [DECIDER, branch, action], { encoding: 'utf8' });
  return { refused: result.status !== 0, stderr: result.stderr || '' };
}

test('the hooks exist and are executable, or git silently ignores them', () => {
  for (const name of ['pre-commit', 'pre-push', 'protected-branch.sh']) {
    const path = join(HOOKS, name);
    assert.ok(existsSync(path), `.githooks/${name} is missing`);
    assert.ok(statSync(path).mode & 0o111, `.githooks/${name} is not executable`);
  }
});

// The rule is "never on main, no matter how small". A guard that only covered some branches, or
// that let master through on an older clone, would be the same policy with a hole in it.
test('commits are refused on the protected branches and allowed everywhere else', () => {
  assert.equal(decide('main').refused, true);
  assert.equal(decide('master').refused, true);
  for (const branch of ['feat/x', 'fix/y', 'chore/z', 'docs/w', 'mainline', 'feature/main']) {
    assert.equal(decide(branch).refused, false, `${branch} should be allowed`);
  }
});

test('pushes to a protected branch are refused too', () => {
  assert.equal(decide('main', 'push').refused, true);
});

// `git push origin HEAD:main` from a feature branch is a direct write to main. A hook that read the
// LOCAL branch name would wave it through -- and that is the exact shape that put two commits on
// main by hand on 2026-09-06.
test('the pre-push hook checks the destination ref, not the local branch name', () => {
  const hook = read('.githooks/pre-push');
  assert.match(hook, /remote_ref/);
  assert.match(hook, /refs\/heads\/\*/);
  const result = spawnSync('bash', [join(HOOKS, 'pre-push')], {
    input: 'refs/heads/feat/x abc123 refs/heads/main def456\n',
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'pushing a feature branch to main must be refused');
});

test('a push to a feature branch passes the hook', () => {
  const result = spawnSync('bash', [join(HOOKS, 'pre-push')], {
    input: 'refs/heads/feat/x abc123 refs/heads/feat/x def456\n',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

// A detached HEAD is where rebases, bisects and worktree surgery run. Refusing there would break
// ordinary git operations while protecting nothing.
test('a detached HEAD is not treated as a protected branch', () => {
  assert.equal(decide('').refused, false);
});

// A refusal that does not say what to do instead gets bypassed rather than obeyed.
test('the refusal names the way forward, not just the rule', () => {
  const { stderr } = decide('main');
  assert.match(stderr, /git switch -c/);
  assert.match(stderr, /gh pr create/);
  assert.match(stderr, /--delete-branch/, 'the cleanup step must be part of the instructions');
  assert.match(stderr, /AGENTS\.md/);
});

// .git/hooks is not versioned, so hooks are inert until core.hooksPath points into the tree. If
// that wiring is dropped, every fresh clone and cloud VM silently loses the guard.
test('the hooks are activated by an installer that session-refresh runs', () => {
  assert.ok(existsSync(join(ROOT, 'scripts/setup/install-git-hooks.sh')));
  assert.match(read('scripts/setup/install-git-hooks.sh'), /core\.hooksPath/);
  assert.match(read('scripts/setup/session-refresh.sh'), /install-git-hooks\.sh/);
});

// Three harnesses drive this repo. A policy only one of them can see is not the policy.
test('every harness carries the rule, and AGENTS.md is the one that states it', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /## Branching — every change goes through a branch and a PR/);
  assert.match(agents, /--delete-branch/, 'AGENTS.md must carry the branch cleanup step');

  // The other two point at it rather than restating it: CLAUDE.md's own rule is that a rule copied
  // into both files will drift and one copy will be wrong.
  const claude = read('CLAUDE.md');
  assert.match(claude, /AGENTS\.md → Branching/);
  assert.match(claude, /the branching and PR policy/);

  const cursor = read('.cursor/rules/branch-policy.mdc');
  assert.match(cursor, /alwaysApply: true/, 'the branch rule must bind on every Cursor turn');
  assert.match(cursor, /AGENTS\.md/);
});

// The previous claim about this ruleset sat wrong in AGENTS.md for two weeks. Pin the shape of the
// correction so a future edit cannot quietly restore "there is no pull_request rule".
test('AGENTS.md records that main requires a PR, with the date it was verified', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /pull_request/);
  assert.match(agents, /required_approving_review_count.{0,4}0/);
  assert.match(agents, /2026-09-06/);
  assert.doesNotMatch(agents, /carries `deletion` and `non_fast_forward` only/);
});

test('the hooks are honest that a bypass exists', () => {
  assert.match(read('.githooks/protected-branch.sh'), /--no-verify/);
  assert.match(read('AGENTS.md'), /guards, not walls/i);
});

// Asserted statically rather than by running it: git worktrees SHARE .git/config, so invoking the
// installer from a test would rewrite core.hooksPath for the whole checkout as a side effect.
test('the installer is idempotent and re-points a stale hooksPath', () => {
  const script = read('scripts/setup/install-git-hooks.sh');
  assert.match(script, /already pointed at \.githooks/);
  assert.match(script, /exit 0/);
  assert.match(script, /repointing to \.githooks/);
});
