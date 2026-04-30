#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const {
  endpointFor,
  getProfile,
  loadConfig,
  shellQuote
} = require('./lib/config');
const { runBenchmarkMatrix } = require('./lib/benchmark');
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
  remote-ollama-mac claude --profile NAME [--model MODEL] [-- CLAUDE_ARGS...]
  remote-ollama-mac benchmark --profile NAME --model MODEL --context N --num-predict N --scenario NAME
  remote-ollama-mac benchmark-matrix --profiles a,b --models x,y --contexts 4096,8192 --scenario NAME
  remote-ollama-mac project-safety-check [remote-project-safety-check args...]
  remote-ollama-mac project-sync [--branch main]
  remote-ollama-mac project-push-main [--branch main]
  remote-ollama-mac dry-run start --profile dual --model qwen3-coder:30b

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

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    dryRun: false,
    tunnel: false,
    localPort: null,
    route: config.host.defaultRoute,
    profile: null,
    model: null,
    context: 8192,
    contexts: [],
    numPredict: 4096,
    scenario: 'vitest-generation',
    profiles: [],
    models: [],
    tail: 120,
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
    } else if (arg === '--tunnel') {
      options.tunnel = true;
    } else if (arg === '--local-port') {
      options.localPort = Number(args[++index]);
    } else if (arg === '--route') {
      options.route = args[++index];
    } else if (arg === '--profile') {
      options.profile = args[++index];
    } else if (arg === '--profiles') {
      options.profiles = parseList(args[++index]);
    } else if (arg === '--model') {
      options.model = args[++index];
    } else if (arg === '--models') {
      options.models = parseList(args[++index]);
    } else if (arg === '--context') {
      options.context = Number(args[++index]);
    } else if (arg === '--contexts') {
      options.contexts = parseList(args[++index]).map(Number);
    } else if (arg === '--num-predict') {
      options.numPredict = Number(args[++index]);
    } else if (arg === '--scenario') {
      options.scenario = args[++index];
    } else if (arg === '--tail') {
      options.tail = Number(args[++index]);
    } else if (arg === '-h' || arg === '--help') {
      options.command = 'help';
    } else {
      options.extra.push(arg);
    }
  }

  return options;
}

function endpointLine(profileName, route) {
  const profile = getProfile(config, profileName || 'primary');
  return `Endpoint URL: ${endpointFor(config, profile, route)}`;
}

function clientEndpoint(profile, options) {
  if (options.tunnel) {
    return `http://127.0.0.1:${options.localPort || profile.port}`;
  }
  return endpointFor(config, profile, options.route);
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
  const profile = getProfile(config, options.profile || 'primary');
  const endpoint = clientEndpoint(profile, options);
  process.stdout.write(`export OLLAMA_HOST=${shellQuote(endpoint)}\n`);
  process.stdout.write(`export ANTHROPIC_BASE_URL=${shellQuote(endpoint)}\n`);
  process.stdout.write(`export ANTHROPIC_AUTH_TOKEN=${shellQuote(process.env.ANTHROPIC_AUTH_TOKEN || 'ollama')}\n`);
  process.stdout.write('export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1\n');
}

function runClaude(options) {
  const profile = getProfile(config, options.profile || 'primary');
  const model = options.model || profile.defaultModel;
  const endpoint = clientEndpoint(profile, options);
  const claudeCmd = process.env.CLAUDE_CMD || 'claude';
  const args = [];
  if (model) {
    args.push('--model', model);
  }
  args.push(...options.extra);

  if (options.dryRun) {
    process.stdout.write(`OLLAMA_HOST=${shellQuote(endpoint)} ANTHROPIC_BASE_URL=${shellQuote(endpoint)} ANTHROPIC_AUTH_TOKEN=${shellQuote(process.env.ANTHROPIC_AUTH_TOKEN || 'ollama')} ${displayCommand(claudeCmd, args)}\n`);
    return;
  }

  process.stdout.write(`${endpointLine(profile.name, options.route)}\n`);
  const result = spawnSync(claudeCmd, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      OLLAMA_HOST: endpoint,
      ANTHROPIC_BASE_URL: endpoint,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || 'ollama',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
    }
  });
  process.exit(result.status === null ? 1 : result.status);
}

function printTunnelCommand(options) {
  const profile = getProfile(config, options.profile || 'primary');
  const baseArgs = sshBaseArgs(config, options.route);
  const destination = baseArgs.pop();
  const localPort = options.localPort || profile.port;
  const args = [
    ...baseArgs,
    '-N',
    '-L',
    `${localPort}:127.0.0.1:${profile.port}`,
    destination
  ];
  process.stdout.write(`${displayCommand('ssh', args)}\n`);
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

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === 'help') {
    usage();
    return;
  }

  if (['start', 'stop', 'restart', 'logs', 'claude', 'tunnel-command'].includes(options.command) && !options.profile) {
    options.profile = 'primary';
  }

  if (['start', 'stop', 'restart', 'status', 'ps', 'logs', 'telemetry'].includes(options.command)) {
    runProfileCommand(options.command, options);
  } else if (options.command === 'print-env') {
    printEnv(options);
  } else if (options.command === 'claude') {
    runClaude(options);
  } else if (options.command === 'tunnel-command') {
    printTunnelCommand(options);
  } else if (options.command === 'benchmark') {
    await runBenchmark(options, false);
  } else if (options.command === 'benchmark-matrix') {
    await runBenchmark(options, true);
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
