const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/affinity-resolution-v1-basic.json"), "utf8"));
const effectsModule = moduleUrl("packages/runtime/src/personas/configurator/affinity-effects.js");
const loadoutsModule = moduleUrl("packages/runtime/src/personas/configurator/affinity-loadouts.js");
const rulesModule = moduleUrl("packages/runtime/src/personas/configurator/affinity-rules.js");

test("affinity effects resolve vitals and abilities deterministically", () => {
  const script = `
import assert from "node:assert/strict";
import { resolveAffinityEffects } from ${JSON.stringify(effectsModule)};
import { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } from ${JSON.stringify(loadoutsModule)};

const fixture = ${JSON.stringify(fixture)};
assert.equal(fixture.schema, "agent-kernel/AffinityResolutionFixture");
assert.equal(fixture.schemaVersion, 1);

const presetResult = normalizeAffinityPresetCatalog({ presets: fixture.input.presets });
assert.equal(presetResult.ok, true);
const loadoutResult = normalizeActorLoadoutCatalog({ loadouts: fixture.input.loadouts }, { presets: presetResult.value.presets });
assert.equal(loadoutResult.ok, true);

const result = resolveAffinityEffects({
  presets: presetResult.value.presets,
  loadouts: loadoutResult.value.loadouts,
  baseVitalsByActorId: fixture.input.baseVitalsByActorId,
  traps: fixture.input.traps,
});

assert.deepEqual(result, fixture.expected);
const second = resolveAffinityEffects({
  presets: presetResult.value.presets,
  loadouts: loadoutResult.value.loadouts,
  baseVitalsByActorId: fixture.input.baseVitalsByActorId,
  traps: fixture.input.traps,
});
assert.deepEqual(second, fixture.expected);
`;
  runEsm(script);
});

test("draw expression siphons matching ambient pressure into default resource conversion", () => {
  const script = `
import assert from "node:assert/strict";
import { resolveAffinityEffects } from ${JSON.stringify(effectsModule)};

const result = resolveAffinityEffects({
  presets: [
    {
      id: "affinity_fire_draw",
      kind: "fire",
      expression: "draw",
      manaCost: 0,
      effects: {},
      stack: { max: 3, scaling: "linear" },
    },
  ],
  loadouts: [
    {
      actorId: "actor_drawer",
      affinities: [{ presetId: "affinity_fire_draw", kind: "fire", expression: "draw", targetType: "self", stacks: 2 }],
    },
  ],
  baseVitalsByActorId: {
    actor_drawer: {
      health: { current: 5, max: 10, regen: 0 },
      mana: { current: 1, max: 5, regen: 0 },
      stamina: { current: 0, max: 3, regen: 0 },
      durability: { current: 0, max: 3, regen: 0 },
    },
  },
  rooms: [
    { id: "room_fire", affinities: [{ kind: "fire", expression: "emit", stacks: 3 }] },
  ],
});

assert.equal(result.actors[0].vitals.mana.current, 3);
const drawEffect = result.actors[0].resolvedEffects.find((entry) => entry.id === "fire:draw:self:vital");
assert.ok(drawEffect);
assert.equal(drawEffect.operation, "draw_vital_affinity");
assert.equal(drawEffect.targetVital, "mana");
assert.equal(drawEffect.potency, 2);
assert.equal(drawEffect.siphonedStacks, 2);
`;
  runEsm(script);
});

test("draw does not restore without matching net pressure and pull remains non-restorative", () => {
  const script = `
import assert from "node:assert/strict";
import { resolveAffinityEffects } from ${JSON.stringify(effectsModule)};

const result = resolveAffinityEffects({
  presets: [
    {
      id: "affinity_fire_draw",
      kind: "fire",
      expression: "draw",
      manaCost: 0,
      effects: {},
      stack: { max: 3, scaling: "linear" },
    },
    {
      id: "affinity_fire_pull",
      kind: "fire",
      expression: "pull",
      manaCost: 0,
      effects: {},
      stack: { max: 3, scaling: "linear" },
    },
  ],
  loadouts: [
    {
      actorId: "actor_drawer",
      affinities: [{ presetId: "affinity_fire_draw", kind: "fire", expression: "draw", targetType: "self", stacks: 2 }],
    },
    {
      actorId: "actor_puller",
      affinities: [{ presetId: "affinity_fire_pull", kind: "fire", expression: "pull", targetType: "self", stacks: 2 }],
    },
  ],
  baseVitalsByActorId: {
    actor_drawer: {
      health: { current: 5, max: 10, regen: 0 },
      mana: { current: 1, max: 5, regen: 0 },
      stamina: { current: 0, max: 3, regen: 0 },
      durability: { current: 0, max: 3, regen: 0 },
    },
    actor_puller: {
      health: { current: 5, max: 10, regen: 0 },
      mana: { current: 1, max: 5, regen: 0 },
      stamina: { current: 0, max: 3, regen: 0 },
      durability: { current: 0, max: 3, regen: 0 },
    },
  },
  rooms: [
    { id: "room_water", affinities: [{ kind: "water", expression: "emit", stacks: 3 }] },
  ],
});

assert.equal(result.actors[0].vitals.mana.current, 1);
assert.equal(result.actors[1].vitals.mana.current, 1);
const drawEffect = result.actors[0].resolvedEffects.find((entry) => entry.id === "fire:draw:self:vital");
assert.ok(drawEffect);
assert.equal(drawEffect.operation, "draw_vital_affinity");
assert.equal(drawEffect.potency, 0);
const pullEffect = result.actors[1].resolvedEffects.find((entry) => entry.id === "fire:pull:self:vital");
assert.ok(pullEffect);
assert.equal(pullEffect.operation, "apply_vital_affinity");
`;
  runEsm(script);
});

test("draw conversion mapping can be configured by affinity rules globals", () => {
  const script = `
import assert from "node:assert/strict";
import { resolveAffinityEffects } from ${JSON.stringify(effectsModule)};
import { resolveAffinityRules } from ${JSON.stringify(rulesModule)};

const rules = JSON.parse(JSON.stringify(resolveAffinityRules()));
rules.globals = {
  ...(rules.globals || {}),
  drawConversion: {
    byAffinity: {
      fire: { targetVital: "stamina", efficiency: 2 },
    },
  },
};

const result = resolveAffinityEffects({
  presets: [
    {
      id: "affinity_fire_draw",
      kind: "fire",
      expression: "draw",
      manaCost: 0,
      effects: {},
      stack: { max: 3, scaling: "linear" },
    },
  ],
  loadouts: [
    {
      actorId: "actor_drawer",
      affinities: [{ presetId: "affinity_fire_draw", kind: "fire", expression: "draw", targetType: "self", stacks: 1 }],
    },
  ],
  baseVitalsByActorId: {
    actor_drawer: {
      health: { current: 5, max: 10, regen: 0 },
      mana: { current: 1, max: 5, regen: 0 },
      stamina: { current: 0, max: 4, regen: 0 },
      durability: { current: 0, max: 3, regen: 0 },
    },
  },
  rooms: [
    { id: "room_fire", affinities: [{ kind: "fire", expression: "emit", stacks: 1 }] },
  ],
  affinityRules: rules,
});

assert.equal(result.actors[0].vitals.stamina.current, 2);
const drawEffect = result.actors[0].resolvedEffects.find((entry) => entry.id === "fire:draw:self:vital");
assert.ok(drawEffect);
assert.equal(drawEffect.targetVital, "stamina");
assert.equal(drawEffect.potency, 2);
`;
  runEsm(script);
});
