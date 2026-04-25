const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

function isObject(v) {
  return v !== null && typeof v === "object";
}

function validateArtifactRef(ref, label = "ref") {
  assert.ok(isObject(ref), `${label}: expected object`);
  assert.ok(typeof ref.id === "string", `${label}.id: expected string`);
  assert.ok(typeof ref.schema === "string", `${label}.schema: expected string`);
  assert.ok(Number.isInteger(ref.schemaVersion), `${label}.schemaVersion: expected integer`);
}

/**
 * Validates the optional ArtifactCostContextV1 shape on ArtifactMeta.cost.
 * All numeric token fields must be non-negative when present.
 * lineItemIds must be an array of strings when present.
 * Refs must conform to ArtifactRef shape when present.
 */
function validateArtifactCostContext(cost) {
  assert.ok(isObject(cost), "cost: expected object");

  if (cost.selfTokens !== undefined) {
    assert.ok(
      Number.isFinite(cost.selfTokens) && cost.selfTokens >= 0,
      "cost.selfTokens: expected non-negative number",
    );
  }
  if (cost.runTotalTokens !== undefined) {
    assert.ok(
      Number.isFinite(cost.runTotalTokens) && cost.runTotalTokens >= 0,
      "cost.runTotalTokens: expected non-negative number",
    );
  }
  if (cost.budgetTokens !== undefined) {
    assert.ok(
      Number.isInteger(cost.budgetTokens) && cost.budgetTokens >= 0,
      "cost.budgetTokens: expected non-negative integer",
    );
  }
  if (cost.category !== undefined) {
    assert.ok(
      typeof cost.category === "string" && cost.category.length > 0,
      "cost.category: expected non-empty string",
    );
  }
  if (cost.receiptRef !== undefined) {
    validateArtifactRef(cost.receiptRef, "cost.receiptRef");
  }
  if (cost.proposalRef !== undefined) {
    validateArtifactRef(cost.proposalRef, "cost.proposalRef");
  }
  if (cost.lineItemIds !== undefined) {
    assert.ok(Array.isArray(cost.lineItemIds), "cost.lineItemIds: expected array");
    cost.lineItemIds.forEach((id, i) => {
      assert.ok(typeof id === "string", `cost.lineItemIds[${i}]: expected string`);
    });
  }
}

function validateArtifactMetaWithCost(meta) {
  assert.ok(isObject(meta), "meta: expected object");
  assert.ok(typeof meta.id === "string", "meta.id: expected string");
  assert.ok(typeof meta.runId === "string", "meta.runId: expected string");
  assert.ok(typeof meta.createdAt === "string", "meta.createdAt: expected string");
  assert.ok(typeof meta.producedBy === "string", "meta.producedBy: expected string");
  if (meta.cost !== undefined) {
    validateArtifactCostContext(meta.cost);
  }
}

test("ArtifactMeta accepts optional cost context with all fields", () => {
  const fixture = readFixture("artifact-cost-context-v1-full.json");
  validateArtifactMetaWithCost(fixture.meta);
  assert.ok(isObject(fixture.meta.cost));
  assert.ok(Number.isFinite(fixture.meta.cost.selfTokens));
  assert.ok(Number.isFinite(fixture.meta.cost.runTotalTokens));
  assert.ok(Number.isInteger(fixture.meta.cost.budgetTokens));
  assert.ok(typeof fixture.meta.cost.category === "string");
  assert.ok(isObject(fixture.meta.cost.receiptRef));
  assert.ok(isObject(fixture.meta.cost.proposalRef));
  assert.ok(Array.isArray(fixture.meta.cost.lineItemIds));
});

test("ArtifactMeta accepts meta without cost field (cost is optional)", () => {
  const fixture = readFixture("artifact-cost-context-v1-no-cost.json");
  validateArtifactMetaWithCost(fixture.meta);
  assert.equal(fixture.meta.cost, undefined);
});

test("ArtifactMeta rejects invalid cost context shapes", () => {
  const fixture = readFixture("invalid/artifact-meta-v1-invalid-cost.json");
  assert.throws(() => validateArtifactMetaWithCost(fixture.meta));
});

test("ArtifactCostContext accepts partial fields (all fields optional except object itself)", () => {
  const partialCost = { category: "rooms", budgetTokens: 100 };
  assert.doesNotThrow(() => validateArtifactCostContext(partialCost));
});

test("ArtifactCostContext rejects negative token values", () => {
  assert.throws(() => validateArtifactCostContext({ selfTokens: -1 }));
  assert.throws(() => validateArtifactCostContext({ runTotalTokens: -5 }));
  assert.throws(() => validateArtifactCostContext({ budgetTokens: -10 }));
});

test("ArtifactCostContext rejects non-integer budgetTokens", () => {
  assert.throws(() => validateArtifactCostContext({ budgetTokens: 1.5 }));
});

test("ArtifactCostContext rejects lineItemIds with non-string entries", () => {
  assert.throws(() => validateArtifactCostContext({ lineItemIds: ["valid", 42] }));
});

// ## TODO: Test Permutations
// - cost.receiptRef with missing id field
// - cost.proposalRef with wrong schemaVersion type
// - cost with unknown extra fields (should pass — open world)
// - meta.cost = null (should fail, null is not an object)
// - meta.cost.category = "" (empty string, should fail)
// - runTotalTokens < selfTokens (no constraint enforced at contract level — confirm behavior)
