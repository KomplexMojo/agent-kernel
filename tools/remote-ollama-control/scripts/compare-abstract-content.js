#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { comparePairedAttempts, validateComparisonMetadata } = require('./lib/abstract-compare');

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { contentDir: null, abstractDir: null, outDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--content-dir', '--abstract-dir', '--out-dir'].includes(flag) || !value) fail(`invalid argument: ${flag}`);
    if (flag === '--content-dir') options.contentDir = path.resolve(value);
    if (flag === '--abstract-dir') options.abstractDir = path.resolve(value);
    if (flag === '--out-dir') options.outDir = path.resolve(value);
    index += 1;
  }
  if (!options.contentDir || !options.abstractDir) fail('--content-dir and --abstract-dir are required');
  options.outDir ||= path.join(options.abstractDir, 'comparison');
  return options;
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function percent(metric) {
  return `${(metric.rate * 100).toFixed(1)}% (${metric.pass}/${metric.total})`;
}

function renderSummary(result) {
  return [
    '# Abstract vs Domain-Prompt Benchmark',
    '',
    `- Paired attempts: ${result.pairs}`,
    `- Profile/model: ${result.profiles.join(', ')} / ${result.models.join(', ')}`,
    '',
    '| Metric | Domain prompt | Abstract | Delta |',
    '|---|---:|---:|---:|',
    `| End-to-end verdict | ${percent(result.content.expectedOutcome)} | ${percent(result.abstract.endToEnd)} | ${(result.delta.endToEndRate * 100).toFixed(1)} pp |`,
    `| Raw execution | ${percent(result.content.rawExecution)} | ${percent(result.abstract.rawExecution)} | ${(result.delta.rawExecutionRate * 100).toFixed(1)} pp |`,
    `| Native score (different contracts) | ${result.content.averageScore} semantic | ${result.abstract.averagePlanningScore} planning | n/a |`,
    `| Average LLM latency | ${result.content.averageLlmMs} ms | ${result.abstract.averageLlmMs} ms | ${result.delta.averageLlmMs} ms |`,
    '',
    `Abstract exact planning: ${percent(result.abstract.planningExact)}; mapping: ${percent(result.abstract.mapping)}; execution outcome: ${percent(result.abstract.expectedOutcome)}; end to end: ${percent(result.abstract.endToEnd)}.`,
    '',
  ].join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const content = readJsonl(path.join(options.contentDir, 'runs.jsonl'));
  const abstract = readJsonl(path.join(options.abstractDir, 'runs.jsonl'));
  const contentResult = JSON.parse(fs.readFileSync(path.join(options.contentDir, 'result.json'), 'utf8'));
  const abstractResult = JSON.parse(fs.readFileSync(path.join(options.abstractDir, 'result.json'), 'utf8'));
  const metadata = validateComparisonMetadata(contentResult, abstractResult);
  const result = comparePairedAttempts(content, abstract, metadata);
  fs.mkdirSync(options.outDir, { recursive: true });
  const resultPath = path.join(options.outDir, 'comparison.json');
  const summaryPath = path.join(options.outDir, 'summary.md');
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(summaryPath, renderSummary(result));
  process.stdout.write(`${JSON.stringify({ resultPath, summaryPath, pairs: result.pairs })}\n`);
}

main();
