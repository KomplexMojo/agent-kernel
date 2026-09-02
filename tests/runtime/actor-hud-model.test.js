/**
 * The HUD view-model is where everything M1 stripped off the sprite reappears:
 * vitals, expression, motivation. Ordering, labels, colours and formatting are
 * semantics, so they live in runtime and `ui-web` only draws what it is handed
 * (charter: ui-web renders and emits intents, it does not own meaning).
 */
const assert = require("node:assert/strict");

const {
  buildActorHudModel,
  HUD_VITAL_LABELS,
} = require("../../packages/runtime/src/render/actor-hud-model.js");
const { GAME_COLOR_PALETTE } = require("../../packages/runtime/src/contracts/game-elements.js");
const {
  VITAL_KEYS,
  HAZARD_VITAL_KEYS,
  RESOURCE_VITAL_KEYS,
} = require("../../packages/runtime/src/contracts/domain-constants.js");

const DELVER = {
  id: "delver-1",
  type: "delver",
  position: { x: 2, y: 3 },
  affinities: [{ kind: "fire", expression: "push" }],
  motivation: "exploring",
  vitals: {
    health: { current: 34, max: 50, regen: 2 },
    mana: { current: 12, max: 30, regen: 1 },
    stamina: { current: 27, max: 30 },
    durability: { current: 18, max: 30 },
  },
};

test("carries the identity channels the sprite no longer shows", () => {
  const model = buildActorHudModel(DELVER);
  assert.equal(model.id, "delver-1");
  assert.equal(model.role, "delver");
  assert.equal(model.affinity, "fire");
  assert.equal(model.expression, "push");
  assert.equal(model.motivation, "exploring");
});

test("vitals come back ordered, labelled and coloured from the canonical palette", () => {
  const model = buildActorHudModel(DELVER);
  assert.deepEqual(model.vitals.map((v) => v.key), VITAL_KEYS);
  for (const vital of model.vitals) {
    assert.equal(vital.label, HUD_VITAL_LABELS[vital.key], `${vital.key} label`);
    assert.equal(
      vital.colorHex,
      GAME_COLOR_PALETTE.vitals[vital.key],
      `${vital.key} must take its colour from the canonical palette, not a copy`,
    );
  }
});

test("fraction is derived, clamped, and safe when max is zero", () => {
  const model = buildActorHudModel({
    ...DELVER,
    vitals: {
      health: { current: 25, max: 50 },
      mana: { current: 0, max: 0 },          // division by zero
      stamina: { current: 99, max: 30 },     // over-full
      durability: { current: -5, max: 30 },  // negative
    },
  });
  const by = Object.fromEntries(model.vitals.map((v) => [v.key, v]));
  assert.equal(by.health.fraction, 0.5);
  assert.equal(by.mana.fraction, 0, "max 0 must not produce NaN or Infinity");
  assert.equal(by.stamina.fraction, 1, "fraction must clamp at 1");
  assert.equal(by.durability.fraction, 0, "fraction must clamp at 0");
});

test("shows only the vitals its role actually has", () => {
  // Hazards carry mana + durability; resources carry health + mana + stamina.
  // Rendering four bars for every entity would invent two of them.
  const hazard = buildActorHudModel({
    id: "h1", type: "hazard", affinity: { kind: "decay" },
    vitals: { mana: { current: 3, max: 6 }, durability: { current: 8, max: 10 } },
  });
  assert.deepEqual(hazard.vitals.map((v) => v.key), [...HAZARD_VITAL_KEYS]);

  const resource = buildActorHudModel({
    id: "r1", type: "resource", affinity: { kind: "life" },
    vitals: { health: { current: 1, max: 2 }, mana: { current: 1, max: 2 }, stamina: { current: 1, max: 2 } },
  });
  assert.deepEqual(resource.vitals.map((v) => v.key), [...RESOURCE_VITAL_KEYS]);
});

test("omits a vital the entity does not report rather than inventing a zero bar", () => {
  const model = buildActorHudModel({
    id: "d2", type: "delver",
    vitals: { health: { current: 5, max: 10 } },
  });
  assert.deepEqual(model.vitals.map((v) => v.key), ["health"]);
});

test("regen is normalized to a non-negative integer", () => {
  const model = buildActorHudModel({
    ...DELVER,
    vitals: {
      health: { current: 1, max: 2, regen: 2.7 },
      mana: { current: 1, max: 2, regen: -4 },
      stamina: { current: 1, max: 2 },
      durability: { current: 1, max: 2, regen: "3" },
    },
  });
  const by = Object.fromEntries(model.vitals.map((v) => [v.key, v]));
  assert.equal(by.health.regen, 2);
  assert.equal(by.mana.regen, 0);
  assert.equal(by.stamina.regen, 0);
  assert.equal(by.durability.regen, 3);
});

test("the model is serializable — no functions, no class instances", () => {
  // Same rule persona context follows: this crosses a boundary, so it must survive
  // a JSON round-trip unchanged.
  const model = buildActorHudModel(DELVER);
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
});

test("returns null for something that is not an entity", () => {
  for (const input of [null, undefined, 42, "delver", []]) {
    assert.equal(buildActorHudModel(input), null, `${JSON.stringify(input)} should not produce a HUD`);
  }
});

test("survives an entity with no vitals, affinity, expression or motivation", () => {
  const model = buildActorHudModel({ id: "bare", type: "warden" });
  assert.equal(model.id, "bare");
  assert.equal(model.role, "warden");
  assert.deepEqual(model.vitals, []);
  assert.equal(model.expression, "");
  assert.equal(model.motivation, "");
});

test("reads affinity and expression from the shapes observations actually use", () => {
  // Same lesson as the sprite composer, where reading only the string form made
  // every hazard render as the default affinity.
  assert.equal(buildActorHudModel({ id: "a", affinity: "water" }).affinity, "water");
  assert.equal(buildActorHudModel({ id: "a", affinity: { kind: "water" } }).affinity, "water");
  assert.equal(buildActorHudModel({ id: "a", equippedAffinity: { kind: "water" } }).affinity, "water");
  assert.equal(
    buildActorHudModel({ id: "a", affinities: [{ kind: "water", expression: "draw" }] }).expression,
    "draw",
  );
});

// ## TODO: Test Permutations
// Named permutations awaiting /local-test-gen. Empty bodies on purpose -- see
// tests/README.md: un-skipping one creates a vacuously passing empty test.
test.skip("every motivation kind round-trips into the model unchanged", () => {});
test.skip("every affinity expression round-trips into the model unchanged", () => {});
test.skip("a vital reported as a bare number rather than an object is handled", () => {});
test.skip("very large vital values format without overflowing the label", () => {});
test.skip("warden and delver produce identical vital ordering", () => {});
