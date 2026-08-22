'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadTriggerPolicy(rootDir) {
  const policy = JSON.parse(fs.readFileSync(path.join(rootDir, 'config', 'benchmark-trigger-policy.json'), 'utf8'));
  if (policy.schemaVersion !== 'agent-kernel-benchmark-trigger-policy/v1'
    || !policy.runnerContractVersion || !Array.isArray(policy.relevantPaths)
    || !policy.pathClasses || !['authoring', 'runtimeExecution', 'generatedExecution']
      .every((name) => Array.isArray(policy.pathClasses[name]))) {
    throw new Error('Invalid benchmark trigger policy');
  }
  return policy;
}

function pathMatches(pattern, filePath) {
  if (pattern.endsWith('/**')) return filePath.startsWith(pattern.slice(0, -2));
  const expression = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*');
  return new RegExp(`^${expression}$`).test(filePath);
}

function classifyTrigger({
  policy,
  polledRef = policy.sourceRef,
  changedPaths = [],
  initial = false,
  scenarioHashChanged = false,
  matrixHashChanged = false,
  executionSuiteHashChanged = false
}) {
  const emptyModes = () => ({ authoring: false, runtimeExecution: false, generatedExecution: false });
  if (polledRef === policy.resultBranch) {
    return { required: false, reasons: ['result_branch'], relevantPaths: [], pathClasses: [], modes: emptyModes() };
  }
  const reasons = [];
  if (initial) reasons.push('initial_evaluation');
  if (scenarioHashChanged) reasons.push('scenario_hash');
  if (matrixHashChanged) reasons.push('matrix_hash');
  if (executionSuiteHashChanged) reasons.push('execution_suite_hash');
  const relevant = changedPaths.filter((filePath) => (
    policy.relevantPaths.some((pattern) => pathMatches(pattern, filePath))
  ));
  if (relevant.length > 0) reasons.push('relevant_source');
  const matchedClasses = Object.entries(policy.pathClasses).filter(([, patterns]) => (
    changedPaths.some((filePath) => patterns.some((pattern) => pathMatches(pattern, filePath)))
  )).map(([name]) => name);
  const modes = emptyModes();
  if (initial) Object.keys(modes).forEach((name) => { modes[name] = true; });
  if (scenarioHashChanged || matrixHashChanged) {
    modes.authoring = true;
    modes.generatedExecution = true;
  }
  if (executionSuiteHashChanged) {
    modes.runtimeExecution = true;
    modes.generatedExecution = true;
  }
  matchedClasses.forEach((name) => { modes[name] = true; });
  if (modes.authoring) modes.generatedExecution = true;
  if (modes.runtimeExecution) modes.generatedExecution = true;
  return { required: Object.values(modes).some(Boolean), reasons, relevantPaths: relevant,
    pathClasses: matchedClasses, modes };
}

function computeRunKey(input) {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right))));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

module.exports = { classifyTrigger, computeRunKey, loadTriggerPolicy, pathMatches };
