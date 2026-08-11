'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadTriggerPolicy(rootDir) {
  const policy = JSON.parse(fs.readFileSync(path.join(rootDir, 'config', 'benchmark-trigger-policy.json'), 'utf8'));
  if (policy.schemaVersion !== 'agent-kernel-benchmark-trigger-policy/v1'
    || !policy.runnerContractVersion || !Array.isArray(policy.relevantPaths)) {
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
  matrixHashChanged = false
}) {
  if (polledRef === policy.resultBranch) return { required: false, reasons: ['result_branch'] };
  const reasons = [];
  if (initial) reasons.push('initial_evaluation');
  if (scenarioHashChanged) reasons.push('scenario_hash');
  if (matrixHashChanged) reasons.push('matrix_hash');
  const relevant = changedPaths.filter((filePath) => (
    policy.relevantPaths.some((pattern) => pathMatches(pattern, filePath))
  ));
  if (relevant.length > 0) reasons.push('relevant_source');
  return { required: reasons.length > 0, reasons, relevantPaths: relevant };
}

function computeRunKey(input) {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right))));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

module.exports = { classifyTrigger, computeRunKey, loadTriggerPolicy, pathMatches };
