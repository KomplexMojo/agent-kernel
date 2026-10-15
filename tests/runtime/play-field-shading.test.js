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

const OPPOSITES = [["fire", "water"], ["earth", "wind"], ["life", "decay"], ["corrode", "fortify"], ["light", "dark"]];
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
  const layered = (await session([trap("ta", "fire", 4), trap("tb", "life", 6)])).view();
  assert.deepEqual([...kindsAt(layered, 5)].sort(), ["fire", "life"]);
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
  assert.equal(asciiFieldCellStyle(null, [{ kind: "fire", intensity: 1 }]), null);
  for (const kind of AFFINITY_KINDS) {
    const tinted = asciiFieldCellStyle(floor, [{ kind, stacks: 1, intensity: 1 }]);
    assert.notEqual(tinted.bg, floor.bg, kind);
    // Closer to the affinity colour than the bare floor is.
    const distance = (a, b) => [1, 3, 5].reduce((sum, i) => sum + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);
    assert.ok(distance(tinted.bg, GAME_AFFINITY_COLOR_HEX[kind]) < distance(floor.bg, GAME_AFFINITY_COLOR_HEX[kind]), kind);
  }
  const mixed = asciiFieldCellStyle(floor, [{ kind: "life", intensity: 1 }, { kind: "fire", intensity: 1 }]);
  assert.notEqual(mixed.bg, asciiFieldCellStyle(floor, [{ kind: "life", intensity: 1 }]).bg);
  assert.notEqual(mixed.bg, asciiFieldCellStyle(floor, [{ kind: "fire", intensity: 1 }]).bg);
});

test("the screen tints floor under a field and leaves the text unchanged", async () => {
  const view = (await session([trap("t", "decay", 6)])).view();
  const tinted = renderScreen({ view, levelName: "field", color: true });
  const bare = renderScreen({ view: { ...view, field: null }, levelName: "field", color: true });
  assert.notEqual(tinted, bare);
  const strip = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");
  assert.equal(strip(tinted), strip(bare));
});

// ## TODO: Test Permutations
// - a stronger opposite leaves its remainder tinted at the meeting tile
// - draw expressions never tint the floor
// - a remembered cell keeps its faded style with no live field
// - tint grows with intensity up to ASCII_FIELD_TINT_MAX
// - walls, spawn and exit cells are never tinted
