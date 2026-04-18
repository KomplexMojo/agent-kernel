const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const costModelUrl = moduleUrl("packages/runtime/src/personas/configurator/cost-model.js");

test("affinity stack cost formula: 10 + 8·(n-1)² (design §6.2)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { computeStackCost, computeCumulativeStackCost } from ${JSON.stringify(costModelUrl)};

// Per-stack costs (design §6.2 table)
assert.equal(computeStackCost(1), 10);
assert.equal(computeStackCost(2), 18);
assert.equal(computeStackCost(3), 42);
assert.equal(computeStackCost(4), 82);
assert.equal(computeStackCost(5), 138);
assert.equal(computeStackCost(6), 210);

// Cumulative stack totals
assert.equal(computeCumulativeStackCost(1), 10);
assert.equal(computeCumulativeStackCost(2), 28);
assert.equal(computeCumulativeStackCost(3), 70);
assert.equal(computeCumulativeStackCost(4), 152);
assert.equal(computeCumulativeStackCost(5), 290);
assert.equal(computeCumulativeStackCost(6), 500);
`);
});

test("vital max costs: 2H + 2M + S + 2D (design §7)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { calculateVitalCost } from ${JSON.stringify(costModelUrl)};

const result = calculateVitalCost({
  vitals: { health: 10, mana: 10, stamina: 10, durability: 10 },
});
assert.ok(result.ok);
// 2×10 + 2×10 + 1×10 + 2×10 = 20 + 20 + 10 + 20 = 70
assert.equal(result.cost, 70);
`);
});

test("regen costs are quadratic: 12·R² + 5·R² + 4·R² + 10·R² (design §8)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { calculateRegenCost } from ${JSON.stringify(costModelUrl)};

// Single regen point each
const r1 = calculateRegenCost({
  regen: { health: 1, mana: 1, stamina: 1, durability: 1 },
});
assert.ok(r1.ok);
// 12×1 + 5×1 + 4×1 + 10×1 = 31
assert.equal(r1.cost, 31);

// Two regen points each (quadratic)
const r2 = calculateRegenCost({
  regen: { health: 2, mana: 2, stamina: 2, durability: 2 },
});
assert.ok(r2.ok);
// 12×4 + 5×4 + 4×4 + 10×4 = 48 + 20 + 16 + 40 = 124
assert.equal(r2.cost, 124);

// Three health regen
const r3 = calculateRegenCost({
  regen: { health: 3 },
});
assert.ok(r3.ok);
// 12×9 = 108
assert.equal(r3.cost, 108);
`);
});

test("durability regen is supported (design §8.4)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { normalizeRegen } from ${JSON.stringify(costModelUrl)};

const errors = [];
const result = normalizeRegen({ durability: 2 }, errors);
assert.equal(errors.length, 0, "durability regen should not produce errors");
assert.equal(result.durability, 2);
`);
});

test("affinity base cost is 30 (design §6.1)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { COST_DEFAULTS, calculateAffinityCost } from ${JSON.stringify(costModelUrl)};

assert.equal(COST_DEFAULTS.affinityBaseCost, 30);

// Affinity with 1 stack: base(30) + stack(10) = 40
const r = calculateAffinityCost({ stacks: 1 });
assert.ok(r.ok);
assert.equal(r.cost, 40);
`);
});

test("expression costs: external=35, internal=25 (design §6.4)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { COST_DEFAULTS } from ${JSON.stringify(costModelUrl)};

assert.equal(COST_DEFAULTS.externalExpressionCost, 35);
assert.equal(COST_DEFAULTS.internalExpressionCost, 25);
`);
});

test("motivation costs: simple=25, advanced=50 (design §6.6)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { COST_DEFAULTS } from ${JSON.stringify(costModelUrl)};

assert.equal(COST_DEFAULTS.simpleMotivationCost, 25);
assert.equal(COST_DEFAULTS.advancedMotivationCost, 50);
`);
});

test("minimum external affinity package cost: 30 + 10 + 35 = 75 (design §6.5)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { COST_DEFAULTS, computeCumulativeStackCost } from ${JSON.stringify(costModelUrl)};

const minExternal = COST_DEFAULTS.affinityBaseCost + computeCumulativeStackCost(1) + COST_DEFAULTS.externalExpressionCost;
assert.equal(minExternal, 75);
`);
});

test("minimum internal affinity package cost: 30 + 10 + 25 = 65 (design §6.5)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { COST_DEFAULTS, computeCumulativeStackCost } from ${JSON.stringify(costModelUrl)};

const minInternal = COST_DEFAULTS.affinityBaseCost + computeCumulativeStackCost(1) + COST_DEFAULTS.internalExpressionCost;
assert.equal(minInternal, 65);
`);
});

test("runtime external mana use: 5 + 4·(s-1)² (design §9.1)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { computeExternalManaUse } from ${JSON.stringify(costModelUrl)};

assert.equal(computeExternalManaUse(1), 5);
assert.equal(computeExternalManaUse(2), 9);
assert.equal(computeExternalManaUse(3), 21);
assert.equal(computeExternalManaUse(4), 41);
assert.equal(computeExternalManaUse(5), 69);
`);
});

test("runtime internal mana upkeep: 2 + s (design §9.2)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { computeInternalManaUpkeep } from ${JSON.stringify(costModelUrl)};

assert.equal(computeInternalManaUpkeep(1), 3);
assert.equal(computeInternalManaUpkeep(2), 4);
assert.equal(computeInternalManaUpkeep(3), 5);
assert.equal(computeInternalManaUpkeep(4), 6);
assert.equal(computeInternalManaUpkeep(5), 7);
`);
});

test("external range: 1 + s (design §10.1)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { computeExternalRange } from ${JSON.stringify(costModelUrl)};

assert.equal(computeExternalRange(1), 2);
assert.equal(computeExternalRange(3), 4);
`);
});

test("internal radius: 1 + s (design §10.2)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { computeInternalRadius } from ${JSON.stringify(costModelUrl)};

assert.equal(computeInternalRadius(1), 2);
assert.equal(computeInternalRadius(3), 4);
`);
});

test("draw net formula: 3·min(s,e) - (2+s) (design §11.3)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { computeDrawNet } from ${JSON.stringify(costModelUrl)};

// fire +1 + draw, e=1: 3×min(1,1) - (2+1) = 3 - 3 = 0
assert.equal(computeDrawNet(1, 1), 0);

// fire +3 + draw, e=2: 3×min(3,2) - (2+3) = 6 - 5 = 1
assert.equal(computeDrawNet(3, 2), 1);

// fire +3 + draw, e=4: 3×min(3,4) - (2+3) = 9 - 5 = 4
assert.equal(computeDrawNet(3, 4), 4);
`);
});

test("emit strength: s (design §12.2)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { computeEmitStrength } from ${JSON.stringify(costModelUrl)};

assert.equal(computeEmitStrength(1), 1);
assert.equal(computeEmitStrength(3), 3);
assert.equal(computeEmitStrength(5), 5);
`);
});

test("affinity package validation: requires kind + stacks + expression (design §5.1)", () => {
  runEsm(`
import assert from "node:assert/strict";
import { normalizeAffinityList } from ${JSON.stringify(costModelUrl)};

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
`);
});
