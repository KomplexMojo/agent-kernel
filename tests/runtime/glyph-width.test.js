// #575: every board glyph is exactly one terminal column wide. No dependency: the check is a small
// table of the code points we draw with, plus structural checks (one grapheme, no emoji presentation).
const assert = require("node:assert/strict");

const { ACTOR_GLYPH_SETS } = require("../../packages/runtime/src/render/actor-glyphs.js");
const { WALL_GLYPH_SETS } = require("../../packages/runtime/src/render/wall-glyphs.js");

// East Asian Width Narrow (Na) or Neutral (N), checked with Python unicodedata when chosen.
const NARROW_OR_NEUTRAL = new Set([..."@DWHRB-|+", "◊", "▴", "☼", "◙", "▮"]);
// Named exception (#575): box-drawing and the isolated-wall square are East Asian Width Ambiguous.
// One column in every Western-locale terminal; `--ascii` is the escape hatch for CJK terminals.
const AMBIGUOUS_EXCEPTION = (char) => (char >= "─" && char <= "╿") || char === "■";
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u;

const everyGlyph = () => [
  ...Object.values(ACTOR_GLYPH_SETS).flatMap((set) => Object.values(set)),
  ...Object.values(WALL_GLYPH_SETS).flatMap((set) => Object.values(set)),
];

test("every actor and wall glyph is a single grapheme, one column wide, and not an emoji", () => {
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  for (const glyph of everyGlyph()) {
    assert.equal([...segmenter.segment(glyph)].length, 1, `${glyph} is one grapheme`);
    assert.equal([...glyph].length, 1, `${glyph} is one code point (no variation selector)`);
    assert.ok(!/\p{Emoji_Presentation}/u.test(glyph), `${glyph} has no emoji presentation`);
    assert.ok(!WIDE.test(glyph), `${glyph} is not in a wide block`);
    assert.ok(NARROW_OR_NEUTRAL.has(glyph) || AMBIGUOUS_EXCEPTION(glyph), `${glyph} is Narrow, Neutral or a named exception`);
  }
});

test("the Unicode actor set draws only Narrow or Neutral glyphs; the exception is walls alone", () => {
  for (const glyph of Object.values(ACTOR_GLYPH_SETS.unicode)) assert.ok(NARROW_OR_NEUTRAL.has(glyph), glyph);
  for (const glyph of Object.values(WALL_GLYPH_SETS.ascii)) assert.ok(NARROW_OR_NEUTRAL.has(glyph), glyph);
});

test("each role has its own glyph in a set", () => {
  for (const set of Object.values(ACTOR_GLYPH_SETS)) assert.equal(new Set(Object.values(set)).size, Object.keys(set).length);
});
