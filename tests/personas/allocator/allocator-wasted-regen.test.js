/**
 * Regen above a vital's max can never be used: regen never fills past max. The
 * Allocator still prices what was asked (no refusal), and its receipt flags the
 * waste so the author sees it. Darren chose "Warn", 2026-10-15.
 */
const assert = require("node:assert/strict");
const { configuratorNormalizeMotivations } = require("../../helpers/configurator-capabilities.js");
const { evaluateConfiguratorSpend, readWastedRegen } = require("../../../packages/runtime/src/personas/allocator/controller.js");
const { buildDefaultPriceList } = require("../../../packages/runtime/src/personas/allocator/default-price-list.js");

const meta = (id) => ({ id, runId: "run-wasted", createdAt: "2026-10-15T00:00:00Z", producedBy: "test" });
const budget = { schema: "agent-kernel/BudgetArtifact", schemaVersion: 1, meta: meta("budget"), budget: { tokens: 1000000 } };

async function receiptFor({ actors = [], layout = { width: 5, height: 5 }, hazards } = {}) {
  const { receipt } = evaluateConfiguratorSpend({
    normalizeMotivations: await configuratorNormalizeMotivations(),
    budget,
    priceList: buildDefaultPriceList(),
    layout,
    actors,
    hazards,
    proposalMeta: meta("proposal"),
    receiptMeta: meta("receipt"),
  });
  return receipt;
}

const delver = (vitals) => ({ id: "delver_1", vitals });

test("regen above max is still priced as asked, and the receipt names the waste for each vital", async () => {
  const receipt = await receiptFor({ actors: [delver({
    health: { current: 10, max: 10, regen: 1 },
    mana: { current: 10, max: 10, regen: 100 },
    stamina: { current: 2, max: 2, regen: 5 },
    durability: { current: 10, max: 10, regen: 10 },
  })] });
  assert.equal(receipt.status, "approved", "nothing is refused");
  const mana = receipt.lineItems.find((item) => item.id === "vital_mana_regen_tick");
  assert.equal(mana.quantity, 100);
  assert.equal(mana.totalCost, 100 * 100 * mana.unitCost, "the asked-for regen is what is charged");

  const wasted = readWastedRegen(receipt);
  assert.deepEqual(wasted.map(({ subjectId, vital, regen, usableRegen }) => ({ subjectId, vital, regen, usableRegen })), [
    { subjectId: "delver_1", vital: "mana", regen: 100, usableRegen: 10 },
    { subjectId: "delver_1", vital: "stamina", regen: 5, usableRegen: 2 },
  ]);
  const manaWaste = wasted.find((entry) => entry.vital === "mana");
  assert.equal(manaWaste.wastedTokens, (100 * 100 - 10 * 10) * mana.unitCost);
});

test("regen at or below max is not flagged", async () => {
  const receipt = await receiptFor({ actors: [delver({
    health: { current: 10, max: 10, regen: 10 },
    mana: { current: 5, max: 5, regen: 5 },
  })] });
  assert.deepEqual(readWastedRegen(receipt), []);
  assert.equal(receipt.lineItems.some((item) => item.detail?.usableRegen !== undefined), false);
});

test("hazards are flagged the same way", async () => {
  const hazards = [{ id: "hazard_1", x: 1, y: 1, vitals: { mana: { current: 4, max: 4, regen: 9 } } }];
  const receipt = await receiptFor({ hazards });
  assert.deepEqual(readWastedRegen(receipt).map(({ subjectId, vital, usableRegen }) => ({ subjectId, vital, usableRegen })),
    [{ subjectId: "hazard_1", vital: "mana", usableRegen: 4 }]);
});

test("a missing receipt reads as no waste", () => {
  assert.deepEqual(readWastedRegen(undefined), []);
  assert.deepEqual(readWastedRegen({ lineItems: [] }), []);
});

// ## TODO: Test Permutations
// - a warden and a delver in one proposal each get their own entry
// - max 0 with regen > 0 flags all of it as wasted
// - a custom price list with a linear regen formula computes wastedTokens linearly
