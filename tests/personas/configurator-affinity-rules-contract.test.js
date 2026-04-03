const test = require("node:test");
const { readFixture } = require("../helpers/fixtures");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/configurator/affinity-rules.js");
const wave1Fixture = readFixture("affinity-rules-artifact-v1-wave1.json");
const invalidTrapFixture = readFixture("invalid/affinity-rules-artifact-v1-invalid-trap-archetype.json");
const invalidCostFixture = readFixture("invalid/affinity-rules-artifact-v1-invalid-fixed-position-cost.json");

test("affinity rules normalize Wave 1 interaction contract and world actor model", () => {
  const script = `
import assert from "node:assert/strict";
import {
  normalizeAffinityRulesArtifact,
  resolveAffinityCastProfile,
} from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(wave1Fixture)};
const normalized = normalizeAffinityRulesArtifact(fixture);
assert.equal(normalized.ok, true);

const rules = normalized.value;
assert.equal(rules.interactionContract.expressionSemantics.push.channel, "projected");
assert.equal(rules.interactionContract.expressionSemantics.pull.channel, "projected");
assert.equal(rules.interactionContract.expressionSemantics.emit.channel, "field");
assert.equal(rules.interactionContract.expressionSemantics.draw.channel, "field");
assert.equal(rules.interactionContract.closeProximityNegation.enabled, true);
assert.equal(rules.interactionContract.closeProximityNegation.radiusTiles, 1);

const exampleIds = rules.interactionContract.interactionExamples.map((entry) => entry.id);
assert.ok(exampleIds.includes("ambient_fire_vs_water"));
assert.ok(exampleIds.includes("ambient_light_vs_dark"));
assert.ok(exampleIds.includes("projected_fire_push_vs_water_pull"));

assert.equal(rules.worldActorCostModel.roomWideAffinityMode, "optional");
assert.equal(rules.worldActorCostModel.fixedPositionNeutralProfile.tokenCost, 1);
assert.equal(rules.worldActorCostModel.trapArchetype.roomBounded, true);
assert.equal(rules.worldActorCostModel.trapArchetype.attackingOnly, true);
assert.equal(rules.worldActorCostModel.trapArchetype.maxAffinityCount, 1);
assert.equal(rules.worldActorCostModel.trapArchetype.maxExpressionCount, 1);
assert.equal(rules.worldActorCostModel.trapArchetype.highInvestmentProfile.stacks, 5);
assert.equal(rules.worldActorCostModel.mixedRoomAssembly.requireRectangularFootprint, true);
assert.equal(rules.worldActorCostModel.mixedRoomAssembly.allowRoomWideAffinityOverlay, true);
assert.equal(rules.worldActorCostModel.mixedRoomAssembly.overlapPolicy, "reject_any_overlap");
const mixedRoomTemplateIds = rules.worldActorCostModel.mixedRoomAssembly.templates.map((entry) => entry.id);
assert.ok(mixedRoomTemplateIds.includes("neutral_room_with_localized_traps"));
assert.ok(mixedRoomTemplateIds.includes("room_overlay_with_neutral_tiles"));
assert.ok(mixedRoomTemplateIds.includes("mixed_overlay_and_traps"));

const cast = resolveAffinityCastProfile({
  rules,
  kind: "fire",
  expression: "push",
  stacks: 2,
});
assert.ok(cast);
assert.equal(cast.channel, "projected");
assert.equal(cast.polarity, "outward");
assert.equal(cast.rangeBehavior.shape, "line");
`;
  runEsm(script);
});

test("affinity rules normalize custom mixed-room templates with overlays and heterogeneous traps", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityRulesArtifact } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(wave1Fixture)};
fixture.worldActorCostModel = fixture.worldActorCostModel || {};
fixture.worldActorCostModel.roomWideAffinityMode = "optional";
fixture.worldActorCostModel.mixedRoomAssembly = {
  placementCoordinateSpace: "room_local",
  requireRectangularFootprint: true,
  allowRoomWideAffinityOverlay: true,
  allowMixedTrapAffinities: true,
  overlapPolicy: "reject_any_overlap",
  outOfBoundsPolicy: "reject",
  budgetPolicy: "fixed_position_tokens",
  templates: [
    {
      id: "custom_mixed_room",
      width: 6,
      height: 4,
      budgetTokens: 52,
      defaultTileKind: "floor",
      defaultTileTokenCost: 1,
      roomWideOverlay: {
        kind: "light",
        expression: "emit",
        stacks: 2,
        tokenCost: 12,
      },
      localizedTraps: [
        {
          id: "fire_corner",
          x: 1,
          y: 1,
          tokenCost: 8,
          affinity: { kind: "fire", expression: "emit", stacks: 2 },
          manaReserve: 10,
          manaRegen: 1,
        },
        {
          id: "water_lane",
          x: 4,
          y: 2,
          tokenCost: 8,
          affinity: { kind: "water", expression: "pull", stacks: 2 },
          manaReserve: 10,
          manaRegen: 0,
        },
      ],
    },
  ],
};

const normalized = normalizeAffinityRulesArtifact(fixture);
assert.equal(normalized.ok, true);
assert.equal(normalized.value.worldActorCostModel.mixedRoomAssembly.templates.length, 1);
assert.equal(normalized.value.worldActorCostModel.mixedRoomAssembly.templates[0].roomWideOverlay.kind, "light");
assert.equal(normalized.value.worldActorCostModel.mixedRoomAssembly.templates[0].localizedTraps.length, 2);
`;
  runEsm(script);
});

test("affinity rules reject mixed-room overlap, out-of-bounds, and incompatible budget-affinity combinations", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityRulesArtifact } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(wave1Fixture)};
fixture.worldActorCostModel = fixture.worldActorCostModel || {};
fixture.worldActorCostModel.roomWideAffinityMode = "optional";
fixture.worldActorCostModel.mixedRoomAssembly = {
  placementCoordinateSpace: "room_local",
  requireRectangularFootprint: true,
  allowRoomWideAffinityOverlay: true,
  allowMixedTrapAffinities: true,
  overlapPolicy: "reject_any_overlap",
  outOfBoundsPolicy: "reject",
  budgetPolicy: "fixed_position_tokens",
  templates: [
    {
      id: "invalid_room",
      width: 3,
      height: 3,
      budgetTokens: 9,
      defaultTileKind: "floor",
      defaultTileTokenCost: 1,
      roomWideOverlay: {
        kind: "decay",
        expression: "emit",
        stacks: 1,
        tokenCost: 4,
      },
      localizedTiles: [
        { x: 1, y: 1, kind: "barrier", tokenCost: 1 },
      ],
      localizedTraps: [
        {
          id: "trap_a",
          x: 1,
          y: 1,
          tokenCost: 2,
          affinity: { kind: "fire", expression: "emit", stacks: 1 },
          manaReserve: 5,
          manaRegen: 0,
        },
        {
          id: "trap_b",
          x: 1,
          y: 1,
          tokenCost: 2,
          affinity: { kind: "water", expression: "pull", stacks: 1 },
          manaReserve: 5,
          manaRegen: 0,
        },
        {
          id: "trap_c",
          x: 3,
          y: 0,
          tokenCost: 2,
          affinity: { kind: "light", expression: "emit", stacks: 1 },
          manaReserve: 5,
          manaRegen: 0,
        },
      ],
    },
  ],
};

const normalized = normalizeAffinityRulesArtifact(fixture);
assert.equal(normalized.ok, false);
assert.ok(normalized.errors.some((entry) => entry.code === "overlap"));
assert.ok(normalized.errors.some((entry) => entry.code === "out_of_bounds"));
assert.ok(normalized.errors.some((entry) => entry.code === "incompatible_budget_affinity"));
assert.ok(normalized.errors.some((entry) => entry.code === "budget_exceeded"));
`;
  runEsm(script);
});

test("affinity rules reject malformed trap archetype contract", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityRulesArtifact } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(invalidTrapFixture)};
const normalized = normalizeAffinityRulesArtifact(fixture);
assert.equal(normalized.ok, false);
assert.ok(normalized.errors.some((entry) => entry.code === "trap_archetype_requires_attacking_only"));
assert.ok(normalized.errors.some((entry) => entry.code === "trap_archetype_requires_single_affinity"));
`;
  runEsm(script);
});

test("affinity rules reject malformed fixed-position neutral cost profiles", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityRulesArtifact } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(invalidCostFixture)};
const normalized = normalizeAffinityRulesArtifact(fixture);
assert.equal(normalized.ok, false);
assert.ok(normalized.errors.some((entry) => entry.code === "neutral_baseline_requires_token_cost_1"));
`;
  runEsm(script);
});
