'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function bareGit(remote, args) {
  return git(path.dirname(remote), [`--git-dir=${remote}`, ...args]);
}

// `git --git-dir=<x>` only means anything when x is a directory on this machine. In production the
// remote is always a URL, so every read below used to fail closed and report "no such branch" with
// total confidence. Every test in this suite passed a local bare path, where it happens to work,
// which is why the whole class stayed invisible.
function isLocalGitDir(remote) {
  return typeof remote === 'string'
    && !/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)
    && !remote.includes('@')
    && fs.existsSync(path.join(remote, 'HEAD'));
}

// ls-remote speaks to paths and URLs alike, and asks the remote rather than guessing from a layout.
function branchExists(remote, branch) {
  try {
    return git(os.tmpdir(), ['ls-remote', '--heads', remote, `refs/heads/${branch}`]).length > 0;
  } catch {
    return false;
  }
}

/**
 * Ensure a local clone that can be read and committed against. Shared by the readers and by
 * publishResult so a poll pays for at most one clone, refreshed by fetch thereafter.
 */
function ensureMirror(remote, workDir) {
  if (!fs.existsSync(path.join(workDir, '.git'))) {
    fs.mkdirSync(path.dirname(workDir), { recursive: true });
    git(path.dirname(workDir), ['clone', '--no-checkout', remote, workDir]);
    git(workDir, ['config', 'user.email', 'benchmark-agent@example.invalid']);
    git(workDir, ['config', 'user.name', 'Benchmark Agent']);
  }
  git(workDir, ['fetch', 'origin']);
  return workDir;
}

// workDir is optional so the local-path callers (and the tests that use them) keep working
// unchanged; a URL remote needs somewhere to fetch into before anything can be read.
function readJsonFromBranch(remote, branch, filePath, workDir) {
  if (isLocalGitDir(remote)) {
    try {
      return JSON.parse(bareGit(remote, ['show', `refs/heads/${branch}:${filePath}`]));
    } catch {
      return null;
    }
  }
  if (!workDir) return null;
  try {
    ensureMirror(remote, workDir);
    return JSON.parse(git(workDir, ['show', `origin/${branch}:${filePath}`]));
  } catch {
    return null;
  }
}

function listHistoryPaths(remote, branch, workDir) {
  try {
    if (isLocalGitDir(remote)) {
      return bareGit(remote, ['ls-tree', '-r', '--name-only', `refs/heads/${branch}`, 'history'])
        .split('\n').filter((entry) => entry.endsWith('.json'));
    }
    if (!workDir) return [];
    ensureMirror(remote, workDir);
    return git(workDir, ['ls-tree', '-r', '--name-only', `origin/${branch}`, 'history'])
      .split('\n').filter((entry) => entry.endsWith('.json'));
  } catch {
    return [];
  }
}

function hasCompletedRunKey(remote, branch, runKey, workDir) {
  if (!branchExists(remote, branch)) return false;
  const latest = readJsonFromBranch(remote, branch, 'latest.json', workDir);
  if (latest?.run?.key === runKey && latest.run.status === 'completed') return true;
  return listHistoryPaths(remote, branch, workDir).some((entry) => {
    const record = readJsonFromBranch(remote, branch, entry, workDir);
    return record?.run?.key === runKey && record.run.status === 'completed';
  });
}

function prepareCheckout(remote, branch, workDir) {
  ensureMirror(remote, workDir);
  // Getting this wrong is not a failed publish, it is a destroyed archive: an orphan checkout of an
  // existing branch drops every prior result, and the only thing standing between that and the
  // remote is the non-force push being rejected.
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
