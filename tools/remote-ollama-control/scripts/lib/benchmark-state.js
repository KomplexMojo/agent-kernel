'use strict';

const fs = require('fs');
const path = require('path');

const emptyState = () => ({
  schemaVersion: 'agent-kernel-benchmark-agent-state/v1',
  lastEvaluatedCommit: null,
  scenarioSetHash: null,
  matrixHash: null,
  inFlight: null,
  queuedCommit: null,
  completedRunKeys: {}
});

function ensureDir(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
}

function loadAgentState(stateDir) {
  const statePath = path.join(stateDir, 'state.json');
  if (!fs.existsSync(statePath)) return emptyState();
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.schemaVersion !== 'agent-kernel-benchmark-agent-state/v1') throw new Error('Invalid benchmark agent state');
  return state;
}

function saveAgentState(stateDir, state) {
  ensureDir(stateDir);
  const statePath = path.join(stateDir, 'state.json');
  const temporary = `${statePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, statePath);
}

// EPERM means the process exists and belongs to someone else -- alive. Only ESRCH proves it is
// gone. Conflating them would reclaim a lock a live agent still holds.
function ownerAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function readLockOwner(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    return /^[0-9]+$/.test(raw) ? Number(raw) : null;
  } catch {
    return null;
  }
}

/**
 * The lock was a bare `wx` create with no liveness check, so it outlived its owner. Any SIGTERM,
 * crash, OOM, reboot mid-run, or kill at the 72h authoring ceiling left it held forever, and the
 * agent then reported `locked` and exited ZERO on every poll while the heartbeat kept beating
 * "idle". That is the failure shape this whole mechanism exists to catch -- exits clean, looks
 * healthy, does nothing -- and it is what the 147 consecutive failed nightlies and the nine-day
 * dry_run stall both were. Observed live on 2026-08-24 after a run was stopped by hand.
 *
 * So a lock whose owner is provably dead is reclaimed, and the reclaim is REPORTED rather than
 * swallowed: silently taking the lock would hide the crash that stranded it.
 *
 * A lock whose owner cannot be parsed is NOT reclaimed. Mutual exclusion is the point, and a
 * corrupt lock cannot be shown to be free -- the refusal names the file so an operator can act,
 * which is a far rarer situation than the kill this fixes.
 */
function acquireAgentLock(stateDir, owner = `${process.pid}`) {
  ensureDir(stateDir);
  const lockPath = path.join(stateDir, 'agent.lock');
  let reclaimedFrom = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(descriptor, `${owner}\n`);
      return {
        acquired: true,
        reclaimedFrom,
        release() {
          if (descriptor === undefined) return;
          fs.closeSync(descriptor);
          descriptor = undefined;
          fs.rmSync(lockPath, { force: true });
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    // Lost the create. On the second pass another agent won the race legitimately, so stop.
    if (attempt === 1) {
      return { acquired: false, heldBy: readLockOwner(lockPath), reason: 'raced', release() {} };
    }

    const holder = readLockOwner(lockPath);
    if (holder === null) {
      return {
        acquired: false,
        heldBy: null,
        reason: `unreadable owner in ${lockPath}; remove it by hand once no agent is running`,
        release() {}
      };
    }
    if (ownerAlive(holder)) {
      return { acquired: false, heldBy: holder, reason: 'held by a live agent', release() {} };
    }
    reclaimedFrom = holder;
    fs.rmSync(lockPath, { force: true });
  }

  return { acquired: false, heldBy: readLockOwner(lockPath), reason: 'raced', release() {} };
}

module.exports = { acquireAgentLock, loadAgentState, saveAgentState };
