const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");


const catalogPath = resolve(__dirname, "../fixtures/pool/catalog-basic.json");
const catalogFixture = JSON.parse(readFileSync(catalogPath, "utf8"));



test("allocator selection spend trims over-budget selections deterministically", async () => {
const { evaluateSelectionSpend } = await import("../../packages/runtime/src/personas/allocator/selection-spend.js");
const { mapSummaryToPool } = await import("../../packages/runtime/src/personas/director/pool-mapper.js");

const summary = {
  dungeonAffinity: "fire",
  rooms: [{ motivation: "stationary", affinity: "fire", count: 1 }],
  actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
};

const mapped = mapSummaryToPool({ summary, catalog: catalogFixture });
const result = evaluateSelectionSpend({ selections: mapped.selections, budgetTokens: 250 });

assert.equal(result.spentTokens, 200);
assert.equal(result.remainingBudgetTokens, 50);
assert.equal(result.approvedSelections.length, 1);
assert.equal(result.rejectedSelections.length, 1);
assert.ok(result.warnings?.some((entry) => entry.code === "trimmed"));
});

test("allocator selection spend approves selections when budget allows", async () => {
const { evaluateSelectionSpend } = await import("../../packages/runtime/src/personas/allocator/selection-spend.js");
const { mapSummaryToPool } = await import("../../packages/runtime/src/personas/director/pool-mapper.js");

const summary = {
  dungeonAffinity: "fire",
  rooms: [{ motivation: "stationary", affinity: "fire", count: 1 }],
  actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
};

const mapped = mapSummaryToPool({ summary, catalog: catalogFixture });
const result = evaluateSelectionSpend({ selections: mapped.selections, budgetTokens: 400 });

assert.equal(result.spentTokens, 280);
assert.equal(result.remainingBudgetTokens, 120);
assert.equal(result.approvedSelections.length, 2);
assert.equal(result.rejectedSelections.length, 0);
});


test("allocator selection spend includes actor configuration costs", async () => {
const { evaluateSelectionSpend } = await import("../../packages/runtime/src/personas/allocator/selection-spend.js");
const { mapSummaryToPool } = await import("../../packages/runtime/src/personas/director/pool-mapper.js");

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
const result = evaluateSelectionSpend({ selections: mapped.selections, budgetTokens: 100 });

assert.equal(result.approvedSelections.length, 0);
assert.equal(result.rejectedSelections.length, 1);
assert.equal(result.spentTokens, 0);
assert.equal(result.remainingBudgetTokens, 100);
assert.equal(result.decisions[0].baseUnitCost, 80);
// Updated for design-aligned cost model:
// vitals: 2×8 + 2×4 + 1×4 + 2×2 = 32
// regen: 5×1² + 4×1² = 9 (mana regen 1, stamina regen 1)
// total config: 41
assert.equal(result.decisions[0].configUnitCost, 41);
assert.equal(result.decisions[0].unitCost, 121);
});
