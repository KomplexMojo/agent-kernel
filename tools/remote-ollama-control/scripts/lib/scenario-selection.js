'use strict';

/**
 * Which scenarios are worth running against a given configuration?
 *
 * A full matrix run is 100 scenarios x every configuration x up to 3 passes. Most of that buys
 * nothing on a frequent cadence: a scenario a configuration passes every time, and one it fails
 * every time, each yield almost no information per attempt. Information peaks where the pass rate
 * is near 0.5 -- the ordinary result from adaptive testing, and the reason this selects on MEASURED
 * pass rate rather than on the tier label.
 *
 * Tier labels cannot do this job. Measured 2026-08-24, four of six configurations were
 * NON-MONOTONIC across tiers: qwen3-coder:30b scored 1.00 on `complex` and 0.48 on `constrained`;
 * qwen3.8:27b found `affinity` easier than `simple`. "Complex" is not reliably harder than
 * "constrained", and the ordering differs per model, so difficulty is a property of the
 * model-scenario pair and has to be measured.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO.
 *
 * It does not replace the qualification run. `minimumSuccessfulConfiguration` reports the cheapest
 * configuration that qualifies, which is a comparison ACROSS configurations and only means anything
 * if every configuration answered the same questions. Selecting per configuration makes verdict
 * rates incomparable, so a selected run is for development signal and carries its own identity to
 * keep the two apart.
 *
 * It does not drop the healthy scenarios entirely. Running only what fails is how a suite goes
 * blind to regressions: the set self-selects toward the hard cases and nothing notices the day a
 * change breaks something that used to work. `rotating` keeps every scenario in circulation. It is
 * also what protects the canary signal -- models.json keeps qwen3.5:9b because "a uniform drop
 * across the whole matrix says harness, not model", and that only works while the weak model still
 * runs the easy scenarios.
 */

const crypto = require('crypto');

const DEFAULT_POLICY = Object.freeze({
  // The discriminating band. Outside it, an attempt mostly confirms what is already known.
  lowerRate: 0.2,
  upperRate: 0.8,
  // A scenario that passes but scores poorly is the one about to break; worth watching even at a
  // high pass rate.
  marginalScore: 60,
  // Healthy scenarios are rotated so the whole catalog is covered every `rotationPeriod` runs.
  rotationPeriod: 5,
});

function classify(row, policy) {
  if (row.rate <= policy.lowerRate) return 'failing';
  if (row.rate < policy.upperRate) return 'discriminating';
  if (row.avgScore < policy.marginalScore) return 'marginal';
  return 'healthy';
}

/**
 * @param {Array} perScenario rows as published by ak-compare's perScenarioAggregate
 * @param {number} runOrdinal which focused run this is; rotates the healthy slice
 */
function selectScenarios(perScenario, { runOrdinal = 0, policy = {} } = {}) {
  const settings = { ...DEFAULT_POLICY, ...policy };
  const rows = Array.isArray(perScenario) ? [...perScenario].sort((a, b) => a.i - b.i) : [];
  const bands = { failing: [], discriminating: [], marginal: [], healthy: [] };
  for (const row of rows) bands[classify(row, settings)].push(row.i);

  // Deterministic round-robin over the healthy set: slice `runOrdinal mod period`, so every healthy
  // scenario is exercised once per full rotation and the choice never depends on a random seed.
  const period = Math.max(1, settings.rotationPeriod);
  const rotating = bands.healthy.filter((_, position) => position % period === runOrdinal % period);

  const selected = [...new Set([...bands.failing, ...bands.discriminating, ...bands.marginal, ...rotating])]
    .sort((left, right) => left - right);

  return {
    selected,
    bands: {
      failing: bands.failing.length,
      discriminating: bands.discriminating.length,
      marginal: bands.marginal.length,
      healthy: bands.healthy.length,
      rotating: rotating.length,
    },
    // Never reported as a scenarioSetHash: a subset is not the catalog, and a reader that compared
    // the two would be comparing different questions. Its own name, so the difference is loud.
    scenarioSubsetHash: crypto.createHash('sha256')
      .update(JSON.stringify({ contract: 'scenario-subset-v1', selected }))
      .digest('hex'),
    // No silent caps: what was left out, and why, travels with what was selected.
    excluded: rows.filter((row) => !selected.includes(row.i)).map((row) => ({ i: row.i, rate: row.rate })),
    policy: settings,
  };
}

module.exports = { DEFAULT_POLICY, classify, selectScenarios };
