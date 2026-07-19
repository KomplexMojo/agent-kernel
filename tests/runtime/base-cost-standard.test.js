/**
 * The base-cost standard: NUMBERS live in JSON, FORMULAS live in code.
 *
 * Every element with a token cost must follow this. The failure mode it prevents is
 * duplication: a cost hardcoded in JS alongside the JSON drifts silently, and the
 * two disagree with nobody noticing (this repo already has that problem between
 * cost-model.js and the price list — see the divergence test at the bottom).
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
// KNOWN DIVERGENCE — documented deliberately so it cannot be forgotten.
//
// cost-model.js holds a SECOND set of base costs in code that disagrees with the
// price list on nearly every value — and it DOES charge live paths: spend-proposal's
// calculateActorConfigurationUnitCost (card authoring, selection-spend, the CLI
// delver-card maximizer) uses its constants as silent fallbacks, and uses
// COST_DEFAULTS.affinityBaseCost + computeCumulativeStackCost unconditionally,
// never consulting the price list for actor affinity base/stacks. This test pins
// the divergence so it is visible and cannot silently widen — NOT an endorsement.
// See allocator/README.md "Known divergence" and local-codex/Plan.md M18–M21.
// ---------------------------------------------------------------------------

test("P1.2: cost-model.js numbers are sourced from base-costs.json (actorModel group)", async () => {
  const base = JSON.parse(readFileSync(BASE_COSTS_JSON, "utf8"));
  const cm = await import("../../packages/runtime/src/personas/configurator/cost-model.js");
  const am = base.actorModel;
  assert.deepEqual(cm.VITAL_MAX_COST_MULTIPLIER, {
    health: am.vital_max_health,
    mana: am.vital_max_mana,
    stamina: am.vital_max_stamina,
    durability: am.vital_max_durability,
  });
  assert.deepEqual(cm.REGEN_COST_COEFFICIENT, {
    health: am.regen_coeff_health,
    mana: am.regen_coeff_mana,
    stamina: am.regen_coeff_stamina,
    durability: am.regen_coeff_durability,
  });
  assert.equal(cm.COST_DEFAULTS.affinityBaseCost, am.affinity_base_attached);
  assert.equal(cm.COST_DEFAULTS.externalExpressionCost, am.expression_external);
  assert.equal(cm.COST_DEFAULTS.internalExpressionCost, am.expression_internal);
  // Formula stays in code; its base numbers come from the JSON.
  assert.equal(cm.computeStackCost(1), am.affinity_stack_base);
  assert.equal(cm.computeStackCost(3), am.affinity_stack_base + am.affinity_stack_quad_coeff * 4);
});

test("P1.2: motivation fallback tiers are sourced from base-costs.json (motivationFallback group)", async () => {
  const base = JSON.parse(readFileSync(BASE_COSTS_JSON, "utf8"));
  const mp = await import("../../packages/runtime/src/personas/allocator/motivation-price-policy.js");
  assert.equal(mp.SIMPLE_MOTIVATION_COST, base.motivationFallback.fallback_simple);
  assert.equal(mp.ADVANCED_MOTIVATION_COST, base.motivationFallback.fallback_advanced);
  assert.equal(mp.DEFAULT_MOTIVATION_COSTS.user_controlled, base.motivationFallback.fallback_user_controlled);
  const cm = await import("../../packages/runtime/src/personas/configurator/cost-model.js");
  assert.equal(cm.COST_DEFAULTS.simpleMotivationCost, base.motivationFallback.fallback_simple);
  assert.equal(cm.COST_DEFAULTS.advancedMotivationCost, base.motivationFallback.fallback_advanced);
});

test("cost-model.js diverges from the price list — pinned, not endorsed", async () => {
  const { COST_DEFAULTS } = await import("../../packages/runtime/src/personas/configurator/cost-model.js");
  const base = JSON.parse(readFileSync(BASE_COSTS_JSON, "utf8"));
  // If these ever match, the systems have been reconciled and this guard is obsolete.
  assert.notEqual(
    COST_DEFAULTS.affinityBaseCost,
    base.affinity.affinity_base,
    "cost-model.js and the price list now agree on affinity base — reconcile and delete this test",
  );
});
