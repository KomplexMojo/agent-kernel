const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const {
  BASE_COSTS_PATH, buildPriceBrief, loadBaseCosts, priceBriefHash,
} = require("../../tools/remote-ollama-control/scripts/lib/price-brief");

// The brief tells the authoring model what things cost. A stale copy would teach it wrong prices
// with total confidence, so nothing here may be restated by hand: the numbers are read back out of
// the Allocator's own data, and the two formula rules out of the source that implements them.
// This is the same discipline the resource-spec alignment test uses on the CLI allow-list.

test("every number in the brief comes from base-costs.json", () => {
  const costs = loadBaseCosts();
  const brief = buildPriceBrief(costs);

  for (const group of ["actor", "motivation", "vitals", "regen", "affinity", "hazard", "resource", "tile"]) {
    for (const [id, cost] of Object.entries(costs[group] || {})) {
      assert.match(
        brief, new RegExp(`${id}=${cost}\\b`),
        `the brief omits or misprices ${id}; the model would author against a number the Allocator does not charge`,
      );
    }
  }
});

test("the brief states the quadratic rule, and names it for the ids the price list actually treats that way", () => {
  // QUADRATIC_IDS is logic, not data — it lives in default-price-list.js. Read it from there so a
  // change to the formula set fails here instead of silently making the brief wrong.
  const source = readFileSync(
    BASE_COSTS_PATH.replace("base-costs.json", "default-price-list.js"), "utf8",
  );
  const block = source.slice(source.indexOf("QUADRATIC_IDS = new Set(["));
  const ids = [...block.slice(0, block.indexOf("]);")).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 4, "failed to read QUADRATIC_IDS out of the price list source");

  const brief = buildPriceBrief();
  assert.match(brief, /QUADRATIC/);
  // Every quadratic id is a regen tick or an affinity stack; the brief must describe both families,
  // or a model reading it would price the expensive ones linearly.
  const families = new Set(ids.map((id) => (id.includes("regen") ? "regen" : "stack")));
  for (const family of families) {
    assert.match(brief, new RegExp(family, "i"), `the brief never mentions ${family} in the quadratic rule`);
  }
  assert.match(brief, /n\*n tokens, not n/);
});

test("the brief states the resource premium at the rate the price list applies", () => {
  const costs = loadBaseCosts();
  const brief = buildPriceBrief(costs);
  assert.match(brief, new RegExp(`${costs.freeFloatingPremium}x`));
  // Hazards are deliberately not premiumed; saying so stops the model over-pricing them.
  assert.match(brief, /Hazards carry no such premium/);
});

test("a price change moves the brief and its hash", () => {
  const costs = loadBaseCosts();
  const before = buildPriceBrief(costs);
  const bumped = JSON.parse(JSON.stringify(costs));
  bumped.actor.actor_spawn = costs.actor.actor_spawn + 7;

  const after = buildPriceBrief(bumped);
  assert.notEqual(before, after, "editing a base cost must change what the model is told");
  assert.notEqual(priceBriefHash(before), priceBriefHash(after));
  assert.match(after, new RegExp(`actor_spawn=${costs.actor.actor_spawn + 7}\\b`));
});

test("the brief stays small enough to sit in every prompt", () => {
  // It rides on all 100 scenarios per configuration; a brief that bloats is a context tax.
  assert.ok(buildPriceBrief().length < 4000, "the price brief has grown past its budget");
});

// ---------------------------------------------------------------------------
// What the model was TOLD, as identity.
//
// scenarioSetHash covers the questions, matrixHash the configurations, executionSuiteHash the
// evaluation. Nothing covered the instructions — so adding the price brief on 2026-08-24 changed
// what was being measured while all three pinned hashes sat still, and two runs would have looked
// comparable. That is the silent-drift failure this repository cares most about.

const { authoringPolicy } = require("../../tools/remote-ollama-control/scripts/lib/ak-runner");
const { assertResumable } = require("../../tools/remote-ollama-control/scripts/lib/content-gen-checkpoint");

// assertResumable checks catalog, matrix, policy, scenario ids and configuration ids in that
// order, so a fixture must satisfy all of them for the policy case to be the one under test.
const IDENT = {
  scenarioSet: { sha256: "s".repeat(64) },
  matrix: { sha256: "m".repeat(64), configurationIds: ["cfg-a"] },
  scenarioIds: [1, 2],
};

test("the authoring policy hashes the instructions and the prices together", () => {
  const policy = authoringPolicy();
  assert.match(policy.sha256, /^[0-9a-f]{64}$/);
  assert.match(policy.priceBriefSha256, /^[0-9a-f]{64}$/);
  // Two hashes, because "the prices moved" and "the wording moved" call for different responses.
  assert.notEqual(policy.sha256, policy.priceBriefSha256);
});

test("a run refuses to resume once the prices it was told have changed", () => {
  const prior = { ...IDENT, authoringPolicy: { sha256: "a".repeat(64), priceBriefSha256: "b".repeat(64) } };
  const current = { ...IDENT, authoringPolicy: { sha256: "c".repeat(64), priceBriefSha256: "d".repeat(64) } };
  assert.throws(() => assertResumable(prior, current), /price brief changed/);
});

test("a wording change is named as such, not as a price change", () => {
  const brief = "e".repeat(64);
  const prior = { ...IDENT, authoringPolicy: { sha256: "a".repeat(64), priceBriefSha256: brief } };
  const current = { ...IDENT, authoringPolicy: { sha256: "c".repeat(64), priceBriefSha256: brief } };
  // Same prices, different policy hash — the instructions moved.
  assert.throws(() => assertResumable(prior, current), /authoring instructions changed/);
});

test("an unchanged policy resumes", () => {
  const policy = { sha256: "a".repeat(64), priceBriefSha256: "b".repeat(64) };
  assert.doesNotThrow(() => assertResumable({ ...IDENT, authoringPolicy: policy }, { ...IDENT, authoringPolicy: policy }));
});

test("a run predating the record refuses rather than silently merging", () => {
  // No way to tell what those attempts were told, so they cannot be pooled with new ones.
  const prior = { ...IDENT };
  const current = { ...IDENT, authoringPolicy: { sha256: "c".repeat(64), priceBriefSha256: "d".repeat(64) } };
  assert.throws(() => assertResumable(prior, current), /predates the authoring-policy record/);
});
