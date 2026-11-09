/**
 * #814 / #815 — the graphical overlay model reads what the terminal paints: the same fields,
 * tint, marks, cast arrows and defeat marks, from one place. Draw sustains ride on their own
 * `view.drawField` grid and never touch `view.field`.
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { buildAffinityBoardOverlayModel } = require("../../packages/runtime/src/render/client-surface.js");
const { ASCII_FIELD_TINT_MAX, asciiFieldCellStyle, affinityFieldTint } = require("../../packages/runtime/src/render/ascii-cell-style.js");
const { AFFINITY_COLOR_HEX } = require("../../packages/runtime/src/render/affinity-palette.js");
const { overlayFieldMarks } = require("../../packages/ui-ascii/src/screen.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const HALL = ["###########", "S.........E", "###########"];
const PLAYER = (affinities = []) => ({ category: "delver", id: "hero", position: { x: 1, y: 1 }, vitals: viableVitals({ mana: 60 }),
  motivations: ["user_controlled"], affinities });
const hazard = (id, kind, x, expression = "emit", stacks = 2) => ({
  category: "hazard", id, position: { x, y: 1 },
  vitals: { durability: { current: 10, max: 10, regen: 1 }, mana: { current: 30, max: 30, regen: 30 } },
  affinities: [{ kind, expression, stacks }], activeAffinityKey: `${kind}:${expression}`,
});
const session = (actors, options = {}) => createPlaySession({ ...buildUnifiedLevel({ id: "overlay", tiles: HALL, actors }), ...options });

test("the field layer carries the tint, mark and per-contributor numbers the terminal paints from", async () => {
  const view = (await session([PLAYER(), hazard("ta", "fire", 5), hazard("tb", "growth", 8)])).view();
  const model = buildAffinityBoardOverlayModel(view);
  assert.equal(model.width, 11);
  assert.equal(model.height, 3);
  const mixed = model.cells[1].find((cell) => cell.field?.contributors.length === 2);
  assert.ok(mixed, "a cell where fire and growth meet");
  const x = model.cells[1].indexOf(mixed);
  const tint = affinityFieldTint(view.field[1][x]);
  assert.deepEqual(mixed.field.tint, { mix: tint.mix, alpha: tint.alpha, valence: tint.valence });
  // The model's tint is the very one the terminal paints: same mix, same strength.
  const floor = { fg: "#8a8588", bg: "#241f22" };
  assert.notDeepEqual(asciiFieldCellStyle(floor, view.field[1][x]), floor);
  assert.equal(mixed.field.mark, true, "the terminal's ':' shows on empty floor under a field");
  for (const entry of mixed.field.contributors) {
    const source = view.field[1][x].find((candidate) => candidate.kind === entry.kind);
    assert.equal(entry.hex, AFFINITY_COLOR_HEX[entry.kind]);
    assert.equal(entry.falloff, source.falloff);
    assert.equal(entry.intensity, source.intensity);
    assert.equal(entry.stacks, source.stacks);
    assert.equal(entry.strength, source.falloff * source.intensity * source.intensity);
    assert.deepEqual(entry.sources, source.sources);
    assert.equal(entry.restores, source.restores);
  }
  assert.ok(Math.abs(mixed.field.contributors.reduce((sum, entry) => sum + entry.weight, 0) - 1) < 1e-9);
  assert.equal(model.cells[1][0].field, null, "no field, no layer");
});

test("a player emit is carried too, and the terminal's marks fall on the same cells", async () => {
  const play = await session([PLAYER([{ kind: "dark", expression: "emit", stacks: 3 }]), hazard("ta", "fire", 6)]);
  await play.act({ kind: "equip_affinity", params: { affinityKey: "dark:emit" } });
  const view = play.view();
  const model = buildAffinityBoardOverlayModel(view);
  const marked = overlayFieldMarks(view.rows, view.field, view.legend.floor, view.legend.fog);
  view.rows.forEach((row, y) => [...row].forEach((glyph, x) => {
    assert.equal(model.cells[y][x].field?.mark === true, marked[y][x] === ":" && glyph !== ":", `${x},${y}`);
  }));
  assert.ok(model.cells.flat().some((cell) => cell.field?.mark));
});

test("fog: unseen cells carry no live field; only the viewer's own reach remains, flagged own", async () => {
  const view = (await session([PLAYER([{ kind: "dark", expression: "emit", stacks: 3 }]), hazard("t", "decay", 9)], { fog: true })).view();
  const model = buildAffinityBoardOverlayModel(view);
  model.cells.forEach((row) => row.forEach((cell) => {
    if (cell.sight !== "v" && cell.field) assert.ok(cell.field.own && cell.field.contributors.every((entry) => entry.strength === null));
  }));
  assert.ok(model.cells[1][9].field === null, "another actor's field out of sight stays hidden");
});

async function castOver(expression) {
  const play = await session([PLAYER([{ kind: "fire", expression, stacks: 3 }]), hazard("t", "decay", 4)]);
  await play.act({ kind: "equip_affinity", params: { affinityKey: `fire:${expression}` } });
  await play.act({ kind: "cast_affinity", params: { targetId: "t", affinityKey: `fire:${expression}` } });
  return buildAffinityBoardOverlayModel(play.view());
}

test("cast paths: a push points away from the caster, tinted by its kind", async () => {
  const cast = (await castOver("push")).cells[1].map((cell) => cell.cast).filter(Boolean);
  assert.ok(cast.length > 0, "the push path reaches the model");
  for (const cell of cast) {
    assert.deepEqual([cell.kind, cell.expression, cell.glyph, cell.direction, cell.hex],
      ["fire", "push", ">", "east", AFFINITY_COLOR_HEX.fire]);
    assert.equal(cell.alpha, ASCII_FIELD_TINT_MAX);
  }
});

test("cast paths: a pull is the same path reversed, pointing back at the caster", async () => {
  const cast = (await castOver("pull")).cells[1].map((cell) => cell.cast).filter(Boolean);
  assert.ok(cast.length > 0);
  for (const cell of cast) assert.deepEqual([cell.expression, cell.glyph, cell.direction], ["pull", "<", "west"]);
});

test("draw sustains: their own drawField grid, expression draw, never in view.field", async () => {
  const play = await session([PLAYER(), hazard("td", "light", 5, "draw", 2), hazard("te", "fire", 8)]);
  const view = play.view();
  const draws = view.drawField[1].flatMap((cell) => cell);
  assert.ok(draws.length > 0, "the draw reach is projected");
  assert.ok(draws.every((entry) => entry.expression === "draw" && entry.kind === "light" && entry.restores === false));
  assert.ok(view.field[1].flatMap((cell) => cell).every((entry) => entry.kind !== "light"), "emit's grid never carries a draw");
  const model = buildAffinityBoardOverlayModel(view);
  const cell = model.cells[1].find((entry) => entry.draw);
  assert.ok(cell.draw.contributors.every((entry) => entry.expression === "draw"));
  assert.equal(cell.draw.mark, false, "a draw has no emit mark");
  assert.equal(cell.field, null, "a draw does not paint an emit wash");
});

test("a same-kind emit and draw stay two entries in two grids", async () => {
  const view = (await session([PLAYER(), hazard("te", "fire", 4), hazard("td", "fire", 6, "draw", 2)])).view();
  const x = 5;
  assert.deepEqual(view.field[1][x].map((entry) => entry.kind), ["fire"]);
  assert.deepEqual(view.drawField[1][x].map((entry) => `${entry.kind}:${entry.expression}`), ["fire:draw"]);
});

test("draw fog: out of sight only the viewer's own draw reach is kept", async () => {
  const view = (await session([PLAYER([{ kind: "light", expression: "draw", stacks: 3 }]), hazard("td", "dark", 9, "draw", 2)], { fog: true })).view();
  view.sight.forEach((row, y) => [...row].forEach((mark, x) => {
    if (mark !== "v") assert.ok(view.drawField[y][x].every((entry) => entry.own === true), `${x},${y}`);
  }));
});

test("the overlay model needs a view", () => {
  assert.throws(() => buildAffinityBoardOverlayModel(null), /play-session view/);
});

// ## TODO: Test Permutations
// - defeat and spent marks land on floor only
// - every opposite pair cancelled to nothing yields no field layer
// - walls and entities hide cast arrows, as the terminal does
