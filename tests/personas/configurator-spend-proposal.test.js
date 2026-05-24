const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { readFixture } = require("../helpers/fixtures");

const allocatorFixtures = resolve(__dirname, "../fixtures/allocator");

function readAllocatorFixture(name) {
  return JSON.parse(readFileSync(resolve(allocatorFixtures, name), "utf8"));
}

const budget = readFixture("budget-artifact-v1-basic.json");
const priceList = readFixture("price-list-artifact-v1-basic.json");
const proposalBasic = readAllocatorFixture("spend-proposal-v1-basic.json");
const receiptBasic = readAllocatorFixture("spend-receipt-v1-basic.json");
const proposalOverBudget = readAllocatorFixture("spend-proposal-v1-over-budget.json");
const receiptOverBudget = readAllocatorFixture("spend-receipt-v1-over-budget.json");
const proposalVam = readAllocatorFixture("spend-proposal-v1-vam.json");

test("configurator builds spend proposals and validates receipts", async () => {
  const { buildSpendProposal, evaluateConfiguratorSpend } = await import(
    "../../packages/runtime/src/personas/configurator/spend-proposal.js"
  );

  const basicLayout = { width: 9, height: 9, traps: [{ x: 2, y: 2 }] };
  const basicActors = [{ id: "actor_one" }, { id: "actor_two" }];

  const builtProposal = buildSpendProposal({
    meta: proposalBasic.meta,
    layout: basicLayout,
    actors: basicActors,
  });

  assert.deepEqual(builtProposal, proposalBasic);

  const evaluatedBasic = evaluateConfiguratorSpend({
    budget,
    priceList,
    layout: basicLayout,
    actors: basicActors,
    proposalMeta: proposalBasic.meta,
    receiptMeta: receiptBasic.meta,
  });

  assert.deepEqual(evaluatedBasic.receipt, receiptBasic);
  assert.equal(evaluatedBasic.allowed, false);

  const overBudgetLayout = {
    width: 9,
    height: 9,
    traps: Array.from({ length: 30 }, (_, idx) => ({ x: idx, y: idx })),
  };
  const overBudgetActors = Array.from({ length: 50 }, (_, idx) => ({ id: `actor_${idx}` }));

  const evaluatedOverBudget = evaluateConfiguratorSpend({
    budget,
    priceList,
    layout: overBudgetLayout,
    actors: overBudgetActors,
    proposalMeta: proposalOverBudget.meta,
    receiptMeta: receiptOverBudget.meta,
  });

  assert.deepEqual(evaluatedOverBudget.receipt, receiptOverBudget);
  assert.equal(evaluatedOverBudget.allowed, false);

  const vamActors = [
    {
      id: "actor_vam",
      vitals: {
        health: { current: 8, max: 10, regen: 2 },
        mana: { current: 1, max: 3, regen: 0 },
        stamina: { current: 0, max: 4, regen: 1 },
        durability: { current: 0, max: 1, regen: 0 },
      },
      traits: { affinities: { "fire:push": 2, "life:pull": 1 } },
      motivations: ["reflexive"],
    },
  ];

  const builtVam = buildSpendProposal({
    meta: proposalVam.meta,
    actors: vamActors,
  });

  assert.deepEqual(builtVam, proposalVam);
});

test("configurator prices room cards by layout only — affinities on room card have no cost", async () => {
  const { calculateRoomCardUnitCost } = await import(
    "../../packages/runtime/src/personas/configurator/spend-proposal.js"
  );

  const medium = calculateRoomCardUnitCost({
    card: {
      id: "room_medium",
      type: "room",
      source: "room",
      roomSize: "medium",
      count: 1,
      affinity: "dark",
      affinities: [
        { kind: "dark", expression: "emit", stacks: 2 },
        { kind: "water", expression: "emit", stacks: 2 },
      ],
    },
    priceList: { items: [] },
  });

  const large = calculateRoomCardUnitCost({
    card: {
      id: "room_large",
      type: "room",
      source: "room",
      roomSize: "large",
      count: 1,
      affinity: "dark",
      affinities: [
        { kind: "dark", expression: "emit", stacks: 2 },
        { kind: "water", expression: "emit", stacks: 2 },
      ],
    },
    priceList: { items: [] },
  });

  assert.ok(medium.cost >= 0);
  assert.ok(large.cost >= medium.cost);
  assert.equal(large.detail.affinitySpend, undefined, "rooms must not include affinity spend in cost detail");
});
