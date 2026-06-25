import { readFixture } from "../../helpers/fixtures.js";
import assert from "node:assert/strict";
import { buildPriceMap, validateSpendProposal, normalizePriceItems } from "../../../packages/runtime/src/personas/allocator/validate-spend.js";
import { buildDefaultPriceList } from "../../../packages/runtime/src/personas/allocator/default-price-list.js";
import { maximizeActorBudget } from "../../../packages/runtime/src/personas/configurator/budget-maximizer.js";

const baseMeta = {
  id: "meta-1",
  runId: "run-1",
  createdAt: "2026-04-22T00:00:00Z",
  producedBy: "allocator",
};

function makeBudget(tokens) {
  return {
    schema: "agent-kernel/BudgetArtifact",
    schemaVersion: 1,
    meta: { id: "budget-1", runId: "run-1", createdAt: "2026-04-22T00:00:00Z", producedBy: "test" },
    budget: { tokens },
  };
}

test("buildDefaultPriceList returns a valid PriceList artifact", () => {
  const pl = buildDefaultPriceList();
  assert.equal(pl.schema, "agent-kernel/PriceList");
  assert.equal(pl.schemaVersion, 1);
  assert.ok(Array.isArray(pl.items) && pl.items.length > 0);
});

test("default price list prices vital_health_point at 1 token (base unit)", () => {
  const pl = buildDefaultPriceList();
  const item = pl.items.find((i) => i.id === "vital_health_point");
  assert.ok(item, "vital_health_point must be in default price list");
  assert.equal(item.unitCost, 1);
  assert.equal(item.formula, "linear");
});

test("default price list marks all regen items as quadratic", () => {
  const pl = buildDefaultPriceList();
  const regenIds = [
    "vital_health_regen_tick",
    "vital_mana_regen_tick",
    "vital_stamina_regen_tick",
    "vital_durability_regen_tick",
  ];
  for (const id of regenIds) {
    const item = pl.items.find((i) => i.id === id);
    assert.ok(item, `${id} must be in default price list`);
    assert.equal(item.formula, "quadratic", `${id} must be quadratic`);
  }
});

test("default price list marks affinity_stack as quadratic", () => {
  const pl = buildDefaultPriceList();
  const item = pl.items.find((i) => i.id === "affinity_stack");
  assert.ok(item, "affinity_stack must be in default price list");
  assert.equal(item.formula, "quadratic");
});

test("default price list approves layout grid items as zero-cost structural overhead", () => {
  const pl = buildDefaultPriceList();
  const proposal = {
    schema: "agent-kernel/SpendProposal",
    schemaVersion: 1,
    meta: { ...baseMeta, id: "prop-layout" },
    items: [
      { id: "layout_grid_12x8", kind: "layout", quantity: 1 },
      { id: "tile_floor", kind: "tile", quantity: 6 },
    ],
  };
  const result = validateSpendProposal({
    budget: makeBudget(500),
    priceList: pl,
    proposal,
    meta: { ...baseMeta, id: "receipt-layout" },
  });

  assert.equal(result.receipt.status, "approved");
  assert.equal(result.receipt.totalCost, 6);
  const layoutLine = result.receipt.lineItems.find((entry) => entry.kind === "layout");
  assert.ok(layoutLine, "layout line item should be retained");
  assert.equal(layoutLine.status, "approved");
  assert.equal(layoutLine.unitCost, 0);
  assert.equal(layoutLine.totalCost, 0);
});

test("normalizePriceItems accepts new canonical unitCost field", () => {
  const pl = buildDefaultPriceList();
  const map = normalizePriceItems(pl);
  assert.ok(map.size > 0, "normalizePriceItems should return a non-empty map");
  assert.ok(map.has("vital:vital_health_point"), "vital_health_point should be addressable by kind:id");
  const entry = map.get("vital:vital_health_point");
  assert.equal(entry.unitCost, 1);
});

test("buildPriceMap exposes only canonical kind:id price entries", () => {
  const priceMap = buildPriceMap({
    items: [
      { id: "actor_spawn", kind: "actor", unitCost: 5 },
      { key: "actor_spawn", unitCost: 99 },
      { id: "bad_negative", kind: "actor", unitCost: -1 },
    ],
  });
  assert.equal(priceMap.get("actor:actor_spawn"), 5);
  assert.equal(priceMap.has("legacy:actor_spawn"), false);
  assert.equal(priceMap.has("actor:bad_negative"), false);
});

test("validateSpendProposal uses default price list when priceList omitted but items are present", () => {
  const pl = buildDefaultPriceList();
  const proposal = {
    schema: "agent-kernel/SpendProposal",
    schemaVersion: 1,
    meta: { ...baseMeta, id: "prop-1" },
    items: [
      { id: "vital_health_point", kind: "vital", quantity: 10 },
    ],
  };
  const result = validateSpendProposal({
    budget: makeBudget(500),
    priceList: pl,
    proposal,
    meta: { ...baseMeta, id: "receipt-1" },
  });
  assert.ok(result.receipt);
  assert.equal(result.receipt.status, "approved");
  // 10 health × 1 token = 10 tokens
  assert.equal(result.receipt.totalCost, 10);
});

test("validateSpendProposal applies declared quadratic formulas", () => {
  const pl = buildDefaultPriceList();
  const proposal = {
    schema: "agent-kernel/SpendProposal",
    schemaVersion: 1,
    meta: { ...baseMeta, id: "prop-formula" },
    items: [
      { id: "affinity_stack", kind: "affinity", quantity: 3 },
      { id: "vital_mana_regen_tick", kind: "vital", quantity: 2 },
    ],
  };
  const result = validateSpendProposal({
    budget: makeBudget(500),
    priceList: pl,
    proposal,
    meta: { ...baseMeta, id: "receipt-formula" },
  });

  assert.equal(result.receipt.status, "approved");
  assert.equal(result.receipt.totalCost, 13);
  assert.equal(result.receipt.lineItems.find((entry) => entry.id === "affinity_stack").totalCost, 9);
  assert.equal(result.receipt.lineItems.find((entry) => entry.id === "vital_mana_regen_tick").totalCost, 4);
});

test("maximizeActorBudget uses the shared declared regen price formula", () => {
  const priceList = {
    items: [
      { id: "vital_health_point", kind: "vital", unitCost: 1, formula: "linear" },
      { id: "vital_mana_point", kind: "vital", unitCost: 1, formula: "linear" },
      { id: "vital_stamina_point", kind: "vital", unitCost: 1, formula: "linear" },
      { id: "vital_durability_point", kind: "vital", unitCost: 1, formula: "linear" },
      { id: "vital_health_regen_tick", kind: "vital", unitCost: 1, formula: "quadratic" },
      { id: "vital_mana_regen_tick", kind: "vital", unitCost: 1, formula: "quadratic" },
      { id: "vital_stamina_regen_tick", kind: "vital", unitCost: 1, formula: "quadratic" },
      { id: "vital_durability_regen_tick", kind: "vital", unitCost: 1, formula: "quadratic" },
    ],
  };
  const [actor] = maximizeActorBudget({
    actors: [
      {
        id: "actor-1",
        vitals: {
          health: { current: 0, max: 0, regen: 0 },
          mana: { current: 0, max: 0, regen: 0 },
          stamina: { current: 0, max: 0, regen: 0 },
          durability: { current: 0, max: 0, regen: 0 },
        },
      },
    ],
    remaining: 80,
    priceList,
  });

  assert.equal(actor.vitals.health.regen, 2);
  assert.equal(actor.vitals.durability.regen, 2);
  assert.equal(actor.vitals.mana.regen, 2);
  assert.equal(actor.vitals.stamina.regen, 2);
});

test("validateSpendProposal attaches attribution fields from proposal items if present", () => {
  const pl = buildDefaultPriceList();
  const proposal = {
    schema: "agent-kernel/SpendProposal",
    schemaVersion: 1,
    meta: { ...baseMeta, id: "prop-2" },
    items: [
      {
        id: "vital_health_point",
        kind: "vital",
        quantity: 5,
        category: "delvers",
        subjectRef: { id: "delver-1", schema: "agent-kernel/DelverArtifact", schemaVersion: 1 },
      },
    ],
  };
  const result = validateSpendProposal({
    budget: makeBudget(500),
    priceList: pl,
    proposal,
    meta: { ...baseMeta, id: "receipt-2" },
  });
  assert.equal(result.receipt.status, "approved");
  const li = result.receipt.lineItems[0];
  // category and subjectRef should pass through from proposal item
  assert.equal(li.category, "delvers");
  assert.ok(li.subjectRef?.id === "delver-1");
});

test("validateSpendProposal denies when total cost exceeds budget", () => {
  const pl = buildDefaultPriceList();
  const proposal = {
    schema: "agent-kernel/SpendProposal",
    schemaVersion: 1,
    meta: { ...baseMeta, id: "prop-3" },
    items: [
      { id: "vital_health_point", kind: "vital", quantity: 1000 },
    ],
  };
  const result = validateSpendProposal({
    budget: makeBudget(10),
    priceList: pl,
    proposal,
    meta: { ...baseMeta, id: "receipt-3" },
  });
  assert.equal(result.receipt.status, "denied");
  assert.ok(result.errors?.length > 0);
});

// ## TODO: Test Permutations
// - proposal with mix of known and unknown item ids (partial status)
// - proposal item with quantity=0 (normalizes to 1 — verify)
// - proposal item with quadratic formula item — does validateSpendProposal apply n² cost?
// - validateSpendProposal with priceList=null and proposal items (all items denied)
// - validateSpendProposal with empty proposal.items (totalCost=0, status=approved)
// - receipt lineItems preserve category from proposal item (not just id/kind/quantity)
