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

test("runtime external mana use: 5 + 4·(s-1)² (design §9.1)", async () => {
  const { computeExternalManaUse } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");

assert.equal(computeExternalManaUse(1), 5);
assert.equal(computeExternalManaUse(2), 9);
assert.equal(computeExternalManaUse(3), 21);
assert.equal(computeExternalManaUse(4), 41);
assert.equal(computeExternalManaUse(5), 69);
});

test("runtime internal mana upkeep: 2 + s (design §9.2)", async () => {
  const { computeInternalManaUpkeep } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");

assert.equal(computeInternalManaUpkeep(1), 3);
assert.equal(computeInternalManaUpkeep(2), 4);
assert.equal(computeInternalManaUpkeep(3), 5);
assert.equal(computeInternalManaUpkeep(4), 6);
assert.equal(computeInternalManaUpkeep(5), 7);
});

test("external range: 1 + s (design §10.1)", async () => {
  const { computeExternalRange } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");

assert.equal(computeExternalRange(1), 2);
assert.equal(computeExternalRange(3), 4);
});

test("internal radius: 1 + s (design §10.2)", async () => {
  const { computeInternalRadius } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");

assert.equal(computeInternalRadius(1), 2);
assert.equal(computeInternalRadius(3), 4);
});

test("draw net formula: 3·min(s, async e) - (2+s) (design §11.3)", async () => {
  const { computeDrawNet } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");

// fire +1 + draw, e=1: 3×min(1,1) - (2+1) = 3 - 3 = 0
assert.equal(computeDrawNet(1, 1), 0);

// fire +3 + draw, e=2: 3×min(3,2) - (2+3) = 6 - 5 = 1
assert.equal(computeDrawNet(3, 2), 1);

// fire +3 + draw, e=4: 3×min(3,4) - (2+3) = 9 - 5 = 4
assert.equal(computeDrawNet(3, 4), 4);
});

test("emit strength: s (design §12.2)", async () => {
  const { computeEmitStrength } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");

assert.equal(computeEmitStrength(1), 1);
assert.equal(computeEmitStrength(3), 3);
assert.equal(computeEmitStrength(5), 5);
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
