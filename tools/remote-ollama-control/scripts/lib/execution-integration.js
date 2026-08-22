'use strict';

const fs = require('fs');
const path = require('path');

function routeKey(scenarioId, variant) {
  return variant ? `${scenarioId}#${variant}` : scenarioId;
}

function createGeneratedBuildResolver({ records, configurationId, routes }) {
  if (!Array.isArray(records)) throw new Error('records must be an array');
  if (typeof configurationId !== 'string' || !configurationId) throw new Error('configurationId is required');
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)) throw new Error('routes must be an object');

  return async ({ scenario, variant = null }) => {
    const key = routeKey(scenario?.id, variant);
    const route = routes[key];
    if (!route || !Number.isSafeInteger(route.scenarioIndex) || !Number.isSafeInteger(route.repeat)) {
      throw new Error(`No explicit generated-content route for ${key}`);
    }
    const record = records.find((entry) => (
      (!entry.recordKind || entry.recordKind === 'content_gen_attempt')
      && entry.configurationId === configurationId
      && entry.scenarioIndex === route.scenarioIndex
      && entry.repeat === route.repeat
    ));
    if (!record || record.execSucceeded !== true || record.scenarioVerdict?.passed !== true
      || typeof record.outDir !== 'string' || !record.outDir) {
      throw new Error(`No successful authoring artifact for ${key}`);
    }
    const required = ['sim-config.json', 'initial-state.json'];
    if (!required.every((name) => fs.existsSync(path.join(record.outDir, name)))) {
      throw new Error(`Successful authoring artifact for ${key} is incomplete`);
    }
    return record.outDir;
  };
}

function executionQualifies(result) {
  if (!result || typeof result !== 'object') return false;
  if (typeof result.verdict?.qualifies === 'boolean') return result.verdict.qualifies;
  return result.schemaVersion === 'agent-kernel-execution-schedule/v1'
    && result.status === 'completed'
    && Array.isArray(result.scenarios)
    && result.scenarios.length > 0
    && result.scenarios.every((scenario) => scenario.aggregate?.verdict?.qualifies === true);
}

function compareResources(left, right) {
  for (const key of ['gpuCount', 'capacityRank', 'modelSizeBillions', 'contextTokens', 'outputTokens']) {
    const delta = left.resourceOrder[key] - right.resourceOrder[key];
    if (delta !== 0) return delta;
  }
  return left.configurationId.localeCompare(right.configurationId);
}

function dominates(left, right) {
  const keys = ['gpuCount', 'capacityRank', 'modelSizeBillions', 'contextTokens', 'outputTokens'];
  return keys.every((key) => left[key] <= right[key]) && keys.some((key) => left[key] < right[key]);
}

function executionProjection(result) {
  return {
    qualifies: executionQualifies(result),
    status: result?.status || result?.verdict?.status || 'missing',
    identity: result?.identity || null,
  };
}

function combineBenchmarkQualification({
  authoringResult,
  runtimeExecution,
  generatedExecutionByConfiguration = {},
}) {
  if (authoringResult?.schemaVersion !== 'agent-kernel-content-gen-result/v1'
    || !Array.isArray(authoringResult.configurations)) {
    throw new Error('A valid authoring result is required');
  }
  if (!generatedExecutionByConfiguration || typeof generatedExecutionByConfiguration !== 'object'
    || Array.isArray(generatedExecutionByConfiguration)) {
    throw new Error('generatedExecutionByConfiguration must be an object');
  }
  const runtime = executionProjection(runtimeExecution);
  const configurations = authoringResult.configurations.map((configuration) => {
    const authoring = {
      qualifies: configuration.verdict?.qualifies === true,
      failedGates: configuration.verdict?.failedGates || [],
    };
    const generatedExecution = executionProjection(
      generatedExecutionByConfiguration[configuration.configurationId],
    );
    const failedGates = [];
    if (!authoring.qualifies) failedGates.push('authoring');
    if (!runtime.qualifies) failedGates.push('runtime_execution');
    if (!generatedExecution.qualifies) failedGates.push('generated_execution');
    return {
      ...configuration,
      authoring,
      runtimeExecution: runtime,
      generatedExecution,
      verdict: { qualifies: failedGates.length === 0, failedGates },
    };
  });
  const qualifying = configurations.filter((entry) => entry.verdict.qualifies).sort(compareResources);
  const frontier = qualifying.filter((candidate) => !qualifying.some((other) => (
    other !== candidate && dominates(other.resourceOrder, candidate.resourceOrder)
  )));
  return {
    schemaVersion: 'agent-kernel-combined-benchmark-result/v1',
    scenarioSet: authoringResult.scenarioSet,
    matrix: authoringResult.matrix,
    thresholds: authoringResult.thresholds,
    runtimeExecution: runtime,
    configurations,
    minimumSuccessfulConfiguration: qualifying.length
      ? { configurationId: qualifying[0].configurationId }
      : null,
    paretoFrontier: frontier.map((entry) => entry.configurationId),
    failures: {
      configurations: configurations.filter((entry) => !entry.verdict.qualifies).length,
      byGate: configurations.flatMap((entry) => entry.verdict.failedGates)
        .reduce((counts, gate) => ({ ...counts, [gate]: (counts[gate] || 0) + 1 }), {}),
    },
  };
}

module.exports = {
  combineBenchmarkQualification,
  createGeneratedBuildResolver,
  executionQualifies,
};
