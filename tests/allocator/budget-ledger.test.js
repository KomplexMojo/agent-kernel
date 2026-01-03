const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");
const { readFixture } = require("../helpers/fixtures");

const ledgerModule = moduleUrl("packages/runtime/src/personas/allocator/budget-ledger.js");
const allocatorFixtures = resolve(__dirname, "../fixtures/allocator");

function readAllocatorFixture(name) {
  return JSON.parse(readFileSync(resolve(allocatorFixtures, name), "utf8"));
}

const receipt = readFixture("budget-receipt-artifact-v1-basic.json");
const ledger = readFixture("budget-ledger-artifact-v1-basic.json");
const spendEvents = readAllocatorFixture("spend-events-v1-basic.json").events;

const script = `
import assert from "node:assert/strict";
import { updateBudgetLedger } from ${JSON.stringify(ledgerModule)};

const receipt = ${JSON.stringify(receipt)};
const ledger = ${JSON.stringify(ledger)};
const spendEvents = ${JSON.stringify(spendEvents)};

const result = updateBudgetLedger({ receipt, spendEvents, meta: ledger.meta });
assert.deepEqual(result.ledger, ledger);
`;

test("allocator ledger updates deterministically", () => {
  runEsm(script);
});
