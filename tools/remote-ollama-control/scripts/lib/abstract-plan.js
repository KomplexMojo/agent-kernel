'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CATALOG_VERSION = 'agent-kernel-abstract-plan-catalog/v1';
const PROBLEM_VERSION = 'abstract-component-selection/v1';
const ABSTRACT_CATALOG_DIR = path.resolve(__dirname, '..', '..', 'benchmarks', 'abstract-plan');
const ABSTRACT_CATALOG_PATH = path.resolve(
  ABSTRACT_CATALOG_DIR, 'pilot.json',
);
const ABSTRACT_CATALOG_PATHS = Object.freeze({
  pilot: ABSTRACT_CATALOG_PATH,
  parallel: path.join(ABSTRACT_CATALOG_DIR, 'parallel.json'),
});
const TARGETS = new Set(['room', 'floorTile', 'hazard', 'resource', 'delver', 'warden']);
const COUNT_TARGETS = new Set(['room', 'floorTile', 'delver', 'warden']);
const DOMAIN_WORDS = /\b(room|hazard|delver|warden|dungeon|affinit(?:y|ies))\b/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${label} has unknown field: ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing field: ${key}`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
}

function selectionShape(selections) {
  if (!Array.isArray(selections) || selections.length === 0) return false;
  return selections.every((selection) => (
    isPlainObject(selection)
    && Object.keys(selection).length === 2
    && Object.hasOwn(selection, 'componentId')
    && Object.hasOwn(selection, 'quantity')
    && typeof selection.componentId === 'string'
    && selection.componentId.length > 0
    && Number.isInteger(selection.quantity)
    && selection.quantity > 0
  ));
}

function evaluateAbstractPlan(scenario, selections) {
  const components = scenario?.problem?.components || [];
  const byId = new Map(components.map((component) => [component.id, component]));
  const structureOk = selectionShape(selections);
  const safeSelections = structureOk ? selections : [];
  const ids = safeSelections.map((selection) => selection.componentId);
  const duplicateFree = new Set(ids).size === ids.length;
  const knownComponents = duplicateFree && safeSelections.every((selection) => byId.has(selection.componentId));
  const quantityBounds = knownComponents && safeSelections.every((selection) => (
    selection.quantity <= byId.get(selection.componentId).maxQuantity
  ));

  const categoryQuantities = {};
  const categoryCapacities = {};
  const signalsByCategory = {};
  let totalCost = 0;
  if (knownComponents) {
    for (const selection of safeSelections) {
      const component = byId.get(selection.componentId);
      categoryQuantities[component.category] = (categoryQuantities[component.category] || 0) + selection.quantity;
      categoryCapacities[component.category] = (categoryCapacities[component.category] || 0)
        + component.capacity * selection.quantity;
      if (!signalsByCategory[component.category]) signalsByCategory[component.category] = new Set();
      for (const signal of component.signals) signalsByCategory[component.category].add(signal);
      totalCost += component.unitCost * selection.quantity;
    }
  }

  const constraints = scenario?.problem?.constraints || {};
  const categoryRequirements = constraints.categoryQuantities || {};
  const categoryQuantitiesOk = knownComponents && (
    Object.keys(categoryQuantities).every((category) => Object.hasOwn(categoryRequirements, category))
    && Object.entries(categoryRequirements).every(([category, quantity]) => categoryQuantities[category] === quantity)
  );
  const capacityRequirementsOk = knownComponents && Object.entries(
    constraints.minimumCapacityByCategory || {},
  ).every(([category, minimum]) => (categoryCapacities[category] || 0) >= minimum);
  const signalCoverageOk = knownComponents && Object.entries(
    constraints.requiredSignalsByCategory || {},
  ).every(([category, required]) => required.every((signal) => signalsByCategory[category]?.has(signal)));
  const budgetRespected = knownComponents && totalCost <= constraints.maximumTotalCost;
  const feasible = structureOk && knownComponents && quantityBounds && categoryQuantitiesOk
    && capacityRequirementsOk && signalCoverageOk && budgetRespected;
  const optimal = feasible && totalCost === scenario?.reference?.minimumCost;

  const breakdown = {
    outputStructure: structureOk ? 10 : 0,
    knownComponents: knownComponents ? 10 : 0,
    quantityBounds: quantityBounds ? 10 : 0,
    categoryQuantities: categoryQuantitiesOk ? 20 : 0,
    capacityRequirements: capacityRequirementsOk ? 10 : 0,
    signalCoverage: signalCoverageOk ? 20 : 0,
    budgetRespected: budgetRespected ? 5 : 0,
    optimalCost: optimal ? 15 : 0,
  };
  return {
    score: Object.values(breakdown).reduce((sum, value) => sum + value, 0),
    scoreMax: 100,
    feasible,
    optimal,
    totalCost: knownComponents ? totalCost : null,
    breakdown,
    observed: {
      categoryQuantities,
      categoryCapacities,
      signalsByCategory: Object.fromEntries(
        Object.entries(signalsByCategory).map(([category, values]) => [category, [...values].sort()]),
      ),
    },
  };
}

function validateCatalog(document) {
  const rootKeys = ['schemaVersion', 'scenarios'];
  if (Object.hasOwn(document, 'sourceScenarioSet')) rootKeys.push('sourceScenarioSet');
  assertExactKeys(document, rootKeys, 'abstract catalog');
  if (document.schemaVersion !== CATALOG_VERSION) throw new Error(`unsupported abstract catalog version: ${document.schemaVersion}`);
  if (!Array.isArray(document.scenarios) || document.scenarios.length === 0) throw new Error('abstract catalog needs scenarios');
  if (document.sourceScenarioSet) {
    assertExactKeys(document.sourceScenarioSet, ['count', 'sha256'], 'abstract source scenario set');
    if (!Number.isInteger(document.sourceScenarioSet.count) || document.sourceScenarioSet.count <= 0) {
      throw new Error('abstract source scenario count must be positive');
    }
    if (!/^[a-f0-9]{64}$/.test(document.sourceScenarioSet.sha256)) {
      throw new Error('abstract source scenario hash must be sha256');
    }
  }
  const indexes = new Set();
  const ids = new Set();
  for (const scenario of document.scenarios) {
    const scenarioKeys = ['index', 'id', 'title', 'expectedOutcome', 'problem', 'reference', 'mapping'];
    if (Object.hasOwn(scenario, 'sourceScenario')) scenarioKeys.push('sourceScenario');
    assertExactKeys(scenario, scenarioKeys, 'abstract scenario');
    if (!Number.isInteger(scenario.index) || scenario.index <= 0 || indexes.has(scenario.index)) {
      throw new Error(`invalid or duplicate abstract scenario index: ${scenario.index}`);
    }
    indexes.add(scenario.index);
    assertNonEmptyString(scenario.id, 'abstract scenario id');
    if (ids.has(scenario.id)) throw new Error(`duplicate abstract scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    assertNonEmptyString(scenario.title, 'abstract scenario title');
    if (!['success', 'budget_denied'].includes(scenario.expectedOutcome)) {
      throw new Error(`${scenario.id} has unsupported expected outcome`);
    }
    if (scenario.sourceScenario) {
      assertExactKeys(scenario.sourceScenario, ['index', 'tier'], `${scenario.id}.sourceScenario`);
      if (!Number.isInteger(scenario.sourceScenario.index) || scenario.sourceScenario.index <= 0) {
        throw new Error(`${scenario.id} has invalid source scenario index`);
      }
      assertNonEmptyString(scenario.sourceScenario.tier, `${scenario.id} source tier`);
    }
    assertExactKeys(scenario.problem, ['schemaVersion', 'objective', 'constraints', 'components'], `${scenario.id}.problem`);
    if (scenario.problem.schemaVersion !== PROBLEM_VERSION) throw new Error(`${scenario.id} has unsupported problem version`);
    if (scenario.problem.objective !== 'minimize_total_cost') throw new Error(`${scenario.id} has unsupported objective`);
    if (DOMAIN_WORDS.test(JSON.stringify(scenario.problem))) throw new Error(`${scenario.id}.problem leaks domain vocabulary`);
    assertExactKeys(
      scenario.problem.constraints,
      ['categoryQuantities', 'minimumCapacityByCategory', 'requiredSignalsByCategory', 'maximumTotalCost'],
      `${scenario.id}.constraints`,
    );
    for (const [category, quantity] of Object.entries(scenario.problem.constraints.categoryQuantities)) {
      assertNonEmptyString(category, `${scenario.id} category`);
      assertNonNegativeInteger(quantity, `${scenario.id} category quantity`);
    }
    for (const [category, capacity] of Object.entries(scenario.problem.constraints.minimumCapacityByCategory)) {
      assertNonEmptyString(category, `${scenario.id} capacity category`);
      assertNonNegativeInteger(capacity, `${scenario.id} minimum capacity`);
    }
    for (const [category, signals] of Object.entries(scenario.problem.constraints.requiredSignalsByCategory)) {
      assertNonEmptyString(category, `${scenario.id} signal category`);
      assertStringArray(signals, `${scenario.id} required signals`);
    }
    assertNonNegativeInteger(scenario.problem.constraints.maximumTotalCost, `${scenario.id} maximum total cost`);
    if (!Array.isArray(scenario.problem.components) || scenario.problem.components.length === 0) {
      throw new Error(`${scenario.id}.components must be a non-empty array`);
    }
    const componentIds = new Set();
    for (const component of scenario.problem.components) {
      assertExactKeys(component, ['id', 'category', 'unitCost', 'capacity', 'signals', 'maxQuantity'], `${scenario.id} component`);
      assertNonEmptyString(component.id, `${scenario.id} component id`);
      if (componentIds.has(component.id)) throw new Error(`${scenario.id} duplicate component: ${component.id}`);
      componentIds.add(component.id);
      assertNonEmptyString(component.category, `${scenario.id} component category`);
      assertNonNegativeInteger(component.unitCost, `${scenario.id} component unit cost`);
      assertNonNegativeInteger(component.capacity, `${scenario.id} component capacity`);
      assertStringArray(component.signals, `${scenario.id} component signals`);
      if (!Number.isInteger(component.maxQuantity) || component.maxQuantity <= 0) {
        throw new Error(`${scenario.id} component maxQuantity must be positive`);
      }
    }
    assertExactKeys(scenario.reference, ['selections', 'minimumCost'], `${scenario.id}.reference`);
    assertNonNegativeInteger(scenario.reference.minimumCost, `${scenario.id} minimum cost`);
    assertExactKeys(scenario.mapping, ['text', 'fixedArgs', 'components'], `${scenario.id}.mapping`);
    assertNonEmptyString(scenario.mapping.text, `${scenario.id} mapping text`);
    if (!isPlainObject(scenario.mapping.fixedArgs)) throw new Error(`${scenario.id} fixedArgs must be an object`);
    for (const key of Object.keys(scenario.mapping.fixedArgs)) {
      if (!['budgetTokens', 'dungeonAffinity'].includes(key)) throw new Error(`${scenario.id} has unsupported fixed arg: ${key}`);
    }
    if (scenario.mapping.fixedArgs.budgetTokens !== undefined
      && (!Number.isInteger(scenario.mapping.fixedArgs.budgetTokens) || scenario.mapping.fixedArgs.budgetTokens <= 0)) {
      throw new Error(`${scenario.id} has invalid fixed budgetTokens`);
    }
    if (scenario.mapping.fixedArgs.dungeonAffinity !== undefined) {
      assertNonEmptyString(scenario.mapping.fixedArgs.dungeonAffinity, `${scenario.id} fixed dungeonAffinity`);
    }
    if (!isPlainObject(scenario.mapping.components)) throw new Error(`${scenario.id} mappings must be an object`);
    for (const componentId of componentIds) {
      const mapping = scenario.mapping.components[componentId];
      assertExactKeys(mapping, ['target', 'spec'], `${scenario.id} mapping ${componentId}`);
      if (!TARGETS.has(mapping.target)) throw new Error(`${scenario.id} mapping ${componentId} has invalid target`);
      if (!isPlainObject(mapping.spec) && typeof mapping.spec !== 'string') {
        throw new Error(`${scenario.id} mapping ${componentId}.spec must be an object or string`);
      }
      const roomHasAffinity = isPlainObject(mapping.spec)
        ? Object.hasOwn(mapping.spec, 'affinity')
        : /(?:^|;)affinity=/.test(mapping.spec);
      if (mapping.target === 'room' && roomHasAffinity) {
        throw new Error(`${scenario.id} mapping ${componentId} puts affinity on a room`);
      }
      const hazardHasAffinity = isPlainObject(mapping.spec)
        ? typeof mapping.spec.affinity === 'string'
        : /(?:^|;)affinity=[^;]+/.test(mapping.spec);
      if (mapping.target === 'hazard' && !hazardHasAffinity) {
        throw new Error(`${scenario.id} mapping ${componentId} omits hazard affinity`);
      }
    }
    for (const componentId of Object.keys(scenario.mapping.components)) {
      if (!componentIds.has(componentId)) throw new Error(`${scenario.id} maps unknown component: ${componentId}`);
    }
    const referenceEvaluation = evaluateAbstractPlan(scenario, scenario.reference.selections);
    if (referenceEvaluation.score !== 100 || referenceEvaluation.totalCost !== scenario.reference.minimumCost) {
      throw new Error(`${scenario.id} reference is not a feasible optimal solution`);
    }
  }
}

function loadAbstractPlanCatalog(catalog = 'pilot') {
  const catalogPath = ABSTRACT_CATALOG_PATHS[catalog] || catalog;
  let document;
  try {
    document = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (error) {
    throw new Error(`invalid abstract plan catalog ${catalogPath}: ${error.message}`);
  }
  validateCatalog(document);
  if (document.sourceScenarioSet) {
    const { loadScenarioCatalog } = require('./ak-scenarios');
    const source = loadScenarioCatalog();
    if (document.sourceScenarioSet.count !== source.count
      || document.sourceScenarioSet.sha256 !== source.sha256) {
      throw new Error(
        `abstract source scenario set is stale: expected ${source.count}/${source.sha256}, `
        + `received ${document.sourceScenarioSet.count}/${document.sourceScenarioSet.sha256}`,
      );
    }
  }
  return {
    schemaVersion: document.schemaVersion,
    sha256: crypto.createHash('sha256').update(canonicalJson(document)).digest('hex'),
    sourceScenarioSet: document.sourceScenarioSet || null,
    scenarios: document.scenarios,
  };
}

function mapAbstractPlanToCreateArgs(scenario, selections, { outDir, runId }) {
  const evaluation = evaluateAbstractPlan(scenario, selections);
  if (!selectionShape(selections)) throw new Error('abstract selections have an invalid shape');
  if (!evaluation.breakdown.knownComponents || !evaluation.breakdown.quantityBounds) {
    throw new Error('abstract selections contain unknown, duplicate, or out-of-bounds components');
  }
  assertNonEmptyString(outDir, 'mapped outDir');
  assertNonEmptyString(runId, 'mapped runId');
  const selected = new Map(selections.map((entry) => [entry.componentId, entry.quantity]));
  const output = {
    ...scenario.mapping.fixedArgs,
    text: scenario.mapping.text,
    runId,
    outDir,
    emitIntermediates: true,
    room: [],
    floorTile: [],
    hazard: [],
    resource: [],
    delver: [],
    warden: [],
  };
  const componentsById = new Map(scenario.problem.components.map((component) => [component.id, component]));
  for (const componentId of Object.keys(scenario.mapping.components)) {
    const component = componentsById.get(componentId);
    const quantity = selected.get(componentId);
    if (!quantity) continue;
    const mapping = scenario.mapping.components[componentId];
    if (COUNT_TARGETS.has(mapping.target) && isPlainObject(mapping.spec)) {
      const spec = { ...mapping.spec };
      spec.count = (spec.count || 1) * quantity;
      output[mapping.target].push(spec);
    } else {
      for (let offset = 0; offset < quantity; offset += 1) {
        output[mapping.target].push(isPlainObject(mapping.spec) ? { ...mapping.spec } : mapping.spec);
      }
    }
  }
  return output;
}

module.exports = {
  ABSTRACT_CATALOG_PATH,
  evaluateAbstractPlan,
  loadAbstractPlanCatalog,
  mapAbstractPlanToCreateArgs,
};
