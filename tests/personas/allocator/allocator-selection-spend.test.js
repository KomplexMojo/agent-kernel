const assert = require("node:assert/strict");
// CR.9 M3: selection spend prices raw actor motivations, and the Allocator refuses
// without the Configurator's vocabulary — injected here exactly as production does.
const { configuratorNormalizeMotivations } = require("../../helpers/configurator-capabilities.js");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");


const catalogPath = resolve(__dirname, "../../fixtures/pool/catalog-basic.json");
const catalogFixture = JSON.parse(readFileSync(catalogPath, "utf8"));



test("allocator selection spend trims over-budget selections deterministically", async () => {
const { evaluateSelectionSpend } = await import("../../../packages/runtime/src/personas/allocator/selection-spend.js");
const normalizeMotivations = await configuratorNormalizeMotivations();
const { mapSummaryToPool } = await import("../../../packages/runtime/src/personas/director/pool-mapper.js");

const summary = {
  dungeonAffinity: "fire",
  rooms: [{ motivation: "stationary", affinity: "fire", count: 1 }],
  actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
};

const mapped = mapSummaryToPool({ summary, catalog: catalogFixture });
const result = evaluateSelectionSpend({ selections: mapped.selections, budgetTokens: 250, normalizeMotivations });

assert.equal(result.spentTokens, 200);
assert.equal(result.remainingBudgetTokens, 50);
assert.equal(result.approvedSelections.length, 1);
assert.equal(result.rejectedSelections.length, 1);
assert.ok(result.warnings?.some((entry) => entry.code === "trimmed"));
});

test("allocator selection spend approves selections when budget allows", async () => {
const { evaluateSelectionSpend } = await import("../../../packages/runtime/src/personas/allocator/selection-spend.js");
const normalizeMotivations = await configuratorNormalizeMotivations();
const { mapSummaryToPool } = await import("../../../packages/runtime/src/personas/director/pool-mapper.js");

const summary = {
  dungeonAffinity: "fire",
  rooms: [{ motivation: "stationary", affinity: "fire", count: 1 }],
  actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
};

const mapped = mapSummaryToPool({ summary, catalog: catalogFixture });
const result = evaluateSelectionSpend({ selections: mapped.selections, budgetTokens: 400, normalizeMotivations });

assert.equal(result.spentTokens, 280);
assert.equal(result.remainingBudgetTokens, 120);
assert.equal(result.approvedSelections.length, 2);
assert.equal(result.rejectedSelections.length, 0);
});


test("allocator selection spend includes actor configuration costs", async () => {
const { evaluateSelectionSpend } = await import("../../../packages/runtime/src/personas/allocator/selection-spend.js");
const normalizeMotivations = await configuratorNormalizeMotivations();
const { mapSummaryToPool } = await import("../../../packages/runtime/src/personas/director/pool-mapper.js");
const { buildDefaultPriceList } = await import("../../../packages/runtime/src/personas/allocator/default-price-list.js");

const summary = {
  dungeonAffinity: "fire",
  actors: [{
    motivation: "patrolling",
    affinity: "wind",
    count: 1,
    vitals: {
      health: { current: 8, max: 8, regen: 0 },
      mana: { current: 4, max: 4, regen: 1 },
      stamina: { current: 4, max: 4, regen: 1 },
      durability: { current: 2, max: 2, regen: 0 },
    },
  }],
};

const mapped = mapSummaryToPool({ summary, catalog: catalogFixture });
const result = evaluateSelectionSpend({
  selections: mapped.selections,
  budgetTokens: 103,
  priceList: buildDefaultPriceList({ createdAt: "2026-07-20T00:00:00.000Z" }),
  normalizeMotivations,
});

assert.equal(result.approvedSelections.length, 1);
assert.equal(result.rejectedSelections.length, 0);
assert.equal(result.spentTokens, 103);
assert.equal(result.remainingBudgetTokens, 0);
assert.equal(result.decisions[0].baseUnitCost, 80);
// Vitals: 8 + 4 + 4 + 2 = 18; regen: 1² + 1² = 2; patrolling motivation: 3.
assert.equal(result.decisions[0].configUnitCost, 23);
assert.equal(result.decisions[0].unitCost, 103);
});
