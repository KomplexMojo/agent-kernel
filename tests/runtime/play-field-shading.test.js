/**
 * #287 — the board shows every affinity field on each floor tile, for every kind
 * alike (Darren, 2026-10-15: "this needs to apply to all affinities"). Core reads the
 * field after opposite pairs cancel; play-session carries it on the view, masked to
 * what the player sees; render blends the palette's affinity colours into the fill.
 */
const assert = require("node:assert/strict");

const { AFFINITY_KINDS } = require("../../packages/runtime/src/contracts/domain-constants.js");
const { GAME_AFFINITY_COLOR_HEX } = require("../../packages/runtime/src/contracts/game-elements.js");
const { asciiFieldCellStyle } = require("../../packages/runtime/src/render/ascii-cell-style.js");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { renderScreen } = require("../../packages/ui-ascii/src/screen.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const OPPOSITES = [["fire", "water"], ["earth", "wind"], ["growth", "decay"], ["corrode", "fortify"], ["light", "dark"]];
const HALL = ["###########", "S.........E", "###########"];
const PLAYER = { category: "delver", id: "hero", position: { x: 1, y: 1 }, vitals: viableVitals(), motivations: ["user_controlled"] };

function trap(id, kind, x, stacks = 2) {
  return {
    category: "hazard", id, position: { x, y: 1 },
    vitals: { durability: { current: 10, max: 10, regen: 1 }, mana: { current: 30, max: 30, regen: 30 } },
    affinities: [{ kind, expression: "emit", stacks }], activeAffinityKey: `${kind}:emit`,
  };
}

const session = (traps, options = {}) =>
  createPlaySession({ ...buildUnifiedLevel({ id: "field", tiles: HALL, actors: [PLAYER, ...traps] }), ...options });
const kindsAt = (view, x) => (view.field[1][x] || []).map((entry) => entry.kind);

test("every affinity kind's field reaches the view on the tiles around its source", async () => {
  assert.equal(AFFINITY_KINDS.length, 10);
  for (const kind of AFFINITY_KINDS) {
    const view = (await session([trap("t", kind, 6)])).view();
    assert.deepEqual(kindsAt(view, 5), [kind], `${kind} beside its source`);
    assert.equal(view.field[1][5][0].stacks, 2, `${kind} stacks`);
  }
});

test("every opposite pair cancels where equal fields meet, and unrelated kinds layer", async () => {
  for (const [a, b] of OPPOSITES) {
    const view = (await session([trap("ta", a, 4), trap("tb", b, 6)])).view();
    assert.deepEqual(kindsAt(view, 5), [], `${a}/${b} cancel at the midpoint`);
  }
  const layered = (await session([trap("ta", "fire", 4), trap("tb", "growth", 6)])).view();
  assert.deepEqual([...kindsAt(layered, 5)].sort(), ["fire", "growth"]);
});

test("with fog the view only carries the field on cells the player sees now", async () => {
  const view = (await session([trap("t", "decay", 8)], { fog: true })).view();
  view.sight.forEach((row, y) => [...row].forEach((mark, x) => {
    if (mark !== "v") assert.deepEqual(view.field[y][x], [], `${x},${y} unseen`);
  }));
});

test("a field tints the fill toward its affinity colour, opposed or mixed alike", () => {
  const floor = { fg: "#8a8588", bg: "#241f22" };
  assert.deepEqual(asciiFieldCellStyle(floor, []), floor);
  assert.equal(asciiFieldCellStyle(null, [{ kind: "fire", falloff: 1 }]), null);
  for (const kind of AFFINITY_KINDS) {
    const tinted = asciiFieldCellStyle(floor, [{ kind, stacks: 1, falloff: 1 }]);
    assert.notEqual(tinted.bg, floor.bg, kind);
    // Closer to the affinity colour than the bare floor is.
    const distance = (a, b) => [1, 3, 5].reduce((sum, i) => sum + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);
    assert.ok(distance(tinted.bg, GAME_AFFINITY_COLOR_HEX[kind]) < distance(floor.bg, GAME_AFFINITY_COLOR_HEX[kind]), kind);
  }
  const mixed = asciiFieldCellStyle(floor, [{ kind: "growth", falloff: 1 }, { kind: "fire", falloff: 1 }]);
  assert.notEqual(mixed.bg, asciiFieldCellStyle(floor, [{ kind: "growth", falloff: 1 }]).bg);
  assert.notEqual(mixed.bg, asciiFieldCellStyle(floor, [{ kind: "fire", falloff: 1 }]).bg);
});

test("the screen tints floor under a field and leaves the text unchanged", async () => {
  const view = (await session([trap("t", "decay", 6)])).view();
  const tinted = renderScreen({ view, levelName: "field", color: true });
  const bare = renderScreen({ view: { ...view, field: null }, levelName: "field", color: true });
  assert.notEqual(tinted, bare);
  const strip = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");
  // #479: the covered floor also carries a plain-text mark; apart from it the text is the same.
  const boardOf = (text) => text.split("\n").slice(0, 5).join("\n");
  assert.equal(boardOf(strip(tinted)).replace(/:/g, "."), boardOf(strip(bare)));
  assert.equal(strip(tinted).split("\n").slice(5).join("\n"), strip(bare).split("\n").slice(5).join("\n"));
});

// #485: a field that helps whoever stands in it reads differently from one that harms, read from
// the affinity table for every kind alike; and the HUD names it even at full vitals.
test("each field cell says whether it restores a vital, from the affinity table, for every kind", async () => {
  const restoring = [];
  for (const kind of AFFINITY_KINDS) {
    const view = (await session([trap("t", kind, 6)])).view();
    const entry = view.field[1][5][0];
    assert.equal(typeof entry.restores, "boolean", kind);
    assert.ok(["health", "mana", "stamina", "durability"].includes(entry.vital), `${kind} names its vital`);
    assert.deepEqual(entry.sources, ["t"], `${kind} names its source`);
    if (entry.restores) restoring.push(kind);
  }
  assert.ok(restoring.length > 0 && restoring.length < AFFINITY_KINDS.length, "some kinds help and some harm");
});

test("a helping field draws its glyph toward the resource colour and a harming one toward the hazard colour", () => {
  const floor = { fg: "#8a8588", bg: "#241f22" };
  const helped = asciiFieldCellStyle(floor, [{ kind: "growth", falloff: 1, restores: true }]);
  const harmed = asciiFieldCellStyle(floor, [{ kind: "decay", falloff: 1, restores: false }]);
  const plain = asciiFieldCellStyle(floor, [{ kind: "growth", falloff: 1 }]);
  assert.notEqual(helped.fg, plain.fg);
  assert.notEqual(helped.fg, harmed.fg);
  const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  assert.ok(channel(helped.fg, 1) > channel(helped.fg, 0), "helping reads green-ish");
  assert.ok(channel(harmed.fg, 0) > channel(harmed.fg, 1), "harming reads red-ish");
});

test("standing in someone else's restoring field says so at full vitals; a harmful or own field does not", async () => {
  const helpful = (await session([trap("t", "fortify", 2)])).view();
  assert.match(renderScreen({ view: helpful, levelName: "field" }), /Field here: restores DU/);
  const harmful = (await session([trap("t", "corrode", 2)])).view();
  assert.doesNotMatch(renderScreen({ view: harmful, levelName: "field" }), /Field here:/);
  const own = (await createPlaySession({ ...buildUnifiedLevel({ id: "own", tiles: HALL, actors: [
    { ...PLAYER, affinities: [{ kind: "fortify", expression: "emit", stacks: 2 }], activeAffinityKey: "fortify:emit" }] }) })).view();
  assert.doesNotMatch(renderScreen({ view: own, levelName: "own" }), /Field here:/);
});

// #479: an active field is marked in plain text on empty floor, for every kind alike.
test("a field marks the empty floor it covers with a colourless glyph, for every kind", async () => {
  const board = (view) => renderScreen({ view, levelName: "field", color: false }).split("\n").slice(2, 5).join("\n");
  for (const kind of AFFINITY_KINDS) assert.match(board((await session([trap("t", kind, 6)])).view()), /:/, `${kind} marks its floor`);
  assert.doesNotMatch(board((await session([])).view()), /:/);
});

// #479: a warden once seen stays at its last known spot until that cell is seen empty.
test("a seen warden stays known where it was last seen until the cell is seen empty", async () => {
  const warden = { category: "warden", id: "guard", position: { x: 2, y: 1 }, vitals: viableVitals(), motivations: ["defending"] };
  const play = await session([warden], { fog: true });
  assert.equal(play.view().actors.length, 1);
  await play.act({ kind: "move", params: { direction: "west" } });
  let view = play.view();
  assert.equal(view.actors.length, 0, "out of sight now");
  assert.deepEqual(view.lastSeen.map((a) => [a.id, a.position.x, a.position.y]), [["guard", 2, 1]]);
  assert.match(renderScreen({ view, levelName: "field" }), /\n  @\.W/);
  await play.act({ kind: "move", params: { direction: "east" } });
  view = play.view();
  assert.equal(view.actors.length, 1);
  assert.deepEqual(view.lastSeen, [], "seen again, no stale copy");
});

// ## TODO: Test Permutations
// - a stronger opposite leaves its remainder tinted at the meeting tile
// - draw expressions never tint the floor
// - a remembered cell keeps its faded style with no live field
// - tint grows with falloff up to ASCII_FIELD_TINT_MAX
// - walls, spawn and exit cells are never tinted
