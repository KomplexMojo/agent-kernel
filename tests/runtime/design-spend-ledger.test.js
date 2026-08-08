const assert = require("node:assert/strict");
// CR.9 M3: ledgers price raw actor motivations, and the Allocator refuses without the
// Configurator's vocabulary. Injected here exactly as production injects it.
const { configuratorNormalizeMotivations } = require("../helpers/configurator-capabilities.js");
// D8 follow-up: a ledger built from CARDS needs the Director's translation, and the
// Allocator refuses without it. Injected here exactly as production injects it.
const { directorResolveSummary } = require("../helpers/director-capabilities.js");

test("buildDesignSpendLedger computes level, actor base, and actor config categories", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const normalizeMotivations = await configuratorNormalizeMotivations();

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
    normalizeMotivations,
    summary,
    actorSet,
    budgeting: {
      levelBudgetTokens: 400,
      actorBudgetTokens: 300,
    },
  });

  // P1.4 unified list: vitals 4+2+1+1=8, regen 1²+1²=2, affinity 10+2²+35=49 → 59/unit × 2 = 118
  // CR.9 M5: levelConfig 110 → 120 and the total 388 → 398. The layout is 10 floor + 10
  // HALLWAY tiles; hallway tiles used to be zeroed before pricing, so half this layout was
  // free. They now cost what floor tiles cost.
  assert.equal(ledger.totalSpentTokens, 398);
  assert.equal(ledger.remainingTokens, 602);
  assert.equal(ledger.overBudget, false);
  assert.equal(ledger.categories.levelConfig.spentTokens, 120);
  assert.equal(ledger.categories.actorBase.spentTokens, 160);
  assert.equal(ledger.categories.actorConfiguration.spentTokens, 118);
  assert.ok(ledger.lineItems.some((entry) => entry.category === "levelConfig"));
  assert.ok(ledger.lineItems.some((entry) => entry.category === "actorBase"));
  assert.ok(ledger.lineItems.some((entry) => entry.category === "actorConfiguration"));
});

test("buildDesignSpendLedger flags over-budget totals", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const normalizeMotivations = await configuratorNormalizeMotivations();

  const ledger = buildDesignSpendLedger({
    normalizeMotivations,
    summary: {
      budgetTokens: 100,
      layout: { floorTiles: 120, hallwayTiles: 60 },
    },
    actorSet: [],
  });

  assert.equal(ledger.overBudget, true);
  assert.ok(ledger.totalOverBudgetBy > 0);
});

test("buildDesignSpendLedger prices actor configuration from price list items", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const normalizeMotivations = await configuratorNormalizeMotivations();

  const ledger = buildDesignSpendLedger({
    normalizeMotivations,
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
        // CR.9 M5: a list that prices no tiles is INCOMPLETE and the Allocator now refuses
        // it rather than completing it from a contracts default (CR.1's last entry).
        { id: "tile_floor", kind: "tile", costTokens: 1 },
        { id: "tile_hallway", kind: "tile", costTokens: 1 },
        { id: "vital_health_point", kind: "vital", costTokens: 1 },
        { id: "vital_health_regen_tick", kind: "vital", costTokens: 4 },
        { id: "affinity_base", kind: "affinity", costTokens: 8 },
        { id: "affinity_stack", kind: "affinity", costTokens: 6 },
        { id: "affinity_expression_externalize", kind: "affinity", costTokens: 7 },
      ],
    },
  });

  const configLine = ledger.lineItems.find((entry) => entry.category === "actorConfiguration");
  assert.ok(configLine);
  // P1.4: custom items without a formula price linearly.
  // vitals 30×1=30, regen 3×4=12, affinity base 8 + stacks 2×6 + push 7 = 27 → 69/unit × 3 = 207
  assert.equal(configLine.unitCostTokens, 69);
  assert.equal(configLine.spendTokens, 207);
  assert.equal(configLine.detail.vitalPoints, 30);
  assert.equal(configLine.detail.regenPoints, 3);
  assert.equal(configLine.detail.affinityStacks, 2);
  assert.equal(configLine.detail.pricingSource, "price-list");
  assert.ok(configLine.unitCostTokens >= configLine.detail.vitalPoints);
});

test("buildDesignSpendLedger treats tokenHint as per-unit and multiplies by count", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const normalizeMotivations = await configuratorNormalizeMotivations();

  const ledger = buildDesignSpendLedger({
    normalizeMotivations,
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
  // P1.4 unified list: vitals 10+5+8+6=29, regen 1²+1²+2²=6, affinity 10+2²+35=49 → 84/unit × 9 = 756
  assert.equal(ledger.categories.actorConfiguration.spentTokens, 756);
  assert.equal(ledger.totalSpentTokens, 70056);
  assert.equal(ledger.remainingTokens, 6944);
  assert.equal(ledger.overBudget, false);
});

test("buildDesignSpendLedger uses shared room-card layout budget when cardSet is provided", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const normalizeMotivations = await configuratorNormalizeMotivations();
  // CR.9 M2: the Allocator prices room geometry, it does not derive it — the
  // Configurator's derivation is injected, as production wires it.
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/persona.js"
  );
  const deriveRoomLayout = createConfiguratorPersona({ clock: () => "2026-08-04T00:00:00.000Z" }).deriveRoomLayout;
  const resolveSummary = await directorResolveSummary();

  const low = buildDesignSpendLedger({
    normalizeMotivations,
    summary: {
      dungeonAffinity: "fire",
      budgetTokens: 500,
      cardSet: [
        { id: "room_small", type: "room", affinity: "fire", roomSize: "small", count: 1 },
      ],
    },
    deriveRoomLayout,
    resolveSummary,
  });

  const high = buildDesignSpendLedger({
    normalizeMotivations,
    summary: {
      dungeonAffinity: "fire",
      budgetTokens: 500,
      cardSet: [
        { id: "room_small", type: "room", affinity: "fire", roomSize: "small", count: 3 },
      ],
    },
    deriveRoomLayout,
    resolveSummary,
  });

  assert.ok(high.categories.levelConfig.spentTokens > low.categories.levelConfig.spentTokens);
  assert.ok(high.remainingTokens < low.remainingTokens);
  assert.equal(high.overBudget, high.totalSpentTokens > high.budgetTokens);
});

test("buildDesignSpendLedger charges rooms layout cost only — no affinity cost", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const normalizeMotivations = await configuratorNormalizeMotivations();
  // CR.9 M2: the Allocator prices room geometry, it does not derive it — the
  // Configurator's derivation is injected, as production wires it.
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/persona.js"
  );
  const deriveRoomLayout = createConfiguratorPersona({ clock: () => "2026-08-04T00:00:00.000Z" }).deriveRoomLayout;

  const ledger = buildDesignSpendLedger({
    normalizeMotivations,
    summary: {
      budgetTokens: 1000,
      cardSet: [
        {
          id: "room_fire",
          type: "room",
          source: "room",
          count: 1,
          affinity: "fire",
          affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
          roomSize: "small",
        },
      ],
    },
    priceList: {
      schema: "agent-kernel/PriceList",
      schemaVersion: 1,
      items: [
        { id: "tile_floor", kind: "tile", costTokens: 1 },
        // CR.9 M5: every tile field needs a price — an incomplete list is a refusal.
        { id: "tile_hallway", kind: "tile", costTokens: 1 },
        { id: "affinity_stack", kind: "affinity", costTokens: 10 },
        { id: "affinity_expression_externalize", kind: "affinity", costTokens: 10 },
      ],
    },
    deriveRoomLayout,
    resolveSummary: await directorResolveSummary(),
  });

  const affinityLines = ledger.lineItems.filter(
    (entry) => entry.category === "levelConfig" && String(entry.id).includes("room_fire") && entry.detail?.affinityCostScale !== undefined,
  );
  assert.equal(affinityLines.length, 0, "rooms must not generate affinity cost line items");
});

// ---------------------------------------------------------------------------
// D8 follow-up — the Allocator does not translate card sets.
//
// These three tests are the teeth on `AllocatorSummaryResolutionError`. Without them the
// refusal is untestable-by-success: every production caller now injects `resolveSummary`,
// so deleting the guard would change nothing observable — the M5b.2a′ lesson ("making all
// callers correct is what leaves a refusal untested") applied at the moment of writing.
//
// The third test is the one that matters most: a summary with no cards must still price,
// with no capability at all. A refusal that fires on every input is not a boundary, it is
// an outage, and this branch has shipped guards whose scope was wider than their rule.
// ---------------------------------------------------------------------------

test("buildDesignSpendLedger REFUSES to price a card set without the Director's translation", async () => {
  const { buildDesignSpendLedger, AllocatorSummaryResolutionError } = await import(
    "../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const normalizeMotivations = await configuratorNormalizeMotivations();
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/persona.js"
  );
  const deriveRoomLayout = createConfiguratorPersona({ clock: () => "2026-08-04T00:00:00.000Z" }).deriveRoomLayout;

  assert.throws(
    () => buildDesignSpendLedger({
      normalizeMotivations,
      deriveRoomLayout,
      summary: {
        dungeonAffinity: "fire",
        budgetTokens: 500,
        cardSet: [
          { id: "room_small", type: "room", affinity: "fire", roomSize: "small", count: 1 },
        ],
      },
    }),
    (error) => error instanceof AllocatorSummaryResolutionError
      && error.code === "allocator_summary_resolution_required",
  );
});

test("buildDesignSpendLedger refuses the `cards` spelling of a card set too", async () => {
  const { buildDesignSpendLedger, AllocatorSummaryResolutionError } = await import(
    "../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const normalizeMotivations = await configuratorNormalizeMotivations();

  // The Director's `readCardSet` accepts `cardSet` OR `cards`. A guard that knew only the
  // first spelling would let the second past and quietly price an untranslated summary —
  // the recurring "guard matches one syntax of the defect" trap on this branch.
  assert.throws(
    () => buildDesignSpendLedger({
      normalizeMotivations,
      summary: {
        budgetTokens: 500,
        cards: [
          { id: "room_small", type: "room", affinity: "fire", roomSize: "small", count: 1 },
        ],
      },
    }),
    (error) => error instanceof AllocatorSummaryResolutionError,
  );
});

test("buildDesignSpendLedger prices a card-free summary with NO resolveSummary", async () => {
  const { buildDesignSpendLedger } = await import(
    "../../packages/runtime/src/personas/allocator/spend-proposal.js"
  );
  const normalizeMotivations = await configuratorNormalizeMotivations();

  // Nothing to translate ⇒ nothing to ask the Director for. An empty card set is the
  // same case: the Director itself returns the summary untouched rather than resolving.
  const ledger = buildDesignSpendLedger({
    normalizeMotivations,
    summary: { budgetTokens: 1000, cardSet: [], layout: { floorTiles: 10, hallwayTiles: 10 } },
    actorSet: [
      { source: "room", id: "room_1", role: "stationary", affinity: "fire", count: 2, tokenHint: 50 },
    ],
  });

  assert.equal(ledger.budgetTokens, 1000);
  assert.ok(ledger.categories.levelConfig.spentTokens > 0);
});
