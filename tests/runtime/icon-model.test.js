/**
 * Icon semantics: which categories the sprite language can actually speak for,
 * what shape and colour each key gets, and where it must decline.
 *
 * The important behaviour here is the DECLINING. Roles and affinities have a
 * shape and a colour in the sprite language; expressions and motivations do not,
 * and inventing marks for them would be design invention dressed up as a port.
 */
const assert = require("node:assert/strict");

const { buildIconModel, ICON_SHAPES, ICON_NEUTRAL_INK } = require("../../packages/runtime/src/render/icon-model.js");
const {
  GAME_COLOR_PALETTE,
  GAME_AFFINITY_COLOR_HEX,
} = require("../../packages/runtime/src/contracts/game-elements.js");
const { AFFINITY_KINDS } = require("../../packages/runtime/src/contracts/domain-constants.js");
const {
  ENTITY_SPRITE_OUTLINE_DARK,
  ENTITY_SPRITE_OUTLINE_LIGHT,
  outlineForFill,
} = require("../../packages/runtime/src/render/entity-sprite-composer.js");

test("roles keep the silhouettes they have on the board", () => {
  // An icon for a delver must be the same shape as a delver on the board, or the
  // left rail and the board are two different languages again.
  // `resource` is an ITEM, not a type -- GAME_COLOR_PALETTE.types has no such key,
  // so asking for types/resource correctly returns null rather than a guess.
  const types = { delver: "delver", attacker: "delver", warden: "warden", defender: "warden", hazard: "hazard" };
  for (const [key, shape] of Object.entries(types)) {
    assert.equal(buildIconModel("types", key)?.shape, shape, `types/${key}`);
  }
  assert.equal(buildIconModel("types", "resource"), null, "resource is not a type");
  assert.equal(buildIconModel("items", "hazard")?.shape, "hazard");
  assert.equal(buildIconModel("items", "resource")?.shape, "resource");
});

test("every affinity resolves to its canonical colour", () => {
  for (const kind of AFFINITY_KINDS) {
    const model = buildIconModel("affinities", kind);
    assert.equal(model.kind, "shape", `${kind} should be a generated shape`);
    assert.equal(model.colorHex, GAME_AFFINITY_COLOR_HEX[kind], `${kind} colour`);
  }
});

test("affinity icons are colour, not shape", () => {
  // Colour is the affinity channel; the silhouette is spent on role. So every
  // affinity shares one neutral mark and differs only in fill.
  const shapes = new Set(AFFINITY_KINDS.map((k) => buildIconModel("affinities", k).shape));
  assert.equal(shapes.size, 1, `affinities must share one mark, got ${[...shapes].join(", ")}`);
});

test("vitals take their colour from the canonical vital palette", () => {
  for (const [key, hex] of Object.entries(GAME_COLOR_PALETTE.vitals)) {
    const model = buildIconModel("vitals", key);
    assert.equal(model.colorHex, hex, `vitals/${key}`);
  }
});

test("expressions are geometry, motivations are marks, and only ui declines", () => {
  // Expressions are directional, so their geometry is near-literal. Motivations are
  // abstract AND a generated family scheme provably cannot cover twelve of them --
  // four family shapes times a filled/hollow split is eight slots -- so they stay
  // typographic inside the same chip. Only `ui` sits outside the chip system.
  for (const key of ["push", "pull", "emit", "draw"]) {
    const model = buildIconModel("expressions", key);
    assert.equal(model?.kind, "shape", `expressions/${key}`);
    assert.equal(model.shape, key, `expressions/${key} shape`);
  }
  for (const key of ["exploring", "attacking", "user_controlled"]) {
    const model = buildIconModel("motivations", key);
    assert.equal(model?.kind, "glyph", `motivations/${key}`);
    assert.ok(model.mark, `motivations/${key} needs a mark`);
  }
  assert.equal(buildIconModel("ui", "game-inspector")?.kind, "text");
});

test("colour identifies for roles and affinities, and only contains elsewhere", () => {
  // Expression colours are all cyan (worst pair dE 10.0) and motivation colours
  // collide (7.2). Drawing those glyphs in their own colours would imply a
  // distinction that is not there, so the ink goes neutral and colour becomes wash.
  for (const [cat, key] of [["types", "delver"], ["affinities", "fire"], ["vitals", "health"]]) {
    const m = buildIconModel(cat, key);
    assert.equal(m.inkHex, m.colorHex, `${cat}/${key} should draw in its own colour`);
    assert.ok(m.outlineHex, `${cat}/${key} needs the board outline`);
  }
  for (const [cat, key] of [["expressions", "push"], ["motivations", "exploring"]]) {
    const m = buildIconModel(cat, key);
    assert.equal(m.inkHex, ICON_NEUTRAL_INK, `${cat}/${key} should use neutral ink`);
    assert.notEqual(m.inkHex, m.colorHex, `${cat}/${key} colour must not pose as identity`);
  }
});

test("the outline is the same rule the board sprite uses", () => {
  // Not a second implementation: the icon must go dark-on-light and light-on-dark
  // by exactly the rule that keeps `light` from being an edgeless blob on the board.
  for (const kind of AFFINITY_KINDS) {
    const model = buildIconModel("affinities", kind);
    assert.equal(model.outlineHex, outlineForFill(model.colorHex), `${kind} outline`);
  }
  assert.equal(buildIconModel("affinities", "light").outlineHex, ENTITY_SPRITE_OUTLINE_DARK);
  assert.equal(buildIconModel("affinities", "dark").outlineHex, ENTITY_SPRITE_OUTLINE_LIGHT);
});

test("every generated shape is one the renderer knows how to draw", () => {
  for (const category of ["types", "items", "affinities", "vitals"]) {
    for (const key of Object.keys(GAME_COLOR_PALETTE[category] ?? GAME_AFFINITY_COLOR_HEX)) {
      const model = buildIconModel(category, key);
      if (model?.kind !== "shape") continue;
      assert.ok(ICON_SHAPES.includes(model.shape), `${category}/${key} -> unknown shape ${model.shape}`);
    }
  }
});

test("unknown categories and keys return null rather than guessing", () => {
  assert.equal(buildIconModel("sorcery", "fire"), null);
  assert.equal(buildIconModel("affinities", "plasma"), null);
  assert.equal(buildIconModel("types", "wizard"), null);
  assert.equal(buildIconModel(null, null), null);
});

test("the model is serializable", () => {
  const model = buildIconModel("types", "warden");
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
});

// ## TODO: Test Permutations
// Named permutations awaiting /local-test-gen. Empty bodies on purpose -- see
// tests/README.md: un-skipping one creates a vacuously passing empty test.
test.skip("every types key in GAME_COLOR_PALETTE resolves to a model", () => {});
test.skip("category and key casing is normalized consistently", () => {});
test.skip("ui category keys resolve to text models", () => {});
test.skip("every generated colour clears contrast against the chip wash", () => {});
