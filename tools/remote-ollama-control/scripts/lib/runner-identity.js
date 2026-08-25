'use strict';

/**
 * Which machine produced a result.
 *
 * computeRunKey hashed sourceCommit, the three identity hashes and the contract version -- and
 * nothing about the host. Two machines running the same commit against the same matrix therefore
 * produced the SAME run key: the second would overwrite the first's latest.json, conflate
 * completedRunKeys, and leave two results from different hardware indistinguishable.
 *
 * That was harmless while exactly one runner existed. It stops being harmless the moment a second
 * one does, and it fails silently rather than loudly -- the same shape as every other identity gap
 * found on 2026-08-24.
 *
 * The record lands in a PUBLIC repository, so this deliberately publishes no hostname, address,
 * port or route. `id` is an opaque digest that is stable for a machine and meaningless off it;
 * `platform` and `arch` are the parts a reader genuinely needs to interpret a number (an M-series
 * result and an ROCm result are not comparable); `label` is whatever the operator chooses to say.
 */

const crypto = require('crypto');
const os = require('os');

function machineFacts() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    cpu: (cpus && cpus[0] && cpus[0].model) || 'unknown',
  };
}

/**
 * Stable across restarts and reinstalls, distinct between machines, and not reversible into
 * anything useful. Derived rather than configured so a second runner cannot collide by forgetting
 * to set something -- the failure this exists to prevent is precisely one of omission.
 */
function runnerIdentity(env = process.env, facts = machineFacts()) {
  const digest = crypto.createHash('sha256')
    .update([facts.hostname, facts.platform, facts.arch, facts.cpu].join('\n'))
    .digest('hex')
    .slice(0, 16);
  const label = (env.AK_BENCHMARK_RUNNER_LABEL || '').trim();
  return {
    id: digest,
    platform: facts.platform,
    arch: facts.arch,
    // Optional and operator-chosen. Null rather than absent: a reader must be able to tell
    // "nobody named this runner" from "this field did not exist yet".
    label: label === '' ? null : label,
  };
}

module.exports = { machineFacts, runnerIdentity };
