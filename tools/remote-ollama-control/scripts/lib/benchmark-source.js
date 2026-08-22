'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function assertSafeInputs(stateDir, runKey) {
  const resolved = path.resolve(stateDir || '');
  if (!stateDir || resolved === path.parse(resolved).root) throw new Error('stateDir must be a specific directory');
  if (!/^[a-f0-9]{64}$/.test(runKey || '')) throw new Error('runKey must be a SHA-256 identity');
  return resolved;
}

function registeredWorktrees(sourceRepo) {
  return git(sourceRepo, ['worktree', 'list', '--porcelain']).split('\n')
    .filter((line) => line.startsWith('worktree ')).map((line) => path.resolve(line.slice('worktree '.length)));
}

function removeOwnedWorktree(sourceRepo, worktreeRoot, worktreePath) {
  const root = path.resolve(worktreeRoot);
  const target = path.resolve(worktreePath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`refusing to remove non-owned worktree: ${target}`);
  }
  if (registeredWorktrees(sourceRepo).includes(target)) {
    git(sourceRepo, ['worktree', 'remove', '--force', target]);
  }
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  git(sourceRepo, ['worktree', 'prune']);
}

function boundedText(text, maxBytes) {
  const buffer = Buffer.from(text || '', 'utf8');
  if (buffer.length <= maxBytes) return buffer;
  const suffix = Buffer.from('\n[output truncated]\n');
  return Buffer.concat([buffer.subarray(0, Math.max(0, maxBytes - suffix.length)), suffix]);
}

function runPreflightStep(step, { cwd, logDir, stateDir, maxLogBytes, env }) {
  if (!step || typeof step.id !== 'string' || !/^[a-z0-9_-]+$/.test(step.id)
    || typeof step.command !== 'string' || !step.command || !Array.isArray(step.args)) {
    throw new Error('invalid preflight step');
  }
  const started = process.hrtime.bigint();
  const child = spawnSync(step.command, step.args, {
    cwd, env: { ...env, ...(step.env || {}) }, encoding: 'utf8',
    maxBuffer: Math.max(16 * 1024 * 1024, maxLogBytes * 4),
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const logPath = path.join(logDir, `${step.id}.log`);
  const output = [
    `$ ${step.command} ${step.args.join(' ')}`,
    child.stdout ? `\n[stdout]\n${child.stdout}` : '',
    child.stderr ? `\n[stderr]\n${child.stderr}` : '',
    child.error ? `\n[error]\n${child.error.message}` : '',
  ].join('');
  fs.writeFileSync(logPath, boundedText(output, maxLogBytes));
  return {
    id: step.id,
    exitCode: child.status ?? null,
    signal: child.signal ?? null,
    durationMs,
    log: path.relative(stateDir, logPath),
    passed: !child.error && child.status === 0,
  };
}

function defaultPreflightSteps(validationDir) {
  const pnpm = process.env.PNPM_BIN || 'pnpm';
  const deterministicTestHosts = { LLM_INTERNAL_HOST: '192.0.2.10', LLM_EXTERNAL_HOST: '192.0.2.11' };
  return [
    { id: 'dependencies', command: pnpm, args: ['install', '--frozen-lockfile'] },
    { id: 'tests', command: pnpm, args: ['run', 'test'], env: deterministicTestHosts },
    { id: 'typecheck', command: pnpm, args: ['run', 'typecheck'] },
    { id: 'benchmark_package', command: pnpm,
      args: ['--dir', 'tools/remote-ollama-control', 'run', 'check'] },
    { id: 'execution_contract', command: pnpm,
      args: ['--dir', 'tools/remote-ollama-control', 'run', 'validate:execution', '--', '--out', validationDir] },
  ];
}

async function prepareBenchmarkSource({
  sourceRepo,
  sourceCommit,
  sourceTree,
  stateDir,
  runKey,
  steps,
  maxLogBytes = 1024 * 1024,
  env = process.env,
} = {}) {
  const resolvedStateDir = assertSafeInputs(stateDir, runKey);
  if (!sourceRepo || !/^[a-f0-9]{40,64}$/.test(sourceCommit || '')
    || !/^[a-f0-9]{40,64}$/.test(sourceTree || '')) {
    throw new Error('sourceRepo, sourceCommit, and sourceTree are required');
  }
  if (!Number.isSafeInteger(maxLogBytes) || maxLogBytes < 128) throw new Error('maxLogBytes must be at least 128');
  const worktreeRoot = path.join(resolvedStateDir, 'source-worktrees');
  const worktreePath = path.join(worktreeRoot, runKey);
  const retentionId = `preflights/${runKey}`;
  const logDir = path.join(resolvedStateDir, retentionId);
  fs.mkdirSync(worktreeRoot, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  removeOwnedWorktree(sourceRepo, worktreeRoot, worktreePath);
  git(sourceRepo, ['worktree', 'add', '--detach', worktreePath, sourceCommit]);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    removeOwnedWorktree(sourceRepo, worktreeRoot, worktreePath);
    cleaned = true;
  };
  const preflight = { status: 'running', retentionId, sourceCommit, sourceTree, steps: [] };
  try {
    const actualCommit = git(worktreePath, ['rev-parse', 'HEAD']);
    const actualTree = git(worktreePath, ['rev-parse', 'HEAD^{tree}']);
    if (actualCommit !== sourceCommit || actualTree !== sourceTree) {
      throw new Error(`source identity mismatch: expected ${sourceCommit}/${sourceTree}, received ${actualCommit}/${actualTree}`);
    }
    const selectedSteps = steps || defaultPreflightSteps(path.join(logDir, 'execution-validation'));
    if (!Array.isArray(selectedSteps) || selectedSteps.length === 0) throw new Error('at least one preflight step is required');
    for (const step of selectedSteps) {
      const result = runPreflightStep(step, {
        cwd: worktreePath, logDir, stateDir: resolvedStateDir, maxLogBytes, env,
      });
      preflight.steps.push(result);
      if (!result.passed) throw new Error(`preflight ${step.id} failed`);
    }
    const trackedChanges = git(worktreePath, ['status', '--porcelain', '--untracked-files=no']);
    if (trackedChanges) throw new Error('preflight modified tracked source files');
    preflight.status = 'passed';
    return { worktreePath, preflight, cleanup };
  } catch (error) {
    preflight.status = 'failed';
    error.preflight = preflight;
    error.worktreePath = worktreePath;
    try { cleanup(); } catch (cleanupError) { error.cleanupError = cleanupError.message; }
    throw error;
  }
}

module.exports = {
  defaultPreflightSteps,
  prepareBenchmarkSource,
  removeOwnedWorktree,
};
