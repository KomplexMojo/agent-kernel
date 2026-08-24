'use strict';

/**
 * What things cost, rendered for the authoring model.
 *
 * The benchmark told the model `Set budgetTokens to 277` and nothing else. It was asked to author
 * within a budget it had no way to compute against, and then measured on whether it guessed well:
 * budget and spatial failures were 55% of everything that failed once the schema defects were
 * fixed, and the constrained tier failed at 56% against 18% for simple.
 *
 * The numbers come from base-costs.json, the Allocator's own data, and are NEVER restated here --
 * the price list is emphatic that costs must not get a second home, and a stale copy would teach
 * the model wrong prices with total confidence. The two formula rules live in
 * default-price-list.js as logic rather than data, so they are stated in prose and pinned by a
 * test that reads them back out of that source.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_COSTS_PATH = path.resolve(
  __dirname, '../../../../packages/runtime/src/personas/allocator/base-costs.json',
);

function loadBaseCosts(costsPath = BASE_COSTS_PATH) {
  return JSON.parse(fs.readFileSync(costsPath, 'utf8'));
}

// Groups worth showing an authoring model, in the order it makes decisions: what an actor costs,
// what it carries, then what fills the level. Internal bookkeeping groups are left out -- a longer
// brief is not a better one, and every extra line is a chance to teach something irrelevant.
const SECTIONS = [
  ['actor', 'Actors'],
  ['motivation', 'Motivations (per actor)'],
  ['vitals', 'Vital points (per point of max)'],
  ['regen', 'Vital regen (per tick of rate)'],
  ['affinity', 'Affinity'],
  ['hazard', 'Hazards'],
  ['resource', 'Resources'],
  ['tile', 'Tiles'],
];

function buildPriceBrief(baseCosts = loadBaseCosts()) {
  const lines = ['Token prices (authoring budget):'];
  for (const [key, label] of SECTIONS) {
    const group = baseCosts[key];
    if (!group || typeof group !== 'object') continue;
    const entries = Object.entries(group).map(([id, cost]) => `${id}=${cost}`);
    lines.push(`- ${label}: ${entries.join(', ')}`);
  }
  lines.push(
    '- Regen rates and affinity stacks are QUADRATIC: n units cost n*n tokens, not n. '
    + 'Everything else is linear: unit cost times quantity.',
  );
  const premium = baseCosts.freeFloatingPremium;
  if (premium) {
    lines.push(
      `- Resource ids cost ${premium}x the equivalent base, rounded, because a resource is free-floating `
      + 'and grants whichever actor picks it up. Hazards carry no such premium.',
    );
  }
  lines.push('- Floor tiles are charged per tile, so a large room costs more than a small one.');
  return lines.join('\n');
}

// Recorded with the run so two results are never silently compared across a change to what the
// model was told. The prompt is not covered by any of the pinned identity hashes.
function priceBriefHash(brief = buildPriceBrief()) {
  return crypto.createHash('sha256').update(brief).digest('hex');
}

module.exports = { BASE_COSTS_PATH, buildPriceBrief, loadBaseCosts, priceBriefHash };
