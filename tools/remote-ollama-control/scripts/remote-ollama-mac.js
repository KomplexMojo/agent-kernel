#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const path = require('path');
const {
  endpointFor,
  getProfile,
  loadConfig,
  shellQuote
} = require('./lib/config');
const { buildHardwareBenchmarkSpecs, runBenchmarkMatrix } = require('./lib/benchmark');
const { health, requestJson } = require('./lib/ollama');
const { displayCommand, runRemote, runRemoteScript, sshBaseArgs } = require('./lib/ssh');

const config = loadConfig();

function usage() {
  process.stdout.write(`Usage:
  remote-ollama-mac status [--route internal|external] [--profile NAME]
  remote-ollama-mac start --profile NAME [--model MODEL] [--route internal|external]
  remote-ollama-mac stop --profile NAME
  remote-ollama-mac restart --profile NAME [--model MODEL]
  remote-ollama-mac ps [--profile NAME]
  remote-ollama-mac logs --profile NAME [--tail N]
  remote-ollama-mac telemetry [--profile NAME]
  remote-ollama-mac doctor --profile NAME [--model MODEL] [--route internal|external] [--direct] [--json]
  remote-ollama-mac claude --profile NAME [--model MODEL] [--direct] [-- CLAUDE_ARGS...]
  remote-ollama-mac claude --local [--model MODEL] [-- CLAUDE_ARGS...]
  remote-ollama-mac run-local --profile NAME [--model MODEL] [--direct] -- COMMAND [ARGS...]
  remote-ollama-mac run-local --local [--model MODEL] -- COMMAND [ARGS...]
  remote-ollama-mac print-env --local [--model MODEL]
  remote-ollama-mac exec [--route internal|external] -- COMMAND [ARGS...]
  remote-ollama-mac smoke-test --profile NAME --model MODEL [--prompt TEXT] [--require-gpu]
  remote-ollama-mac benchmark --profile NAME --model MODEL --context N --num-predict N --scenario NAME
  remote-ollama-mac benchmark-matrix --profiles a,b --models x,y --contexts 4096,8192 --scenario NAME
  remote-ollama-mac benchmark-hardware [--route internal|external] [--models x,y] [--contexts 4096,8192] [--efforts standard,high,max,overnight] [--scenarios a,b] [--no-start] [--no-reset] [--no-isolate]
  remote-ollama-mac project-safety-check [remote-project-safety-check args...]
  remote-ollama-mac project-sync [--branch main]
  remote-ollama-mac project-push-main [--branch main]
  remote-ollama-mac run-content-gen [--profiles a,b,c] [--model MODEL] [--runs N] [--scenario-ids 1,3,5] [--route internal|external] [--no-start] [--no-reset] [--dry-run]
  remote-ollama-mac run-content-gen --local --model MODEL [--runs N] [--scenario-ids 1,3,5] [--dry-run]
  remote-ollama-mac dry-run start --profile dual --model qwen3-coder:30b-a3b-q4_K_M

Common options:
  --external-host HOST   Override LLM_EXTERNAL_HOST for this invocation.
  --local                Drive this Mac's own Ollama (valid only for claude, run-local, print-env).

Profiles: ${Object.keys(config.profiles).join(', ')}
`);
}

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function parseList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function readOptionValue(args, index, flag) {
  const value = args[index + 1];
  if (value === undefined || value === '--' || String(value).startsWith('--')) {
    fail(`${flag} requires a value`);
  }
  return value;
}

function readPositiveNumber(args, index, flag) {
  const value = Number(readOptionValue(args, index, flag));
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${flag} must be a positive number`);
  }
  return value;
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    dryRun: false,
    tunnel: false,
    direct: false,
    local: false,
    explicitFlags: new Set(),
    requireGpu: false,
    localPort: null,
    route: config.host.defaultRoute,
    externalHost: null,
    profile: null,
    model: null,
    context: null,
    contexts: [],
    numPredict: null,
    timeoutMs: 600000,
    sampleMs: 2000,
    json: false,
    skipModelCheck: false,
    startProfiles: true,
    resetProfiles: true,
    isolateProfiles: true,
    prompt: 'Write one short sentence confirming the remote LLM smoke test is running.',
    scenario: 'vitest-generation',
    scenarios: [],
    efforts: [],
    profiles: [],
    models: [],
    tail: 120,
    runs: 1,
    scenarioIds: [],
    extra: []
  };

  if (args[0] === 'dry-run') {
    options.dryRun = true;
    args.shift();
  }

  const command = args.shift() || 'help';
  options.command = command;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      options.extra = args.slice(index + 1);
      break;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--local') {
      options.local = true;
    } else if (arg === '--tunnel') {
      options.tunnel = true;
      options.explicitFlags.add(arg);
    } else if (arg === '--direct') {
      options.direct = true;
      options.explicitFlags.add(arg);
    } else if (arg === '--require-gpu') {
      options.requireGpu = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--skip-model-check') {
      options.skipModelCheck = true;
    } else if (arg === '--no-start') {
      options.startProfiles = false;
      options.resetProfiles = false;
    } else if (arg === '--no-reset') {
      options.resetProfiles = false;
    } else if (arg === '--no-isolate') {
      options.isolateProfiles = false;
    } else if (arg === '--local-port') {
      options.localPort = readPositiveNumber(args, index, arg);
      options.explicitFlags.add(arg);
      index += 1;
    } else if (arg === '--route') {
      options.route = readOptionValue(args, index, arg);
      options.explicitFlags.add(arg);
      index += 1;
    } else if (arg === '--external-host') {
      options.externalHost = readOptionValue(args, index, arg);
      options.explicitFlags.add(arg);
      index += 1;
    } else if (arg === '--profile') {
      options.profile = readOptionValue(args, index, arg);
      options.explicitFlags.add(arg);
      index += 1;
    } else if (arg === '--profiles') {
      options.profiles = parseList(readOptionValue(args, index, arg));
      index += 1;
    } else if (arg === '--model') {
      options.model = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--models') {
      options.models = parseList(readOptionValue(args, index, arg));
      index += 1;
    } else if (arg === '--context') {
      options.context = readPositiveNumber(args, index, arg);
      index += 1;
    } else if (arg === '--contexts') {
      options.contexts = parseList(readOptionValue(args, index, arg)).map(Number);
      if (options.contexts.some((value) => !Number.isFinite(value) || value <= 0)) {
        fail(`${arg} must be a comma-separated list of positive numbers`);
      }
      index += 1;
    } else if (arg === '--num-predict') {
      options.numPredict = readPositiveNumber(args, index, arg);
      index += 1;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = readPositiveNumber(args, index, arg);
      index += 1;
    } else if (arg === '--sample-ms') {
      options.sampleMs = readPositiveNumber(args, index, arg);
      index += 1;
    } else if (arg === '--prompt') {
      options.prompt = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--scenario') {
      options.scenario = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--scenarios') {
      options.scenarios = parseList(readOptionValue(args, index, arg));
      index += 1;
    } else if (arg === '--effort') {
      options.efforts = [readOptionValue(args, index, arg)];
      index += 1;
    } else if (arg === '--efforts') {
      options.efforts = parseList(readOptionValue(args, index, arg));
      index += 1;
    } else if (arg === '--tail') {
      options.tail = readPositiveNumber(args, index, arg);
      index += 1;
    } else if (arg === '--runs') {
      options.runs = readPositiveNumber(args, index, arg);
      index += 1;
    } else if (arg === '--scenario-ids') {
      options.scenarioIds = parseList(readOptionValue(args, index, arg)).map(Number).filter((v) => Number.isFinite(v) && v > 0);
      index += 1;
    } else if (arg === '-h' || arg === '--help') {
      options.command = 'help';
    } else {
      options.extra.push(arg);
    }
  }

  return options;
}

function validateLocalMode(options) {
  if (!options.local) return;
  if (!['claude', 'run-local', 'print-env', 'run-content-gen'].includes(options.command)) {
    fail('--local is only supported for claude, run-local, print-env, and run-content-gen');
  }
  const conflicts = ['--profile', '--route', '--tunnel', '--direct', '--external-host', '--local-port'];
  for (const flag of conflicts) {
    if (options.explicitFlags.has(flag)) {
      fail(`--local cannot be combined with ${flag} (remote-only). In local mode the endpoint comes from LLM_LOCAL_OLLAMA_HOST.`);
    }
  }
  if (options.command === 'run-content-gen' && options.profiles.length > 0) {
    fail('--local cannot be combined with --profiles (remote-only). In local mode there is a single local endpoint.');
  }
}

function applyHostOverrides(options) {
  if (!options.externalHost) {
    return;
  }
  if (/^https?:\/\//i.test(options.externalHost) || /[/?#]/.test(options.externalHost)) {
    fail('--external-host expects a host or IP address, not a URL');
  }
  config.host.externalHost = options.externalHost;
}

function endpointLine(profileName, route) {
  const profile = getProfile(config, profileName || 'primary');
  return `Endpoint URL: ${endpointFor(config, profile, route)}`;
}

function defaultLocalPort(profile) {
  return profile.port + 10000;
}

function clientEndpoint(profile, options) {
  if (options.local) {
    return config.local.host;
  }
  if (options.tunnel || !options.direct) {
    return `http://127.0.0.1:${options.localPort || defaultLocalPort(profile)}`;
  }
  return endpointFor(config, profile, options.route);
}

function localPortFromEndpoint(endpoint) {
  const url = new URL(endpoint);
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  };
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function canConnect(host, port, timeoutMs = 750) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function assertTunnelPortAvailable(endpoint) {
  const { host, port } = localPortFromEndpoint(endpoint);
  if (!isLoopbackHost(host)) {
    return;
  }
  if (await canConnect(host, port)) {
    throw new Error(
      `Local tunnel endpoint ${endpoint} is already accepting connections. ` +
      `Use --local-port with a free port, or stop the existing local service/tunnel first.`
    );
  }
}

function remoteProfileArgs(command, options) {
  const args = [command];
  if (options.profile) {
    args.push('--profile', options.profile);
  }
  if (options.model && ['start', 'restart'].includes(command)) {
    args.push('--model', options.model);
  }
  if (options.tail && command === 'logs') {
    args.push('--tail', String(options.tail));
  }
  return args;
}

function runProfileCommand(command, options) {
  const result = runRemote(config, options.route, remoteProfileArgs(command, options), {
    dryRun: options.dryRun
  });
  if (['start', 'restart'].includes(command) && options.profile) {
    process.stdout.write(`${endpointLine(options.profile, options.route)}\n`);
  }
  return result;
}

function printEnv(options) {
  if (options.local) {
    const endpoint = clientEndpoint(null, options);
    const model = options.model || config.local.model;
    process.stdout.write(`export OLLAMA_HOST=${shellQuote(endpoint)}\n`);
    process.stdout.write(`export OLLAMA_MODEL=${shellQuote(model)}\n`);
    process.stdout.write(`export ANTHROPIC_BASE_URL=${shellQuote(endpoint)}\n`);
    process.stdout.write(`export ANTHROPIC_AUTH_TOKEN=${shellQuote(process.env.ANTHROPIC_AUTH_TOKEN || 'ollama')}\n`);
    process.stdout.write('export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\n');
    return;
  }
  const profile = getProfile(config, options.profile || 'primary');
  const model = options.model || profile.defaultModel || '';
  const endpoint = clientEndpoint(profile, options);
  process.stdout.write(`export OLLAMA_HOST=${shellQuote(endpoint)}\n`);
  process.stdout.write(`export OLLAMA_MODEL=${shellQuote(model)}\n`);
  process.stdout.write(`export ANTHROPIC_BASE_URL=${shellQuote(endpoint)}\n`);
  process.stdout.write(`export ANTHROPIC_AUTH_TOKEN=${shellQuote(process.env.ANTHROPIC_AUTH_TOKEN || 'ollama')}\n`);
  process.stdout.write('export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\n');
  process.stdout.write(`export REMOTE_OLLAMA_PROFILE=${shellQuote(profile.name)}\n`);
  process.stdout.write(`export REMOTE_OLLAMA_ROUTE=${shellQuote(options.route)}\n`);
  process.stdout.write(`export REMOTE_OLLAMA_PORT=${shellQuote(String(profile.port))}\n`);
}

function localHardwareEnv(endpoint, profile, model, options) {
  return {
    ...process.env,
    OLLAMA_HOST: endpoint,
    OLLAMA_MODEL: model || '',
    ANTHROPIC_BASE_URL: endpoint,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || 'ollama',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    REMOTE_OLLAMA_PROFILE: profile.name,
    REMOTE_OLLAMA_ROUTE: options.route,
    REMOTE_OLLAMA_PORT: String(profile.port),
    REMOTE_OLLAMA_ENDPOINT: endpoint
  };
}

function localModeEnv(endpoint, model) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('REMOTE_OLLAMA_')) delete env[key];
  }
  env.OLLAMA_HOST = endpoint;
  env.OLLAMA_MODEL = model || '';
  env.ANTHROPIC_BASE_URL = endpoint;
  env.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || 'ollama';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return env;
}

async function assertLocalEndpointReachable(endpoint) {
  const status = await health(endpoint);
  if (!status.ok) {
    throw new Error(
      `Local Ollama endpoint ${endpoint} is not reachable: ${status.error}. ` +
      `Start Ollama (e.g. 'ollama serve') or set LLM_LOCAL_OLLAMA_HOST to the right address.`
    );
  }
}

async function runClaude(options) {
  const profile = options.local ? null : getProfile(config, options.profile || 'primary');
  const model = options.local ? (options.model || config.local.model) : (options.model || profile.defaultModel);
  const endpoint = clientEndpoint(profile, options);
  const claudeCmd = process.env.CLAUDE_CMD || 'claude';
  const useTunnel = !options.direct;
  const args = [];
  if (model) {
    args.push('--model', model);
  }
  args.push(...options.extra);

  if (options.dryRun) {
    process.stdout.write(`OLLAMA_HOST=${shellQuote(endpoint)} ANTHROPIC_BASE_URL=${shellQuote(endpoint)} ANTHROPIC_AUTH_TOKEN=${shellQuote(process.env.ANTHROPIC_AUTH_TOKEN || 'ollama')} ${displayCommand(claudeCmd, args)}\n`);
    if (!options.local && useTunnel) {
      process.stdout.write(`Tunnel: ${displayCommand('ssh', tunnelArgs(options, profile))}\n`);
    }
    return;
  }

  if (options.local) {
    await assertLocalEndpointReachable(endpoint);
    process.stdout.write(`Local Ollama endpoint healthy: ${endpoint}\n`);
    await assertEndpointModelAvailable(endpoint, model, options.skipModelCheck);

    const result = spawnSync(claudeCmd, args, {
      stdio: 'inherit',
      env: localModeEnv(endpoint, model)
    });
    if (result.error) {
      throw result.error;
    }
    process.exit(result.status === null ? 1 : result.status);
  }

  const remoteStatus = remoteProfileStatus(options.route, profile.name);
  assertRemoteProfileHealthy(remoteStatus, profile, model, 'claude');
  process.stdout.write(`Remote profile ready: ${profile.name} port=${remoteStatus.port} model=${remoteStatus.model || model}\n`);

  let tunnel = null;
  let status = 0;
  try {
    if (useTunnel) {
      tunnel = await openCheckedTunnel(options, profile, endpoint);
      await waitForLocalEndpoint(endpoint, 15000, tunnel);
      process.stdout.write(`Endpoint healthy: ${endpoint}\n`);
    } else {
      process.stdout.write(`${endpointLine(profile.name, options.route)}\n`);
    }
    await assertEndpointModelAvailable(endpoint, model, options.skipModelCheck);

    const result = spawnSync(claudeCmd, args, {
      stdio: 'inherit',
      env: localHardwareEnv(endpoint, profile, model, options)
    });
    if (result.error) {
      throw result.error;
    }
    status = result.status === null ? 1 : result.status;
  } finally {
    stopTunnel(tunnel);
  }
  process.exit(status);
}

function printTunnelCommand(options) {
  const profile = getProfile(config, options.profile || 'primary');
  const baseArgs = sshBaseArgs(config, options.route);
  const destination = baseArgs.pop();
  const localPort = options.localPort || defaultLocalPort(profile);
  const args = [
    ...baseArgs,
    '-N',
    '-L',
    `${localPort}:127.0.0.1:${profile.port}`,
    destination
  ];
  process.stdout.write(`${displayCommand('ssh', args)}\n`);
}

function tunnelArgs(options, profile) {
  const baseArgs = sshBaseArgs(config, options.route);
  const destination = baseArgs.pop();
  const localPort = options.localPort || defaultLocalPort(profile);
  return [
    ...baseArgs,
    '-o',
    'ExitOnForwardFailure=yes',
    '-N',
    '-L',
    `${localPort}:127.0.0.1:${profile.port}`,
    destination
  ];
}

function openTunnel(options, profile) {
  const args = tunnelArgs(options, profile);
  process.stdout.write(`Opening SSH tunnel: ${displayCommand('ssh', args)}\n`);
  const tunnel = spawn('ssh', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });
  tunnel._remoteOllamaStderr = '';
  tunnel._remoteOllamaStdout = '';
  tunnel.stdout.on('data', (chunk) => {
    tunnel._remoteOllamaStdout += String(chunk);
    process.stdout.write(chunk);
  });
  tunnel.stderr.on('data', (chunk) => {
    tunnel._remoteOllamaStderr += String(chunk);
    process.stderr.write(chunk);
  });
  return tunnel;
}

async function openCheckedTunnel(options, profile, endpoint) {
  await assertTunnelPortAvailable(endpoint);
  return openTunnel(options, profile);
}

async function openBenchmarkTunnel(options, profile, endpoint) {
  const { host, port } = localPortFromEndpoint(endpoint);
  if (isLoopbackHost(host) && await canConnect(host, port)) {
    const status = await health(endpoint);
    if (status.ok) {
      process.stdout.write(`Reusing existing local Ollama endpoint: ${endpoint}\n`);
      return null;
    }
    throw new Error(
      `Local tunnel endpoint ${endpoint} is already accepting connections, ` +
      `but it did not respond like Ollama: ${status.error || 'unknown health error'}`
    );
  }
  return openTunnel(options, profile);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLocalEndpoint(endpoint, timeoutMs, tunnel = null) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    if (tunnel && tunnel.exitCode !== null) {
      const detail = (tunnel._remoteOllamaStderr || tunnel._remoteOllamaStdout || '').trim();
      throw new Error(
        `SSH tunnel exited before endpoint became healthy: code=${tunnel.exitCode} signal=${tunnel.signalCode || ''}` +
        `${detail ? `; ${detail}` : ''}`
      );
    }
    const result = await health(endpoint);
    if (result.ok) {
      return result;
    }
    last = result.error;
    await sleep(250);
  }
  throw new Error(`Endpoint did not become healthy: ${endpoint}; last error: ${last || 'unknown'}`);
}

function parsePercentRows(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+\d+\s+0x[0-9a-f]+,\s*\d+.*?(\d+)%\s+(\d+)%\s*$/i);
    if (match) {
      rows.push({
        device: Number(match[1]),
        vramPercent: Number(match[2]),
        gpuPercent: Number(match[3]),
        line
      });
    }
  }
  return rows;
}

function gpuEvidenceFromTelemetry(samples, logsText) {
  const evidence = [];
  for (const sample of samples) {
    const rocm = sample?.commands?.rocmSmi?.stdout || '';
    for (const row of parsePercentRows(rocm)) {
      if (row.vramPercent > 1 || row.gpuPercent > 0) {
        evidence.push(`rocm-smi device ${row.device}: VRAM ${row.vramPercent}%, GPU ${row.gpuPercent}%`);
      }
    }
  }

  const logs = String(logsText || '');
  for (const pattern of [
    /loaded ROCm backend[^\n]*/gi,
    /device=ROCm\d+[^\n]*/gi,
    /offloaded \d+\/\d+ layers to GPU/gi,
    /found \d+ ROCm devices/gi
  ]) {
    for (const match of logs.matchAll(pattern)) {
      evidence.push(match[0]);
    }
  }

  return [...new Set(evidence)];
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function remoteProfileStatus(route, profileName, timeoutMs = 45000) {
  const result = runRemote(config, route, ['status', '--profile', profileName, '--json'], {
    capture: true,
    timeoutMs
  });
  if (result.status !== 0) {
    throw new Error(`Could not read remote profile status: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Could not parse remote profile status JSON: ${error.message}`);
  }
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!row) {
    throw new Error(`Remote profile status did not include profile '${profileName}'.`);
  }
  return row;
}

async function assertEndpointModelAvailable(endpoint, model, skipModelCheck = false) {
  if (!model || skipModelCheck) {
    return;
  }
  try {
    await requestJson(endpoint, '/api/show', { model }, 30000);
  } catch (error) {
    throw new Error(
      `Endpoint ${endpoint} cannot serve model '${model}': ${error.message}. ` +
      `Start the matching profile/model first or pass --skip-model-check.`
    );
  }
}

function assertRemoteProfileHealthy(status, profile, model, commandName = 'smoke-test') {
  const problems = [];
  if (status.state !== 'running') {
    problems.push(`state=${status.state || '<missing>'}`);
  }
  if (!status.healthy) {
    problems.push(`health=${status.health || 'not ok'}`);
  }
  if (Number(status.port) !== Number(profile.port)) {
    problems.push(`port=${status.port}, expected=${profile.port}`);
  }
  if (model && status.model && status.model !== model) {
    problems.push(`reported model=${status.model}, requested=${model}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `Remote profile '${profile.name}' is not ready for ${commandName} (${problems.join('; ')}).\n` +
      `Start it first, for example:\n` +
      `  ./bin/remote-ollama-mac start --profile ${profile.name} --model ${shellQuote(model || profile.defaultModel || '')}`
    );
  }
}

async function runSmokeTest(options) {
  const profile = getProfile(config, options.profile || 'primary');
  const model = options.model || profile.defaultModel;
  const useTunnel = !options.direct;
  const endpoint = useTunnel
    ? `http://127.0.0.1:${options.localPort || defaultLocalPort(profile)}`
    : endpointFor(config, profile, options.route);
  const resultDir = path.join(config.host.resultsDir, 'smoke-tests');
  const resultPath = path.join(resultDir, `${nowStamp()}-${profile.name}.json`);
  const samples = [];
  let tunnel = null;
  let sampleTimer = null;
  let requestResult = null;
  let logsText = '';

  if (options.dryRun) {
    process.stdout.write(JSON.stringify({
      command: 'smoke-test',
      route: options.route,
      profile: profile.name,
      model,
      endpoint,
      useTunnel,
      localPort: options.localPort || defaultLocalPort(profile),
      prompt: options.prompt,
      requireGpu: options.requireGpu
    }, null, 2));
    process.stdout.write('\n');
    return;
  }

  fs.mkdirSync(resultDir, { recursive: true });

  try {
    const remoteStatus = remoteProfileStatus(options.route, profile.name);
    assertRemoteProfileHealthy(remoteStatus, profile, model);
    process.stdout.write(`Remote profile ready: ${profile.name} port=${remoteStatus.port} model=${remoteStatus.model || model}\n`);

    if (useTunnel) {
      tunnel = await openCheckedTunnel(options, profile, endpoint);
      tunnel.on('exit', (code, signal) => {
        if (requestResult === null) {
          process.stderr.write(`SSH tunnel exited before smoke test completed: code=${code} signal=${signal}\n`);
        }
      });
    }

    await waitForLocalEndpoint(endpoint, Math.min(15000, options.timeoutMs), tunnel);
    process.stdout.write(`Endpoint healthy: ${endpoint}\n`);
    await assertEndpointModelAvailable(endpoint, model, options.skipModelCheck);

    const sample = async (label) => {
      const telemetry = await collectRemoteTelemetry(options.route, profile.name, label);
      telemetry.sampledAt = new Date().toISOString();
      samples.push(telemetry);
      process.stdout.write(`Telemetry sample ${samples.length}: ${telemetry.error ? 'error' : 'ok'}\n`);
    };

    await sample('before');
    sampleTimer = setInterval(() => {
      sample('during').catch((error) => {
        samples.push({ label: 'during', sampledAt: new Date().toISOString(), error: error.message });
      });
    }, options.sampleMs);

    const started = Date.now();
    requestResult = await requestJson(endpoint, '/api/generate', {
      model,
      prompt: options.prompt,
      stream: false,
      options: {
        num_ctx: options.context,
        num_predict: options.numPredict,
        temperature: 0.1
      }
    }, options.timeoutMs);
    const wallMs = Date.now() - started;

    if (sampleTimer) {
      clearInterval(sampleTimer);
      sampleTimer = null;
    }
    await sample('after');

    const logs = runRemote(config, options.route, ['logs', '--profile', profile.name, '--tail', '260'], { capture: true });
    logsText = logs.stdout || logs.stderr || '';
    const gpuEvidence = gpuEvidenceFromTelemetry(samples, logsText);
    const ok = !options.requireGpu || gpuEvidence.length > 0;
    const output = {
      ok,
      generatedAt: new Date().toISOString(),
      route: options.route,
      profile: profile.name,
      expectedGpuVisibility: profile.gpuDevices,
      model,
      endpoint,
      useTunnel,
      localPort: useTunnel ? (options.localPort || defaultLocalPort(profile)) : null,
      remotePort: profile.port,
      prompt: options.prompt,
      requireGpu: options.requireGpu,
      wallMs,
      response: requestResult.response || '',
      ollama: {
        totalDuration: requestResult.total_duration || null,
        loadDuration: requestResult.load_duration || null,
        promptEvalCount: requestResult.prompt_eval_count || null,
        promptEvalDuration: requestResult.prompt_eval_duration || null,
        evalCount: requestResult.eval_count || null,
        evalDuration: requestResult.eval_duration || null,
        done: requestResult.done,
        doneReason: requestResult.done_reason || null
      },
      gpuEvidence,
      telemetrySamples: samples,
      logsTail: logsText
    };
    fs.writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`);

    process.stdout.write(`Smoke test ${ok ? 'passed' : 'failed'}\n`);
    process.stdout.write(`Result: ${resultPath}\n`);
    process.stdout.write(`Response: ${(requestResult.response || '').trim()}\n`);
    if (gpuEvidence.length > 0) {
      process.stdout.write(`GPU evidence:\n${gpuEvidence.map((item) => `- ${item}`).join('\n')}\n`);
    } else {
      process.stdout.write('GPU evidence: none observed\n');
    }
    if (!ok) {
      process.exit(1);
    }
  } finally {
    if (sampleTimer) {
      clearInterval(sampleTimer);
    }
    if (tunnel && !tunnel.killed) {
      tunnel.kill('SIGTERM');
    }
  }
}

async function collectRemoteTelemetry(route, profileName, label) {
  const result = runRemote(config, route, ['telemetry', '--profile', profileName, '--json'], {
    capture: true
  });
  if (result.status !== 0) {
    return {
      label,
      profile: profileName,
      error: result.stderr || result.stdout || `telemetry command exited ${result.status}`
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    parsed.label = label;
    return parsed;
  } catch (error) {
    return {
      label,
      profile: profileName,
      error: `Could not parse telemetry JSON: ${error.message}`,
      raw: result.stdout
    };
  }
}

function stopTunnel(tunnel) {
  if (tunnel && !tunnel.killed) {
    tunnel.kill('SIGTERM');
  }
}

function printDoctor(checks, payload, asJson) {
  const ok = checks.every((check) => check.ok);
  const output = { ok, ...payload, checks };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return ok;
  }

  process.stdout.write(`Remote Ollama doctor: ${ok ? 'ok' : 'failed'}\n`);
  process.stdout.write(`Profile: ${payload.profile}  Route: ${payload.route}  Model: ${payload.model || '<none>'}\n`);
  process.stdout.write(`Endpoint: ${payload.endpoint}\n`);
  for (const check of checks) {
    process.stdout.write(`${check.ok ? 'ok' : 'fail'}\t${check.name}\t${check.detail}\n`);
  }
  return ok;
}

async function runDoctor(options) {
  const profile = getProfile(config, options.profile || 'primary');
  const model = options.model || profile.defaultModel || '';
  const endpoint = clientEndpoint(profile, options);
  const useTunnel = !options.direct;
  const checks = [];
  let remoteStatus = null;
  let tunnel = null;

  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add('profile-config', true, `${profile.name}: remote port ${profile.port}, gpu ${profile.gpuDevices || '<unset>'}`);
  add('ssh-key', !config.host.sshKey || fs.existsSync(config.host.sshKey), config.host.sshKey || '<default ssh key handling>');

  if (options.dryRun) {
    add('dry-run', true, 'network checks skipped');
    printDoctor(checks, {
      route: options.route,
      profile: profile.name,
      model,
      endpoint,
      useTunnel,
      remotePort: profile.port,
      localPort: useTunnel ? (options.localPort || defaultLocalPort(profile)) : null,
      tunnelCommand: useTunnel ? displayCommand('ssh', tunnelArgs(options, profile)) : null
    }, options.json);
    return;
  }

  if (useTunnel) {
    const { host, port } = localPortFromEndpoint(endpoint);
    const busy = isLoopbackHost(host) && await canConnect(host, port);
    add('local-tunnel-port', !busy, busy ? `${endpoint} is already in use` : `${endpoint} is free`);
  }

  try {
    remoteStatus = remoteProfileStatus(options.route, profile.name, Math.min(options.timeoutMs, 45000));
    add('remote-status', true, `state=${remoteStatus.state} healthy=${remoteStatus.healthy} port=${remoteStatus.port}`);
  } catch (error) {
    add('remote-status', false, error.message);
  }

  if (remoteStatus) {
    try {
      assertRemoteProfileHealthy(remoteStatus, profile, model, 'doctor');
      add('profile-health', true, `remote profile is ready for ${model || remoteStatus.model || '<default model>'}`);
    } catch (error) {
      add('profile-health', false, error.message);
    }
  }

  if (checks.every((check) => check.ok)) {
    try {
      if (useTunnel) {
        tunnel = await openCheckedTunnel(options, profile, endpoint);
      }
      const healthResult = await waitForLocalEndpoint(endpoint, Math.min(15000, options.timeoutMs), tunnel);
      add('endpoint-health', true, JSON.stringify(healthResult.version || {}));
    } catch (error) {
      add('endpoint-health', false, error.message);
    }

    if (checks.every((check) => check.ok)) {
      try {
        await assertEndpointModelAvailable(endpoint, model, options.skipModelCheck);
        add('model-available', true, options.skipModelCheck ? 'skipped by --skip-model-check' : (model || '<no model configured>'));
      } catch (error) {
        add('model-available', false, error.message);
      }
    }

    stopTunnel(tunnel);
  }

  const ok = printDoctor(checks, {
    route: options.route,
    profile: profile.name,
    model,
    endpoint,
    useTunnel,
    remotePort: profile.port,
    localPort: useTunnel ? (options.localPort || defaultLocalPort(profile)) : null
  }, options.json);
  if (!ok) {
    process.exit(1);
  }
}

async function runLocalCommand(options) {
  if (options.extra.length === 0) {
    fail('run-local requires a command after --, for example: remote-ollama-mac run-local --profile dual -- node ~/.claude/skills/local-test-gen/scripts/main.mjs --dry-run');
  }

  const profile = options.local ? null : getProfile(config, options.profile || 'primary');
  const model = options.local ? (options.model || config.local.model) : (options.model || profile.defaultModel || '');
  const endpoint = clientEndpoint(profile, options);
  const useTunnel = !options.direct;

  if (options.dryRun) {
    process.stdout.write(`OLLAMA_HOST=${shellQuote(endpoint)} OLLAMA_MODEL=${shellQuote(model)} ${displayCommand(options.extra[0], options.extra.slice(1))}\n`);
    if (!options.local && useTunnel) {
      process.stdout.write(`Tunnel: ${displayCommand('ssh', tunnelArgs(options, profile))}\n`);
    }
    return;
  }

  if (options.local) {
    await assertLocalEndpointReachable(endpoint);
    process.stdout.write(`Local Ollama endpoint healthy: ${endpoint}\n`);
    await assertEndpointModelAvailable(endpoint, model, options.skipModelCheck);

    const result = spawnSync(options.extra[0], options.extra.slice(1), {
      stdio: 'inherit',
      env: localModeEnv(endpoint, model)
    });
    if (result.error) {
      throw result.error;
    }
    process.exit(result.status === null ? 1 : result.status);
  }

  const remoteStatus = remoteProfileStatus(options.route, profile.name, Math.min(options.timeoutMs, 45000));
  assertRemoteProfileHealthy(remoteStatus, profile, model, 'run-local');
  process.stdout.write(`Remote profile ready: ${profile.name} port=${remoteStatus.port} model=${remoteStatus.model || model}\n`);

  let tunnel = null;
  let status = 0;
  try {
    if (useTunnel) {
      tunnel = await openCheckedTunnel(options, profile, endpoint);
    }
    await waitForLocalEndpoint(endpoint, Math.min(15000, options.timeoutMs), tunnel);
    process.stdout.write(`Endpoint healthy: ${endpoint}\n`);
    await assertEndpointModelAvailable(endpoint, model, options.skipModelCheck);

    const result = spawnSync(options.extra[0], options.extra.slice(1), {
      stdio: 'inherit',
      env: localHardwareEnv(endpoint, profile, model, options)
    });
    if (result.error) {
      throw result.error;
    }
    status = result.status === null ? 1 : result.status;
  } finally {
    stopTunnel(tunnel);
  }
  process.exit(status);
}

async function runBenchmark(options, matrix) {
  const profileNames = matrix
    ? (options.profiles.length > 0 ? options.profiles : ['primary', 'secondary', 'dual'])
    : [options.profile || 'primary'];
  const models = matrix
    ? options.models
    : [options.model || getProfile(config, profileNames[0]).defaultModel].filter(Boolean);
  const contexts = matrix
    ? (options.contexts.length > 0 ? options.contexts : [4096, 8192])
    : [options.context];

  if (options.dryRun) {
    process.stdout.write(JSON.stringify({
      route: options.route,
      profiles: profileNames,
      models,
      contexts,
      numPredict: options.numPredict,
      scenario: options.scenario,
      resultsDir: config.host.resultsDir
    }, null, 2));
    process.stdout.write('\n');
    return;
  }

  const result = await runBenchmarkMatrix({
    config,
    route: options.route,
    profileNames,
    models,
    contexts,
    numPredict: options.numPredict,
    scenarioName: options.scenario,
    collectTelemetry: (profileName, label) => collectRemoteTelemetry(options.route, profileName, label)
  });

  process.stdout.write(`Results directory: ${result.resultDir}\n`);
  process.stdout.write(`JSONL: ${result.jsonlPath}\n`);
  process.stdout.write(`Summary: ${result.summaryPath}\n`);
}

async function runHardwareBenchmark(options) {
  const plan = buildHardwareBenchmarkSpecs(config, {
    models: options.models,
    profileNames: options.profiles,
    contexts: options.contexts,
    efforts: options.efforts,
    scenarioNames: options.scenarios
  });
  const profileNames = [...new Set(plan.specs.map((spec) => spec.profileName))];
  const useTunnel = !options.direct;

  if (plan.specs.length === 0) {
    fail('benchmark-hardware did not find any model/profile specs. Check config/models.json or pass --models/--profiles.');
  }
  if (useTunnel && options.localPort && profileNames.length > 1) {
    fail('--local-port can only be used with benchmark-hardware when one profile is selected.');
  }

  if (options.dryRun) {
    process.stdout.write(JSON.stringify({
      command: 'benchmark-hardware',
      route: options.route,
      useTunnel,
      startProfiles: options.startProfiles,
      resetProfiles: options.resetProfiles,
      isolateProfiles: options.isolateProfiles,
      scenarios: plan.scenarios,
      contexts: plan.contexts,
      efforts: plan.efforts,
      profiles: profileNames,
      runs: plan.specs,
      tunnels: useTunnel
        ? profileNames.map((profileName) => {
            const profile = getProfile(config, profileName);
            return {
              profile: profile.name,
              endpoint: clientEndpoint(profile, options),
              command: displayCommand('ssh', tunnelArgs(options, profile))
            };
          })
        : []
    }, null, 2));
    process.stdout.write('\n');
    return;
  }

  const tunnels = new Map();
  const endpoints = new Map();
  const currentModelByProfile = new Map();
  try {
    for (const profileName of profileNames) {
      const profile = getProfile(config, profileName);
      const endpoint = clientEndpoint(profile, options);
      endpoints.set(profile.name, endpoint);
      if (useTunnel) {
        tunnels.set(profile.name, await openBenchmarkTunnel(options, profile, endpoint));
      }
    }

    const result = await runBenchmarkMatrix({
      config,
      route: options.route,
      runSpecs: plan.specs,
      scenarioNames: plan.scenarios,
      timeoutMs: options.timeoutMs,
      endpointForRun: (profile) => endpoints.get(profile.name) || endpointFor(config, profile, options.route),
      beforeRun: async ({ profile, endpoint, model }) => {
        const key = `${profile.name}\t${model}`;
        if (currentModelByProfile.get(profile.name) !== key) {
          if (options.startProfiles) {
            if (options.isolateProfiles) {
              for (const otherProfileName of Object.keys(config.profiles)) {
                if (otherProfileName === profile.name) {
                  continue;
                }
                runRemote(config, options.route, ['stop', '--profile', otherProfileName], {
                  capture: true,
                  timeoutMs: options.timeoutMs
                });
                currentModelByProfile.delete(otherProfileName);
              }
            }
            const command = options.resetProfiles ? 'restart' : 'start';
            process.stdout.write(`${options.resetProfiles ? 'Resetting' : 'Starting'} remote profile ${profile.name} with ${model}\n`);
            runRemote(config, options.route, [command, '--profile', profile.name, '--model', model], {
              timeoutMs: options.timeoutMs
            });
          }
          await waitForLocalEndpoint(endpoint, Math.min(30000, options.timeoutMs), tunnels.get(profile.name));
          await assertEndpointModelAvailable(endpoint, model, options.skipModelCheck);
          currentModelByProfile.set(profile.name, key);
        }
      },
      collectTelemetry: (profileName, label) => collectRemoteTelemetry(options.route, profileName, label)
    });

    process.stdout.write(`Results directory: ${result.resultDir}\n`);
    process.stdout.write(`JSONL: ${result.jsonlPath}\n`);
    process.stdout.write(`Summary: ${result.summaryPath}\n`);
  } finally {
    for (const tunnel of tunnels.values()) {
      stopTunnel(tunnel);
    }
  }
}

function runRemoteProjectTool(options, mode) {
  const script = path.posix.join(config.host.remoteScriptsDir, 'remote-project-safety-check');
  const args = ['--repo', config.host.remoteProjectDir];
  if (mode === 'sync') {
    args.push('--require-git-remote', '--pull');
  } else if (mode === 'push-main') {
    args.push('--require-git-remote', '--push');
    if (!options.extra.includes('--branch')) {
      args.push('--branch', 'main');
    }
  }
  args.push(...options.extra);
  runRemoteScript(config, options.route, script, args, { dryRun: options.dryRun });
}

function runRemoteExec(options) {
  if (options.extra.length === 0) {
    fail('exec requires a command after --, for example: remote-ollama-mac exec -- pwd');
  }

  const pathPrefix = [
    config.host.remoteScriptsDir,
    '/home/darren/bin',
    '/home/darren/.local/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ].filter(Boolean).join(':');
  const command = [
    `export PATH=${shellQuote(pathPrefix)}:$PATH;`,
    `[ -d ${shellQuote(config.host.remoteProjectDir)} ] && cd ${shellQuote(config.host.remoteProjectDir)};`,
    'exec',
    ...options.extra.map((arg) => shellQuote(arg))
  ].join(' ');
  const sshArgs = [...sshBaseArgs(config, options.route), command];
  const printable = displayCommand('ssh', sshArgs);

  if (options.dryRun) {
    process.stdout.write(`${printable}\n`);
    return;
  }

  const result = spawnSync('ssh', sshArgs, {
    stdio: 'inherit',
    env: process.env
  });
  process.exit(result.status === null ? 1 : result.status);
}

async function runContentGen(options) {
  const { loadScenarios, resolveVaultDir } = require('./lib/ak-scenarios');
  const { runScenario } = require('./lib/ak-runner');
  const { scoreRun, writeContentSummary } = require('./lib/ak-compare');

  const vaultDir = resolveVaultDir(config.env);
  let scenarios = loadScenarios(vaultDir);

  if (options.scenarioIds.length > 0) {
    const ids = new Set(options.scenarioIds);
    scenarios = scenarios.filter((s) => ids.has(s.index));
  }

  if (scenarios.length === 0) {
    fail('No scenarios found. Check LLM_AK_VAULT_DIR or --scenario-ids.');
  }

  const profileNames = options.local
    ? ['local']
    : (options.profiles.length > 0 ? options.profiles : ['dual']);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultDir = path.join(config.host.resultsDir, `${timestamp}-content-gen`);

  if (options.dryRun) {
    process.stdout.write(JSON.stringify({
      command: 'run-content-gen',
      route: options.route,
      profiles: profileNames,
      scenarios: scenarios.map((s) => `${s.index}. ${s.title}`),
      runsPerScenario: options.runs,
      vaultDir,
      resultDir,
      startProfiles: options.startProfiles,
      resetProfiles: options.resetProfiles
    }, null, 2));
    process.stdout.write('\n');
    return;
  }

  fs.mkdirSync(resultDir, { recursive: true });
  const jsonlPath = path.join(resultDir, 'runs.jsonl');
  const summaryPath = path.join(resultDir, 'summary.md');
  const allResults = [];
  const tunnels = new Map();
  const endpoints = new Map();

  try {
    for (const profileName of profileNames) {
      const profile = options.local ? null : getProfile(config, profileName);
      const model = options.model || (options.local ? config.local.model : profile.defaultModel);
      if (options.local && !model) {
        fail('--local requires --model (or LLM_LOCAL_OLLAMA_MODEL) since there is no default local model.');
      }
      const endpoint = options.local ? config.local.host : clientEndpoint(profile, options);
      endpoints.set(profileName, endpoint);

      if (!options.local && !options.direct) {
        tunnels.set(profileName, await openBenchmarkTunnel(options, profile, endpoint));
      }

      if (!options.local && options.startProfiles) {
        const command = options.resetProfiles ? 'restart' : 'start';
        process.stdout.write(`${options.resetProfiles ? 'Resetting' : 'Starting'} remote profile ${profileName} with ${model}\n`);
        runRemote(config, options.route, [command, '--profile', profileName, '--model', model], {
          timeoutMs: options.timeoutMs
        });
      }

      await waitForLocalEndpoint(endpoint, Math.min(30000, options.timeoutMs), tunnels.get(profileName));
      process.stdout.write(`Endpoint healthy: ${endpoint}\n`);
      await assertEndpointModelAvailable(endpoint, model, options.skipModelCheck);

      let runIndex = 0;
      for (const scenario of scenarios) {
        for (let repeat = 0; repeat < options.runs; repeat += 1) {
          runIndex += 1;
          const runId = [
            'cg',
            String(runIndex).padStart(4, '0'),
            profileName,
            `s${String(scenario.index).padStart(2, '0')}`,
            `r${repeat + 1}`
          ].join('-');
          const runOutDir = path.join(resultDir, 'raw', runId);
          fs.mkdirSync(runOutDir, { recursive: true });

          process.stdout.write(
            `[${runIndex}] ${profileName} | scenario ${String(scenario.index).padStart(2, '0')} ${scenario.title} | run ${repeat + 1}/${options.runs}\n`
          );

          let runResult;
          try {
            runResult = await runScenario(endpoint, model, scenario, runOutDir, runId, options.timeoutMs);
          } catch (error) {
            runResult = {
              toolCallProduced: false,
              toolArgs: null,
              llmMs: 0,
              llmError: error.message,
              execResult: null,
              outDir: null
            };
          }

          const refSpecPath = path.join(scenario.artifactDir, 'spec.json');
          const refReceiptPath = path.join(scenario.artifactDir, 'budget-receipt.json');
          const scoreResult = scoreRun(runResult, scenario, refSpecPath, refReceiptPath);

          const record = {
            runId,
            timestamp: new Date().toISOString(),
            profile: profileName,
            model,
            scenarioIndex: scenario.index,
            scenarioTitle: scenario.title,
            scenarioTier: scenario.tier,
            scenarioBudget: scenario.budget,
            repeat: repeat + 1,
            toolCallProduced: runResult.toolCallProduced,
            toolArgs: runResult.toolArgs || null,
            llmMs: runResult.llmMs,
            llmError: runResult.llmError || null,
            execSucceeded: runResult.execResult?.succeeded || false,
            execExitCode: runResult.execResult?.exitCode ?? null,
            execMs: runResult.execResult?.execMs || null,
            execStderr: runResult.execResult?.stderr || null,
            outDir: runResult.outDir || null,
            score: scoreResult.points,
            scoreMax: scoreResult.max,
            scoreBreakdown: scoreResult.breakdown
          };

          allResults.push(record);
          fs.appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`);
          writeContentSummary(summaryPath, allResults, {
            profiles: profileNames,
            scenarios: scenarios.length,
            route: options.route,
            resultDir
          });

          process.stdout.write(
            `  Score: ${scoreResult.points}/100 | Tool: ${runResult.toolCallProduced ? 'yes' : 'no'} | ` +
            `Exec: ${runResult.execResult?.succeeded ? 'ok' : 'fail'} | LLM: ${runResult.llmMs}ms\n`
          );
        }
      }
    }
  } finally {
    for (const tunnel of tunnels.values()) {
      stopTunnel(tunnel);
    }
  }

  process.stdout.write(`Result directory: ${resultDir}\n`);
  process.stdout.write(`JSONL: ${jsonlPath}\n`);
  process.stdout.write(`Summary: ${summaryPath}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateLocalMode(options);
  applyHostOverrides(options);

  if (options.command === 'help') {
    usage();
    return;
  }

  if (['start', 'stop', 'restart', 'logs', 'doctor', 'claude', 'run-local', 'tunnel-command', 'smoke-test'].includes(options.command) && !options.profile) {
    options.profile = 'primary';
  }

  if (options.context === null || options.numPredict === null) {
    const profileDefaults = config.profiles[options.profile || 'primary'] || {};
    if (options.context === null) {
      options.context = profileDefaults.defaultContext || 8192;
    }
    if (options.numPredict === null) {
      options.numPredict = profileDefaults.defaultNumPredict || 4096;
    }
  }

  if (['start', 'stop', 'restart', 'status', 'ps', 'logs', 'telemetry'].includes(options.command)) {
    runProfileCommand(options.command, options);
  } else if (options.command === 'print-env') {
    printEnv(options);
  } else if (options.command === 'doctor') {
    await runDoctor(options);
  } else if (options.command === 'claude') {
    await runClaude(options);
  } else if (options.command === 'run-local') {
    await runLocalCommand(options);
  } else if (options.command === 'exec') {
    runRemoteExec(options);
  } else if (options.command === 'tunnel-command') {
    printTunnelCommand(options);
  } else if (options.command === 'smoke-test') {
    await runSmokeTest(options);
  } else if (options.command === 'benchmark') {
    await runBenchmark(options, false);
  } else if (options.command === 'benchmark-matrix') {
    await runBenchmark(options, true);
  } else if (options.command === 'benchmark-hardware') {
    await runHardwareBenchmark(options);
  } else if (options.command === 'run-content-gen') {
    await runContentGen(options);
  } else if (options.command === 'project-safety-check') {
    runRemoteProjectTool(options, 'check');
  } else if (options.command === 'project-sync') {
    runRemoteProjectTool(options, 'sync');
  } else if (options.command === 'project-push-main') {
    runRemoteProjectTool(options, 'push-main');
  } else {
    usage();
    process.exit(2);
  }
}

main().catch((error) => {
  fail(error.message);
});
