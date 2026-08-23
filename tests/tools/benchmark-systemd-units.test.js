const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');

const SYSTEMD_DIR = resolve(__dirname, '../../tools/remote-ollama-control/systemd');

// Both of these reach GitHub over SSH: the benchmark service to publish results, the heartbeat to
// publish its beacon.
const PUBLISHING_UNITS = ['agent-kernel-benchmark.service', 'agent-kernel-heartbeat.service'];

function unit(name) {
  return readFileSync(join(SYSTEMD_DIR, name), 'utf8');
}

function directives(text) {
  return text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && line.includes('='));
}

/**
 * PrivateTmp=true silently destroys SSH in these units. Inside its mount namespace OpenSSH's
 * safe_path check on /etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf fails with "Bad owner or
 * permissions" and every ssh invocation exits 255 -- while the same command run by hand, or under
 * systemd-run without this one setting, succeeds. That asymmetry is what makes it expensive: it
 * cannot be reproduced outside a unit, so it only ever appears in production.
 */
test('units that publish over SSH do not enable PrivateTmp', () => {
  for (const name of PUBLISHING_UNITS) {
    const active = directives(unit(name));
    const offending = active.filter((line) => /^PrivateTmp\s*=\s*(true|yes|on|1)$/i.test(line));
    assert.deepEqual(
      offending, [],
      `${name} sets PrivateTmp, which makes every ssh call in it fail with `
      + '"Bad owner or permissions on /etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf"',
    );
  }
});

// The explanation is the only thing standing between the next reader and re-adding it as an obvious
// hardening win. A bare absence looks like an oversight.
test('the omission is documented in each unit, not merely absent', () => {
  for (const name of PUBLISHING_UNITS) {
    assert.match(unit(name), /PrivateTmp is deliberately NOT set/,
      `${name} must say why PrivateTmp is missing`);
  }
});

test('every shipped unit is syntactically a systemd unit', () => {
  const units = readdirSync(SYSTEMD_DIR).filter((name) => /\.(service|timer)$/.test(name));
  assert.ok(units.length >= 4, `expected the benchmark and heartbeat units, found ${units.join(', ')}`);
  for (const name of units) {
    const text = unit(name);
    assert.match(text, /^\[Unit\]/m, `${name} has no [Unit] section`);
    for (const line of directives(text)) {
      assert.match(line, /^[A-Za-z][A-Za-z0-9]*\s*=/, `${name} has a malformed directive: ${line}`);
    }
  }
});

// The heartbeat exists to keep reporting while a benchmark run occupies the agent for days. Sharing
// the benchmark timer's OnUnitInactiveSec would make it wait for that run to finish first, which is
// precisely the window it is meant to cover.
test('the heartbeat timer fires on a fixed cadence rather than after the previous run', () => {
  const timer = unit('agent-kernel-heartbeat.timer');
  assert.match(timer, /^OnUnitActiveSec=/m);
  assert.doesNotMatch(timer, /^OnUnitInactiveSec=/m);
});

// ## TODO: Test Permutations
// - a unit adding ProtectSystem or ProtectHome, which can fail the same safe_path check
// - PrivateTmp written with whitespace or alternate truthy spellings
// - a newly added *.service that publishes but is missing from PUBLISHING_UNITS
