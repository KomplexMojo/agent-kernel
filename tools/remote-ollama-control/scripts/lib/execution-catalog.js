'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXECUTION_CATALOG_DIR = path.resolve(__dirname, '..', '..', 'benchmarks', 'execution');
const FAMILIES = ['traversal', 'combat', 'hazards', 'resources', 'stress'];
const DIRECTIONS = new Set(['min', 'max', 'range', 'exact', 'relational']);
const EVIDENCE = new Set(['artifact', 'observation']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`invalid execution catalog JSON ${file}: ${error.message}`);
  }
}

function assertKeys(value, allowed, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} has unknown field: ${key}`);
}

function validateContract(contract) {
  assertKeys(contract, new Set([
    'schemaVersion', 'evaluatorVersion', 'qualification', 'profiles', 'invariants', 'metrics',
  ]), 'execution contract');
  if (contract.schemaVersion !== 'agent-kernel-execution-metric-contract/v1') throw new Error('invalid execution metric contract');
  if (typeof contract.evaluatorVersion !== 'string' || contract.evaluatorVersion === '') throw new Error('evaluatorVersion is required');
  if (!isObject(contract.profiles) || !isObject(contract.metrics) || !isObject(contract.invariants)) {
    throw new Error('profiles, metrics, and invariants are required');
  }
  assertKeys(contract.qualification, new Set([
    'meanScore', 'medianScore', 'minimumSeedScore', 'probabilisticGateRate', 'deterministicGateRate',
  ]), 'execution qualification');
  for (const score of ['meanScore', 'medianScore', 'minimumSeedScore']) {
    if (!Number.isFinite(contract.qualification[score])
      || contract.qualification[score] < 0 || contract.qualification[score] > 100) {
      throw new Error(`execution qualification ${score} must be between 0 and 100`);
    }
  }
  for (const rate of ['probabilisticGateRate', 'deterministicGateRate']) {
    if (!Number.isFinite(contract.qualification[rate])
      || contract.qualification[rate] < 0 || contract.qualification[rate] > 1) {
      throw new Error(`execution qualification ${rate} must be between 0 and 1`);
    }
  }
  for (const [name, profile] of Object.entries(contract.profiles)) {
    assertKeys(profile, new Set(['ticks', 'seeds', 'checkpoints', 'repeats']), `profile ${name}`);
    if (!Number.isInteger(profile.ticks) || profile.ticks < 1) throw new Error(`profile ${name} ticks must be positive`);
    if (!Array.isArray(profile.seeds) || profile.seeds.some((seed) => !Number.isInteger(seed))) throw new Error(`profile ${name} seeds invalid`);
    if (!Array.isArray(profile.checkpoints)
      || profile.checkpoints.some((tick) => !Number.isInteger(tick) || tick < 0 || tick > profile.ticks)) {
      throw new Error(`profile ${name} checkpoints invalid`);
    }
    if (!Number.isInteger(profile.repeats) || profile.repeats < 1) throw new Error(`profile ${name} repeats must be positive`);
    if (new Set(profile.seeds).size !== profile.seeds.length) throw new Error(`profile ${name} seeds must be unique`);
    if (new Set(profile.checkpoints).size !== profile.checkpoints.length) throw new Error(`profile ${name} checkpoints must be unique`);
  }
  for (const [name, invariant] of Object.entries(contract.invariants)) {
    assertKeys(invariant, new Set(['description']), `invariant ${name}`);
    if (typeof invariant.description !== 'string' || invariant.description === '') throw new Error(`invariant ${name} description required`);
  }
  for (const [name, metric] of Object.entries(contract.metrics)) {
    assertKeys(metric, new Set(['unit']), `metric ${name}`);
    if (typeof metric.unit !== 'string' || metric.unit === '') throw new Error(`metric ${name} unit required`);
  }
  return contract;
}

function validateScenario(scenario, family, contract, seen) {
  assertKeys(scenario, new Set([
    'id', 'title', 'family', 'setup', 'profile', 'invariants', 'requiredGates', 'objectives', 'thresholds',
  ]), `scenario ${scenario.id || '<unknown>'}`);
  if (typeof scenario.id !== 'string' || seen.has(scenario.id)) throw new Error(`duplicate or invalid scenario id: ${scenario.id}`);
  seen.add(scenario.id);
  if (scenario.family !== family) throw new Error(`scenario ${scenario.id} has implicit or mismatched family`);
  if (!contract.profiles[scenario.profile]) throw new Error(`scenario ${scenario.id} unknown profile: ${scenario.profile}`);
  if (!Array.isArray(scenario.invariants) || scenario.invariants.length === 0) throw new Error(`scenario ${scenario.id} invariants required`);
  for (const invariant of scenario.invariants) {
    if (!contract.invariants[invariant]) throw new Error(`scenario ${scenario.id} unknown invariant: ${invariant}`);
  }
  if (!Array.isArray(scenario.requiredGates) || scenario.requiredGates.length === 0
    || scenario.requiredGates.some((gate) => typeof gate !== 'string' || gate === '')) {
    throw new Error(`scenario ${scenario.id} requiredGates required`);
  }
  if (!isObject(scenario.objectives) || !isObject(scenario.thresholds)) throw new Error(`scenario ${scenario.id} objectives and thresholds required`);
  let total = 0;
  for (const [metric, objective] of Object.entries(scenario.objectives)) {
    if (!contract.metrics[metric]) throw new Error(`scenario ${scenario.id} unknown metric: ${metric}`);
    assertKeys(objective, new Set(['weight', 'evidence']), `scenario ${scenario.id} objective ${metric}`);
    if (!Number.isInteger(objective.weight) || objective.weight < 1) throw new Error(`scenario ${scenario.id} invalid objective weight`);
    if (!EVIDENCE.has(objective.evidence)) throw new Error(`scenario ${scenario.id} invalid objective evidence`);
    total += objective.weight;
  }
  if (total !== 100) throw new Error(`scenario ${scenario.id} objective weights must total 100`);
  for (const [metric, threshold] of Object.entries(scenario.thresholds)) {
    if (!contract.metrics[metric]) throw new Error(`scenario ${scenario.id} unknown threshold metric: ${metric}`);
    assertKeys(threshold, new Set(['direction', 'value', 'unit', 'evidence']), `scenario ${scenario.id} threshold ${metric}`);
    if (!DIRECTIONS.has(threshold.direction) || typeof threshold.unit !== 'string' || threshold.unit === '') {
      throw new Error(`scenario ${scenario.id} invalid threshold direction or unit`);
    }
    if (!EVIDENCE.has(threshold.evidence)) throw new Error(`scenario ${scenario.id} invalid threshold evidence`);
    if (threshold.unit !== contract.metrics[metric].unit) {
      throw new Error(`scenario ${scenario.id} threshold ${metric} unit must match metric contract`);
    }
    if (threshold.direction === 'range'
      && (!Array.isArray(threshold.value) || threshold.value.length !== 2)) {
      throw new Error(`scenario ${scenario.id} range threshold ${metric} requires two values`);
    }
  }
}

function loadExecutionCatalog(catalogDir = EXECUTION_CATALOG_DIR) {
  const contract = validateContract(readJson(path.join(catalogDir, 'contract.json')));
  const documents = [];
  const scenarios = [];
  const familyCounts = {};
  const seen = new Set();
  for (const family of FAMILIES) {
    const document = readJson(path.join(catalogDir, `${family}.json`));
    assertKeys(document, new Set(['schemaVersion', 'family', 'scenarios']), `execution catalog ${family}`);
    if (document.schemaVersion !== 'agent-kernel-execution-catalog/v1' || document.family !== family) {
      throw new Error(`execution catalog ${family} has implicit or mismatched family`);
    }
    if (!Array.isArray(document.scenarios) || document.scenarios.length !== 5) {
      throw new Error(`execution catalog ${family} expected 5 scenarios`);
    }
    for (const scenario of document.scenarios) validateScenario(scenario, family, contract, seen);
    documents.push(document);
    scenarios.push(...document.scenarios);
    familyCounts[family] = document.scenarios.length;
  }
  const profileIdentity = Object.fromEntries(Object.entries(contract.profiles).map(([name, value]) => [name, value]));
  return {
    schemaVersion: 'agent-kernel-execution-catalog/v1',
    evaluatorVersion: contract.evaluatorVersion,
    count: scenarios.length,
    familyCounts,
    sha256: sha256({ contract, documents }),
    seedSetHash: sha256(Object.fromEntries(Object.entries(profileIdentity).map(([name, profile]) => [name, profile.seeds]))),
    tickProfileHash: sha256(Object.fromEntries(Object.entries(profileIdentity).map(([name, profile]) => [name, {
      ticks: profile.ticks, checkpoints: profile.checkpoints, repeats: profile.repeats,
    }]))),
    contract,
    scenarios,
  };
}

module.exports = { EXECUTION_CATALOG_DIR, canonicalJson, loadExecutionCatalog };
