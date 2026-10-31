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
  // room hashes into that footprint. Leading it through the body painted corridor art inside a
  // room the player had walked (draw-reach seed 9 playtest). Body-overlap tiles are not hallways.
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
  assert.deepEqual(lines, ["@"], "room is one mark; doorway tile on the body footprint is not a stub");
});

test("spawn or doorway on a room body block is not a dangling corridor stub", () => {
  // full-budget-tactics seed 9: spawn S sits one tile north of the start room but shares the
  // room's notebook cell, which used to render as `│` above `@`.
  const rows = [
    "????????",
    "????S???",
    "???.....",
    "???.....",
    "???.....",
    "???.....",
    "????????",
    "????????",
  ];
  const rooms = [room({ id: "R8", x: 3, y: 2, width: 5, height: 4 })];
  const { lines } = buildNotebook({
    rows, legend: { ...legend, fog: "?", wallGlyphs: ["│", "─", "┌", "┐", "└", "┘", "├", "┤", "┬", "┴", "┼"] },
    rooms, player: { x: 5, y: 2 }, scale: 4,
  });
  assert.deepEqual(lines, ["@"]);
});

test("a short doorway compressed onto room footprints still joins the two marks", () => {
  // Two rooms one tile apart: the door tile sits outside both rects but in a body block, so it
  // must not paint a stub on the footprint — yet the pies still need a line between them.
  const rows = [
    "~~~~~~~~~~~~",
    "~~~~~~~~~~~~",
    "~~....~~~~~~",
    "~~....~~~~~~",
    "~~....~~~~~~",
    "~~....~~~~~~",
    "~~~.~~~~~~~~",
    "~~....~~~~~~",
    "~~....~~~~~~",
    "~~....~~~~~~",
    "~~....~~~~~~",
    "~~~~~~~~~~~~",
  ];
  const rooms = [
    room({ id: "A", x: 2, y: 2, width: 4, height: 4, seen: 1, done: 1, explored: true }),
    room({ id: "B", x: 2, y: 7, width: 4, height: 4, seen: 1, done: 0 }),
  ];
  const { lines } = buildNotebook({ rows, legend, rooms, player: { x: 3, y: 3 }, scale: 4 });
  const drawing = lines.join("\n");
  assert.match(drawing, /@/);
  assert.match(drawing, /◌/);
  // Scale may place the two marks in neighbouring cells (no │ between) or one apart (a │).
  assert.equal(lines.length, 2, "door joins the rooms into one contiguous sketch");
  assert.doesNotMatch(drawing, /[└┘┌┐├┤┬┴┼]/);
});

test("a hallway outside the room footprint still meets the room mark", () => {
  // Room starts at y=5 so body blocks are y>=1; hallway floor at y=1..3 sits in block y=0 and
  // must be led down to the pie (full-budget-tactics seed 9 geometry).
  const rows = Array.from({ length: 16 }, () => "~".repeat(16));
  const put = (x, y, ch) => { const row = [...rows[y]]; row[x] = ch; rows[y] = row.join(""); };
  const rooms = [room({ x: 2, y: 5, width: 8, height: 8, seen: 2, done: 1 })];
  for (let y = 5; y < 13; y += 1) for (let x = 2; x < 10; x += 1) put(x, y, ".");
  put(5, 1, ".");
  put(5, 2, ".");
  put(5, 3, ".");
  const { lines } = buildNotebook({ rows, legend, rooms, player: null, scale: 4 });
  const drawing = lines.join("\n");
  assert.match(drawing, /◒/);
  assert.match(drawing, /│/, "hallway meets the room");
  assert.doesNotMatch(drawing, /[└┘┌┐├┤┬┴┼]/);
});
