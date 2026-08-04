const assert = require("node:assert/strict");
// CR.9 M3: the Allocator refuses to price raw motivations without the Configurator's
// vocabulary, so this test injects exactly what production injects.
const { configuratorNormalizeMotivations } = require("../helpers/configurator-capabilities.js");



test("motivation costs flow through calculateActorConfigurationUnitCost", async () => {
const { calculateActorConfigurationUnitCost } = await import("../../packages/runtime/src/personas/allocator/spend-proposal.js");
const { buildDefaultPriceList } = await import("../../packages/runtime/src/personas/allocator/default-price-list.js");
const { normalizePriceItems } = await import("../../packages/runtime/src/personas/allocator/validate-spend.js");
const normalizeMotivations = await configuratorNormalizeMotivations();
const defaultPriceMap = normalizePriceItems(
  buildDefaultPriceList({ createdAt: "2026-07-20T00:00:00.000Z" }),
);

// ── motivation costs are included in actor configuration cost ──
{
  const entry = {
    vitals: {
      health: { max: 10, regen: 0 },
      mana: { max: 5, regen: 1 },
      stamina: { max: 0, regen: 0 },
      durability: { max: 0, regen: 0 },
    },
    affinities: [],
    motivations: ["reflexive"],
  };
  const result = calculateActorConfigurationUnitCost({ entry, priceMap: defaultPriceMap, normalizeMotivations });
  assert.ok(result.cost > 0, "cost should be positive");
  assert.ok(result.detail.motivationCost > 0, "motivationCost should be reported");
  assert.equal(result.detail.motivationCost, 1);
  const motivationLineItems = result.detail.lineItems.filter((li) => li.category === "motivation");
  assert.equal(motivationLineItems.length, 1);
  assert.equal(motivationLineItems[0].id, "motivation_reflexive");
}

// ── no motivations means zero motivation cost ──
{
  const entry = {
    vitals: { health: { max: 10 } },
    affinities: [],
  };
  const result = calculateActorConfigurationUnitCost({ entry, priceMap: defaultPriceMap, normalizeMotivations });
  assert.equal(result.detail.motivationCost, 0);
}

// ── multi-motivation stack cost is additive ──
{
  const entry = {
    vitals: { health: { max: 1 } },
    affinities: [],
    motivations: ["random", "attacking", "goal_oriented"],
  };
  const result = calculateActorConfigurationUnitCost({ entry, priceMap: defaultPriceMap, normalizeMotivations });
  // random(1) + attacking(3) + goal_oriented(5) = 9
  assert.equal(result.detail.motivationCost, 9);
}

// ── motivation cost uses priceMap when available ──
{
  const priceMap = new Map(defaultPriceMap);
  priceMap.set("motivation:motivation_reflexive", 50);
  const entry = {
    vitals: { health: { max: 1 } },
    affinities: [],
    motivations: ["reflexive"],
  };
  const result = calculateActorConfigurationUnitCost({ entry, priceMap, normalizeMotivations });
  assert.equal(result.detail.motivationCost, 50);
}

// ── structured motivation objects work ──
{
  const entry = {
    vitals: { health: { max: 1 } },
    affinities: [],
    motivations: [{ kind: "strategy_focused", intensity: 2 }],
  };
  const result = calculateActorConfigurationUnitCost({ entry, priceMap: defaultPriceMap, normalizeMotivations });
  // strategy_focused(10) * intensity(2) = 20
  assert.equal(result.detail.motivationCost, 20);
}

// ── motivation cost preserves legacy cognition ordering ──
{
  const reflexiveEntry = { vitals: { health: { max: 1 } }, motivations: ["reflexive"] };
  const goalEntry = { vitals: { health: { max: 1 } }, motivations: ["goal_oriented"] };
  const strategyEntry = { vitals: { health: { max: 1 } }, motivations: ["strategy_focused"] };
  const pm = defaultPriceMap;
  const r1 = calculateActorConfigurationUnitCost({ entry: reflexiveEntry, priceMap: pm, normalizeMotivations });
  const r2 = calculateActorConfigurationUnitCost({ entry: goalEntry, priceMap: pm, normalizeMotivations });
  const r3 = calculateActorConfigurationUnitCost({ entry: strategyEntry, priceMap: pm, normalizeMotivations });
  assert.ok(r1.detail.motivationCost < r2.detail.motivationCost, "reflexive < goal_oriented");
  assert.ok(r2.detail.motivationCost < r3.detail.motivationCost, "goal_oriented < strategy_focused");
}

// An incomplete map reports the missing entries instead of falling back.
{
  const result = calculateActorConfigurationUnitCost({
    entry: { vitals: { health: { max: 1 } }, motivations: ["reflexive"] },
    priceMap: new Map(),
    normalizeMotivations,
  });
  assert.equal(result.cost, 0);
  assert.ok(result.errors?.some((entry) => entry.includes("vital_health_point")));
  assert.ok(result.errors?.some((entry) => entry.includes("motivation_reflexive")));
}
});
