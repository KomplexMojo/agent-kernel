/**
 * Mini map prototype: a 2x2 downscale of the rows a seat has explored. Floor beats wall,
 * the fog glyph is unseen, and the block holding the seat is `@`.
 */
const assert = require("node:assert/strict");
const { buildMinimap } = require("../../packages/runtime/src/render/minimap.js");

const legend = { wall: "#", floor: ".", fog: "~", wallGlyphs: ["─", "│"] };

test("floor beats wall in a 2x2 block, and the seat's block is @", () => {
  const rows = ["##..", "##.#", "....", "...."];
  assert.deepEqual(buildMinimap({ rows, legend, player: { x: 3, y: 3 } }), ["#.", ".@"]);
  assert.deepEqual(buildMinimap({ rows: ["#.", ".#"], legend }), ["."]);
});

test("never-seen cells stay blank and margins are trimmed", () => {
  const rows = ["~~~~~~", "~~~~~~", "~~..#~", "~~..#~", "~~~~~~", "~~~~~~"];
  assert.deepEqual(buildMinimap({ rows, legend, player: null }), [".#"]);
});

test("connected wall glyphs count as wall; nothing explored gives no lines", () => {
  assert.deepEqual(buildMinimap({ rows: ["──", "││"], legend }), ["#"]);
  assert.deepEqual(buildMinimap({ rows: ["~~", "~~"], legend }), []);
});
