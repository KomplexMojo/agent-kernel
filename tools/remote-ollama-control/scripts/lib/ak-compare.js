'use strict';

const fs = require('fs');
const path = require('path');
const { table } = require('./markdown');

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
    if (!affinities[type]) affinities[type] = new Set();
    if (card.affinity) affinities[type].add(card.affinity);
  }
  return affinities;
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
  const refSpec = refSpecPath ? readJson(refSpecPath) : null;

  const genCardSet = genSpec?.plan?.hints?.cardSet || [];
  const refCardSet = refSpec?.plan?.hints?.cardSet || [];

  // Entity types match: 20 pts
  const genTypes = new Set(genCardSet.map((c) => c.type));
  const refTypes = new Set(refCardSet.map((c) => c.type));
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
  const refCounts = countByType(refCardSet);
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
  const refAffinities = affinityByType(refCardSet);
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

  // Budget delta: 10 pts
  const genReceiptPath = runResult.outDir ? path.join(runResult.outDir, 'budget-receipt.json') : null;
  const genReceipt = genReceiptPath ? readJson(genReceiptPath) : null;
  const refReceipt = refReceiptPath ? readJson(refReceiptPath) : null;
  const genSpend = genReceipt?.totalCost ?? null;
  const refSpend = refReceipt?.totalCost ?? null;
  if (genSpend !== null && refSpend !== null && refSpend > 0) {
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
  const byProfile = new Map();
  for (const result of results) {
    const key = result.profile;
    const group = byProfile.get(key) || {
      profile: result.profile,
      model: result.model,
      runs: 0,
      totalScore: 0,
      toolCallOk: 0,
      execOk: 0,
      scenariosRun: new Set()
    };
    group.runs += 1;
    group.totalScore += result.score || 0;
    if (result.toolCallProduced) group.toolCallOk += 1;
    if (result.execSucceeded) group.execOk += 1;
    group.scenariosRun.add(result.scenarioIndex);
    byProfile.set(key, group);
  }

  const aggregateRows = [...byProfile.values()].map((group) => [
    group.profile,
    group.model,
    group.scenariosRun.size,
    group.runs,
    Math.round((group.totalScore / Math.max(1, group.runs)) * 10) / 10,
    `${group.toolCallOk}/${group.runs}`,
    `${group.execOk}/${group.runs}`
  ]);

  const detailRows = results.map((result) => [
    result.profile,
    result.scenarioIndex,
    result.scenarioTitle,
    result.scenarioTier,
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
      ['Profile', '#', 'Scenario', 'Tier', 'Run', 'Score', 'Tool', 'Exec', 'LLM ms', 'Exec ms', 'Error'],
      detailRows
    )
  ];

  fs.writeFileSync(summaryPath, `${lines.join('\n')}\n`);
}

module.exports = { scoreRun, writeContentSummary };
