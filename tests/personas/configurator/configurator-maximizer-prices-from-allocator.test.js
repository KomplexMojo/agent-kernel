/**
 * WP-5 / CR.7 — the Configurator's budget maximizer holds no price of its own.
 *
 * TWO ALLOWLIST ROWS, ONE MODULE (55 -> 53):
 *   build/orchestrate-build.js            -> configurator/budget-maximizer.js   (D6)
 *   configurator/budget-maximizer.js      -> allocator/validate-spend.js        (D10)
 *
 * The second row is the interesting one. It carried disposition D3 — "CR.9 is the
 * disposition" — and CR.9 CLOSED on 2026-08-05 without clearing it. Nothing reported
 * that: no guard, no gate, no closure check. It surfaced only when the disposition
 * table was re-diffed against the live allowlist.
 *
 * WHY A REFUSAL TEST AND NOT AN OUTPUT DIFFERENTIAL.
 * `maximizeActorBudget` used to read prices with a hardcoded fallback:
 *
 *     getUnitCost(priceMap, "vital", VITAL_POINT_IDS[key], 1)   // <- the 1
 *
 * Every vital in the Allocator's default price list costs EXACTLY 1. So the
 * Configurator's private fallback price and the Allocator's real price are
 * numerically identical, and **no assertion on output can distinguish them** — the
 * maximizer would produce byte-identical results whether it consulted the Allocator
 * or ignored it entirely. This is CR.8's lesson restated: provenance cannot be
 * settled by a differential when the derivation is pure and the numbers agree.
 * The detector has to be a REFUSAL, so that is what these tests assert.
 *
 * The charter rule being enforced: all pricing goes through the Allocator, with no
 * silent fallbacks. A fallback of `1` sitting in a Configurator module is a price
 * constant in the wrong persona that happens to agree with the right one today.
 */
const assert = require("node:assert/strict");

const MAXIMIZER = "../../../packages/runtime/src/personas/configurator/budget-maximizer.js";
const ALLOCATOR = "../../../packages/runtime/src/personas/allocator/persona.js";
const REQUIRE_CLOCK = "../../../packages/runtime/src/personas/_shared/require-clock.js";

async function loadMaximizer() {
  const { maximizeActorBudget } = await import(MAXIMIZER);
  return maximizeActorBudget;
}

function actor(id) {
  return {
    id,
    vitals: {
      health: { current: 1, max: 1, regen: 0 },
      mana: { current: 1, max: 1, regen: 0 },
      stamina: { current: 1, max: 1, regen: 0 },
      durability: { current: 1, max: 1, regen: 0 },
    },
  };
}

/** The Allocator's published pricing surface — the only legitimate source. */
async function allocatorPricing(priceList = null) {
  const { createAllocatorPersona } = await import(ALLOCATOR);
  const { UNUSED_CLOCK } = await import(REQUIRE_CLOCK);
  const { pricing } = createAllocatorPersona({
    ...(priceList ? { priceList } : {}),
    clock: UNUSED_CLOCK,
  });
  return { unitCosts: pricing.unitCosts(), priceItems: pricing.priceMap() };
}

function totalMax(actors) {
  return actors.reduce(
    (sum, a) => sum + Object.values(a.vitals).reduce((s, v) => s + v.max, 0),
    0,
  );
}

test("maximizeActorBudget spends against the Allocator's published prices", async () => {
  const { unitCosts, priceItems } = await allocatorPricing();
  const maximizeActorBudget = await loadMaximizer();
  const result = maximizeActorBudget({
    actors: [actor("a1")],
    remaining: 100,
    unitCosts,
    priceItems,
  });

  assert.ok(Array.isArray(result), "returns an actor array");
  assert.ok(
    totalMax(result) > totalMax([actor("a1")]),
    "a positive budget buys vital points",
  );
});

test("REFUSAL: the maximizer will not price without the Allocator's unit costs", async () => {
  const { priceItems } = await allocatorPricing();
  const maximizeActorBudget = await loadMaximizer();

  assert.throws(
    () => maximizeActorBudget({
      actors: [actor("a1")],
      remaining: 100,
      priceItems,
    }),
    /unitCosts/,
    "no Allocator unit costs must be a refusal, not a fallback price",
  );
});

test("REFUSAL: the maximizer will not price without the Allocator's price items", async () => {
  const { unitCosts } = await allocatorPricing();
  const maximizeActorBudget = await loadMaximizer();

  assert.throws(
    () => maximizeActorBudget({
      actors: [actor("a1")],
      remaining: 100,
      unitCosts,
    }),
    /priceItems/,
    "no Allocator price items must be a refusal, not a fallback price",
  );
});

test("REFUSAL: a vital the Allocator did not price is a refusal, not a silent 1", async () => {
  // This is the assertion the old `fallback = 1` made unwritable. Remove
  // health's price from the Allocator's list and the maximizer must refuse
  // rather than quietly charging its own number.
  const { unitCosts, priceItems } = await allocatorPricing();
  const maximizeActorBudget = await loadMaximizer();
  const withoutHealth = new Map(unitCosts);
  withoutHealth.delete("vital:vital_health_point");

  assert.throws(
    () => maximizeActorBudget({
      actors: [actor("a1")],
      remaining: 100,
      unitCosts: withoutHealth,
      priceItems,
    }),
    /vital_health_point/,
    "an unpriced vital must name itself in the refusal",
  );
});

test("REFUSAL: a regen tick the Allocator did not price is a refusal, not a skip", async () => {
  const { unitCosts, priceItems } = await allocatorPricing();
  const maximizeActorBudget = await loadMaximizer();
  const withoutRegen = new Map(priceItems);
  withoutRegen.delete("vital:vital_stamina_regen_tick");

  assert.throws(
    () => maximizeActorBudget({
      actors: [actor("a1")],
      remaining: 100,
      unitCosts,
      priceItems: withoutRegen,
    }),
    /vital_stamina_regen_tick/,
    "an unpriced regen tick must refuse rather than silently skip that vital",
  );
});

test("TEETH: the maximizer tracks the Allocator's price, it does not assume 1", async () => {
  // With every vital at the default unit cost of 1, a maximizer that ignored the
  // Allocator entirely would score identically. Raising the Allocator's price is
  // what separates them: the same budget must buy strictly fewer points.
  const base = await allocatorPricing();
  const maximizeActorBudget = await loadMaximizer();
  const dearer = new Map(base.unitCosts);
  for (const key of [
    "vital:vital_health_point",
    "vital:vital_mana_point",
    "vital:vital_stamina_point",
    "vital:vital_durability_point",
  ]) {
    dearer.set(key, 4);
  }

  const cheap = maximizeActorBudget({
    actors: [actor("a1")],
    remaining: 400,
    unitCosts: base.unitCosts,
    priceItems: base.priceItems,
  });
  const expensive = maximizeActorBudget({
    actors: [actor("a1")],
    remaining: 400,
    unitCosts: dearer,
    priceItems: base.priceItems,
  });

  assert.ok(
    totalMax(expensive) < totalMax(cheap),
    `quadrupling the Allocator's vital price must buy fewer points ` +
    `(cheap=${totalMax(cheap)} expensive=${totalMax(expensive)})`,
  );
});

test("a zero or negative budget is returned untouched, priced or not", async () => {
  const { unitCosts, priceItems } = await allocatorPricing();
  const maximizeActorBudget = await loadMaximizer();
  const actors = [actor("a1")];
  assert.equal(
    maximizeActorBudget({ actors, remaining: 0, unitCosts, priceItems }),
    actors,
    "no budget means no maximization and no pricing question to answer",
  );
});

// ## TODO: Test Permutations
// - multi-actor rosters: remainder distribution across 2, 3 and 11 scalable actors
// - actors with a missing/!object `vitals` bag mixed with scalable ones
// - quadratic vs linear regen formula on the same budget
// - budgets that divide exactly vs leave a remainder in each of the three phases
