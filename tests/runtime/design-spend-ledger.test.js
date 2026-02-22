const test = require("node:test");
const assert = require("node:assert/strict");

test("buildDesignSpendLedger computes level, actor base, and actor config categories", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/configurator/spend-proposal.js"
  );

  const summary = {
    budgetTokens: 1000,
    layout: { floorTiles: 10, hallwayTiles: 10 },
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

  assert.equal(ledger.totalSpentTokens, 368);
  assert.equal(ledger.remainingTokens, 632);
  assert.equal(ledger.overBudget, false);
  assert.equal(ledger.categories.levelConfig.spentTokens, 120);
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
      layout: { floorTiles: 60, hallwayTiles: 60 },
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
      layout: { floorTiles: 10, hallwayTiles: 10 },
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

test("buildDesignSpendLedger treats tokenHint as per-unit and multiplies by count", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/configurator/spend-proposal.js"
  );

  const ledger = buildDesignSpendLedger({
    summary: {
      budgetTokens: 77000,
      layout: {},
    },
    actorSet: [
      {
        id: "actor_patrolling_1",
        source: "actor",
        role: "patrolling",
        affinity: "wind",
        count: 9,
        tokenHint: 7700,
        affinities: [
          {
            kind: "wind",
            expression: "push",
            stacks: 2,
          },
        ],
        vitals: {
          health: {
            current: 10,
            max: 10,
            regen: 1,
          },
          mana: {
            current: 5,
            max: 5,
            regen: 1,
          },
          stamina: {
            current: 8,
            max: 8,
            regen: 2,
          },
          durability: {
            current: 6,
            max: 6,
            regen: 0,
          },
        },
        setupMode: "auto",
      },
    ],
  });

  assert.equal(ledger.categories.actorBase.spentTokens, 69300);
  assert.equal(ledger.categories.actorConfiguration.spentTokens, 621);
  assert.equal(ledger.totalSpentTokens, 69921);
  assert.equal(ledger.remainingTokens, 7079);
  assert.equal(ledger.overBudget, false);
});
