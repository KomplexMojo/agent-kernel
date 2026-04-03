const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/configurator/cost-model.js");

test("fixed-position world actor cost model supports neutral 1-token atoms", () => {
  const script = `
import assert from "node:assert/strict";
import {
  calculateFixedPositionWorldActorCost,
  normalizeFixedPositionWorldActorCostProfile,
} from ${JSON.stringify(modulePath)};

const errors = [];
const profile = normalizeFixedPositionWorldActorCostProfile({
  id: "neutral_floor_or_barrier_atom",
  kind: "floor",
  stationary: true,
  neutralBaseline: true,
  tokenCost: 1,
  vitals: { health: 0, mana: 0, stamina: 0, durability: 0 },
  regen: { health: 0, mana: 0, stamina: 0 },
}, errors, "profile");
assert.equal(errors.length, 0);

const result = calculateFixedPositionWorldActorCost({ profile });
assert.equal(result.ok, true);
assert.equal(result.cost, 1);
`;
  runEsm(script);
});

test("fixed-position world actor cost allows stationary affinity states without regen investment", () => {
  const script = `
import assert from "node:assert/strict";
import { calculateFixedPositionWorldActorCost } from ${JSON.stringify(modulePath)};

const result = calculateFixedPositionWorldActorCost({
  profile: {
    id: "stationary_trap_low_power",
    kind: "trap",
    stationary: true,
    tokenCost: 10,
    vitals: { mana: 0, durability: 4 },
    regen: { mana: 0 },
    affinity: { kind: "fire", expression: "emit", stacks: 3 },
  },
  allowZeroReserveAffinityState: true,
  regenOptional: true,
});
assert.equal(result.ok, true);
assert.ok(result.cost >= 10);
`;
  runEsm(script);
});

test("fixed-position world actor cost rejects malformed neutral baselines", () => {
  const script = `
import assert from "node:assert/strict";
import { calculateFixedPositionWorldActorCost } from ${JSON.stringify(modulePath)};

const result = calculateFixedPositionWorldActorCost({
  profile: {
    id: "neutral_floor_or_barrier_atom",
    kind: "floor",
    stationary: true,
    neutralBaseline: true,
    tokenCost: 2,
    vitals: { health: 0, mana: 0, stamina: 0, durability: 0 },
    regen: { health: 0, mana: 0, stamina: 0 },
  },
});
assert.equal(result.ok, false);
assert.ok(result.errors.some((entry) => entry.code === "neutral_baseline_requires_token_cost_1"));
`;
  runEsm(script);
});

test("trap archetype rules enforce constrained stationary attacking profiles", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeTrapArchetypeRules } from ${JSON.stringify(modulePath)};

const errors = [];
const rules = normalizeTrapArchetypeRules({
  roomBounded: true,
  attackingOnly: false,
  maxAffinityCount: 2,
  maxExpressionCount: 1,
  stacksAllowed: true,
  manaReserveRequired: true,
  manaRegenOptional: true,
  allowedExpressions: ["emit", "draw"],
}, errors, "trap");
assert.equal(rules.roomBounded, true);
assert.ok(errors.some((entry) => entry.code === "trap_archetype_requires_attacking_only"));
assert.ok(errors.some((entry) => entry.code === "trap_archetype_requires_single_affinity"));
`;
  runEsm(script);
});
