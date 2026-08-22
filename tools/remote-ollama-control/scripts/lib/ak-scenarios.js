'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 'agent-kernel-content-gen-catalog/v1';
const CATALOG_DIR = path.resolve(__dirname, '..', '..', 'benchmarks', 'content-gen');
// Baselines generated with a budgetTokens at or above this sentinel are
// budget-UNCONSTRAINED (generate-baselines.mjs uses a non-binding 1M ceiling);
// anything below it is an explicit budget-test with a tight, feasible cap.
const UNCONSTRAINED_SENTINEL = 1_000_000;

const CATALOG_TIERS = ['simple', 'affinity', 'complex', 'constrained'];
const EXPECTED_TIER_COUNTS = Object.freeze({
  simple: 25,
  affinity: 25,
  complex: 25,
  constrained: 25,
});
const SCENARIO_KEYS = new Set([
  'index',
  'title',
  'runId',
  'tier',
  'budgetMode',
  'budget',
  'prompt',
  'payload',
  'expectedOutcome',
  'reference',
  'referenceSpend',
  'remaining',
  'status',
  'legacyReferencePath',
]);
const PAYLOAD_KEYS = new Set([
  'text',
  'budgetTokens',
  'runId',
  'createdAt',
  'outDir',
  'emitIntermediates',
  'dungeonAffinity',
  'room',
  'floorTile',
  'hazard',
  'resource',
  'delver',
  'warden',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} has unknown field: ${key}`);
    }
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
}

function validateReference(reference, label) {
  if (!isPlainObject(reference)) {
    throw new Error(`${label}.reference must be an object`);
  }
  assertAllowedKeys(reference, new Set(['entityCounts', 'affinitiesByType', 'totalSpend']), `${label}.reference`);
  if (!isPlainObject(reference.entityCounts) || !isPlainObject(reference.affinitiesByType)) {
    throw new Error(`${label}.reference counts and affinities must be objects`);
  }
  for (const [type, count] of Object.entries(reference.entityCounts)) {
    assertNonEmptyString(type, `${label}.reference entity type`);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`${label}.reference.entityCounts.${type} must be a non-negative integer`);
    }
  }
  for (const [type, affinities] of Object.entries(reference.affinitiesByType)) {
    if (type === 'room') {
      throw new Error(`${label}.reference room affinities are not part of the program construct`);
    }
    assertNonEmptyString(type, `${label}.reference affinity type`);
    assertStringArray(affinities, `${label}.reference.affinitiesByType.${type}`);
  }
  if (!Number.isFinite(reference.totalSpend) || reference.totalSpend < 0) {
    throw new Error(`${label}.reference.totalSpend must be a non-negative number`);
  }
}

function validatePayload(payload, scenario, label) {
  if (!isPlainObject(payload)) {
    throw new Error(`${label}.payload must be an object`);
  }
  assertAllowedKeys(payload, PAYLOAD_KEYS, `${label}.payload`);
  for (const key of ['text', 'runId', 'createdAt', 'outDir']) {
    assertNonEmptyString(payload[key], `${label}.payload.${key}`);
  }
  if (!Number.isInteger(payload.budgetTokens) || payload.budgetTokens <= 0) {
    throw new Error(`${label}.payload.budgetTokens must be a positive integer`);
  }
  if (payload.outDir !== '$RUN_OUTPUT/create') {
    throw new Error(`${label}.payload.outDir must be the canonical $RUN_OUTPUT/create placeholder`);
  }
  if (payload.emitIntermediates !== true) {
    throw new Error(`${label}.payload.emitIntermediates must be true`);
  }
  for (const key of ['room', 'floorTile', 'hazard', 'resource', 'delver', 'warden']) {
    if (payload[key] !== undefined) assertStringArray(payload[key], `${label}.payload.${key}`);
  }
  if (payload.dungeonAffinity !== undefined) {
    assertNonEmptyString(payload.dungeonAffinity, `${label}.payload.dungeonAffinity`);
  }
  if (payload.text !== scenario.prompt || payload.runId !== scenario.runId) {
    throw new Error(`${label}.payload text/runId must match the scenario`);
  }
}

function validateScenario(scenario, fileTier, seenIds) {
  const label = `scenario ${scenario?.index ?? '?'}`;
  if (!isPlainObject(scenario)) throw new Error(`${label} must be an object`);
  assertAllowedKeys(scenario, SCENARIO_KEYS, label);
  if (!Number.isInteger(scenario.index) || scenario.index <= 0) {
    throw new Error(`${label}.index must be a positive integer`);
  }
  if (seenIds.has(scenario.index)) throw new Error(`duplicate scenario index: ${scenario.index}`);
  seenIds.add(scenario.index);
  for (const key of ['title', 'runId', 'tier', 'budgetMode', 'prompt', 'expectedOutcome', 'status']) {
    assertNonEmptyString(scenario[key], `${label}.${key}`);
  }
  if (scenario.tier !== fileTier) throw new Error(`${label}.tier must match file tier ${fileTier}`);
  if (!CATALOG_TIERS.includes(scenario.tier)) throw new Error(`${label}.tier is unknown: ${scenario.tier}`);
  if (!['unconstrained', 'constrained'].includes(scenario.budgetMode)) {
    throw new Error(`${label}.budgetMode is unknown: ${scenario.budgetMode}`);
  }
  if (!['success', 'budget_denied'].includes(scenario.expectedOutcome)) {
    throw new Error(`${label}.expectedOutcome is unknown: ${scenario.expectedOutcome}`);
  }
  if (scenario.budgetMode === 'constrained') {
    if (!Number.isInteger(scenario.budget) || scenario.budget <= 0) {
      throw new Error(`${label}.budget must be positive for a constrained scenario`);
    }
  } else if (scenario.budget !== null) {
    throw new Error(`${label}.budget must be null for an unconstrained scenario`);
  }
  if (!Number.isFinite(scenario.referenceSpend) || !Number.isFinite(scenario.remaining)) {
    throw new Error(`${label} legacy spend fields must be finite numbers`);
  }
  assertNonEmptyString(scenario.legacyReferencePath, `${label}.legacyReferencePath`);
  if (path.isAbsolute(scenario.legacyReferencePath) || scenario.legacyReferencePath.split(/[\\/]/).includes('..')) {
    throw new Error(`${label}.legacyReferencePath must be a safe relative path`);
  }
  validatePayload(scenario.payload, scenario, label);
  validateReference(scenario.reference, label);
  if (scenario.reference.totalSpend !== scenario.referenceSpend) {
    throw new Error(`${label}.reference.totalSpend must match referenceSpend`);
  }
  const derived = scenarioBudgetMode(scenario.payload);
  if (derived.budgetMode !== scenario.budgetMode || derived.budget !== scenario.budget) {
    throw new Error(`${label}.payload.budgetTokens does not match its budget classification`);
  }
}

function scenarioBudgetMode(payload) {
  const budgetTokens = payload?.budgetTokens;
  if (Number.isInteger(budgetTokens) && budgetTokens < UNCONSTRAINED_SENTINEL) {
    return { budgetMode: 'constrained', budget: budgetTokens };
  }
  return { budgetMode: 'unconstrained', budget: null };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function loadScenarioCatalog(catalogDir = CATALOG_DIR) {
  const seenIds = new Set();
  const tierCounts = {};
  const documents = [];
  const scenarios = [];

  for (const tier of CATALOG_TIERS) {
    const catalogPath = path.join(catalogDir, `${tier}.json`);
    if (!fs.existsSync(catalogPath)) throw new Error(`catalog file not found: ${catalogPath}`);
    let document;
    try {
      document = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    } catch (error) {
      throw new Error(`invalid catalog JSON ${catalogPath}: ${error.message}`);
    }
    if (!isPlainObject(document)) throw new Error(`catalog document must be an object: ${catalogPath}`);
    assertAllowedKeys(document, new Set(['schemaVersion', 'tier', 'scenarios']), `catalog ${tier}`);
    if (document.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(`catalog ${tier} has unsupported schemaVersion: ${document.schemaVersion}`);
    }
    if (document.tier !== tier) throw new Error(`catalog ${tier} has implicit or mismatched tier`);
    if (!Array.isArray(document.scenarios)) throw new Error(`catalog ${tier}.scenarios must be an array`);
    for (const scenario of document.scenarios) validateScenario(scenario, tier, seenIds);
    tierCounts[tier] = document.scenarios.length;
    scenarios.push(...document.scenarios);
    documents.push(document);
  }

  for (const tier of CATALOG_TIERS) {
    if (tierCounts[tier] !== EXPECTED_TIER_COUNTS[tier]) {
      throw new Error(`catalog ${tier} expected ${EXPECTED_TIER_COUNTS[tier]} scenarios, found ${tierCounts[tier]}`);
    }
  }
  const ids = [...seenIds].sort((left, right) => left - right);
  if (ids.length !== 100 || ids.some((id, offset) => id !== offset + 1)) {
    throw new Error('catalog scenario indexes must be exactly 1 through 100');
  }
  scenarios.sort((left, right) => left.index - right.index);
  const sha256 = crypto.createHash('sha256').update(canonicalJson(documents)).digest('hex');
  return {
    schemaVersion: SCHEMA_VERSION,
    count: scenarios.length,
    tierCounts,
    sha256,
    scenarios,
  };
}

function loadScenarios() {
  return loadScenarioCatalog().scenarios;
}

module.exports = {
  CATALOG_DIR,
  UNCONSTRAINED_SENTINEL,
  canonicalJson,
  loadScenarioCatalog,
  loadScenarios,
  scenarioBudgetMode,
};
