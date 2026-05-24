const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { readFixture } = require("../helpers/fixtures");

const allocatorFixtures = resolve(__dirname, "../fixtures/allocator");

function readAllocatorFixture(name) {
  return JSON.parse(readFileSync(resolve(allocatorFixtures, name), "utf8"));
}

const receipt = readFixture("budget-receipt-artifact-v1-basic.json");
const ledger = readFixture("budget-ledger-artifact-v1-basic.json");
const spendEvents = readAllocatorFixture("spend-events-v1-basic.json").events;


test("allocator ledger updates deterministically", async () => {
const { updateBudgetLedger } = await import("../../packages/runtime/src/personas/allocator/budget-ledger.js");


const result = updateBudgetLedger({ receipt, spendEvents, meta: ledger.meta });
assert.deepEqual(result.ledger, ledger);
});
