const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const spendModule = moduleUrl("packages/runtime/src/personas/configurator/spend-proposal.js");

const script = `
import assert from "node:assert/strict";
import { calculateActorConfigurationUnitCost } from ${JSON.stringify(spendModule)};

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
  const result = calculateActorConfigurationUnitCost({ entry, priceMap: new Map() });
  assert.ok(result.cost > 0, "cost should be positive");
  assert.ok(result.detail.motivationCost > 0, "motivationCost should be reported");
  // reflexive = simple tier = 25 tokens (design §6.6)
  assert.equal(result.detail.motivationCost, 25);
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
  const result = calculateActorConfigurationUnitCost({ entry, priceMap: new Map() });
  assert.equal(result.detail.motivationCost, 0);
}

// ── multi-motivation stack cost is additive ──
{
  const entry = {
    vitals: { health: { max: 1 } },
    affinities: [],
    motivations: ["random", "attacking", "goal_oriented"],
  };
  const result = calculateActorConfigurationUnitCost({ entry, priceMap: new Map() });
  // random(25) + attacking(25) + goal_oriented(50) = 100
  assert.equal(result.detail.motivationCost, 100);
}

// ── motivation cost uses priceMap when available ──
{
  const priceMap = new Map();
  priceMap.set("motivation:motivation_reflexive", 50);
  const entry = {
    vitals: { health: { max: 1 } },
    affinities: [],
    motivations: ["reflexive"],
  };
  const result = calculateActorConfigurationUnitCost({ entry, priceMap });
  assert.equal(result.detail.motivationCost, 50);
}

// ── structured motivation objects work ──
{
  const entry = {
    vitals: { health: { max: 1 } },
    affinities: [],
    motivations: [{ kind: "strategy_focused", intensity: 2 }],
  };
  const result = calculateActorConfigurationUnitCost({ entry, priceMap: new Map() });
  // strategy_focused(50) * intensity(2) = 100
  assert.equal(result.detail.motivationCost, 100);
}

// ── motivation cost preserves legacy cognition ordering ──
{
  const reflexiveEntry = { vitals: { health: { max: 1 } }, motivations: ["reflexive"] };
  const goalEntry = { vitals: { health: { max: 1 } }, motivations: ["goal_oriented"] };
  const strategyEntry = { vitals: { health: { max: 1 } }, motivations: ["strategy_focused"] };
  const pm = new Map();
  const r1 = calculateActorConfigurationUnitCost({ entry: reflexiveEntry, priceMap: pm });
  const r2 = calculateActorConfigurationUnitCost({ entry: goalEntry, priceMap: pm });
  const r3 = calculateActorConfigurationUnitCost({ entry: strategyEntry, priceMap: pm });
  assert.ok(r1.detail.motivationCost < r2.detail.motivationCost, "reflexive < goal_oriented");
  // goal_oriented and strategy_focused are both advanced tier (50 tokens each)
  assert.ok(r2.detail.motivationCost <= r3.detail.motivationCost, "goal_oriented <= strategy_focused");
}
`;

test("motivation costs flow through calculateActorConfigurationUnitCost", () => {
  runEsm(script);
});
