const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const spendModulePath = moduleUrl("packages/runtime/src/personas/allocator/selection-spend.js");
const mapperModulePath = moduleUrl("packages/runtime/src/personas/director/pool-mapper.js");

const catalogPath = resolve(__dirname, "../fixtures/pool/catalog-basic.json");
const catalogFixture = JSON.parse(readFileSync(catalogPath, "utf8"));

const trimScript = `
import assert from "node:assert/strict";
import { evaluateSelectionSpend } from ${JSON.stringify(spendModulePath)};
import { mapSummaryToPool } from ${JSON.stringify(mapperModulePath)};

const summary = {
  dungeonAffinity: "fire",
  rooms: [{ motivation: "stationary", affinity: "fire", count: 1 }],
  actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
};

const mapped = mapSummaryToPool({ summary, catalog: ${JSON.stringify(catalogFixture)} });
const result = evaluateSelectionSpend({ selections: mapped.selections, budgetTokens: 250 });

assert.equal(result.spentTokens, 200);
assert.equal(result.remainingBudgetTokens, 50);
assert.equal(result.approvedSelections.length, 1);
assert.equal(result.rejectedSelections.length, 1);
assert.ok(result.warnings?.some((entry) => entry.code === "trimmed"));
`;

const approveScript = `
import assert from "node:assert/strict";
import { evaluateSelectionSpend } from ${JSON.stringify(spendModulePath)};
import { mapSummaryToPool } from ${JSON.stringify(mapperModulePath)};

const summary = {
  dungeonAffinity: "fire",
  rooms: [{ motivation: "stationary", affinity: "fire", count: 1 }],
  actors: [{ motivation: "patrolling", affinity: "wind", count: 1 }],
};

const mapped = mapSummaryToPool({ summary, catalog: ${JSON.stringify(catalogFixture)} });
const result = evaluateSelectionSpend({ selections: mapped.selections, budgetTokens: 400 });

assert.equal(result.spentTokens, 280);
assert.equal(result.remainingBudgetTokens, 120);
assert.equal(result.approvedSelections.length, 2);
assert.equal(result.rejectedSelections.length, 0);
`;

test("allocator selection spend trims over-budget selections deterministically", () => {
  runEsm(trimScript);
});

test("allocator selection spend approves selections when budget allows", () => {
  runEsm(approveScript);
});
