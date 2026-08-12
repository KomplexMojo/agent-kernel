const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

function isObject(v) {
  return v !== null && typeof v === "object";
}

const VALID_FORMULAS = ["linear", "quadratic"];

/**
 * Validates the canonical PriceListItem shape:
 *   { id, kind, unitCost, formula?, category?, description? }
 * Legacy shape { key, unitCost } is also accepted for backward compatibility.
 */
function validatePriceListItem(item) {
  assert.ok(isObject(item), "item: expected object");
  const isLegacy = typeof item.key === "string";
  if (isLegacy) {
    assert.ok(
      Number.isFinite(item.unitCost) && item.unitCost >= 0,
      `legacy item key=${item.key}: unitCost must be non-negative number`,
    );
    return;
  }
  assert.ok(typeof item.id === "string" && item.id.length > 0, "item.id: expected non-empty string");
  assert.ok(typeof item.kind === "string" && item.kind.length > 0, "item.kind: expected non-empty string");
  assert.ok(
    Number.isFinite(item.unitCost) && item.unitCost >= 0,
    `item ${item.id}: unitCost must be non-negative number`,
  );
  if (item.formula !== undefined) {
    assert.ok(
      VALID_FORMULAS.includes(item.formula),
      `item ${item.id}: formula must be one of ${VALID_FORMULAS.join(", ")}`,
    );
  }
}

function validatePriceListArtifact(artifact) {
  assert.ok(isObject(artifact), "artifact: expected object");
  assert.equal(artifact.schema, "agent-kernel/PriceList");
  assert.equal(artifact.schemaVersion, 1);
  assert.ok(isObject(artifact.meta));
  assert.ok(Array.isArray(artifact.items) && artifact.items.length > 0, "items: expected non-empty array");
  artifact.items.forEach((item, i) => {
    try {
      validatePriceListItem(item);
    } catch (err) {
      throw new assert.AssertionError({ message: `items[${i}]: ${err.message}` });
    }
  });
}

/** Returns a set of item ids from the price list. */
function priceListIds(artifact) {
  return new Set(
    artifact.items
      .map((item) => item.id || item.key)
      .filter(Boolean),
  );
}

const REQUIRED_VITAL_IDS = [
  "vital_health_point",
  "vital_mana_point",
  "vital_stamina_point",
  "vital_durability_point",
];

const REQUIRED_REGEN_IDS = [
  "vital_health_regen_tick",
  "vital_mana_regen_tick",
  "vital_stamina_regen_tick",
  "vital_durability_regen_tick",
];

const REQUIRED_AFFINITY_IDS = [
  "affinity_stack",
  "affinity_expression_externalize",
  "affinity_expression_internalize",
  "affinity_expression_localized",
  "affinity_expression_sustain",
];

const REQUIRED_MOTIVATION_IDS = [
  "motivation_stationary",
  "motivation_random",
  "motivation_exploring",
  "motivation_patrolling",
  "motivation_attacking",
  "motivation_defending",
];

const REQUIRED_STRUCTURE_IDS = [
  "tile_floor",
  "tile_hallway",
];

const REQUIRED_ACTOR_IDS = ["actor_spawn"];

const REQUIRED_ENTITY_IDS = [
  "hazard_basic",
  "hazard_base",
  "resource_base",
];

test("price list artifact validates canonical item shape", () => {
  const fixture = readFixture("price-list-artifact-v1-canonical.json");
  validatePriceListArtifact(fixture);
});

test("price list canonical fixture has base unit: 1 health point = 1 token", () => {
  const fixture = readFixture("price-list-artifact-v1-canonical.json");
  const healthItem = fixture.items.find((i) => i.id === "vital_health_point");
  assert.ok(healthItem, "vital_health_point must be present");
  assert.equal(healthItem.unitCost, 1, "vital_health_point unitCost must be 1 (base unit)");
  assert.equal(healthItem.formula, "linear");
});

test("price list canonical fixture covers all vital categories", () => {
  const fixture = readFixture("price-list-artifact-v1-canonical.json");
  const ids = priceListIds(fixture);
  for (const id of REQUIRED_VITAL_IDS) {
    assert.ok(ids.has(id), `Missing required vital item: ${id}`);
  }
});

test("price list canonical fixture covers all regen categories with quadratic formula", () => {
  const fixture = readFixture("price-list-artifact-v1-canonical.json");
  const ids = priceListIds(fixture);
  const itemMap = new Map(fixture.items.map((i) => [i.id, i]));
  for (const id of REQUIRED_REGEN_IDS) {
    assert.ok(ids.has(id), `Missing required regen item: ${id}`);
    assert.equal(
      itemMap.get(id)?.formula,
      "quadratic",
      `${id}: regen must use quadratic formula`,
    );
  }
});

test("price list canonical fixture covers affinity stacks with quadratic formula", () => {
  const fixture = readFixture("price-list-artifact-v1-canonical.json");
  const itemMap = new Map(fixture.items.map((i) => [i.id, i]));
  const stackItem = itemMap.get("affinity_stack");
  assert.ok(stackItem, "affinity_stack must be present");
  assert.equal(stackItem.formula, "quadratic", "affinity_stack must use quadratic formula");
  for (const id of REQUIRED_AFFINITY_IDS) {
    assert.ok(itemMap.has(id), `Missing required affinity item: ${id}`);
  }
});

test("price list canonical fixture covers motivations", () => {
  const fixture = readFixture("price-list-artifact-v1-canonical.json");
  const ids = priceListIds(fixture);
  for (const id of REQUIRED_MOTIVATION_IDS) {
    assert.ok(ids.has(id), `Missing required motivation item: ${id}`);
  }
});

test("price list canonical fixture covers floor tiles, actors, hazards, and resources", () => {
  const fixture = readFixture("price-list-artifact-v1-canonical.json");
  const ids = priceListIds(fixture);
  for (const id of [...REQUIRED_STRUCTURE_IDS, ...REQUIRED_ACTOR_IDS, ...REQUIRED_ENTITY_IDS]) {
    assert.ok(ids.has(id), `Missing required item: ${id}`);
  }
});

test("price list rejects item with negative unitCost", () => {
  const fixture = readFixture("invalid/price-list-artifact-v1-missing-cost.json");
  assert.throws(() => validatePriceListArtifact(fixture));
});

test("normalizePriceItems accepts canonical unitCost field (not just costTokens)", async () => {
  const { normalizePriceItems } = await import(
    "../../packages/runtime/src/personas/allocator/validate-spend.js"
  );
  const priceList = {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    meta: { id: "pl-1", runId: "r-1", createdAt: "2026-04-22T00:00:00Z", producedBy: "test" },
    items: [
      { id: "vital_health_point", kind: "vital", unitCost: 1, formula: "linear" },
      { id: "affinity_stack", kind: "affinity", unitCost: 1, formula: "quadratic" },
    ],
  };
  const map = normalizePriceItems(priceList);
  assert.ok(map.has("vital:vital_health_point"), "Should find canonical item by kind:id key");
  assert.ok(map.has("affinity:affinity_stack"), "Should find canonical item by kind:id key");
  assert.equal(map.get("vital:vital_health_point").unitCost, 1);
});

test("price list accepts free quadratic item", () => {
  const artifact = {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    meta: { id: "pl-free", runId: "run-free", createdAt: "2026-04-22T00:00:00Z", producedBy: "test" },
    items: [
      { id: "affinity_stack", kind: "affinity", unitCost: 0, formula: "quadratic" },
    ],
  };
  assert.doesNotThrow(() => validatePriceListArtifact(artifact));
});

test("normalizePriceItems prefers canonical id shape when id and key are both present", async () => {
  const { normalizePriceItems } = await import(
    "../../packages/runtime/src/personas/allocator/validate-spend.js"
  );
  const map = normalizePriceItems({
    items: [
      { id: "actor_spawn", key: "legacy_actor_spawn", kind: "actor", unitCost: 5 },
    ],
  });
  assert.equal(map.get("actor:actor_spawn").unitCost, 5);
  assert.equal(map.has("legacy:legacy_actor_spawn"), false);
});

test("normalizePriceItems uses last duplicate canonical id", async () => {
  const { normalizePriceItems } = await import(
    "../../packages/runtime/src/personas/allocator/validate-spend.js"
  );
  const map = normalizePriceItems({
    items: [
      { id: "actor_spawn", kind: "actor", unitCost: 5 },
      { id: "actor_spawn", kind: "actor", unitCost: 8 },
    ],
  });
  assert.equal(map.get("actor:actor_spawn").unitCost, 8);
});

test("price list accepts free stationary motivation item", () => {
  const artifact = {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    meta: { id: "pl-free-motivation", runId: "run-free", createdAt: "2026-04-22T00:00:00Z", producedBy: "test" },
    items: [
      { id: "motivation_stationary", kind: "motivation", unitCost: 0, formula: "linear" },
    ],
  };
  assert.doesNotThrow(() => validatePriceListArtifact(artifact));
});

test("price list accepts regen item without formula field", () => {
  const artifact = {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    meta: { id: "pl-no-formula", runId: "run-regen", createdAt: "2026-04-22T00:00:00Z", producedBy: "test" },
    items: [
      { id: "vital_mana_regen_tick", kind: "vital", unitCost: 2 },
    ],
  };
  assert.doesNotThrow(() => validatePriceListArtifact(artifact));
});

test("price list rejects empty items array", () => {
  const artifact = {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    meta: { id: "pl-empty", runId: "run-empty", createdAt: "2026-04-22T00:00:00Z", producedBy: "test" },
    items: [],
  };
  assert.throws(() => validatePriceListArtifact(artifact), /items/);
});
