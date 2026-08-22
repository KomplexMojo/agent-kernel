#!/usr/bin/env node
'use strict';

/**
 * Prints the benchmark identities derived from this checkout.
 *
 * The installed agent refuses to start unless AK_BENCHMARK_SCENARIO_HASH,
 * AK_BENCHMARK_MATRIX_HASH and AK_BENCHMARK_EXECUTION_SUITE_HASH are all set,
 * and the shipped env template carries only <placeholder> markers — deliberately,
 * because an identity that drifts from the source it describes must fail closed
 * rather than be guessed. That leaves the operator needing a way to read the
 * current values, which is this command.
 *
 * Reads only committed catalog and config files. No network, no GPU, no host.
 */

const { currentBenchmarkIdentity } = require('./lib/benchmark-result-reader.js');

const ENV_NAMES = Object.freeze({
  scenario: 'AK_BENCHMARK_SCENARIO_HASH',
  matrix: 'AK_BENCHMARK_MATRIX_HASH',
  execution: 'AK_BENCHMARK_EXECUTION_SUITE_HASH',
});

function parseArgs(rawArgv) {
  // `pnpm run identity -- --env` forwards the separator itself, which is how every
  // documented invocation of these scripts is written.
  const argv = rawArgv.filter((arg) => arg !== '--');
  const known = new Set(['--env', '--json']);
  for (const arg of argv) {
    if (!known.has(arg)) {
      throw new Error(`Usage: print-benchmark-identity.js [--env | --json]\nUnknown option: ${arg}`);
    }
  }
  return { env: argv.includes('--env') };
}

function main() {
  const { env } = parseArgs(process.argv.slice(2));
  const identity = currentBenchmarkIdentity();

  if (env) {
    process.stdout.write([
      `${ENV_NAMES.scenario}=${identity.scenarioSet.sha256}`,
      `${ENV_NAMES.matrix}=${identity.matrix.sha256}`,
      `${ENV_NAMES.execution}=${identity.execution.executionSuiteHash}`,
      '',
    ].join('\n'));
    return;
  }

  process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
