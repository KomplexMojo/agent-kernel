#!/usr/bin/env node
'use strict';

const { loadConfig } = require('./lib/config');
const { runBenchmarkMatrix } = require('./lib/benchmark');

function parseList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    route: 'internal',
    profiles: ['primary'],
    models: [],
    contexts: [8192],
    numPredict: 4096,
    scenario: 'vitest-generation'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--route') {
      options.route = argv[++index];
    } else if (arg === '--profile') {
      options.profiles = [argv[++index]];
    } else if (arg === '--profiles') {
      options.profiles = parseList(argv[++index]);
    } else if (arg === '--model') {
      options.models = [argv[++index]];
    } else if (arg === '--models') {
      options.models = parseList(argv[++index]);
    } else if (arg === '--context') {
      options.contexts = [Number(argv[++index])];
    } else if (arg === '--contexts') {
      options.contexts = parseList(argv[++index]).map(Number);
    } else if (arg === '--num-predict') {
      options.numPredict = Number(argv[++index]);
    } else if (arg === '--scenario') {
      options.scenario = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const config = loadConfig();
  const options = parseArgs(process.argv.slice(2));
  const result = await runBenchmarkMatrix({
    config,
    route: options.route,
    profileNames: options.profiles,
    models: options.models,
    contexts: options.contexts,
    numPredict: options.numPredict,
    scenarioName: options.scenario
  });
  process.stdout.write(`Results: ${result.resultDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
});
