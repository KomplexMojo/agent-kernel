/**
 * #620 — a thinking actor on your side that adopted a goal of its own shows it in the view's
 * `orders` (`adopted: true`), so you can read what a companion is doing without reading logs. A
 * hostile's adopted goal is never listed: that stays unknown to the player. The status strip
 * shows the ladder: the immediate goal (a hostile in sight) above the floor goal (the exit).
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { goalLadder, renderScreen } = require("../../packages/ui-ascii/src/screen.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const ROOM = ["############", "S..........#", "#..........#", "#..........#", "#..........E", "############"];
const HERO = { category: "delver", id: "hero", position: { x: 1, y: 1 }, vitals: viableVitals(), motivations: ["user_controlled"] };
const PAL = { category: "delver", id: "pal", position: { x: 1, y: 3 }, vitals: viableVitals(), motivations: ["friendly", "goal_oriented", "exploring"] };
const level = (actors) => buildUnifiedLevel({ id: "adopted", tiles: ROOM, actors, approaches: { exitApproach: { x: 10, y: 4 } } });

test("a companion's adopted goal is listed in orders; a hostile's is not", async () => {
  const guard = { category: "warden", id: "guard", position: { x: 8, y: 1 }, vitals: viableVitals(), motivations: ["goal_oriented", "attacking"] };
  const session = await createPlaySession({ ...level([HERO, PAL, guard]), fog: false });
  await session.act({ kind: "wait" });
  await session.act({ kind: "wait" });
  const orders = session.view().orders;
  const pal = orders.find((entry) => entry.id === "pal");
  assert.ok(pal, `pal listed: ${JSON.stringify(orders)}`);
  assert.equal(pal.adopted, true);
  assert.ok(pal.doing?.kind, "the goal it adopted is named");
  assert.equal(orders.some((entry) => entry.id === "guard"), false, "a hostile's adopted goal is not shown");
});

test("the status strip puts the nearest hostile above the exit goal, and just the exit when none is in sight", async () => {
  const guard = { category: "warden", id: "guard", position: { x: 5, y: 1 }, vitals: viableVitals(), motivations: ["stationary"] };
  const session = await createPlaySession({ ...level([HERO, guard]), fog: false });
  const view = session.view();
  assert.match(goalLadder(view).immediate, /^Now: deal with .* \(4 away\)\.$/);
  assert.match(renderScreen({ view, levelName: "adopted" }), /Now: deal with .* \(4 away\)\. Find the exit/);
  const calm = await createPlaySession({ ...level([HERO]), fog: false });
  assert.deepEqual(goalLadder(calm.view()), {});
});

// ## TODO: Test Permutations
