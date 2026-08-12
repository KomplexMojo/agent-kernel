const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

const META = {
  id: "receipt_spend_proposal_item_source_backed",
  runId: "run_spend_proposal_item_source_backed",
  createdAt: "2026-06-11T00:00:00.000Z",
  producedBy: "allocator-test",
};

async function loadAllocator() {
  const [{ validateSpendProposal }, { buildDefaultPriceList }] = await Promise.all([
    import("../../packages/runtime/src/personas/allocator/validate-spend.js"),
    import("../../packages/runtime/src/personas/allocator/default-price-list.js"),
  ]);
  return { validateSpendProposal, buildDefaultPriceList };
}

function makeBudget(tokens = 500) {
  return {
    schema: "agent-kernel/BudgetArtifact",
    schemaVersion: 1,
    meta: { id: "budget_spend_proposal_item", runId: META.runId, createdAt: META.createdAt, producedBy: "test" },
    budget: { tokens },
  };
}

test("validateSpendProposal preserves proposal attribution fields on approved line items", async () => {
  const { validateSpendProposal, buildDefaultPriceList } = await loadAllocator();
  const proposal = {
    schema: "agent-kernel/SpendProposal",
    schemaVersion: 1,
    meta: { id: "proposal_spend_proposal_item", runId: META.runId, createdAt: META.createdAt, producedBy: "test" },
    items: [
      {
        id: "vital_health_point",
        kind: "vital",
        quantity: 5,
        category: "delvers",
        artifactRef: { id: "artifact_actor_1", schema: "agent-kernel/InitialStateArtifact", schemaVersion: 1 },
        subjectRef: { id: "actor_1", schema: "agent-kernel/ActorState", schemaVersion: 1 },
        detail: { vital: "health", target: "actor_1" },
      },
    ],
  };

  const result = validateSpendProposal({
    budget: makeBudget(),
    priceList: buildDefaultPriceList(),
    proposal,
    meta: META,
    proposalRef: { id: proposal.meta.id, schema: proposal.schema, schemaVersion: proposal.schemaVersion },
  });

  assert.equal(result.errors, undefined);
  assert.equal(result.receipt.status, "approved");
  assert.equal(result.receipt.proposalRef.id, proposal.meta.id);
  assert.equal(result.receipt.lineItems.length, 1);
  assert.deepEqual(result.receipt.lineItems[0], {
    id: "vital_health_point",
    kind: "vital",
    quantity: 5,
    unitCost: 1,
    totalCost: 5,
    status: "approved",
    category: "delvers",
    artifactRef: proposal.items[0].artifactRef,
    subjectRef: proposal.items[0].subjectRef,
    detail: proposal.items[0].detail,
  });
});

test("validateSpendProposal denies malformed and unknown proposal items through the real allocator", async () => {
  const { validateSpendProposal, buildDefaultPriceList } = await loadAllocator();
  const proposal = {
    schema: "agent-kernel/SpendProposal",
    schemaVersion: 1,
    meta: { id: "proposal_spend_proposal_item_denied", runId: META.runId, createdAt: META.createdAt, producedBy: "test" },
    items: [
      { kind: "vital", quantity: 1 },
      { id: "missing_price", kind: "vital", quantity: 2, category: "shared_system" },
    ],
  };

  const result = validateSpendProposal({
    budget: makeBudget(),
    priceList: buildDefaultPriceList(),
    proposal,
    meta: { ...META, id: "receipt_spend_proposal_item_denied" },
  });

  assert.equal(result.receipt.status, "denied");
  assert.equal(result.receipt.lineItems.length, 2);
  assert.deepEqual(result.receipt.lineItems.map((item) => item.status), ["denied", "denied"]);
  assert.match(result.errors.join("\n"), /Invalid proposal item/);
  assert.match(result.errors.join("\n"), /Unknown price item: vital:missing_price/);
  assert.equal(result.receipt.lineItems[1].category, "shared_system");
});

test("artifact fixture proposal exercises the real allocator instead of a copied shape validator", async () => {
  const { validateSpendProposal, buildDefaultPriceList } = await loadAllocator();
  const proposal = readFixture("spend-proposal-item-v1-full.json");

  const result = validateSpendProposal({
    budget: makeBudget(10_000),
    priceList: buildDefaultPriceList(),
    proposal,
    meta: { ...META, id: "receipt_spend_proposal_item_fixture" },
    proposalRef: { id: proposal.meta.id, schema: proposal.schema, schemaVersion: proposal.schemaVersion },
  });

  assert.ok(result.receipt);
  assert.equal(result.receipt.schema, "agent-kernel/BudgetReceiptArtifact");
  assert.equal(result.receipt.proposalRef.id, proposal.meta.id);
  assert.ok(result.receipt.lineItems.length > 0);
  assert.ok(result.receipt.lineItems.every((item) => typeof item.id === "string"));
});
