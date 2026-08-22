'use strict';

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function tally(records, predicate) {
  const pass = records.filter(predicate).length;
  return { pass, total: records.length, rate: records.length === 0 ? 0 : round(pass / records.length) };
}

function average(records, selector) {
  if (records.length === 0) return 0;
  return round(records.reduce((sum, record) => sum + Number(selector(record) || 0), 0) / records.length);
}

function pairKey(record) {
  return [record.profile, record.model, record.scenarioIndex, record.repeat || 1].join('\0');
}

function validateSettings(settings, label) {
  if (!settings || !Number.isInteger(settings.contextTokens) || settings.contextTokens <= 0
    || !Number.isInteger(settings.outputTokens) || settings.outputTokens <= 0) {
    throw new Error(`${label} must declare positive contextTokens and outputTokens`);
  }
}

function validateComparisonMetadata(contentResult, abstractResult) {
  const contentScenarioSet = contentResult?.scenarioSet;
  const abstractSource = abstractResult?.sourceScenarioSet;
  if (!contentScenarioSet || !abstractSource) {
    throw new Error('paired comparison requires content and abstract source scenario identities');
  }
  if (contentScenarioSet.sha256 !== abstractSource.sha256) {
    throw new Error('source scenario hash mismatch');
  }
  const contentCatalogCount = contentScenarioSet.catalogCount ?? contentScenarioSet.count;
  if (contentCatalogCount !== abstractSource.count) {
    throw new Error('source scenario count mismatch');
  }
  const configuration = contentResult.configurations?.find((entry) => (
    entry.profile?.id === abstractResult.profile && entry.model?.id === abstractResult.model
  ));
  if (!configuration) {
    throw new Error(`content result has no ${abstractResult.profile}/${abstractResult.model} configuration`);
  }
  validateSettings(configuration.settings, 'content settings');
  validateSettings(abstractResult.settings, 'abstract settings');
  if (configuration.settings.contextTokens !== abstractResult.settings.contextTokens
    || configuration.settings.outputTokens !== abstractResult.settings.outputTokens) {
    throw new Error('paired context/output settings mismatch');
  }
  return {
    profile: abstractResult.profile,
    model: abstractResult.model,
    settings: { ...abstractResult.settings },
    sourceScenarioSet: { ...abstractSource },
  };
}

function aggregatePairs(pairs) {
  const content = pairs.map((pair) => pair.content);
  const abstract = pairs.map((pair) => pair.abstract);
  const contentMetrics = {
    toolCall: tally(content, (record) => record.toolCallProduced === true),
    rawExecution: tally(content, (record) => record.execSucceeded === true),
    expectedOutcome: tally(content, (record) => record.scenarioVerdict?.passed === true),
    averageScore: average(content, (record) => record.score),
    averageLlmMs: average(content, (record) => record.llmMs),
  };
  const abstractMetrics = {
    toolCall: tally(abstract, (record) => record.toolCallProduced === true),
    planningExact: tally(abstract, (record) => record.planning?.score === 100),
    mapping: tally(abstract, (record) => record.mappingSucceeded === true),
    rawExecution: tally(abstract, (record) => record.execSucceeded === true),
    expectedOutcome: tally(abstract, (record) => record.executionVerdictPassed === true),
    endToEnd: tally(abstract, (record) => record.passed === true),
    averagePlanningScore: average(abstract, (record) => record.planning?.score),
    averageLlmMs: average(abstract, (record) => record.llmMs),
  };
  return {
    content: contentMetrics,
    abstract: abstractMetrics,
    delta: {
      endToEndRate: round(abstractMetrics.endToEnd.rate - contentMetrics.expectedOutcome.rate),
      rawExecutionRate: round(abstractMetrics.rawExecution.rate - contentMetrics.rawExecution.rate),
      averageLlmMs: round(abstractMetrics.averageLlmMs - contentMetrics.averageLlmMs),
    },
  };
}

function comparePairedAttempts(contentRecords, abstractRecords, metadata = null) {
  const contentByKey = new Map();
  for (const record of contentRecords) {
    const key = pairKey(record);
    if (contentByKey.has(key)) throw new Error(`duplicate content attempt: ${key}`);
    contentByKey.set(key, record);
  }
  const abstractByKey = new Map();
  for (const record of abstractRecords) {
    const key = pairKey(record);
    if (abstractByKey.has(key)) throw new Error(`duplicate abstract attempt: ${key}`);
    abstractByKey.set(key, record);
  }
  const keys = [...contentByKey.keys()].filter((key) => abstractByKey.has(key));
  if (keys.length === 0) throw new Error('content and abstract results have no paired attempts');
  const missingContent = [...abstractByKey.keys()].filter((key) => !contentByKey.has(key));
  const missingAbstract = [...contentByKey.keys()].filter((key) => !abstractByKey.has(key));
  if (missingContent.length > 0 || missingAbstract.length > 0) {
    throw new Error(`unpaired attempts: missingContent=${missingContent.length}, missingAbstract=${missingAbstract.length}`);
  }
  const pairs = keys.map((key) => ({ content: contentByKey.get(key), abstract: abstractByKey.get(key) }));
  const aggregate = aggregatePairs(pairs);
  const tierOrder = [];
  for (const pair of pairs) {
    const tier = pair.content.scenarioTier || pair.abstract.scenarioTier || 'unknown';
    if (!tierOrder.includes(tier)) tierOrder.push(tier);
  }
  const byTier = Object.fromEntries(tierOrder.map((tier) => [
    tier,
    aggregatePairs(pairs.filter((pair) => (
      (pair.content.scenarioTier || pair.abstract.scenarioTier || 'unknown') === tier
    ))),
  ]));
  return {
    schemaVersion: 'agent-kernel-abstract-content-comparison/v1',
    ...(metadata || {}),
    pairs: pairs.length,
    profiles: [...new Set(pairs.map((pair) => pair.content.profile))],
    models: [...new Set(pairs.map((pair) => pair.content.model))],
    ...aggregate,
    byTier,
  };
}

module.exports = { comparePairedAttempts, validateComparisonMetadata };
