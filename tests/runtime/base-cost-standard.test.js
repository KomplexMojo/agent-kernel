/**
 * The base-cost standard: NUMBERS live in JSON, FORMULAS live in code.
 *
 * Every element with a token cost must follow this. The failure mode it prevents is
 * duplication: a cost hardcoded in JS alongside the JSON drifts silently, and the
 * two disagree with nobody noticing.
 *
 * ⚠️ **THE REPO'S OWN INSTANCE OF THAT IS CLOSED (P1.4, 2026-08-12).** This header used to
 * point at "the divergence test at the bottom", which pinned `cost-model.js`'s second price
 * model as visible-but-tolerated. That model is deleted: the census found it charged nothing
 * in production, its only consumer having no importers. What replaces the pin is a real
 * prohibition — `tests/architecture/single-origin.test.js` fails if vital/regen/affinity
 * price constants are declared outside `personas/allocator/`. A pinned divergence documents
 * a second origin; a single-origin guard forbids one.
 *
 * These tests are guards, not behaviour: they fail when someone puts a cost back
 * into code.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const PRICE_LIST_JS = resolve(ROOT, "packages/runtime/src/personas/allocator/default-price-list.js");
const BASE_COSTS_JSON = resolve(ROOT, "packages/runtime/src/personas/allocator/base-costs.json");
const MODULE = "../../packages/runtime/src/personas/allocator/default-price-list.js";

test("base costs live in JSON", () => {
  const base = JSON.parse(readFileSync(BASE_COSTS_JSON, "utf8"));
  assert.equal(typeof base.freeFloatingPremium, "number");
  assert.equal(base.affinity.affinity_base, 10);
  assert.equal(base.vitals.vital_health_point, 1);
});

test("the price list JS declares no cost numbers of its own", () => {
  const src = readFileSync(PRICE_LIST_JS, "utf8");
  // A literal unitCost number in code means the JSON is no longer the only home.
  assert.equal(
    /unitCost:\s*[0-9]/.test(src),
    false,
    "found a hardcoded unitCost in default-price-list.js — base costs belong in base-costs.json",
  );
});

test("every price list item is sourced from the JSON", async () => {
  const { buildDefaultPriceList } = await import(MODULE);
  const base = JSON.parse(readFileSync(BASE_COSTS_JSON, "utf8"));
  const known = new Set();
  for (const [group, entries] of Object.entries(base)) {
    if (group.startsWith("_") || typeof entries !== "object") continue;
    for (const id of Object.keys(entries)) {
      known.add(id);
      known.add(`resource_${id}`); // premium mirrors are derived in code
    }
  }
  for (const item of buildDefaultPriceList().items) {
    assert.ok(known.has(item.id), `${item.id} is not backed by base-costs.json`);
  }
});

test("every item carries a formula, and formulas are decided in code not JSON", async () => {
  const { buildDefaultPriceList } = await import(MODULE);
  const base = JSON.parse(readFileSync(BASE_COSTS_JSON, "utf8"));
  // Every cost VALUE must be a bare number. Prose in _comment keys is fine; a
  // formula name appearing as a value would mean logic had leaked into the data.
  for (const [group, entries] of Object.entries(base)) {
    if (group.startsWith("_")) continue;
    if (typeof entries === "number") continue; // e.g. freeFloatingPremium
    for (const [id, value] of Object.entries(entries)) {
      assert.equal(
        typeof value,
        "number",
        `${group}.${id} must be a number — formula selection belongs in code`,
      );
    }
  }
  for (const item of buildDefaultPriceList().items) {
    assert.ok(["linear", "quadratic"].includes(item.formula), `${item.id} has no formula`);
  }
});

test("editing the JSON changes the price — the data is genuinely load-bearing", async () => {
  const { buildDefaultPriceList } = await import(MODULE);
  const base = JSON.parse(readFileSync(BASE_COSTS_JSON, "utf8"));
  const item = buildDefaultPriceList().items.find((i) => i.id === "affinity_base");
  assert.equal(item.unitCost, base.affinity.affinity_base);
});

test("the resource premium is derived in code from the JSON premium", async () => {
  const { buildDefaultPriceList } = await import(MODULE);
  const base = JSON.parse(readFileSync(BASE_COSTS_JSON, "utf8"));
  const items = Object.fromEntries(buildDefaultPriceList().items.map((i) => [i.id, i]));
  for (const id of Object.keys(base.affinity)) {
    const mirror = items[`resource_${id}`];
    assert.ok(mirror, `missing resource mirror for ${id}`);
    assert.equal(
      mirror.unitCost,
      Math.round(base.affinity[id] * base.freeFloatingPremium),
      `${mirror.id} must be round(premium × base)`,
    );
    // Premium changes price, never scaling shape.
    assert.equal(mirror.formula, items[id].formula, `${mirror.id} must mirror ${id}'s formula`);
  }
});

test("hazards pay no free-floating premium", async () => {
  const { buildDefaultPriceList } = await import(MODULE);
  const items = buildDefaultPriceList().items;
  assert.equal(items.some((i) => i.id.startsWith("resource_hazard")), false);
  assert.equal(items.some((i) => i.id.startsWith("hazard_") && /premium/i.test(i.description || "")), false);
});

// ---------------------------------------------------------------------------
// P1.4 (2026-08-12) — the KNOWN DIVERGENCE block that stood here is gone, along with the
// two tests under it and the model they described.
//
// It read: "cost-model.js holds a SECOND set of base costs in code that disagrees with the
// price list on nearly every value — and it DOES charge live paths", naming
// spend-proposal's calculateActorConfigurationUnitCost, card authoring, selection-spend and
// the CLI delver-card maximizer. That was true when written. It stopped being true when the
// actor pricing was unified onto the price list (requireEntry, error on a miss), and
// nothing re-read it — so a test comment kept asserting a live defect that no longer
// existed, and the milestone to fix it stayed scoped as a reconciliation.
//
// What replaces it is in tests/architecture/single-origin.test.js: a guard that FAILS if
// vital/regen/affinity price constants are declared outside personas/allocator/, and a
// second one that forbids reading base-costs.json from outside it at all. The deleted tests
// pinned the divergence's SHAPE (that cost-model's numbers came from the JSON, and that its
// affinity base still differed from the list's); neither could have noticed the model going
// dead, because both only compared it to itself.
//
// ⚠️ THREE tests came out with that block, not two — the third is restored below, trimmed.
// It was collateral: the cut ran from the comment header to the end of the last test and
// took a live guard with it. The count is what caught it (-10 tests, and the parts only
// summed to -9), which is the argument for reconciling a suite delta rather than accepting
// a green run.
// ---------------------------------------------------------------------------

test("P1.4: the motivation policy carries NO cost constants — fail-loud, list-only", async () => {
  // The half of this test that referenced cost-model's COST_DEFAULTS is gone with the
  // module's price half; what remains is the guard that matters — the fallback table that
  // silently overcharged (list `exploring` 2 vs fallback 25) must stay deleted. Also
  // asserted from the Allocator's side in
  // tests/personas/allocator/allocator-unified-pricing.test.js; kept here too because this
  // file is where someone reintroducing a "default cost" would look for permission.
  const mp = await import("../../packages/runtime/src/personas/allocator/motivation-price-policy.js");
  assert.equal(mp.DEFAULT_MOTIVATION_COSTS, undefined, "fallback table deleted in P1.4");
  assert.equal(mp.SIMPLE_MOTIVATION_COST, undefined);
  assert.equal(mp.ADVANCED_MOTIVATION_COST, undefined);
  assert.equal(mp.buildMotivationPriceListItems, undefined, "seeded wrong numbers; deleted");
});
