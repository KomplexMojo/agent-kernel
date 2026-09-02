/**
 * Icon semantics: which categories the sprite language can actually speak for,
 * what shape and colour each key gets, and where it must decline.
 *
 * The important behaviour here is the DECLINING. Roles and affinities have a
 * shape and a colour in the sprite language; expressions and motivations do not,
 * and inventing marks for them would be design invention dressed up as a port.
 */
const assert = require("node:assert/strict");

const {
  buildIconModel,
  ICON_SHAPES,
  ICON_NEUTRAL_INK,
  EXPRESSION_GEOMETRY,
  ICON_GLYPH_EXTENT,
} = require("../../packages/runtime/src/render/icon-model.js");
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

// --- Expression glyph distinctness -----------------------------------------
//
// Rasterises the geometry primitives the resolver draws from, so this measures
// the shapes themselves rather than the markup they happen to compile to.

/** Coverage mask of one glyph at `size` px, in the 0..100 icon viewBox. */
function rasterize(primitives, size) {
  const mask = new Set();
  const s = size / 100;
  const mark = (x, y) => {
    const px = Math.round(x * s);
    const py = Math.round(y * s);
    if (px >= 0 && py >= 0 && px < size && py < size) mask.add(py * size + px);
  };
  // Stamp a disc of the stroke width so round caps and joins are represented.
  const stamp = (x, y, w) => {
    const r = w / 2;
    for (let dy = -r; dy <= r; dy += 0.5) {
      for (let dx = -r; dx <= r; dx += 0.5) {
        if (dx * dx + dy * dy <= r * r) mark(x + dx, y + dy);
      }
    }
  };
  const segment = (x1, y1, x2, y2, w) => {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
    for (let i = 0; i <= steps; i += 1) {
      const t = steps === 0 ? 0 : i / steps;
      stamp(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w);
    }
  };
  for (const p of primitives) {
    if (p.type === "line") segment(p.x1, p.y1, p.x2, p.y2, p.width);
    else if (p.type === "poly") {
      for (let i = 0; i < p.points.length - 1; i += 1) {
        segment(p.points[i][0], p.points[i][1], p.points[i + 1][0], p.points[i + 1][1], p.width);
      }
    } else if (p.type === "circle") {
      if (p.filled) {
        for (let dy = -p.r; dy <= p.r; dy += 0.5) {
          for (let dx = -p.r; dx <= p.r; dx += 0.5) {
            if (dx * dx + dy * dy <= p.r * p.r) mark(p.cx + dx, p.cy + dy);
          }
        }
      } else {
        const steps = Math.ceil(2 * Math.PI * p.r * 2);
        for (let i = 0; i <= steps; i += 1) {
          const a = (i / steps) * 2 * Math.PI;
          stamp(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a), p.width);
        }
      }
    }
  }
  return mask;
}

function overlap(a, b) {
  let inter = 0;
  for (const v of a) if (b.has(v)) inter += 1;
  return inter / (a.size + b.size - inter);
}

test("expression glyphs stay distinguishable down to 16px", () => {
  // The pair that forced this: emit and draw were first the same eight-ray burst
  // differing only by ray direction, then only by a solid-versus-hollow core.
  // Both cues vanish at 16px. Measuring overlap is what catches that; asserting
  // "the markup differs" would not have.
  const MAX_OVERLAP = 0.6;
  const keys = Object.keys(EXPRESSION_GEOMETRY);
  for (const size of [28, 20, 16]) {
    const masks = keys.map((k) => rasterize(EXPRESSION_GEOMETRY[k], size));
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const o = overlap(masks[i], masks[j]);
        assert.ok(
          o <= MAX_OVERLAP,
          `${keys[i]} and ${keys[j]} overlap ${o.toFixed(3)} at ${size}px (ceiling ${MAX_OVERLAP})`,
        );
      }
    }
  }
});

test("expression glyphs sit at the same optical size as the other icons", () => {
  // Reported from the rail: the expressions row read larger than the rows above
  // and below it. It was -- emit's rays reached radius 48 and draw's outer ring
  // 44, against roughly 31 for every shape glyph, so those two nearly touched the
  // chip edge while the rest had margin.
  const reach = (p) => {
    if (p.type === "line") {
      return Math.max(
        Math.hypot(p.x1 - 50, p.y1 - 50),
        Math.hypot(p.x2 - 50, p.y2 - 50),
      ) + p.width / 2;
    }
    if (p.type === "poly") {
      return Math.max(...p.points.map(([x, y]) => Math.hypot(x - 50, y - 50))) + p.width / 2;
    }
    return p.r + (p.filled ? 0 : p.width / 2);
  };
  for (const [key, prims] of Object.entries(EXPRESSION_GEOMETRY)) {
    const extent = Math.max(...prims.map(reach));
    assert.ok(
      extent <= ICON_GLYPH_EXTENT,
      `${key} reaches radius ${extent.toFixed(1)}, past the ${ICON_GLYPH_EXTENT} glyph envelope`,
    );
  }
});

test("every expression glyph actually covers part of its chip at 16px", () => {
  for (const [key, prims] of Object.entries(EXPRESSION_GEOMETRY)) {
    const share = rasterize(prims, 16).size / (16 * 16);
    assert.ok(share > 0.08, `${key} covers only ${(share * 100).toFixed(1)}% at 16px`);
    assert.ok(share < 0.9, `${key} covers ${(share * 100).toFixed(1)}% at 16px -- no silhouette left`);
  }
});

// ## TODO: Test Permutations
// Named permutations awaiting /local-test-gen. Empty bodies on purpose -- see
// tests/README.md: un-skipping one creates a vacuously passing empty test.
test.skip("every types key in GAME_COLOR_PALETTE resolves to a model", () => {});
test.skip("category and key casing is normalized consistently", () => {});
test.skip("ui category keys resolve to text models", () => {});
test.skip("every generated colour clears contrast against the chip wash", () => {});
