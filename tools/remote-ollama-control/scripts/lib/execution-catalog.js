'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXECUTION_CATALOG_DIR = path.resolve(__dirname, '..', '..', 'benchmarks', 'execution');
const FAMILIES = ['traversal', 'combat', 'hazards', 'resources', 'stress'];
const DIRECTIONS = new Set(['min', 'max', 'range', 'exact', 'relational']);
const EVIDENCE = new Set(['artifact', 'observation']);
const GATE_SCOPES = new Set(['seed', 'aggregate', 'paired_variant', 'replay']);
const GATE_LEAF_OPERATORS = new Set(['min', 'max', 'exact', 'range', 'changed_in_direction', 'rate']);
const GATE_COMPOSITE_OPERATORS = new Set(['all', 'any']);
const RATE_DENOMINATORS = new Set(['seeds', 'repeats', 'variants']);
const METRIC_PURPOSES = new Set(['qualification', 'diagnostic']);

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
  if (contract.schemaVersion !== 'agent-kernel-execution-metric-contract/v2') throw new Error('invalid execution metric contract');
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
    assertKeys(metric, new Set(['unit', 'purpose']), `metric ${name}`);
    if (typeof metric.unit !== 'string' || metric.unit === '') throw new Error(`metric ${name} unit required`);
    if ('purpose' in metric && !METRIC_PURPOSES.has(metric.purpose)) throw new Error(`metric ${name} purpose invalid`);
  }
  return contract;
}

function predicateMetrics(predicate) {
  if (GATE_COMPOSITE_OPERATORS.has(predicate.operator)) return predicate.predicates.flatMap(predicateMetrics);
  return predicate.source === 'metric' ? [predicate.ref] : [];
}

function scenarioPurpose(scenario, contract) {
  const metrics = [
    ...Object.keys(scenario.objectives),
    ...scenario.requiredGates.flatMap((gate) => predicateMetrics(gate.predicate)),
  ];
  return metrics.some((name) => contract.metrics[name]?.purpose !== 'diagnostic')
    ? 'qualification' : 'diagnostic';
}

function validateNumericThreshold(operator, threshold, label) {
  if (operator === 'range') {
    if (!Array.isArray(threshold) || threshold.length !== 2
      || threshold.some((value) => !Number.isFinite(value)) || threshold[0] > threshold[1]) {
      throw new Error(`${label} range threshold requires two ordered numbers`);
    }
    return;
  }
  if (!Number.isFinite(threshold)) throw new Error(`${label} threshold required`);
}

function validateGatePredicate(predicate, gate, scenario, contract) {
  const label = `scenario ${scenario.id} gate ${gate.id}`;
  if (!isObject(predicate)) throw new Error(`${label} predicate must be an object`);
  if (GATE_COMPOSITE_OPERATORS.has(predicate.operator)) {
    assertKeys(predicate, new Set(['operator', 'predicates']), `${label} composite predicate`);
    if (!Array.isArray(predicate.predicates) || predicate.predicates.length === 0) {
      throw new Error(`${label} composite predicate children required`);
    }
    return predicate.predicates.flatMap((child) => validateGatePredicate(child, gate, scenario, contract));
  }
  assertKeys(predicate, new Set([
    'source', 'ref', 'operator', 'threshold', 'unit', 'denominator', 'condition',
    'baselineVariant', 'candidateVariant',
  ]), `${label} predicate`);
  if (!['metric', 'invariant'].includes(predicate.source) || typeof predicate.ref !== 'string') {
    throw new Error(`${label} predicate source and ref required`);
  }
  if (!GATE_LEAF_OPERATORS.has(predicate.operator)) throw new Error(`${label} unknown predicate operator`);

  if (predicate.source === 'invariant') {
    if (!contract.invariants[predicate.ref]) throw new Error(`${label} unknown gate invariant: ${predicate.ref}`);
    if (predicate.operator !== 'exact' || typeof predicate.threshold !== 'boolean') {
      throw new Error(`${label} invariant predicate requires exact boolean threshold`);
    }
    if ('unit' in predicate || 'denominator' in predicate || 'condition' in predicate) {
      throw new Error(`${label} invariant predicate has impossible fields`);
    }
    return [predicate.operator];
  }

  const metric = contract.metrics[predicate.ref];
  if (!metric) throw new Error(`${label} unknown gate metric: ${predicate.ref}`);
  if (predicate.unit !== metric.unit) throw new Error(`${label} gate metric ${predicate.ref} unit must match metric contract`);
  if (predicate.operator === 'changed_in_direction') {
    if (!['increase', 'decrease'].includes(predicate.threshold)) {
      throw new Error(`${label} changed_in_direction threshold must be increase or decrease`);
    }
    if (typeof predicate.baselineVariant !== 'string' || predicate.baselineVariant === ''
      || typeof predicate.candidateVariant !== 'string' || predicate.candidateVariant === ''
      || predicate.baselineVariant === predicate.candidateVariant) {
      throw new Error(`${label} paired variant names required and must differ`);
    }
  } else if (predicate.operator === 'rate') {
    if (!Number.isFinite(predicate.threshold) || predicate.threshold < 0 || predicate.threshold > 1) {
      throw new Error(`${label} rate threshold required between 0 and 1`);
    }
    if (!RATE_DENOMINATORS.has(predicate.denominator)) throw new Error(`${label} rate denominator required`);
    if (!isObject(predicate.condition)) throw new Error(`${label} rate condition required`);
    assertKeys(predicate.condition, new Set(['operator', 'threshold']), `${label} rate condition`);
    if (!['min', 'max', 'exact', 'range'].includes(predicate.condition.operator)) {
      throw new Error(`${label} invalid rate condition operator`);
    }
    validateNumericThreshold(predicate.condition.operator, predicate.condition.threshold, `${label} rate condition`);
  } else {
    validateNumericThreshold(predicate.operator, predicate.threshold, label);
  }
  if (predicate.operator !== 'rate' && ('denominator' in predicate || 'condition' in predicate)) {
    throw new Error(`${label} denominator and condition require rate operator`);
  }
  if (predicate.operator !== 'changed_in_direction'
    && ('baselineVariant' in predicate || 'candidateVariant' in predicate)) {
    throw new Error(`${label} variant names require changed_in_direction operator`);
  }
  return [predicate.operator];
}

function validateGate(gate, scenario, contract, gateSeen) {
  const label = `scenario ${scenario.id} gate`;
  assertKeys(gate, new Set(['id', 'description', 'scope', 'evidence', 'predicate']), label);
  if (typeof gate.id !== 'string' || !new RegExp(`^${scenario.id}-G\\d{2}$`).test(gate.id) || gateSeen.has(gate.id)) {
    throw new Error(`${label} duplicate or invalid id: ${gate.id}`);
  }
  gateSeen.add(gate.id);
  if (typeof gate.description !== 'string' || gate.description === '') throw new Error(`${label} description required`);
  if (!GATE_SCOPES.has(gate.scope)) throw new Error(`${label} invalid scope`);
  if (!EVIDENCE.has(gate.evidence)) throw new Error(`${label} invalid evidence`);
  const operators = validateGatePredicate(gate.predicate, gate, scenario, contract);
  if (operators.includes('rate') && gate.scope !== 'aggregate') {
    throw new Error(`${label} rate operator requires aggregate scope`);
  }
  if (operators.includes('changed_in_direction') && gate.scope !== 'paired_variant') {
    throw new Error(`${label} changed_in_direction operator requires paired_variant scope`);
  }
  if (gate.scope === 'paired_variant' && !operators.includes('changed_in_direction')) {
    throw new Error(`${label} paired_variant scope requires changed_in_direction operator`);
  }
  if (gate.scope === 'replay' && contract.profiles[scenario.profile].repeats < 2) {
    throw new Error(`${label} replay scope requires a profile with at least two repeats`);
  }
}

function validateScenario(scenario, family, contract, seen, gateSeen) {
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
  if (!Array.isArray(scenario.requiredGates) || scenario.requiredGates.length === 0) {
    throw new Error(`scenario ${scenario.id} requiredGates required`);
  }
  for (const gate of scenario.requiredGates) validateGate(gate, scenario, contract, gateSeen);
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
  const gateSeen = new Set();
  for (const family of FAMILIES) {
    const document = readJson(path.join(catalogDir, `${family}.json`));
    assertKeys(document, new Set(['schemaVersion', 'family', 'scenarios']), `execution catalog ${family}`);
    if (document.schemaVersion !== 'agent-kernel-execution-catalog/v1' || document.family !== family) {
      throw new Error(`execution catalog ${family} has implicit or mismatched family`);
    }
    if (!Array.isArray(document.scenarios) || document.scenarios.length !== 5) {
      throw new Error(`execution catalog ${family} expected 5 scenarios`);
    }
    for (const scenario of document.scenarios) {
      validateScenario(scenario, family, contract, seen, gateSeen);
      for (const gate of scenario.requiredGates) {
        gate.purpose = predicateMetrics(gate.predicate)
          .some((name) => contract.metrics[name]?.purpose === 'diagnostic') ? 'diagnostic' : 'qualification';
      }
      scenario.purpose = scenarioPurpose(scenario, contract);
    }
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
