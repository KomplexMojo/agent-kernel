/**
 * Configurator — what an affinity DOES at runtime, and what shape one must have.
 *
 * ⚠️ **THIS FILE USED TO BE `tests/financial-model/cost-model.test.js` AND USED TO TEST
 * PRICES.** P1.4 (2026-08-12) deleted the second price model it was pinning — affinity base
 * 30, stacks `Σ(10 + 8·(n-1)²)`, vital points `2·H`, quadratic regen — after a repo-wide
 * census found its only consumer, `configurator/actor-config-generation.js`, had no
 * production importers at all. Eight price tests went with it; every assertion below is
 * about mana, tiles or field shape, none about tokens.
 *
 * The move is the point: pricing tests belong under `tests/financial-model/`, and there is
 * now nothing here to put there. Actor pricing is the Allocator's, and its tests live in
 * `tests/personas/allocator/`. Anything in this file that starts counting tokens is a
 * second price model growing back.
 */
const assert = require("node:assert/strict");


test("durability regen is supported (design §8.4)", async () => {
  const { normalizeRegen } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");

const errors = [];
const result = normalizeRegen({ durability: 2 }, errors);
assert.equal(errors.length, 0, "durability regen should not produce errors");
assert.equal(result.durability, 2);
});

// A push/pull costs what the rules artifact's stack tier says (resolveActorTurnCosts); the
// Configurator keeps no second cast-mana formula (#233, maintainer 2026-10-13).
test("the Configurator has no push/pull mana formula of its own", async () => {
  const costModel = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");
  assert.equal(costModel.computeExternalManaUse, undefined);
});

test("runtime internal mana upkeep: 2 + s (design §9.2)", async () => {
  const { computeInternalManaUpkeep } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");

assert.equal(computeInternalManaUpkeep(1), 3);
assert.equal(computeInternalManaUpkeep(2), 4);
assert.equal(computeInternalManaUpkeep(3), 5);
assert.equal(computeInternalManaUpkeep(4), 6);
assert.equal(computeInternalManaUpkeep(5), 7);
});

// Push/pull range is core's: a cast reaches `stacks` tiles (actor-cast.ts; maintainer, 2026-10-13,
// #231). The Configurator keeps no range formula of its own, so none can drift from core.
test("the Configurator has no push/pull range formula of its own", async () => {
  const costModel = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");
  assert.equal(costModel.computeExternalRange, undefined);
});

// Emit radius, draw yield and emit strength are core's (rules/actor-fields.ts). The 1 + s
// radius, draw-net and emit-strength formulas that lived here had no production caller and
// disagreed with core, so they were removed (drift review, 2026-10-13).
test("the Configurator has no emit radius, draw or emit strength formula of its own", async () => {
  const costModel = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");
  assert.equal(costModel.computeInternalRadius, undefined);
  assert.equal(costModel.computeDrawNet, undefined);
  assert.equal(costModel.computeEmitStrength, undefined);
});

test("affinity package validation: requires kind + stacks + expression (design §5.1)", async () => {
  const { normalizeAffinityList } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");

// Valid package
const e1 = [];
const valid = normalizeAffinityList([{ kind: "fire", stacks: 1, expression: "push" }], e1);
assert.equal(valid.length, 1);
assert.equal(e1.length, 0);

// Invalid: bare string (no stack/expression)
const e2 = [];
normalizeAffinityList(["fire"], e2);
assert.ok(e2.length > 0, "bare string affinity should produce errors");

// Invalid: no expression
const e3 = [];
normalizeAffinityList([{ kind: "fire", stacks: 1 }], e3);
assert.ok(e3.length > 0, "affinity without expression should produce errors");

// Invalid: affinity + expression but no valid stacks
const e4 = [];
normalizeAffinityList([{ kind: "fire", stacks: 0, expression: "push" }], e4);
assert.ok(e4.length > 0, "affinity with stacks=0 should produce errors");
});
