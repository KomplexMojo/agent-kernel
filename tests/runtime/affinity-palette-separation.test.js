/**
 * Executable form of the M2 palette decision (interface-refinement.md).
 *
 * The affinity palette is the ONLY channel carrying affinity on a board sprite --
 * the silhouette is spent on role. So "these ten colours are far enough apart" is
 * not a matter of taste here, it is a load-bearing property, and it regressed
 * silently before: the previous palette had `corrode`/`light` at dE 14.6 and
 * `earth`/`decay` at 22.3, i.e. three visually identical pairs shipping as ten
 * distinct game elements.
 *
 * These gates fail the suite on any colour edit that reintroduces that. They are
 * measured, not asserted against a frozen list, so a *better* palette still passes.
 *
 * Metric is CIE76 dE. It overstates differences in saturated blues, but it is
 * cheap, stable and dependency-free; the derivation script also reports CIEDE2000.
 */
const assert = require("node:assert/strict");

const {
  GAME_AFFINITY_COLOR_HEX,
  GAME_AFFINITY_TEXT_COLOR_HEX,
  GAME_COLOR_PALETTE,
} = require("../../packages/runtime/src/contracts/game-elements.js");
const { AFFINITY_OPPOSITES, AFFINITY_KINDS } = require("../../packages/runtime/src/contracts/domain-constants.js");
const {
  ENTITY_SPRITE_OUTLINE_DARK,
  ENTITY_SPRITE_OUTLINE_LIGHT,
  outlineForFill,
} = require("../../packages/runtime/src/render/entity-sprite-composer.js");

// --- CIE76 dE, self-contained so the guard cannot be weakened by editing a helper.
function labOf(hex) {
  const linear = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  });
  const [r, g, b] = linear;
  const X = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const Y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const Z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function dE(a, b) {
  const [l1, a1, b1] = labOf(a);
  const [l2, a2, b2] = labOf(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

// Thresholds. Chosen from what the derived palette actually achieves, with the
// headroom stated, so a regression trips before a human notices it on screen.
const MIN_PAIRWISE = 45;   // achieved 53.0
const MIN_VS_TILE = 30;    // achieved 30.7 -- TIGHT, see the note on the test
const MIN_OPPOSITE = 90;   // achieved 103.1
const MIN_OUTLINE_VS_FILL = 40; // achieved 42.9

test("every affinity pair is separable at sprite scale", () => {
  const kinds = Object.keys(GAME_AFFINITY_COLOR_HEX);
  assert.equal(kinds.length, AFFINITY_KINDS.length, "palette and AFFINITY_KINDS disagree on membership");
  let worst = { d: Infinity, a: "", b: "" };
  for (let i = 0; i < kinds.length; i += 1) {
    for (let j = i + 1; j < kinds.length; j += 1) {
      const d = dE(GAME_AFFINITY_COLOR_HEX[kinds[i]], GAME_AFFINITY_COLOR_HEX[kinds[j]]);
      if (d < worst.d) worst = { d, a: kinds[i], b: kinds[j] };
    }
  }
  assert.ok(
    worst.d >= MIN_PAIRWISE,
    `${worst.a}/${worst.b} are only dE ${worst.d.toFixed(1)} apart (floor ${MIN_PAIRWISE}). ` +
      "Two affinities that look alike on the board are two game elements the player cannot tell apart.",
  );
});

test("every affinity is visible against every tile colour", () => {
  // The sprite fill carries figure-ground against the board; the outline only has
  // to define the edge. So this runs against EVERY tile in the canonical palette,
  // not just the floor -- an actor standing on an exit tile is the case that bites.
  let worst = { d: Infinity, affinity: "", tile: "" };
  for (const [tile, bg] of Object.entries(GAME_COLOR_PALETTE.tiles)) {
    for (const [affinity, hex] of Object.entries(GAME_AFFINITY_COLOR_HEX)) {
      const d = dE(hex, bg);
      if (d < worst.d) worst = { d, affinity, tile };
    }
  }
  assert.ok(
    worst.d >= MIN_VS_TILE,
    `${worst.affinity} is only dE ${worst.d.toFixed(1)} from the ${worst.tile} tile (floor ${MIN_VS_TILE}). ` +
      "A sprite that matches the tile under it disappears.",
  );
});

test("opposed affinities are the most visually distant pairs", () => {
  // AFFINITY_OPPOSITES is a domain fact, and counterplay only works if a player
  // can identify an opponent's element at a glance. Opposition is carried on
  // three axes because ten hues do not fit one wheel: hue (fire/water,
  // earth/wind, life/decay), chroma (corrode/fortify), lightness (light/dark).
  const seen = new Set();
  for (const [a, b] of Object.entries(AFFINITY_OPPOSITES)) {
    const key = [a, b].sort().join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    const d = dE(GAME_AFFINITY_COLOR_HEX[a], GAME_AFFINITY_COLOR_HEX[b]);
    assert.ok(
      d >= MIN_OPPOSITE,
      `${a}/${b} are opposites but only dE ${d.toFixed(1)} apart (floor ${MIN_OPPOSITE})`,
    );
  }
  assert.equal(seen.size, 5, "expected five opposite pairs");
});

test("the sprite outline contrasts with every fill it is drawn against", () => {
  // Regression guard with a real history: a single near-white outline measured
  // dE 23.4 against the near-white `light` fill, so a light sprite was a white
  // blob with no visible edge. The outline is now chosen from fill lightness.
  let worst = { d: Infinity, affinity: "" };
  for (const [affinity, hex] of Object.entries(GAME_AFFINITY_COLOR_HEX)) {
    const outline = outlineForFill(hex);
    assert.ok(
      outline === ENTITY_SPRITE_OUTLINE_LIGHT || outline === ENTITY_SPRITE_OUTLINE_DARK,
      `${affinity} resolved an outline outside the declared pair`,
    );
    const d = dE(outline, hex);
    if (d < worst.d) worst = { d, affinity };
  }
  assert.ok(
    worst.d >= MIN_OUTLINE_VS_FILL,
    `the outline is only dE ${worst.d.toFixed(1)} from the ${worst.affinity} fill (floor ${MIN_OUTLINE_VS_FILL}); ` +
      "without an edge the silhouette stops reading",
  );
});

test("affinity labels are readable on the UI panel", () => {
  // Text is judged differently from fills: a fill answers to the dark board tiles,
  // a label answers to the dark UI panel by WCAG contrast, and the two disagree.
  // Mirroring the fills straight into text left `earth` at 2.18:1 and `dark` at
  // 1.09:1 -- labels nobody could read. Hence the overrides in AFFINITY_TEXT_COLORS.
  const PANEL = "#1e1818";
  const AA_NORMAL = 4.5;
  const relLum = (hex) => {
    const c = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  let worst = { r: Infinity, affinity: "" };
  for (const [affinity, hex] of Object.entries(GAME_AFFINITY_TEXT_COLOR_HEX)) {
    const r = contrast(hex, PANEL);
    if (r < worst.r) worst = { r, affinity };
  }
  assert.ok(
    worst.r >= AA_NORMAL,
    `the ${worst.affinity} label is only ${worst.r.toFixed(2)}:1 against the panel (WCAG AA needs ${AA_NORMAL}:1)`,
  );
});

test("the tile palette is the single origin for board backgrounds", () => {
  // Five separate colour sources existed before M2: this constant, a duplicate in
  // ui-web/tile-affinity-visuals.js whose wind/decay/corrode had already drifted
  // to different colours, the Phaser FLOOR_BG, the level-preview map, and this
  // one -- which was canonical and used by nothing but tests.
  for (const key of ["floor", "wall", "barrier", "spawn", "exit", "inaccessible", "fog"]) {
    assert.match(
      GAME_COLOR_PALETTE.tiles[key] || "",
      /^#[0-9a-f]{6}$/,
      `tiles.${key} missing from the canonical palette`,
    );
  }
});

// ## TODO: Test Permutations
// Named permutations awaiting /local-test-gen. Empty bodies on purpose -- see
// tests/README.md: un-skipping one creates a vacuously passing empty test.
test.skip("stack-intensity tiers preserve pairwise separation at every tier", () => {});
test.skip("no affinity collides with the actor or item default colours", () => {});
test.skip("palette stays separable under a protanopia simulation", () => {});
test.skip("palette stays separable under a deuteranopia simulation", () => {});
test.skip("palette stays separable under a tritanopia simulation", () => {});
