const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

const presetsFixture = readFixture("affinity-presets-artifact-v1-basic.json");
const loadoutsFixture = readFixture("actor-loadouts-artifact-v1-basic.json");
const invalidPreset = readFixture("invalid/affinity-presets-artifact-v1-invalid-kind.json");
const invalidExpressionPreset = readFixture("invalid/affinity-presets-artifact-v1-invalid-expression.json");
const missingPresetLoadout = readFixture("invalid/actor-loadouts-artifact-v1-missing-preset.json");
const invalidExpressionLoadout = readFixture("invalid/actor-loadouts-artifact-v1-invalid-slot.json");
const nonAffinityLoadout = readFixture("invalid/actor-loadouts-artifact-v1-non-affinity-equipment.json");
const missingActorIdLoadout = readFixture("invalid/actor-loadouts-artifact-v1-missing-actor-id.json");
const stacksExceedLoadout = readFixture("invalid/actor-loadouts-artifact-v1-stacks-exceed.json");
const missingExpressionLoadout = readFixture("invalid/actor-loadouts-artifact-v1-missing-required-expression.json");

test("affinity presets and loadouts normalize with defaults", async () => {const { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } = await import("../../packages/runtime/src/personas/configurator/affinity-loadouts.js");


const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);
assert.equal(presetsResult.ok, true);
const lifePull = presetsResult.value.presets.find((preset) => preset.id === "affinity_life_pull");
assert.equal(lifePull.manaCost, 0);
assert.equal(Array.isArray(lifePull.abilities), true);
assert.equal(lifePull.abilities.length, 1);
assert.equal(lifePull.vitalsModifiers.health.max, 2);

const loadoutsResult = normalizeActorLoadoutCatalog(loadoutsFixture, { presets: presetsResult.value.presets });
assert.equal(loadoutsResult.ok, true);
const actorLoadout = loadoutsResult.value.loadouts.find((entry) => entry.actorId === "actor_mvp");
const pullAffinity = actorLoadout.affinities.find((entry) => entry.expression === "pull");
assert.equal(pullAffinity.stacks, 1);
});

test("affinity presets reject invalid kinds", async () => {const { normalizeAffinityPresetCatalog } = await import("../../packages/runtime/src/personas/configurator/affinity-loadouts.js");

const result = normalizeAffinityPresetCatalog(invalidPreset);
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "invalid_kind"));
});

test("affinity presets reject invalid expressions", async () => {const { normalizeAffinityPresetCatalog } = await import("../../packages/runtime/src/personas/configurator/affinity-loadouts.js");

const invalidPreset = invalidExpressionPreset;
const result = normalizeAffinityPresetCatalog(invalidPreset);
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "invalid_expression"));
});

test("loadouts reject unknown preset references", async () => {const { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } = await import("../../packages/runtime/src/personas/configurator/affinity-loadouts.js");

const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);
const result = normalizeActorLoadoutCatalog(missingPresetLoadout, { presets: presetsResult.value.presets });
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "unknown_preset"));
});

test("loadouts reject invalid expressions and non-affinity equipment", async () => {const { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } = await import("../../packages/runtime/src/personas/configurator/affinity-loadouts.js");

const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);

const slotResult = normalizeActorLoadoutCatalog(invalidExpressionLoadout, { presets: presetsResult.value.presets });
assert.equal(slotResult.ok, false);
assert.ok(slotResult.errors.find((err) => err.code === "invalid_expression"));

const equipmentResult = normalizeActorLoadoutCatalog(nonAffinityLoadout, { presets: presetsResult.value.presets });
assert.equal(equipmentResult.ok, false);
assert.ok(equipmentResult.errors.find((err) => err.code === "non_affinity_equipment"));
});

test("loadouts reject invalid target types", async () => {const { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } = await import("../../packages/runtime/src/personas/configurator/affinity-loadouts.js");

const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);
const invalidTargetTypeLoadout = {
  loadouts: [
    {
      actorId: "actor_mvp",
      affinities: [
        {
          presetId: "affinity_fire_push",
          kind: "fire",
          expression: "push",
          stacks: 1,
          targetType: "ceiling",
        },
      ],
    },
  ],
};
const result = normalizeActorLoadoutCatalog(invalidTargetTypeLoadout, { presets: presetsResult.value.presets });
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "invalid_target_type"));
});

test("loadouts reject missing actor ids", async () => {const { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } = await import("../../packages/runtime/src/personas/configurator/affinity-loadouts.js");

const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);
const result = normalizeActorLoadoutCatalog(missingActorIdLoadout, { presets: presetsResult.value.presets });
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "invalid_actor_id"));
});

test("loadouts reject stacks exceeding preset max", async () => {const { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } = await import("../../packages/runtime/src/personas/configurator/affinity-loadouts.js");

const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);
const result = normalizeActorLoadoutCatalog(stacksExceedLoadout, { presets: presetsResult.value.presets });
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "stacks_exceed_max"));
});

test("loadouts enforce required expressions per actor", async () => {const { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } = await import("../../packages/runtime/src/personas/configurator/affinity-loadouts.js");

const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);
const result = normalizeActorLoadoutCatalog(missingExpressionLoadout, {
  presets: presetsResult.value.presets,
  requiredExpressionsByActorId: { actor_mvp: ["push", "pull"] },
});
assert.equal(result.ok, false);
const error = result.errors.find((err) => err.code === "missing_required_expression");
assert.ok(error);
assert.equal(error.actorId, "actor_mvp");
});
