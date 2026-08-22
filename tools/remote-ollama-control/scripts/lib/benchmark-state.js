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

function acquireAgentLock(stateDir, owner = `${process.pid}`) {
  ensureDir(stateDir);
  const lockPath = path.join(stateDir, 'agent.lock');
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(descriptor, `${owner}\n`);
  } catch (error) {
    if (error.code === 'EEXIST') return { acquired: false, release() {} };
    throw error;
  }
  return {
    acquired: true,
    release() {
      if (descriptor === undefined) return;
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.unlinkSync(lockPath);
    }
  };
}

module.exports = { acquireAgentLock, loadAgentState, saveAgentState };
