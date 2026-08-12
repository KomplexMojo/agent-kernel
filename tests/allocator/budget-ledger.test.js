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

test("allocator ledger reuses receipt totalCost for quadratic line items", async () => {
const { updateBudgetLedger } = await import("../../packages/runtime/src/personas/allocator/budget-ledger.js");

const result = updateBudgetLedger({
  receipt: {
    schema: "agent-kernel/BudgetReceiptArtifact",
    schemaVersion: 1,
    meta: {
      id: "receipt_quadratic",
      runId: "run_quadratic",
      createdAt: "2026-04-22T00:00:00.000Z",
      producedBy: "allocator",
    },
    budgetRef: { id: "budget_quadratic", schema: "agent-kernel/BudgetArtifact", schemaVersion: 1 },
    remaining: 100,
    lineItems: [
      {
        id: "affinity_stack",
        kind: "affinity",
        quantity: 4,
        unitCost: 1,
        totalCost: 16,
        status: "approved",
      },
    ],
  },
  spendEvents: [{ id: "affinity_stack", kind: "affinity", quantity: 4 }],
  meta: {
    id: "ledger_quadratic",
    runId: "run_quadratic",
    createdAt: "2026-04-22T00:00:00.000Z",
    producedBy: "allocator",
  },
});

assert.equal(result.ledger.spendEvents[0].totalCost, 16);
assert.equal(result.ledger.remaining, 84);
});
