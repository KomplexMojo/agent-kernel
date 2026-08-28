'use strict';

const fs = require('fs');
const path = require('path');
const { table } = require('./markdown');

// scenarioVerdictRate was 0.99 until 2026-08-23. Over a 100-scenario set that permits exactly one
// miss, and canStillQualify is optimistic -- it credits every remaining attempt as perfect -- so a
// configuration was eliminated by its SECOND miss, often within the first quarter of its run.
// Lowered to 0.96 (four misses) on the maintainer's call, to leave a gate that a strong model can
// actually clear while still demanding near-perfection.
//
// toolCallRate stays 0.99 deliberately: producing a tool call at all is a harness-level
// expectation, not a quality judgment, and it currently runs at 1.0. Only the verdict gate moved.
//
// Thresholds are NOT part of the content-gen matrix hash (that covers contractVersion, repeatPolicy
// and configurations), so this does not invalidate AK_BENCHMARK_MATRIX_HASH and needs no identity
// regeneration on the runner. Each published result records the thresholds it was judged against,
// so results either side of this change remain readable rather than silently incomparable.
const DEFAULT_THRESHOLDS = Object.freeze({
  toolCallRate: 0.99,
  scenarioVerdictRate: 0.96,
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

/**
 * Per-scenario outcomes, compact enough to publish.
 *
 * The published record carried tier AGGREGATES and nothing finer, so "which scenarios does this
 * configuration actually fail?" could not be answered from evidence -- only from runs.jsonl on the
 * box, which is deliberately never published. That makes every selective-run strategy impossible:
 * you cannot re-run the problematic scenarios, or skip the ones a model always passes, without
 * knowing which those are.
 *
 * Tier labels are not a substitute. Measured on 2026-08-24, four of six configurations were
 * NON-MONOTONIC across tiers -- qwen3-coder:30b scored 1.00 on `complex` and 0.48 on `constrained`,
 * and qwen3.8:27b found `affinity` easier than `simple`. Difficulty is a property of the
 * model-scenario pair, not of the label.
 *
 * One row per scenario, aggregated over repeats: attempts, passes, mean score. That is what a
 * selector needs and roughly 100 short rows per configuration -- kilobytes against a branch that
 * was carrying 15.9 MB of source until it was cleaned.
 */
function perScenarioAggregate(records) {
  const byIndex = new Map();
  for (const record of records) {
    const index = record.scenarioIndex;
    if (!Number.isInteger(index)) continue;
    const row = byIndex.get(index) || { i: index, tier: record.scenarioTier, n: 0, pass: 0, score: 0 };
    row.n += 1;
    if (record.scenarioVerdict?.passed) row.pass += 1;
    row.score += record.score || 0;
    byIndex.set(index, row);
  }
  return [...byIndex.values()]
    .sort((left, right) => left.i - right.i)
    .map((row) => ({
      i: row.i,
      tier: row.tier,
      n: row.n,
      pass: row.pass,
      rate: ratio(row.pass, row.n),
      avgScore: round1(row.score / Math.max(1, row.n)),
    }));
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
      // The finer grain the tier aggregate cannot provide. Selective runs are driven from this.
      perScenario: perScenarioAggregate(attempts),
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

/**
 * A scenario that is SUPPOSED to be denied must be scored like any other.
 *
 * This used to return early when the build did not succeed, so the six catalog scenarios whose
 * expected outcome is `budget_denied` could never earn more than the 20-point tool-call gate -- and,
 * worse, were scored BLIND: a model that authored exactly the right spec and one that authored
 * nonsense both scored 20, as long as both were denied. The verdict rate could not separate them
 * either, since it only compares outcome labels. Correct authoring was unrewardable on 6% of the
 * catalog.
 *
 * Everything needed was already to hand. What the model ASKED FOR is in `runResult.toolArgs`
 * whether or not it was affordable, and the refusal reports how far over it went, so all 100 points
 * have an honest meaning for a denial.
 *
 * `outcome` is passed in rather than derived here: classifyExecutionOutcome lives in ak-runner,
 * which would make this module import its own caller.
 */
/**
 * The card set a tool call describes, in the shape the built spec would have produced. Used only
 * when there is no built spec -- a denial -- so that WHAT the model asked for is still judged.
 */
function cardSetFromToolArgs(toolArgs) {
  if (!toolArgs || typeof toolArgs !== 'object') return [];
  const cards = [];
  for (const type of ['room', 'floorTile', 'hazard', 'resource', 'delver', 'warden']) {
    for (const entry of Array.isArray(toolArgs[type]) ? toolArgs[type] : []) {
      if (!entry || typeof entry !== 'object') continue;
      const count = Number.isInteger(entry.count) && entry.count > 0 ? entry.count : 1;
      cards.push({ type, count, affinity: entry.affinity });
    }
  }
  return cards;
}

function scoreRun(runResult, scenario, refSpecPath, refReceiptPath, { outcome = null } = {}) {
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

  // Outcome matched expectation: 10 pts.
  //
  // Was `execSucceeded`, which rewarded a build for succeeding even when the scenario expected it to
  // be denied -- backwards for the six that do -- and early-returned, ending scoring. Now it asks
  // the question the scenario actually poses, and scoring continues either way.
  const expected = scenario?.expectedOutcome || 'success';
  const actual = outcome || (runResult.execResult?.succeeded ? 'success' : null);
  const outcomeMatched = actual !== null && actual === expected;
  points += outcomeMatched ? 10 : 0;
  breakdown.outcomeMatched = outcomeMatched ? 10 : 0;
  // Only a missing tool call stops scoring: there is no authored spec to judge.
  const deniedAsExpected = outcomeMatched && expected !== 'success';

  const genSpecPath = runResult.outDir ? path.join(runResult.outDir, 'spec.json') : null;
  const genSpec = genSpecPath ? readJson(genSpecPath) : null;
  // A denied build writes no spec.json, but the authored intent is in the tool call itself. Prefer
  // the built spec where it exists -- it is post-normalisation, so successful scenarios keep the
  // scores they had -- and fall back to what was asked for when it does not.
  const genCardSet = genSpec?.plan?.hints?.cardSet || cardSetFromToolArgs(runResult.toolArgs);
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
  // A denial has a budget signal of its own: the refusal reports how far over it went. Being denied
  // by 4 tokens shows a far better grasp of the economy than being denied by 400, and that
  // distinction used to be discarded along with the rest of the score.
  if (deniedAsExpected) {
    const detail = `${runResult.execResult?.stdout || ''}${runResult.execResult?.stderr || ''}`;
    const over = detail.match(/remaining=-(\d+)/) || detail.match(/minimum required spend is (\d+)/);
    const budget = Number.isInteger(scenario?.budget) && scenario.budget > 0 ? scenario.budget : null;
    if (over && budget) {
      const overshoot = over[0].startsWith('remaining')
        ? Number(over[1])
        : Math.max(0, Number(over[1]) - budget);
      // Full marks within 5% of the boundary, tapering to zero at 80% over -- the same shape the
      // constrained branch below uses for spend accuracy.
      const score = Math.round(10 * Math.max(0, 1 - Math.max(0, overshoot / budget - 0.05) / 0.8));
      points += score;
      breakdown.budgetDelta = score;
    } else {
      breakdown.budgetDelta = 0;
    }
  } else if (scenario?.budgetMode !== 'constrained') {
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
