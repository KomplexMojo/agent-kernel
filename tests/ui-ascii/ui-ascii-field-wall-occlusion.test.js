/**
 * AK-10: own light emit must not paint `:` on fog past a wall. Kernel occlusion is
 * the source of truth; the ASCII overlay only marks cells the field actually reaches.
 */
const assert = require("node:assert/strict");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { overlayFieldMarks, renderScreen } = require("../../packages/ui-ascii/src/screen.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const tiles = [
  "##########",
  "#..#.....#",
  "#..#.....#",
  "#..#.....#",
  "##########",
];

test("light emit r2 does not paint ':' through an adjacent wall onto fog", async () => {
  const session = await createPlaySession({
    ...buildUnifiedLevel({
      id: "light-wall",
      tiles,
      actors: [{
        category: "delver", id: "hero", position: { x: 2, y: 2 }, motivations: ["user_controlled"],
        vitals: viableVitals({ mana: 80 }),
        affinities: [{ kind: "light", expression: "emit", stacks: 2, intensity: 1 }],
        activeAffinityKey: "light:emit",
      }],
    }),
    fog: true,
  });
  const view = session.view();
  assert.equal(view.player.position.x, 2);
  assert.equal(view.player.position.y, 2);
  // Far-side floor / fog at (4,2) is Manhattan 2 — was marked before occlusion.
  assert.deepEqual(view.field[2][4], [], "no field past the wall");
  assert.deepEqual(view.field[2][3], [], "no field on the wall cell");
  assert.ok((view.field[2][1] || []).length > 0, "same-room floor still carries the field");

  const board = overlayFieldMarks(view.rows, view.field, view.legend.floor, view.legend.fog);
  assert.notEqual([...board[2]][4], ":", "overlay must not paint beyond the wall");
  const screen = renderScreen({ view, levelName: "light-wall", color: false, showHelp: false });
  assert.match(screen, /Slot 1: light emit r2/);
  assert.doesNotMatch(screen.split("\n").find((line) => line.includes("@")) ?? "", /│:@│:/);
});

// ## TODO: Test Permutations
// - dark emit through a wall stays hidden on fog the same way
// - an open doorway (floor) still shows ':' along the clear line
