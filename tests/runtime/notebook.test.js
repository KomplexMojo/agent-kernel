/**
 * The notebook (Darren, 2026-10-30): the player's remembered context, drawn as symbols. A room is
 * one pie, hallways are single lines, and the pie counts only what was seen there.
 */
const assert = require("node:assert/strict");
const { buildNotebook, pieQuarters, PIE_GLYPHS } = require("../../packages/runtime/src/render/notebook.js");

const legend = { wall: "#", floor: ".", fog: "~", wallGlyphs: [] };
const room = (over = {}) => ({ id: "R1", x: 0, y: 0, width: 4, height: 4, seen: 0, done: 0, explored: false, ...over });

test("pies count only what was seen, and full needs the room explored", () => {
  assert.equal(pieQuarters(room()), 0);
  assert.equal(pieQuarters(room({ explored: true })), 4);
  assert.equal(pieQuarters(room({ seen: 4, done: 1 })), 1);
  assert.equal(pieQuarters(room({ seen: 4, done: 2 })), 2);
  assert.equal(pieQuarters(room({ seen: 4, done: 3 })), 3);
  assert.equal(pieQuarters(room({ seen: 4, done: 4 })), 3);
  assert.equal(pieQuarters(room({ seen: 4, done: 4, explored: true })), 4);
});

test("every pie is one column wide (East Asian Width N, #575)", () => {
  for (const glyph of PIE_GLYPHS) assert.equal([...glyph].length, 1);
  assert.deepEqual(PIE_GLYPHS, ["◌", "◔", "◒", "◕", "◉"]);
});

test("two rooms joined by a hallway are two pies and a single line between them", () => {
  const fog = "~".repeat(16);
  const rows = [fog, "................", fog, fog];
  const rooms = [room({ id: "A", x: 0, y: 0, width: 4, height: 4 }), room({ id: "B", x: 12, y: 0, width: 4, height: 4, seen: 2, done: 1 })];
  const { lines } = buildNotebook({ rows, legend, rooms, player: null });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^◌[─]+◒$/);
});

test("the room you stand in is marked @ and named; nothing noted gives no lines", () => {
  const { lines, here } = buildNotebook({ rows: ["....", "....", "....", "...."], legend, rooms: [room()], player: { x: 1, y: 1 } });
  assert.deepEqual(lines, ["@"]);
  assert.equal(here.id, "R1");
  assert.deepEqual(buildNotebook({ rows: ["~~"], legend, rooms: [] }).lines, []);
});

test("a doorway stub outside one room does not draw phantom hallways through the room", () => {
  // Scale-4 blocks: room body is several notebook cells; a single seen floor tile north of the
  // room used to be led through the body to the centre, so the notebook looked like corridors
  // inside a room the player had fully walked (draw-reach seed 9 playtest).
  const rows = [
    "~~~~~~~~~~~~",
    "~~~~~.~~~~~~",
    "~~........~~",
    "~~........~~",
    "~~........~~",
    "~~........~~",
    "~~........~~",
    "~~........~~",
    "~~........~~",
    "~~........~~",
    "~~~~~~~~~~~~",
    "~~~~~~~~~~~~",
  ];
  const rooms = [room({ x: 2, y: 2, width: 8, height: 8, seen: 40, done: 10 })];
  const { lines } = buildNotebook({ rows, legend, rooms, player: { x: 5, y: 5 }, scale: 4 });
  const drawing = lines.join("\n");
  assert.match(drawing, /@/);
  // Junctions only appear when a path was painted through the room body; stubs may still show │.
  assert.doesNotMatch(drawing, /[└┘┌┐├┤┬┴┼]/, "no corridor junctions inside the room");
});
