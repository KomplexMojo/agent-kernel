'use strict';

/**
 * Liveness beacon for the nightly benchmark agent.
 *
 * The agent's failure mode is not crashing -- it is succeeding at nothing. Two incidents made that
 * concrete: 147 consecutive nightlies died on a deleted branch ref, and a nine-day stretch returned
 * `dry_run` on every poll. Both exited cleanly, so anything watching for a non-zero status saw a
 * healthy service. The alarm condition therefore has to be SILENCE, which means something has to
 * make noise on a schedule even when there is nothing to report.
 *
 * Three constraints shape this file:
 *
 *   - It publishes to a PUBLIC repository. No address, port, route, hostname or firewall detail may
 *     appear in the document. `composeHeartbeat` takes only what it emits, so a caller cannot pass
 *     topology through by accident.
 *   - It force-pushes a single-commit orphan branch. Results are append-only evidence and their
 *     publisher deliberately treats a force as an error; a heartbeat is the opposite -- mutable,
 *     disposable, and published every few minutes, so keeping history would add thousands of
 *     commits a month. The two never share a branch or a code path.
 *   - It must not depend on the benchmark process. A run holds the agent for days, so the heartbeat
 *     runs on its own timer and reads progress from disk. A beacon that a stuck run could silence
 *     would go quiet exactly when it matters.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 'agent-kernel-benchmark-heartbeat/v1';
const HEARTBEAT_NAME = 'heartbeat.json';
const DEFAULT_BRANCH = 'benchmark-heartbeat';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Field names are chosen so the off-box checker never has to infer state. `dryRun` in particular is
 * explicit rather than implied by an absent run: the nine-day stall looked identical to "idle
 * because nothing changed" from the outside, and that ambiguity is what hid it.
 */
function composeHeartbeat({
  publishedAt,
  status,
  dryRun,
  sourceCommit = null,
  sourceRef = null,
  runKey = null,
  triggerReasons = [],
  identity = {},
  agent = null,
  progress = null,
  lastPublishedRunId = null,
  error = null,
}) {
  if (!publishedAt) throw new Error('a heartbeat without a timestamp cannot answer the only question it exists for');
  if (typeof status !== 'string' || status.length === 0) throw new Error('heartbeat status is required');
  return {
    schemaVersion: SCHEMA_VERSION,
    publishedAt,
    status,
    dryRun: dryRun === true,
    source: { commit: sourceCommit, ref: sourceRef },
    runKey,
    triggerReasons: [...triggerReasons],
    identity: {
      scenarioSetHash: identity.scenarioSetHash ?? null,
      matrixHash: identity.matrixHash ?? null,
      executionSuiteHash: identity.executionSuiteHash ?? null,
    },
    lastPublishedRunId,
    // Which agent code is actually RUNNING, as opposed to which commit it polls. Those are
    // different questions with different answers: the box runs an installed file copy, so merging
    // to main updates what the agent checks out per run but never the agent itself. On 2026-08-23 a
    // fix merged, the preflight went green with it, and the identical failure kept publishing for
    // an hour because the code that spawns the preflight was still the previous copy. Nothing on
    // the box could report that, so the beacon carries it off-box for the checker to compare.
    // A commit hash, never a path: this document is public.
    agent: agent
      ? { installedCommit: agent.installedCommit ?? null, installedAt: agent.installedAt ?? null }
      : null,
    // Present only while a run is in flight. Null is a real answer -- "the agent is alive and no
    // benchmark is running" -- and is not the same as the field being absent.
    progress,
    error,
  };
}

function publishHeartbeat({ remote, branch = DEFAULT_BRANCH, workDir, heartbeat }) {
  fs.mkdirSync(workDir, { recursive: true });
  if (!fs.existsSync(path.join(workDir, '.git'))) {
    git(workDir, ['init', '--quiet', '.']);
    git(workDir, ['config', 'user.email', 'benchmark-agent@example.invalid']);
    git(workDir, ['config', 'user.name', 'Benchmark Agent']);
  }
  // A fresh orphan every time. Reusing the branch would accumulate one commit per beat -- roughly
  // 35,000 a year at a five-minute cadence -- for data whose entire value is its most recent value.
  git(workDir, ['checkout', '--quiet', '--orphan', `beat-${Date.now()}`]);
  try {
    git(workDir, ['rm', '-rf', '--cached', '--ignore-unmatch', '.']);
  } catch {}
  fs.writeFileSync(path.join(workDir, HEARTBEAT_NAME), `${JSON.stringify(heartbeat, null, 2)}\n`);
  git(workDir, ['add', '--', HEARTBEAT_NAME]);
  git(workDir, ['commit', '--quiet', '-m', `heartbeat: ${heartbeat.publishedAt}`]);
  // Force is correct here and nowhere else in this tool: the branch holds one mutable document and
  // is rewritten by design. The results publisher must keep rejecting it.
  git(workDir, ['push', '--force', remote, `HEAD:refs/heads/${branch}`]);
  return { branch, commit: git(workDir, ['rev-parse', 'HEAD']) };
}

const INSTALL_MANIFEST_NAME = '.install-manifest.json';

/**
 * Provenance of the installed copy, written by the installer. Absent is a legitimate answer that
 * must not throw: a box installed before this existed has no manifest, and a beacon that died on
 * that would remove the liveness signal to report a staleness one.
 */
function readInstallManifest(packageDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(packageDir, INSTALL_MANIFEST_NAME), 'utf8'));
    return { installedCommit: raw.sourceCommit ?? null, installedAt: raw.installedAt ?? null };
  } catch {
    return null;
  }
}

module.exports = {
  DEFAULT_BRANCH,
  INSTALL_MANIFEST_NAME,
  readInstallManifest,
  HEARTBEAT_NAME,
  SCHEMA_VERSION,
  composeHeartbeat,
  publishHeartbeat,
};
