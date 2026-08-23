#!/usr/bin/env node
'use strict';

/**
 * Publishes one heartbeat and exits.
 *
 * Deliberately a separate entry point from benchmark-agent.js rather than a branch inside it. A
 * benchmark run occupies the agent for days, so a heartbeat emitted by the agent would fall silent
 * for exactly the stretch a watcher most needs it. This reads state and progress from disk and
 * never waits on the run.
 *
 * It is also the only thing on the box that speaks when nothing is happening. "Nothing is happening"
 * has twice been the actual fault -- a deleted branch ref, and a nine-day dry-run pin -- so the
 * quiet case is the one this exists to report, not the one to skip.
 */

const os = require('os');
const path = require('path');

const { loadAgentState } = require('./lib/benchmark-state');
const { latestResultDir } = require('./lib/content-gen-checkpoint');
const { readProgress } = require('./lib/benchmark-progress');
const { composeHeartbeat, publishHeartbeat, readInstallManifest, DEFAULT_BRANCH } = require('./lib/benchmark-heartbeat');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. The heartbeat reads the same configuration as the agent; `
      + 'see config/benchmark-agent.env.example.');
  }
  return value;
}

function lastPublishedRunId(state) {
  const ids = Object.values(state.completedRunKeys || {});
  return ids.length > 0 ? ids[ids.length - 1] : null;
}

function inFlightProgress(stateDir, inFlight) {
  if (!inFlight?.runKey) return null;
  const authoring = path.join(stateDir, 'runs', inFlight.runKey, 'authoring');
  const runDir = latestResultDir(authoring);
  return runDir ? readProgress(runDir) : null;
}

function main() {
  // Must match benchmark-agent.js exactly. A heartbeat pointed at a different directory would
  // report "idle" with total confidence while a run was underway three directories over.
  const stateDir = process.env.AK_BENCHMARK_STATE_DIR
    || path.join(os.homedir(), '.local/state/agent-kernel-benchmark');
  const remote = requiredEnv('AK_BENCHMARK_RESULTS_REMOTE');
  const branch = process.env.AK_BENCHMARK_HEARTBEAT_BRANCH || DEFAULT_BRANCH;
  const dryRun = process.env.AK_BENCHMARK_DRY_RUN === '1';

  let state;
  let error = null;
  try {
    state = loadAgentState(stateDir);
  } catch (cause) {
    // An unreadable state file is itself worth broadcasting. Exiting here would look identical to
    // the box being gone, which is the one confusion this whole mechanism exists to remove.
    state = { inFlight: null, completedRunKeys: {} };
    error = `agent state unreadable: ${cause.message}`;
  }

  const progress = inFlightProgress(stateDir, state.inFlight);
  const status = state.inFlight ? 'running' : (dryRun ? 'dry_run' : 'idle');

  const heartbeat = composeHeartbeat({
    publishedAt: new Date().toISOString(),
    status,
    dryRun,
    sourceCommit: state.inFlight?.sourceCommit ?? state.lastEvaluatedCommit ?? null,
    sourceRef: process.env.AK_BENCHMARK_SOURCE_REF || null,
    runKey: state.inFlight?.runKey ?? null,
    identity: {
      scenarioSetHash: process.env.AK_BENCHMARK_SCENARIO_HASH || null,
      matrixHash: process.env.AK_BENCHMARK_MATRIX_HASH || null,
      executionSuiteHash: process.env.AK_BENCHMARK_EXECUTION_SUITE_HASH || null,
    },
    // Resolved from this file's own location, so it describes the copy that is actually executing
    // rather than whatever a configured path might point at.
    agent: readInstallManifest(path.resolve(__dirname, '..')),
    progress,
    lastPublishedRunId: lastPublishedRunId(state),
    error,
  });

  const result = publishHeartbeat({
    remote, branch, workDir: path.join(stateDir, 'heartbeat-worktree'), heartbeat,
  });
  process.stdout.write(`${JSON.stringify({ ...result, status, dryRun })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  }
}

module.exports = { lastPublishedRunId, inFlightProgress };
