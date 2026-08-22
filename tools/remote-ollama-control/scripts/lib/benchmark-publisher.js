'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function bareGit(remote, args) {
  return git(path.dirname(remote), [`--git-dir=${remote}`, ...args]);
}

function branchExists(remote, branch) {
  try {
    bareGit(remote, ['rev-parse', '--verify', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function readJsonFromBranch(remote, branch, filePath) {
  try {
    return JSON.parse(bareGit(remote, ['show', `refs/heads/${branch}:${filePath}`]));
  } catch {
    return null;
  }
}

function hasCompletedRunKey(remote, branch, runKey) {
  if (!branchExists(remote, branch)) return false;
  const latest = readJsonFromBranch(remote, branch, 'latest.json');
  if (latest?.run?.key === runKey && latest.run.status === 'completed') return true;
  let paths = [];
  try {
    paths = bareGit(remote, ['ls-tree', '-r', '--name-only', `refs/heads/${branch}`, 'history'])
      .split('\n').filter((entry) => entry.endsWith('.json'));
  } catch {}
  return paths.some((entry) => {
    const record = readJsonFromBranch(remote, branch, entry);
    return record?.run?.key === runKey && record.run.status === 'completed';
  });
}

function prepareCheckout(remote, branch, workDir) {
  if (!fs.existsSync(path.join(workDir, '.git'))) {
    fs.mkdirSync(path.dirname(workDir), { recursive: true });
    git(path.dirname(workDir), ['clone', '--no-checkout', remote, workDir]);
    git(workDir, ['config', 'user.email', 'benchmark-agent@example.invalid']);
    git(workDir, ['config', 'user.name', 'Benchmark Agent']);
  }
  git(workDir, ['fetch', 'origin']);
  if (branchExists(remote, branch)) {
    git(workDir, ['checkout', '-B', branch, `origin/${branch}`]);
  } else {
    git(workDir, ['checkout', '--orphan', branch]);
  }
}

async function publishResult({ remote, branch, workDir, record, beforePush }) {
  prepareCheckout(remote, branch, workDir);
  const started = new Date(record.run.startedAt || 0);
  const year = String(started.getUTCFullYear()).padStart(4, '0');
  const month = String(started.getUTCMonth() + 1).padStart(2, '0');
  const historyPath = path.join(workDir, 'history', year, month, `${record.run.id}.json`);
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, `${JSON.stringify(record, null, 2)}\n`);
  fs.writeFileSync(path.join(workDir, 'latest.json'), `${JSON.stringify(record, null, 2)}\n`);
  if (record.run.status === 'completed' && record.qualifies !== false) {
    fs.writeFileSync(path.join(workDir, 'latest-success.json'), `${JSON.stringify(record, null, 2)}\n`);
  }
  const pathsToAdd = ['history', 'latest.json'];
  if (fs.existsSync(path.join(workDir, 'latest-success.json'))) pathsToAdd.push('latest-success.json');
  git(workDir, ['add', '--', ...pathsToAdd]);
  git(workDir, ['commit', '-m', `benchmark: ${record.run.id}`]);
  if (beforePush) await beforePush();
  try {
    git(workDir, ['push', 'origin', `HEAD:refs/heads/${branch}`]);
  } catch (error) {
    throw new Error(`push rejected without force: ${error.stderr || error.message}`);
  }
  return { branch, commit: git(workDir, ['rev-parse', 'HEAD']) };
}

module.exports = { hasCompletedRunKey, publishResult, readJsonFromBranch };
