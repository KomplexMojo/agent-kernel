const test = require("node:test");
const assert = require("node:assert/strict");

test("buildDesignSpendLedger computes level, actor base, and actor config categories", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/configurator/spend-proposal.js"
  );

  const summary = {
    budgetTokens: 1000,
    layout: { wallTiles: 10, floorTiles: 10, hallwayTiles: 10 },
  };
  const actorSet = [
    { source: "room", id: "room_1", role: "stationary", affinity: "fire", count: 2, tokenHint: 50 },
    {
      source: "actor",
      id: "actor_1",
      role: "attacking",
      affinity: "fire",
      count: 2,
      tokenHint: 80,
      affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
      vitals: {
        health: { current: 4, max: 4, regen: 1 },
        mana: { current: 2, max: 2, regen: 1 },
        stamina: { current: 1, max: 1, regen: 0 },
        durability: { current: 1, max: 1, regen: 0 },
      },
    },
  ];

  const ledger = buildDesignSpendLedger({
    summary,
    actorSet,
    budgeting: {
      levelBudgetTokens: 400,
      actorBudgetTokens: 300,
    },
  });

  assert.equal(ledger.totalSpentTokens, 378);
  assert.equal(ledger.remainingTokens, 622);
  assert.equal(ledger.overBudget, false);
  assert.equal(ledger.categories.levelConfig.spentTokens, 130);
  assert.equal(ledger.categories.actorBase.spentTokens, 160);
  assert.equal(ledger.categories.actorConfiguration.spentTokens, 88);
  assert.ok(ledger.lineItems.some((entry) => entry.category === "levelConfig"));
  assert.ok(ledger.lineItems.some((entry) => entry.category === "actorBase"));
  assert.ok(ledger.lineItems.some((entry) => entry.category === "actorConfiguration"));
});

test("buildDesignSpendLedger flags over-budget totals", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/configurator/spend-proposal.js"
  );

  const ledger = buildDesignSpendLedger({
    summary: {
      budgetTokens: 100,
      layout: { wallTiles: 50, floorTiles: 50, hallwayTiles: 50 },
    },
    actorSet: [],
  });

  assert.equal(ledger.overBudget, true);
  assert.ok(ledger.totalOverBudgetBy > 0);
});

test("buildDesignSpendLedger prices actor configuration from price list items", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/configurator/spend-proposal.js"
  );

  const ledger = buildDesignSpendLedger({
    summary: {
      budgetTokens: 1000,
      layout: { wallTiles: 10, floorTiles: 10, hallwayTiles: 10 },
    },
    actorSet: [
      {
        source: "actor",
        id: "actor_attacking_1",
        role: "attacking",
        affinity: "fire",
        count: 3,
        tokenHint: 5,
        affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
        vitals: {
          health: { current: 30, max: 30, regen: 3 },
          mana: { current: 0, max: 0, regen: 0 },
          stamina: { current: 0, max: 0, regen: 0 },
          durability: { current: 0, max: 0, regen: 0 },
        },
      },
    ],
    priceList: {
      schema: "agent-kernel/PriceList",
      schemaVersion: 1,
      items: [
        { id: "vital_health_point", kind: "vital", costTokens: 1 },
        { id: "vital_health_regen_tick", kind: "vital", costTokens: 4 },
        { id: "affinity_stack", kind: "affinity", costTokens: 6 },
        { id: "affinity_expression_externalize", kind: "affinity", costTokens: 7 },
      ],
    },
  });

  const configLine = ledger.lineItems.find((entry) => entry.category === "actorConfiguration");
  assert.ok(configLine);
  assert.equal(configLine.unitCostTokens, 94);
  assert.equal(configLine.spendTokens, 282);
  assert.equal(configLine.detail.vitalPoints, 30);
  assert.equal(configLine.detail.regenPoints, 3);
  assert.equal(configLine.detail.affinityStacks, 2);
  assert.equal(configLine.detail.pricingSource, "price-list");
  assert.ok(configLine.unitCostTokens >= configLine.detail.vitalPoints);
});
