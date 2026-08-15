'use strict';

const fs = require('fs');
const path = require('path');
const { table } = require('./markdown');

const DEFAULT_THRESHOLDS = Object.freeze({
  toolCallRate: 0.99,
  scenarioVerdictRate: 0.99,
  averageScore: 75
});

const round1 = (value) => Math.round(value * 10) / 10;
const ratio = (pass, total) => (total > 0 ? pass / total : 0);
const contentAttempts = (records) => records.filter((record) => (
  !record.recordKind || record.recordKind === 'content_gen_attempt'
));

function historicalAggregate(records, scorerVersion = 'ak-compare-v1') {
  records = contentAttempts(records);
  const total = records.length;
  const execPass = records.filter((record) => record.execSucceeded === true).length;
  const toolPass = records.filter((record) => record.toolCallProduced === true).length;
  return {
    contract: 'agent-kernel-content-gen-aggregate/v1',
    scorerVersion,
    execOk: { pass: execPass, total, rate: ratio(execPass, total) },
    toolCallOk: { pass: toolPass, total, rate: ratio(toolPass, total) },
    avgScore: round1(records.reduce((sum, record) => sum + (record.score || 0), 0) / Math.max(1, total)),
    scoreScale: { min: 0, max: 100 },
    attemptInclusionPolicy: 'recorded-content-gen-attempts-v1',
    comparable: true,
    incomparabilityReasons: []
  };
}

function canStillQualify(records, { remainingAttempts = 0, thresholds = DEFAULT_THRESHOLDS } = {}) {
  if (records.some((record) => record.failureClass === 'infrastructure')) return false;
  const finalTotal = records.length + remainingAttempts;
  const toolPass = records.filter((record) => record.toolCallProduced === true).length;
  const verdictPass = records.filter((record) => record.scenarioVerdict?.passed === true).length;
  const score = records.reduce((sum, record) => sum + (record.score || 0), 0);
  return ratio(toolPass + remainingAttempts, finalTotal) >= thresholds.toolCallRate
    && ratio(verdictPass + remainingAttempts, finalTotal) >= thresholds.scenarioVerdictRate
    && ((score + (remainingAttempts * 100)) / Math.max(1, finalTotal)) >= thresholds.averageScore;
}

function tierAggregate(records) {
  const output = {};
  for (const record of records) {
    const tier = output[record.scenarioTier] || { attempts: 0, verdictPass: 0, scoreTotal: 0 };
    tier.attempts += 1;
    if (record.scenarioVerdict?.passed) tier.verdictPass += 1;
    tier.scoreTotal += record.score || 0;
    output[record.scenarioTier] = tier;
  }
  return Object.fromEntries(Object.entries(output).map(([name, tier]) => [name, {
    attempts: tier.attempts,
    scenarioVerdictRate: ratio(tier.verdictPass, tier.attempts),
    averageScore: round1(tier.scoreTotal / Math.max(1, tier.attempts))
  }]));
}

function dominates(left, right) {
  const keys = ['gpuCount', 'capacityRank', 'modelSizeBillions', 'contextTokens', 'outputTokens'];
  return keys.every((key) => left[key] <= right[key]) && keys.some((key) => left[key] < right[key]);
}

function compareResources(left, right) {
  const keys = ['gpuCount', 'capacityRank', 'modelSizeBillions', 'contextTokens', 'outputTokens'];
  for (const key of keys) {
    if (left.resourceOrder[key] !== right.resourceOrder[key]) {
      return left.resourceOrder[key] - right.resourceOrder[key];
    }
  }
  return left.configurationId.localeCompare(right.configurationId);
}

function aggregateContentGenResults(records, {
  matrix,
  scenarioSet,
  scorerVersion = 'ak-compare-v1',
  thresholds = DEFAULT_THRESHOLDS
}) {
  const configurations = matrix.configurations.map((configuration) => {
    const attempts = contentAttempts(records)
      .filter((record) => record.configurationId === configuration.configurationId);
    const historicalContentGen = historicalAggregate(attempts, scorerVersion);
    const verdictPass = attempts.filter((record) => record.scenarioVerdict?.passed).length;
    const repeats = [...new Set(attempts.map((record) => record.repeat))];
    const completePasses = repeats.filter((repeat) => (
      attempts.filter((record) => record.repeat === repeat).length === scenarioSet.count
    )).length;
    const failedGates = [];
    if (completePasses < matrix.repeatPolicy.maximumPasses) failedGates.push('matrix_incomplete');
    if (historicalContentGen.toolCallOk.rate < thresholds.toolCallRate) failedGates.push('tool_call_rate');
    if (ratio(verdictPass, attempts.length) < thresholds.scenarioVerdictRate) failedGates.push('scenario_verdict_rate');
    if (historicalContentGen.avgScore < thresholds.averageScore) failedGates.push('average_score');
    if (attempts.some((record) => record.failureClass === 'infrastructure')) failedGates.push('infrastructure_error');
    return {
      ...configuration,
      plannedAttempts: {
        minimum: scenarioSet.count,
        maximum: scenarioSet.count * matrix.repeatPolicy.maximumPasses
      },
      completedAttempts: attempts.length,
      completedPasses: completePasses,
      historicalContentGen,
      scenarioVerdict: { pass: verdictPass, total: attempts.length, rate: ratio(verdictPass, attempts.length) },
      perTier: tierAggregate(attempts),
      verdict: { qualifies: failedGates.length === 0, failedGates }
    };
  });
  const qualifying = configurations.filter((configuration) => configuration.verdict.qualifies).sort(compareResources);
  const frontier = qualifying.filter((candidate) => !qualifying.some((other) => (
    other !== candidate && dominates(other.resourceOrder, candidate.resourceOrder)
  )));
  return {
    schemaVersion: 'agent-kernel-content-gen-result/v1',
    scenarioSet,
    matrix: {
      sha256: matrix.sha256,
      configurationIds: matrix.configurations.map((entry) => entry.configurationId),
      repeatPolicy: matrix.repeatPolicy
    },
    thresholds,
    configurations,
    minimumSuccessfulConfiguration: qualifying.length > 0
      ? { configurationId: qualifying[0].configurationId }
      : null,
    paretoFrontier: frontier.map((entry) => entry.configurationId),
    failures: {
      configurations: configurations.filter((entry) => !entry.verdict.qualifies).length,
      byGate: configurations.flatMap((entry) => entry.verdict.failedGates)
        .reduce((counts, gate) => ({ ...counts, [gate]: (counts[gate] || 0) + 1 }), {})
    }
  };
}

function compareContentResults(current, prior) {
  const reasons = [];
  if (current.scenarioSet.sha256 !== prior.scenarioSet.sha256) reasons.push('scenario_set_hash');
  if (current.matrix.sha256 !== prior.matrix.sha256) reasons.push('matrix_hash');
  const configurations = {};
  for (const entry of current.configurations) {
    const previous = prior.configurations.find((candidate) => candidate.configurationId === entry.configurationId);
    const historicalReasons = [...reasons];
    if (!previous) historicalReasons.push('missing_configuration');
    if (previous && entry.historicalContentGen.scorerVersion !== previous.historicalContentGen.scorerVersion) {
      historicalReasons.push('scorer_version');
    }
    if (previous && entry.historicalContentGen.attemptInclusionPolicy !== previous.historicalContentGen.attemptInclusionPolicy) {
      historicalReasons.push('attempt_inclusion_policy');
    }
    configurations[entry.configurationId] = {
      historicalContentGen: {
        comparable: historicalReasons.length === 0,
        incomparabilityReasons: historicalReasons,
        avgScoreDelta: historicalReasons.length === 0
          ? round1(entry.historicalContentGen.avgScore - previous.historicalContentGen.avgScore)
          : null
      }
    };
  }
  return { comparable: reasons.length === 0, incomparabilityReasons: reasons, configurations };
}

function validateContentResult(result) {
  if (result?.schemaVersion !== 'agent-kernel-content-gen-result/v1') throw new Error('invalid result schemaVersion');
  if (!result.scenarioSet?.sha256 || !result.matrix?.sha256) throw new Error('result identities are required');
  if (!Array.isArray(result.configurations) || !Array.isArray(result.paretoFrontier)) {
    throw new Error('result configurations and paretoFrontier are required');
  }
  return result;
}

function writeContentResult(resultPath, result) {
  validateContentResult(result);
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function countByType(cardSet) {
  const counts = {};
  for (const card of cardSet || []) {
    const type = card.type || 'unknown';
    counts[type] = (counts[type] || 0) + (card.count || 1);
  }
  return counts;
}

function affinityByType(cardSet) {
  const affinities = {};
  for (const card of cardSet || []) {
    const type = card.type || 'unknown';
    if (type === 'room') continue;
    if (!affinities[type]) affinities[type] = new Set();
    if (card.affinity) affinities[type].add(card.affinity);
  }
  return affinities;
}

function compactReferenceMetrics(reference) {
  const fail = (reason) => {
    throw new Error(`Invalid compact reference expectations: ${reason}`);
  };
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    fail('reference must be an object');
  }
  const { entityCounts, affinitiesByType, totalSpend } = reference;
  if (!entityCounts || typeof entityCounts !== 'object' || Array.isArray(entityCounts)) {
    fail('entityCounts must be an object');
  }
  if (!affinitiesByType || typeof affinitiesByType !== 'object' || Array.isArray(affinitiesByType)) {
    fail('affinitiesByType must be an object');
  }
  const counts = {};
  for (const [type, count] of Object.entries(entityCounts)) {
    if (!type || !Number.isInteger(count) || count < 0) {
      fail(`invalid entity count for ${type || '<empty>'}`);
    }
    counts[type] = count;
  }
  const affinities = {};
  for (const [type, values] of Object.entries(affinitiesByType)) {
    if (type === 'room') {
      fail('room affinities are not part of the program construct');
    }
    if (!type || !Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) {
      fail(`invalid affinity list for ${type || '<empty>'}`);
    }
    affinities[type] = new Set(values);
  }
  if (!Number.isFinite(totalSpend) || totalSpend < 0) {
    fail('totalSpend must be a non-negative finite number');
  }
  return {
    types: new Set(Object.keys(counts)),
    counts,
    affinities,
    spend: totalSpend,
  };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

function partialOverlap(genSet, refSet) {
  const denom = Math.max(refSet.size, genSet.size, 1);
  let hits = 0;
  for (const item of genSet) {
    if (refSet.has(item)) hits += 1;
  }
  return hits / denom;
}

function scoreRun(runResult, scenario, refSpecPath, refReceiptPath) {
  const breakdown = {};
  let points = 0;

  // Tool call gate: 20 pts
  if (runResult.toolCallProduced) {
    points += 20;
    breakdown.toolCallProduced = 20;
  } else {
    breakdown.toolCallProduced = 0;
    return { points, max: 100, breakdown };
  }

  // Exec succeeded: 10 pts
  if (runResult.execResult?.succeeded) {
    points += 10;
    breakdown.execSucceeded = 10;
  } else {
    breakdown.execSucceeded = 0;
    return { points, max: 100, breakdown };
  }

  const genSpecPath = runResult.outDir ? path.join(runResult.outDir, 'spec.json') : null;
  const genSpec = genSpecPath ? readJson(genSpecPath) : null;
  const genCardSet = genSpec?.plan?.hints?.cardSet || [];
  let refTypes;
  let refCounts;
  let refAffinities;
  let refSpend;
  if (Object.prototype.hasOwnProperty.call(scenario || {}, 'reference')) {
    const compact = compactReferenceMetrics(scenario.reference);
    refTypes = compact.types;
    refCounts = compact.counts;
    refAffinities = compact.affinities;
    refSpend = compact.spend;
  } else {
    const refSpec = refSpecPath ? readJson(refSpecPath) : null;
    const refCardSet = refSpec?.plan?.hints?.cardSet || [];
    const refReceipt = refReceiptPath ? readJson(refReceiptPath) : null;
    refTypes = new Set(refCardSet.map((card) => card.type));
    refCounts = countByType(refCardSet);
    refAffinities = affinityByType(refCardSet);
    refSpend = refReceipt?.totalCost ?? null;
  }

  // Entity types match: 20 pts
  const genTypes = new Set(genCardSet.map((c) => c.type));
  if (refTypes.size === 0) {
    // No reference to compare against — give full credit if exec succeeded
    points += 20;
    breakdown.entityTypesMatch = 20;
  } else {
    const typeScore = Math.round(20 * partialOverlap(genTypes, refTypes));
    points += typeScore;
    breakdown.entityTypesMatch = typeScore;
  }

  // Entity counts match: 20 pts
  const genCounts = countByType(genCardSet);
  const allTypes = new Set([...Object.keys(genCounts), ...Object.keys(refCounts)]);
  if (allTypes.size === 0) {
    breakdown.entityCountsMatch = 0;
  } else {
    let countHits = 0;
    for (const type of allTypes) {
      if ((genCounts[type] || 0) === (refCounts[type] || 0)) {
        countHits += 1;
      }
    }
    const countScore = Math.round(20 * countHits / allTypes.size);
    points += countScore;
    breakdown.entityCountsMatch = countScore;
  }

  // Affinity match: 20 pts
  const genAffinities = affinityByType(genCardSet);
  const affinityTypes = new Set([...Object.keys(genAffinities), ...Object.keys(refAffinities)]);
  if (affinityTypes.size === 0) {
    breakdown.affinityMatch = 0;
  } else {
    let affinityScore = 0;
    for (const type of affinityTypes) {
      const gen = genAffinities[type] || new Set();
      const ref = refAffinities[type] || new Set();
      affinityScore += partialOverlap(gen, ref);
    }
    const finalAffinityScore = Math.round(20 * affinityScore / affinityTypes.size);
    points += finalAffinityScore;
    breakdown.affinityMatch = finalAffinityScore;
  }

  // Budget delta: 10 pts. Only meaningful for budget-constrained scenarios;
  // unconstrained runs spend whatever their content requires, so comparing
  // spend against the reference would punish legitimate variation — award
  // the component whenever a spend was recorded.
  const genReceiptPath = runResult.outDir ? path.join(runResult.outDir, 'budget-receipt.json') : null;
  const genReceipt = genReceiptPath ? readJson(genReceiptPath) : null;
  const genSpend = genReceipt?.totalCost ?? null;
  if (scenario?.budgetMode !== 'constrained') {
    breakdown.budgetDelta = genSpend !== null && genSpend > 0 ? 10 : 0;
    points += breakdown.budgetDelta;
  } else if (genSpend !== null && refSpend !== null && refSpend > 0) {
    const delta = Math.abs(genSpend - refSpend) / refSpend;
    const budgetScore = Math.round(10 * Math.max(0, 1 - delta / 0.8));
    points += budgetScore;
    breakdown.budgetDelta = budgetScore;
  } else if (genSpend !== null) {
    // No reference spend — full credit if we produced any spend
    points += genSpend > 0 ? 10 : 0;
    breakdown.budgetDelta = genSpend > 0 ? 10 : 0;
  } else {
    breakdown.budgetDelta = 0;
  }

  return { points: Math.min(100, points), max: 100, breakdown };
}

function writeContentSummary(summaryPath, results, runConfig) {
  const byConfiguration = new Map();
  for (const result of contentAttempts(results)) {
    const key = result.configurationId || `${result.profile}\0${result.model}`;
    const group = byConfiguration.get(key) || {
      profile: result.profile,
      model: result.model,
      records: [],
      scenariosRun: new Set()
    };
    group.records.push(result);
    group.scenariosRun.add(result.scenarioIndex);
    byConfiguration.set(key, group);
  }

  const aggregateRows = [...byConfiguration.values()].map((group) => {
    const historical = historicalAggregate(group.records);
    return [
      group.profile,
      group.model,
      group.scenariosRun.size,
      historical.execOk.total,
      historical.avgScore,
      `${historical.toolCallOk.pass}/${historical.toolCallOk.total}`,
      `${historical.execOk.pass}/${historical.execOk.total}`
    ];
  });

  const detailRows = results.map((result) => [
    result.profile,
    result.scenarioIndex,
    result.scenarioTitle,
    result.scenarioTier,
    result.scenarioBudget ?? '',
    result.repeat,
    result.score ?? '',
    result.toolCallProduced ? 'yes' : 'no',
    result.execSucceeded ? 'ok' : `fail(${result.execExitCode ?? '?'})`,
    result.llmMs ?? '',
    result.execMs ?? '',
    result.execStderr ? result.execStderr.slice(0, 80).replace(/\n/g, ' ') : (result.llmError ? result.llmError.slice(0, 60) : '')
  ]);

  const lines = [
    '# Agent-Kernel Content-Gen Benchmark Summary',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Route: ${runConfig.route}`,
    `Result directory: ${runConfig.resultDir}`,
    `Profiles: ${runConfig.profiles.join(', ')}`,
    `Scenarios: ${runConfig.scenarios}`,
    '',
    '## Aggregate by Profile',
    '',
    table(
      ['Profile', 'Model', 'Scenarios', 'Runs', 'Avg score', 'Tool call ok', 'Exec ok'],
      aggregateRows
    ),
    '',
    '## All Runs',
    '',
    table(
      ['Profile', '#', 'Scenario', 'Tier', 'Budget', 'Run', 'Score', 'Tool', 'Exec', 'LLM ms', 'Exec ms', 'Error'],
      detailRows
    )
  ];

  fs.writeFileSync(summaryPath, `${lines.join('\n')}\n`);
}

module.exports = {
  DEFAULT_THRESHOLDS,
  aggregateContentGenResults,
  canStillQualify,
  compareContentResults,
  historicalAggregate,
  scoreRun,
  validateContentResult,
  writeContentResult,
  writeContentSummary
};
