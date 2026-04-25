const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

function isObject(v) {
  return v !== null && typeof v === "object";
}

const VALID_STATUSES = ["approved", "denied", "partial"];
const VALID_CATEGORIES = [
  "rooms",
  "floor_tiles",
  "traps",
  "hazards",
  "resources",
  "delvers",
  "wardens",
  "shared_system",
];

/**
 * Validates an expanded SpendProposalItemV1 with attribution fields.
 * id and kind remain required. All attribution fields are optional.
 */
function validateSpendProposalItem(item) {
  assert.ok(isObject(item), "item: expected object");
  assert.ok(typeof item.id === "string" && item.id.length > 0, "item.id: expected non-empty string");
  assert.ok(typeof item.kind === "string" && item.kind.length > 0, "item.kind: expected non-empty string");

  if (item.quantity !== undefined) {
    assert.ok(Number.isFinite(item.quantity) && item.quantity >= 0, "item.quantity: expected non-negative number");
  }
  if (item.category !== undefined) {
    assert.ok(
      typeof item.category === "string" && VALID_CATEGORIES.includes(item.category),
      `item.category: expected one of ${VALID_CATEGORIES.join(", ")}`,
    );
  }
  if (item.unitCost !== undefined) {
    assert.ok(Number.isFinite(item.unitCost) && item.unitCost >= 0, "item.unitCost: expected non-negative number");
  }
  if (item.totalCost !== undefined) {
    assert.ok(Number.isFinite(item.totalCost) && item.totalCost >= 0, "item.totalCost: expected non-negative number");
  }
  if (item.status !== undefined) {
    assert.ok(VALID_STATUSES.includes(item.status), `item.status: expected one of ${VALID_STATUSES.join(", ")}`);
  }
  if (item.artifactRef !== undefined) {
    assert.ok(isObject(item.artifactRef), "item.artifactRef: expected object");
    assert.ok(typeof item.artifactRef.id === "string", "item.artifactRef.id: expected string");
    assert.ok(typeof item.artifactRef.schema === "string", "item.artifactRef.schema: expected string");
  }
  if (item.subjectRef !== undefined) {
    assert.ok(isObject(item.subjectRef), "item.subjectRef: expected object");
    assert.ok(typeof item.subjectRef.id === "string", "item.subjectRef.id: expected string");
    assert.ok(typeof item.subjectRef.schema === "string", "item.subjectRef.schema: expected string");
  }
}

function validateSpendProposal(proposal) {
  assert.ok(isObject(proposal), "proposal: expected object");
  assert.equal(proposal.schema, "agent-kernel/SpendProposal");
  assert.equal(proposal.schemaVersion, 1);
  assert.ok(isObject(proposal.meta));
  assert.ok(Array.isArray(proposal.items));
  proposal.items.forEach((item, i) => {
    try {
      validateSpendProposalItem(item);
    } catch (err) {
      throw new assert.AssertionError({ message: `item[${i}]: ${err.message}` });
    }
  });
}

test("SpendProposalItemV1 accepts legacy shape (id + kind + quantity only)", () => {
  const item = { id: "room-1", kind: "rooms", quantity: 2 };
  assert.doesNotThrow(() => validateSpendProposalItem(item));
});

test("SpendProposalItemV1 accepts full attribution shape", () => {
  const fixture = readFixture("spend-proposal-item-v1-full.json");
  fixture.items.forEach((item) => validateSpendProposalItem(item));
});

test("SpendProposalItemV1 rejects invalid category", () => {
  const item = { id: "x", kind: "rooms", category: "unknown_category" };
  assert.throws(() => validateSpendProposalItem(item));
});

test("SpendProposalItemV1 rejects negative unitCost", () => {
  const item = { id: "x", kind: "hazards", unitCost: -5 };
  assert.throws(() => validateSpendProposalItem(item));
});

test("SpendProposalItemV1 rejects negative totalCost", () => {
  const item = { id: "x", kind: "traps", totalCost: -1 };
  assert.throws(() => validateSpendProposalItem(item));
});

test("SpendProposalItemV1 rejects invalid status", () => {
  const item = { id: "x", kind: "delvers", status: "pending" };
  assert.throws(() => validateSpendProposalItem(item));
});

test("SpendProposalItemV1 rejects missing id", () => {
  const fixture = readFixture("invalid/spend-proposal-item-v1-invalid.json");
  assert.throws(() => validateSpendProposalItem(fixture));
});

test("SpendProposal accepts items covering all new categories", () => {
  const fixture = readFixture("spend-proposal-item-v1-full.json");
  validateSpendProposal(fixture);
  const categories = fixture.items.map((i) => i.category).filter(Boolean);
  const covered = new Set(categories);
  for (const cat of VALID_CATEGORIES) {
    assert.ok(covered.has(cat), `Expected category ${cat} to be covered`);
  }
});

// ## TODO: Test Permutations
// - item with only id missing (kind present)
// - item with empty string id
// - item with artifactRef missing schema field
// - item with both artifactRef and subjectRef present (valid — not exclusive)
// - proposal with zero items (edge: should pass structurally)
// - proposal with items mixing legacy and full attribution shapes
// - item.detail present with arbitrary JSON value (should pass — open field)
