#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  getProfile,
  loadConfig,
  localEndpointForProfile,
  serviceEnvironment,
  shellQuote
} = require('./lib/config');
const { health, requestJson } = require('./lib/ollama');
const { collectLocalTelemetry, runCapture } = require('./lib/telemetry');

const config = loadConfig();
const stateRoot = process.env.LLM_PROFILE_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'remote-ollama');
const logRoot = process.env.LLM_PROFILE_LOG_DIR || path.join(stateRoot, 'logs');
const systemdEnvRoot = path.join(stateRoot, 'systemd');

function usage() {
  process.stdout.write(`Usage:
  remote-ollama-profile status [--profile NAME] [--json]
  remote-ollama-profile start --profile NAME [--model MODEL] [--skip-model-check] [--dry-run]
  remote-ollama-profile stop --profile NAME [--dry-run]
  remote-ollama-profile restart --profile NAME [--model MODEL] [--dry-run]
  remote-ollama-profile ps [--profile NAME] [--json]
  remote-ollama-profile logs --profile NAME [--tail N]
  remote-ollama-profile telemetry [--profile NAME] [--json]

Profiles: ${Object.keys(config.profiles).join(', ')}
`);
}

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() || 'help';
  const options = {
    command,
    dryRun: false,
    json: false,
    skipModelCheck: false,
    tail: 120
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--profile') {
      options.profile = args[++index];
    } else if (arg === '--model') {
      options.model = args[++index];
    } else if (arg === '--tail') {
      options.tail = Number(args[++index] || '120');
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--skip-model-check') {
      options.skipModelCheck = true;
    } else if (arg === '-h' || arg === '--help') {
      options.command = 'help';
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function ensureDirs() {
  fs.mkdirSync(stateRoot, { recursive: true });
  fs.mkdirSync(logRoot, { recursive: true });
  fs.mkdirSync(systemdEnvRoot, { recursive: true });
}

function stateFile(profile) {
  return path.join(stateRoot, `${profile.name}.json`);
}

function pidFile(profile) {
  return path.join(stateRoot, `${profile.name}.pid`);
}

function logFile(profile) {
  return path.join(logRoot, `${profile.name}.log`);
}

function systemdEnvFile(profile) {
  return path.join(systemdEnvRoot, `${profile.name}.env`);
}

function readState(profile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(profile), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(profile, state) {
  fs.writeFileSync(stateFile(profile), `${JSON.stringify(state, null, 2)}\n`);
}

function removeState(profile) {
  fs.rmSync(stateFile(profile), { force: true });
  fs.rmSync(pidFile(profile), { force: true });
}

function pidAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function pidCommand(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
  } catch {
    return '';
  }
}

function systemctlArgs(scope, args) {
  if (scope === 'user') {
    return ['--user', ...args];
  }
  return args;
}

function systemctl(scope, args) {
  return runCapture('systemctl', systemctlArgs(scope, args), { timeoutMs: 15000 });
}

function systemdTemplateAvailable(scope) {
  const result = systemctl(scope, ['cat', 'ollama-profile@.service']);
  return result.available && result.status === 0;
}

function chooseManager() {
  const requested = config.host.profileManager;
  if (requested === 'pid') {
    return { type: 'pid' };
  }
  if (requested === 'systemd-user') {
    return { type: 'systemd', scope: 'user' };
  }
  if (requested === 'systemd-system') {
    return { type: 'systemd', scope: 'system' };
  }
  if (requested !== 'auto') {
    fail(`Unknown LLM_PROFILE_MANAGER '${requested}'. Use auto, pid, systemd-user, or systemd-system.`);
  }
  if (systemdTemplateAvailable('user')) {
    return { type: 'systemd', scope: 'user' };
  }
  if (systemdTemplateAvailable('system')) {
    return { type: 'systemd', scope: 'system' };
  }
  return { type: 'pid' };
}

function serviceName(profile) {
  return `ollama-profile@${profile.name}.service`;
}

function runningInfo(profile) {
  const state = readState(profile);
  if (state?.mode === 'pid' && pidAlive(state.pid)) {
    return { running: true, mode: 'pid', pid: state.pid, model: state.model || '', state };
  }

  for (const scope of ['user', 'system']) {
    const active = systemctl(scope, ['is-active', '--quiet', serviceName(profile)]);
    if (active.available && active.status === 0) {
      return { running: true, mode: `systemd-${scope}`, service: serviceName(profile), model: state?.model || '', state };
    }
  }

  if (state?.mode === 'pid' && state.pid && !pidAlive(state.pid)) {
    removeState(profile);
  }
  return { running: false, mode: state?.mode || '', model: state?.model || '', state };
}

function portLines(port) {
  const result = runCapture('ss', ['-tulnp']);
  if (!result.available || result.status !== 0) {
    return [];
  }
  return result.stdout.split(/\r?\n/).filter((line) => new RegExp(`:${port}\\b`).test(line));
}

function assertPortAvailable(profile) {
  const info = runningInfo(profile);
  if (info.running) {
    fail(`Profile '${profile.name}' is already running (${info.mode}). Stop or restart it first.`);
  }
  const occupied = portLines(profile.port);
  if (occupied.length > 0) {
    fail(`Port ${profile.port} is already in use; refusing to kill unrelated processes.\n${occupied.join('\n')}`);
  }
}

function printDryRun(message) {
  process.stdout.write(`[dry-run] ${message}\n`);
}

function writeSystemdEnv(profile) {
  const env = serviceEnvironment(profile);
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  fs.writeFileSync(systemdEnvFile(profile), `${lines.join('\n')}\n`);
}

async function waitForEndpoint(profile, timeoutMs = 20000) {
  const started = Date.now();
  const endpoint = localEndpointForProfile(profile);
  while (Date.now() - started < timeoutMs) {
    const status = await health(endpoint);
    if (status.ok) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Ollama did not become healthy at ${endpoint} within ${timeoutMs}ms`);
}

async function assertModelInstalled(profile, model, skipModelCheck) {
  if (!model || skipModelCheck) {
    return;
  }
  const endpoint = localEndpointForProfile(profile);
  try {
    await requestJson(endpoint, '/api/show', { model }, 20000);
  } catch (error) {
    throw new Error(`Model '${model}' is not available on ${profile.name}. Install it with 'ollama pull ${model}' or use --skip-model-check.`);
  }
}

async function startPid(profile, model, options) {
  const env = { ...process.env, ...serviceEnvironment(profile) };
  const command = `env ${Object.entries(serviceEnvironment(profile)).map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ')} ollama serve`;
  if (options.dryRun) {
    printDryRun(command);
    return;
  }

  const logPath = logFile(profile);
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] Starting ${profile.name} model=${model || ''} ${JSON.stringify(serviceEnvironment(profile))}\n`);
  const fd = fs.openSync(logPath, 'a');
  const child = spawn('ollama', ['serve'], {
    detached: true,
    env,
    stdio: ['ignore', fd, fd]
  });
  child.unref();
  fs.closeSync(fd);

  const state = {
    mode: 'pid',
    pid: child.pid,
    profile: profile.name,
    model: model || '',
    port: profile.port,
    bindHost: profile.bindHost,
    gpuDevices: profile.gpuDevices,
    logFile: logPath,
    startedAt: new Date().toISOString(),
    env: serviceEnvironment(profile)
  };
  fs.writeFileSync(pidFile(profile), `${child.pid}\n`);
  writeState(profile, state);

  try {
    await waitForEndpoint(profile);
    await assertModelInstalled(profile, model, options.skipModelCheck);
  } catch (error) {
    await stopProfile(profile, { dryRun: false, quiet: true });
    throw error;
  }
}

async function startSystemd(profile, model, manager, options) {
  writeSystemdEnv(profile);
  const unit = serviceName(profile);
  if (options.dryRun) {
    printDryRun(`systemctl ${manager.scope === 'user' ? '--user ' : ''}start ${unit}`);
    return;
  }
  const daemonReload = systemctl(manager.scope, ['daemon-reload']);
  if (daemonReload.status !== 0) {
    fail(daemonReload.stderr || daemonReload.stdout || `systemctl daemon-reload failed for ${manager.scope}`);
  }
  const started = systemctl(manager.scope, ['start', unit]);
  if (started.status !== 0) {
    fail(started.stderr || started.stdout || `systemctl start ${unit} failed`);
  }

  writeState(profile, {
    mode: `systemd-${manager.scope}`,
    profile: profile.name,
    model: model || '',
    port: profile.port,
    bindHost: profile.bindHost,
    gpuDevices: profile.gpuDevices,
    envFile: systemdEnvFile(profile),
    startedAt: new Date().toISOString(),
    env: serviceEnvironment(profile)
  });

  try {
    await waitForEndpoint(profile);
    await assertModelInstalled(profile, model, options.skipModelCheck);
  } catch (error) {
    await stopProfile(profile, { dryRun: false, quiet: true });
    throw error;
  }
}

async function startProfile(profile, options) {
  ensureDirs();
  const model = options.model || profile.defaultModel || '';
  assertPortAvailable(profile);
  const manager = chooseManager();
  if (manager.type === 'systemd') {
    await startSystemd(profile, model, manager, options);
  } else {
    await startPid(profile, model, options);
  }
  if (!options.dryRun) {
    process.stdout.write(`Started ${profile.name} on ${localEndpointForProfile(profile)} with GPU visibility ${profile.gpuDevices}; model=${model || '<none>'}\n`);
  }
}

async function stopProfile(profile, options = {}) {
  const info = runningInfo(profile);
  const state = readState(profile);

  if (options.dryRun) {
    if (info.mode?.startsWith('systemd-')) {
      const scope = info.mode.replace('systemd-', '');
      printDryRun(`systemctl ${scope === 'user' ? '--user ' : ''}stop ${serviceName(profile)}`);
    } else if (state?.pid) {
      printDryRun(`kill ${state.pid}`);
    } else {
      printDryRun(`no known ${profile.name} process to stop`);
    }
    return;
  }

  if (info.mode?.startsWith('systemd-')) {
    const scope = info.mode.replace('systemd-', '');
    const stopped = systemctl(scope, ['stop', serviceName(profile)]);
    if (stopped.status !== 0 && !options.quiet) {
      fail(stopped.stderr || stopped.stdout || `systemctl stop ${serviceName(profile)} failed`);
    }
    removeState(profile);
    if (!options.quiet) {
      process.stdout.write(`Stopped ${profile.name} (${info.mode}).\n`);
    }
    return;
  }

  if (state?.pid && pidAlive(state.pid)) {
    const command = pidCommand(state.pid);
    if (command && !command.includes('ollama')) {
      fail(`Refusing to stop PID ${state.pid}; command does not look like Ollama: ${command}`);
    }
    process.kill(Number(state.pid), 'SIGTERM');
    const started = Date.now();
    while (pidAlive(state.pid) && Date.now() - started < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (pidAlive(state.pid)) {
      process.kill(Number(state.pid), 'SIGKILL');
    }
    removeState(profile);
    if (!options.quiet) {
      process.stdout.write(`Stopped ${profile.name} (pid ${state.pid}).\n`);
    }
    return;
  }

  removeState(profile);
  if (!options.quiet) {
    process.stdout.write(`Profile ${profile.name} was not running.\n`);
  }
}

async function restartProfile(profile, options) {
  await stopProfile(profile, options);
  await startProfile(profile, options);
}

async function statusCommand(options) {
  const profiles = options.profile ? [getProfile(config, options.profile)] : Object.values(config.profiles);
  const rows = [];
  for (const profile of profiles) {
    const info = runningInfo(profile);
    const endpoint = localEndpointForProfile(profile);
    const status = await health(endpoint);
    const occupied = portLines(profile.port);
    const unmanaged = !info.running && (status.ok || occupied.length > 0);
    rows.push({
      profile: profile.name,
      port: profile.port,
      gpu: profile.gpuDevices,
      bind: profile.bindHost,
      state: info.running ? 'running' : (unmanaged ? 'unmanaged' : 'stopped'),
      mode: info.mode || '',
      model: info.model || profile.defaultModel || '',
      endpoint,
      healthy: status.ok,
      health: status.ok ? JSON.stringify(status.version) : status.error,
      portOwner: occupied.join(' | '),
      log: logFile(profile)
    });
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }
  process.stdout.write('PROFILE\tPORT\tGPU\tBIND\tSTATE\tMODE\tMODEL\tHEALTH\tENDPOINT\tPORT_OWNER\n');
  for (const row of rows) {
    process.stdout.write(`${row.profile}\t${row.port}\t${row.gpu}\t${row.bind}\t${row.state}\t${row.mode}\t${row.model}\t${row.healthy ? 'ok' : 'fail'}\t${row.endpoint}\t${row.portOwner || ''}\n`);
  }
}

function psCommand(options) {
  const profiles = options.profile ? [getProfile(config, options.profile)] : Object.values(config.profiles);
  const result = {};
  for (const profile of profiles) {
    const endpoint = localEndpointForProfile(profile);
    const snapshot = runCapture('ollama', ['ps'], { env: { OLLAMA_HOST: endpoint } });
    result[profile.name] = { endpoint, snapshot };
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  for (const [name, item] of Object.entries(result)) {
    process.stdout.write(`\n## ${name} (${item.endpoint})\n`);
    if (!item.snapshot.available) {
      process.stdout.write(`${item.snapshot.stderr}\n`);
    } else {
      process.stdout.write(item.snapshot.stdout || item.snapshot.stderr || '<no output>\n');
    }
  }
}

function logsCommand(options) {
  if (!options.profile) {
    fail('logs requires --profile NAME');
  }
  const profile = getProfile(config, options.profile);
  const info = runningInfo(profile);
  if (info.mode?.startsWith('systemd-')) {
    const scope = info.mode.replace('systemd-', '');
    const args = systemctlArgs(scope, ['-u', serviceName(profile), '-n', String(options.tail || 120), '--no-pager']);
    const journal = spawnSync('journalctl', args, { encoding: 'utf8' });
    process.stdout.write(journal.stdout || journal.stderr || '');
    process.exit(journal.status === null ? 1 : journal.status);
  }
  const file = logFile(profile);
  if (!fs.existsSync(file)) {
    process.stdout.write(`No log file exists yet: ${file}\n`);
    return;
  }
  const tail = spawnSync('tail', ['-n', String(options.tail || 120), file], { encoding: 'utf8' });
  process.stdout.write(tail.stdout || tail.stderr || '');
  process.exit(tail.status === null ? 1 : tail.status);
}

function telemetryCommand(options) {
  const profiles = options.profile ? [getProfile(config, options.profile)] : Object.values(config.profiles);
  const snapshots = profiles.map((profile) => collectLocalTelemetry(profile, config, options.label || 'manual'));
  if (options.json) {
    process.stdout.write(`${JSON.stringify(snapshots.length === 1 ? snapshots[0] : snapshots, null, 2)}\n`);
    return;
  }
  for (const snapshot of snapshots) {
    process.stdout.write(`\n## telemetry: ${snapshot.profile}\n`);
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') {
    usage();
    return;
  }

  if (['start', 'stop', 'restart'].includes(options.command) && !options.profile) {
    fail(`${options.command} requires --profile NAME`);
  }

  try {
    if (options.command === 'start') {
      await startProfile(getProfile(config, options.profile), options);
    } else if (options.command === 'stop') {
      await stopProfile(getProfile(config, options.profile), options);
    } else if (options.command === 'restart') {
      await restartProfile(getProfile(config, options.profile), options);
    } else if (options.command === 'status') {
      await statusCommand(options);
    } else if (options.command === 'ps') {
      psCommand(options);
    } else if (options.command === 'logs') {
      logsCommand(options);
    } else if (options.command === 'telemetry') {
      telemetryCommand(options);
    } else {
      usage();
      process.exit(2);
    }
  } catch (error) {
    fail(error.message);
  }
}

main();
