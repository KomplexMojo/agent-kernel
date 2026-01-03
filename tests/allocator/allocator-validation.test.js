const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");
const { readFixture } = require("../helpers/fixtures");

const allocatorModule = moduleUrl("packages/runtime/src/personas/allocator/validate-spend.js");
const allocatorFixtures = resolve(__dirname, "../fixtures/allocator");

function readAllocatorFixture(name) {
  return JSON.parse(readFileSync(resolve(allocatorFixtures, name), "utf8"));
}

const budget = readFixture("budget-artifact-v1-basic.json");
const priceList = readFixture("price-list-artifact-v1-basic.json");

const cases = [
  {
    proposal: readAllocatorFixture("spend-proposal-v1-basic.json"),
    expected: readAllocatorFixture("spend-receipt-v1-basic.json"),
    expectErrors: true,
  },
  {
    proposal: readAllocatorFixture("spend-proposal-v1-over-budget.json"),
    expected: readAllocatorFixture("spend-receipt-v1-over-budget.json"),
    expectErrors: true,
  },
  {
    proposal: readAllocatorFixture("spend-proposal-v1-unknown-item.json"),
    expected: readAllocatorFixture("spend-receipt-v1-unknown-item.json"),
    expectErrors: true,
  },
  {
    proposal: readAllocatorFixture("spend-proposal-v1-partial.json"),
    expected: readAllocatorFixture("spend-receipt-v1-partial.json"),
    expectErrors: true,
  },
];

const script = `
import assert from "node:assert/strict";
import { validateSpendProposal } from ${JSON.stringify(allocatorModule)};

const budget = ${JSON.stringify(budget)};
const priceList = ${JSON.stringify(priceList)};
const cases = ${JSON.stringify(cases)};

cases.forEach((entry) => {
  const proposal = entry.proposal;
  const result = validateSpendProposal({
    budget,
    priceList,
    proposal,
    meta: entry.expected.meta,
    proposalRef: { id: proposal.meta.id, schema: proposal.schema, schemaVersion: proposal.schemaVersion },
  });
  assert.deepEqual(result.receipt, entry.expected);
  if (entry.expectErrors) {
    assert.ok(result.errors?.length);
  } else {
    assert.equal(result.errors, undefined);
  }
});
`;

test("allocator validates spend proposals deterministically", () => {
  runEsm(script);
});
