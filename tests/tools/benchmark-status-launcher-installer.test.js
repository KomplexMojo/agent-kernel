const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, existsSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const INSTALLER = resolve(
  __dirname, '../../tools/remote-ollama-control/scripts/install-benchmark-status-launcher.sh',
);
const APP_NAME = 'Benchmark Status.app';

function run(env = {}, expectFailure = false, mode = null) {
  try {
    const stdout = execFileSync('bash', mode ? [INSTALLER, mode] : [INSTALLER], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (expectFailure) assert.fail('installer was expected to refuse, but it succeeded');
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    if (!expectFailure) {
      assert.fail(`installer failed: ${error.stderr || error.stdout || error.message}`);
    }
    return { status: error.status, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

function install(mode = 'app') {
  const dir = mkdtempSync(join(tmpdir(), 'ak-bench-app-'));
  // Forcing the system lets this run on the Ubuntu box too; the icon step degrades on its own when
  // the macOS image tools are absent.
  run({ BENCHMARK_STATUS_INSTALL_SYSTEM: 'Darwin', BENCHMARK_STATUS_APP_DIR: dir }, false, mode);
  return dir;
}

const APP_LAUNCHER = `${APP_NAME}/Contents/MacOS/benchmark-status`;
const COMMAND_LAUNCHER = 'Benchmark Status.command';
const launcherAt = (dir, relative = APP_LAUNCHER) => readFileSync(join(dir, relative), 'utf8');

test('the installer is executable, so a fresh clone can run it directly', () => {
  assert.ok(existsSync(INSTALLER), 'installer script is missing');
  assert.ok(statSync(INSTALLER).mode & 0o111, 'installer is not executable');
});

// The bundle only means anything on macOS. Running it on the Ubuntu box should say so rather than
// scattering a half-built .app into a home directory nothing will ever launch it from.
test('it refuses to install anywhere but macOS, and names the reason', () => {
  const { status, stderr } = run({ BENCHMARK_STATUS_INSTALL_SYSTEM: 'Linux' }, true);
  assert.equal(status, 2);
  assert.match(stderr, /macOS/);
});

test('it builds a launchable bundle', () => {
  const dir = install();
  for (const relative of ['Contents/Info.plist', 'Contents/MacOS/benchmark-status']) {
    assert.ok(existsSync(join(dir, APP_NAME, relative)), `${relative} is missing`);
  }
  assert.ok(
    statSync(join(dir, APP_LAUNCHER)).mode & 0o111,
    'the bundle executable is not executable',
  );
});

test('installing twice is not an error', () => {
  const dir = install();
  run({ BENCHMARK_STATUS_INSTALL_SYSTEM: 'Darwin', BENCHMARK_STATUS_APP_DIR: dir });
  assert.ok(existsSync(join(dir, APP_LAUNCHER)));
});

// The hand-built first version hardcoded one operator's home directory, so on anybody else's clone
// it would have opened an error page forever, blaming a missing repo. The path must be DERIVED at
// install time -- which means the installer source carries none, while its output carries the real
// one (Finder gives a bundle no working directory to infer a checkout from).
test('the installer hardcodes nobody\'s home directory', () => {
  assert.doesNotMatch(readFileSync(INSTALLER, 'utf8'), /\/Users\/[a-z]+\//i);
});

test('the launcher it writes carries the checkout it was installed from', () => {
  const launcher = launcherAt(install());
  assert.match(launcher, /^REPO=/m);
  assert.ok(
    launcher.includes(resolve(__dirname, '../..')),
    'the launcher should name the absolute path of this checkout',
  );
});

// Every failure must still END in an open page. A launcher that exits quietly is indistinguishable
// from a healthy run with nothing to report -- the exact confusion this benchmark rig exists to
// remove.
test('every failure path opens a page saying what went wrong', () => {
  const launcher = launcherAt(install());
  assert.match(launcher, /show_error/);
  const failures = launcher.split('\n').filter((line) => /show_error/.test(line));
  // The definition plus at least three call sites: no node, no repo, and the command failing.
  assert.ok(failures.length >= 4, `expected several guarded failure paths, saw ${failures.length}`);
  assert.match(launcher, /open "\$OUT"/);
});

// `msg | show_error` would run show_error in a SUBSHELL, so its `exit` ended only that subshell and
// the script carried on to the success path and exited 0. It reported failure and success at once.
test('failures are not piped into the error handler, which would swallow the exit', () => {
  const launcher = launcherAt(install());
  // `||` is the correct guard form; only a single pipe creates the subshell.
  assert.doesNotMatch(launcher, /[^|]\|\s*show_error/);
});

// nvm keeps node outside any PATH a Finder-launched app inherits, and pinning one version rots at
// the next upgrade.
test('the launcher discovers node instead of pinning a version', () => {
  const launcher = launcherAt(install());
  assert.match(launcher, /\.nvm/);
  assert.doesNotMatch(launcher, /v\d+\.\d+\.\d+\/bin\/node/);
});

test('the plist is valid and names the executable that exists', () => {
  const dir = install();
  const plist = readFileSync(join(dir, APP_NAME, 'Contents/Info.plist'), 'utf8');
  assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>benchmark-status<\/string>/);
  if (process.platform === 'darwin') {
    execFileSync('plutil', ['-lint', join(dir, APP_NAME, 'Contents/Info.plist')], { stdio: 'ignore' });
  }
});

// The launcher's most likely failure on this Mac is macOS refusing it access to the checkout,
// because the repository sits in a protected folder (~/Documents). The first version blamed the LAN
// and ssh for it, which sends you to check a network that was never the problem.
test('a macOS permission refusal is diagnosed as one, not as a network fault', () => {
  const launcher = launcherAt(install());
  assert.match(launcher, /PERMISSION_HINT/);
  assert.match(launcher, /Full Disk Access/);
  assert.match(launcher, /\*"not permitted"\*\) show_error "\$output" "\$PERMISSION_HINT"/);
});

// "Permission denied (publickey)" is ssh failing to authenticate. Routing that to the privacy-
// settings advice would swap one confident wrong diagnosis for another.
test('an ssh auth failure is not misread as a privacy-settings problem', () => {
  const launcher = launcherAt(install());
  const runFailure = launcher.slice(launcher.indexOf('benchmark-status --route auto'));
  assert.doesNotMatch(runFailure, /ermission denied"\*\)\s*show_error "\$output" "\$PERMISSION_HINT"/);
  assert.match(runFailure, /NETWORK_HINT/);
});

test('both hints exist and are distinct, so neither failure gets generic advice', () => {
  const launcher = launcherAt(install());
  // PERMISSION_HINT is double-quoted so $GRANT_TARGET expands at launch; NETWORK_HINT is single-
  // quoted because it interpolates nothing. Assert the variables, not a quoting style.
  assert.match(launcher, /NETWORK_HINT=["']/);
  assert.match(launcher, /PERMISSION_HINT=["']/);
  assert.match(launcher, /ssh-add/);
});

// --- the .command variant ------------------------------------------------------------------

// The .app is refused access to a checkout in a protected folder until granted, and rebuilding the
// bundle can invalidate that grant. A .command runs under Terminal, which already holds it -- so
// this form works with no permission at all and survives reinstalls.
test('command mode installs a double-clickable script instead of a bundle', () => {
  const dir = install('command');
  assert.ok(existsSync(join(dir, COMMAND_LAUNCHER)), '.command was not installed');
  assert.ok(statSync(join(dir, COMMAND_LAUNCHER)).mode & 0o111, '.command is not executable');
  assert.ok(!existsSync(join(dir, APP_NAME)), 'command mode should not also build the bundle');
});

test('both mode installs each form', () => {
  const dir = install('both');
  assert.ok(existsSync(join(dir, APP_LAUNCHER)), 'bundle missing');
  assert.ok(existsSync(join(dir, COMMAND_LAUNCHER)), '.command missing');
});

// Written as `[ A ] || [ B ] && install`, the compound evaluates false for the mode it does not
// match, and under `set -e` that false ended the script -- so `command` exited having installed
// nothing while still reporting success.
test('command mode actually installs, rather than exiting on the mode test', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-bench-app-'));
  const { status } = run(
    { BENCHMARK_STATUS_INSTALL_SYSTEM: 'Darwin', BENCHMARK_STATUS_APP_DIR: dir }, false, 'command',
  );
  assert.equal(status, 0);
  assert.ok(existsSync(join(dir, COMMAND_LAUNCHER)));
});

// One body, two destinations: a second copy of the failure handling would drift from this one.
test('both forms share the same launcher body', () => {
  const dir = install('both');
  const app = launcherAt(dir, APP_LAUNCHER);
  const command = launcherAt(dir, COMMAND_LAUNCHER);
  const body = (text) => text.slice(text.indexOf('OUT="$HOME'));
  assert.equal(body(app), body(command));
});

// The instructions have to name the thing that actually needs the grant, which differs by form.
test('each form names the right target in its permission instructions', () => {
  const dir = install('both');
  assert.match(launcherAt(dir, APP_LAUNCHER), /GRANT_TARGET="Benchmark Status\.app"/);
  assert.match(launcherAt(dir, COMMAND_LAUNCHER), /GRANT_TARGET="Terminal"/);
});

test('an unknown mode is refused with usage rather than silently installing the default', () => {
  const { status, stderr } = run({ BENCHMARK_STATUS_INSTALL_SYSTEM: 'Darwin' }, true, 'nonsense');
  assert.equal(status, 2);
  assert.match(stderr, /usage:/);
});
