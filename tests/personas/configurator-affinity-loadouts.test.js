const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/configurator/affinity-loadouts.js");
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

test("affinity presets and loadouts normalize with defaults", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } from ${JSON.stringify(modulePath)};

const presetsFixture = ${JSON.stringify(presetsFixture)};
const loadoutsFixture = ${JSON.stringify(loadoutsFixture)};

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
`;
  runEsm(script);
});

test("affinity presets reject invalid kinds", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityPresetCatalog } from ${JSON.stringify(modulePath)};

const invalidPreset = ${JSON.stringify(invalidPreset)};
const result = normalizeAffinityPresetCatalog(invalidPreset);
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "invalid_kind"));
`;
  runEsm(script);
});

test("affinity presets reject invalid expressions", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityPresetCatalog } from ${JSON.stringify(modulePath)};

const invalidPreset = ${JSON.stringify(invalidExpressionPreset)};
const result = normalizeAffinityPresetCatalog(invalidPreset);
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "invalid_expression"));
`;
  runEsm(script);
});

test("loadouts reject unknown preset references", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } from ${JSON.stringify(modulePath)};

const presetsFixture = ${JSON.stringify(presetsFixture)};
const missingPresetLoadout = ${JSON.stringify(missingPresetLoadout)};
const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);
const result = normalizeActorLoadoutCatalog(missingPresetLoadout, { presets: presetsResult.value.presets });
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "unknown_preset"));
`;
  runEsm(script);
});

test("loadouts reject invalid expressions and non-affinity equipment", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } from ${JSON.stringify(modulePath)};

const presetsFixture = ${JSON.stringify(presetsFixture)};
const invalidExpressionLoadout = ${JSON.stringify(invalidExpressionLoadout)};
const nonAffinityLoadout = ${JSON.stringify(nonAffinityLoadout)};
const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);

const slotResult = normalizeActorLoadoutCatalog(invalidExpressionLoadout, { presets: presetsResult.value.presets });
assert.equal(slotResult.ok, false);
assert.ok(slotResult.errors.find((err) => err.code === "invalid_expression"));

const equipmentResult = normalizeActorLoadoutCatalog(nonAffinityLoadout, { presets: presetsResult.value.presets });
assert.equal(equipmentResult.ok, false);
assert.ok(equipmentResult.errors.find((err) => err.code === "non_affinity_equipment"));
`;
  runEsm(script);
});

test("loadouts reject missing actor ids", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } from ${JSON.stringify(modulePath)};

const presetsFixture = ${JSON.stringify(presetsFixture)};
const missingActorIdLoadout = ${JSON.stringify(missingActorIdLoadout)};
const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);
const result = normalizeActorLoadoutCatalog(missingActorIdLoadout, { presets: presetsResult.value.presets });
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "invalid_actor_id"));
`;
  runEsm(script);
});

test("loadouts reject stacks exceeding preset max", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } from ${JSON.stringify(modulePath)};

const presetsFixture = ${JSON.stringify(presetsFixture)};
const stacksExceedLoadout = ${JSON.stringify(stacksExceedLoadout)};
const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);
const result = normalizeActorLoadoutCatalog(stacksExceedLoadout, { presets: presetsResult.value.presets });
assert.equal(result.ok, false);
assert.ok(result.errors.find((err) => err.code === "stacks_exceed_max"));
`;
  runEsm(script);
});

test("loadouts enforce required expressions per actor", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } from ${JSON.stringify(modulePath)};

const presetsFixture = ${JSON.stringify(presetsFixture)};
const missingExpressionLoadout = ${JSON.stringify(missingExpressionLoadout)};
const presetsResult = normalizeAffinityPresetCatalog(presetsFixture);
const result = normalizeActorLoadoutCatalog(missingExpressionLoadout, {
  presets: presetsResult.value.presets,
  requiredExpressionsByActorId: { actor_mvp: ["push", "pull"] },
});
assert.equal(result.ok, false);
const error = result.errors.find((err) => err.code === "missing_required_expression");
assert.ok(error);
assert.equal(error.actorId, "actor_mvp");
`;
  runEsm(script);
});
