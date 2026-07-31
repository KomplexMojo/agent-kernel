/**
 * BUDGET FULFILLMENT — the Allocator's maximize + feasibility surface (P2.3.4).
 *
 * The budget maximizer + feasibility assessors moved out of the CLI
 * (adapters-cli/ak-impl.mjs) into personas/allocator/budget-fulfillment.js,
 * fronted by the persona as createAllocatorPersona().maximizeFulfillment /
 * .assessFeasibility (charter: "budget maximization is Allocator policy").
 *
 * These are behavior tests for that surface: the maximize search grows a
 * flexible card toward its budget and leaves a fixed card untouched; the
 * feasibility assessor throws structured conflict/insufficient-budget errors.
 * The methods are state-free policy (like pricing.*) — exercised here on a
 * fresh IDLE persona with no registerBudget call, proving they are not gated
 * behind the spend FSM round.
 *
 * Byte-level parity with the old CLI implementation is covered end-to-end by
 * the g1/g3 maximize goldens; this file pins the persona surface itself.
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/";

function delverEntry(value, extra = {}) {
  return { value, optimizationGoals: [], ...extra };
}

test("maximizeFulfillment grows a vitals-flexible delver toward the budget (state-free, deterministic)", async () => {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const { UNUSED_CLOCK } = await import(`${P}_shared/require-clock.js`);
  const priceListArtifact = buildDefaultPriceList();

  const base = {
    type: "delver",
    vitals: {
      health: { max: 10, current: 10, regen: 0 },
      mana: { max: 0, current: 0, regen: 0 },
      stamina: { max: 5, current: 5, regen: 1 },
      durability: { max: 0, current: 0, regen: 0 },
    },
    motivations: ["exploring"],
    affinities: [],
  };

  // Fresh persona in IDLE — no registerBudget: the surface is state-free policy.
  const result = createAllocatorPersona({ clock: UNUSED_CLOCK }).maximizeFulfillment({
    rooms: [],
    delvers: [delverEntry(base, { vitalsFlexible: true })],
    priceListArtifact,
    budgetTokens: 100,
  });

  const grown = result.delvers[0].value.vitals;
  // The search spent the budget into mana (the flexible vital), so mana.max rose
  // above the base of 0; the original input object is not mutated.
  assert.ok(grown.mana.max > base.vitals.mana.max, "mana.max should grow under a 100-token budget");
  assert.equal(base.vitals.mana.max, 0, "input card must not be mutated in place");

  // Deterministic: identical inputs → identical grown card.
  const again = createAllocatorPersona({ clock: UNUSED_CLOCK }).maximizeFulfillment({
    rooms: [],
    delvers: [delverEntry(base, { vitalsFlexible: true })],
    priceListArtifact,
    budgetTokens: 100,
  });
  assert.deepEqual(again.delvers[0].value.vitals, grown, "maximize must be deterministic");
});

test("maximizeFulfillment leaves a non-flexible delver untouched", async () => {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const { UNUSED_CLOCK } = await import(`${P}_shared/require-clock.js`);
  const priceListArtifact = buildDefaultPriceList();

  const fixed = {
    type: "delver",
    vitals: {
      health: { max: 10, current: 10, regen: 0 },
      mana: { max: 3, current: 3, regen: 1 },
      stamina: { max: 5, current: 5, regen: 1 },
      durability: { max: 0, current: 0, regen: 0 },
    },
    motivations: ["exploring"],
    affinities: [],
  };

  const result = createAllocatorPersona({ clock: UNUSED_CLOCK }).maximizeFulfillment({
    rooms: [],
    delvers: [delverEntry(fixed)], // vitalsFlexible omitted → fixed
    priceListArtifact,
    budgetTokens: 100,
  });

  assert.deepEqual(result.delvers[0].value.vitals, fixed.vitals, "a fixed card must be returned unchanged");
});

test("assessFeasibility throws a structured insufficient_budget error when the minimum spend exceeds the budget", async () => {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const { UNUSED_CLOCK } = await import(`${P}_shared/require-clock.js`);
  const priceListArtifact = buildDefaultPriceList();

  const expensive = {
    type: "delver",
    vitals: {
      health: { max: 50, current: 50, regen: 0 },
      mana: { max: 50, current: 50, regen: 0 },
      stamina: { max: 5, current: 5, regen: 1 },
      durability: { max: 0, current: 0, regen: 0 },
    },
    motivations: ["exploring"],
    affinities: [],
  };

  assert.throws(
    () => createAllocatorPersona({ clock: UNUSED_CLOCK }).assessFeasibility({
      commandName: "create",
      budgetTokens: 5,
      delvers: [delverEntry(expensive)],
      priceListArtifact,
    }),
    (error) => {
      assert.equal(error.validation.outcome, "insufficient_budget");
      assert.ok(
        error.validation.issues.some((issue) => issue.code === "delver_minimum_cost_exceeds_budget"),
        "expected a delver_minimum_cost_exceeds_budget issue",
      );
      assert.match(error.message, /^create infeasible \(insufficient_budget\):/);
      return true;
    },
  );
});

test("assessFeasibility throws conflicting_requirements when affinities are requested without the mana to support them", async () => {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const { UNUSED_CLOCK } = await import(`${P}_shared/require-clock.js`);
  const priceListArtifact = buildDefaultPriceList();

  const conflicted = {
    type: "delver",
    vitals: {
      health: { max: 10, current: 10, regen: 0 },
      mana: { max: 0, current: 0, regen: 0 },
      stamina: { max: 5, current: 5, regen: 1 },
      durability: { max: 0, current: 0, regen: 0 },
    },
    motivations: ["exploring"],
    affinities: [{ kind: "water", expression: "emit", stacks: 1 }],
  };

  assert.throws(
    () => createAllocatorPersona({ clock: UNUSED_CLOCK }).assessFeasibility({
      commandName: "delver-plan",
      budgetTokens: 500,
      delvers: [delverEntry(conflicted)], // vitalsFlexible omitted → hard requirement conflict
      priceListArtifact,
    }),
    (error) => {
      assert.equal(error.validation.outcome, "conflicting_requirements");
      const codes = error.validation.issues.map((issue) => issue.code);
      assert.ok(codes.includes("affinity_requires_mana"), "expected an affinity_requires_mana issue");
      return true;
    },
  );
});

test("assessFeasibility returns without throwing when the request fits the budget", async () => {
  const { createAllocatorPersona } = await import(`${P}allocator/persona.js`);
  const { buildDefaultPriceList } = await import(`${P}allocator/default-price-list.js`);
  const { UNUSED_CLOCK } = await import(`${P}_shared/require-clock.js`);
  const priceListArtifact = buildDefaultPriceList();

  const modest = {
    type: "delver",
    vitals: {
      health: { max: 5, current: 5, regen: 0 },
      mana: { max: 0, current: 0, regen: 0 },
      stamina: { max: 3, current: 3, regen: 1 },
      durability: { max: 0, current: 0, regen: 0 },
    },
    motivations: ["exploring"],
    affinities: [],
  };

  assert.doesNotThrow(() => createAllocatorPersona({ clock: UNUSED_CLOCK }).assessFeasibility({
    commandName: "create",
    budgetTokens: 500,
    delvers: [delverEntry(modest)],
    priceListArtifact,
  }));
});
