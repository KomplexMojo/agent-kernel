/**
 * #428 — an actor that leaves says so. When an actor leaves by the exit or is defeated, the
 * view lists it under `departures` for that command and the screen prints one event, e.g.
 * `D2 scout left by the exit`; a defeat reads differently. Actors on the seated actor's side
 * are watched wherever they are; others only when the seat could see them, so fog leaks nothing.
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { departuresLine, renderScreen } = require("../../packages/ui-ascii/src/screen.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const ROOM = [
  "############",
  "S..........#",
  "#..........#",
  "#..........#",
  "#..........#",
  "#..........E",
  "############",
];

const HERO = { category: "delver", id: "hero", position: { x: 1, y: 1 }, vitals: viableVitals(), motivations: ["user_controlled"] };
const SCOUT = { category: "delver", id: "scout", position: { x: 1, y: 3 }, vitals: viableVitals(), motivations: ["friendly", "goal_oriented"] };
const level = (actors) => buildUnifiedLevel({ id: "departures", tiles: ROOM, actors, approaches: { exitApproach: { x: 10, y: 5 } } });

async function walkOut(session) {
  await session.order("scout", { goals: [{ kind: "reach", place: "exit" }] });
  for (let turn = 0; turn < 30; turn += 1) {
    await session.act({ kind: "wait" });
    if (session.view().departures.length > 0) return session.view();
  }
  return session.view();
}

test("a companion that leaves by the exit is shown leaving, out of sight too", async () => {
  const session = await createPlaySession({ ...level([HERO, SCOUT]), fog: true });
  const view = await walkOut(session);
  assert.deepEqual(view.departures, [{ id: "scout", label: "D2", role: "delver", how: "exited" }]);
  assert.equal(departuresLine(view), "D2 scout left by the exit");
  assert.match(renderScreen({ view, levelName: "departures" }), /D2 scout left by the exit/);
  await session.act({ kind: "wait" });
  assert.deepEqual(session.view().departures, [], "the event lasts one turn");
  assert.equal(departuresLine(session.view()), null);
});

test("a hostile leaving out of the seat's sight is shown only without fog", async () => {
  // Seated on the dungeon's side, a delver is a hostile; it walks out far from the warden.
  const warden = { ...HERO, category: "warden" };
  const runner = { ...SCOUT, id: "runner", position: { x: 9, y: 5 }, motivations: ["exploring"] };
  for (const fog of [true, false]) {
    const session = await createPlaySession({ ...level([warden, runner]), fog });
    const seen = [];
    for (let turn = 0; turn < 10; turn += 1) {
      await session.act({ kind: "wait" });
      seen.push(...session.view().departures.map((entry) => entry.id));
    }
    assert.deepEqual(seen, fog ? [] : ["runner"], `fog ${fog}`);
  }
});

test("a defeat reads differently from an exit", () => {
  const view = { departures: [
    { id: "pal", label: "D2", role: "delver", how: "exited" },
    { id: "guard", label: "W1", role: "warden", how: "defeated" },
    { id: "t", label: "T1", role: "hazard", how: "defeated" },
  ] };
  assert.equal(departuresLine(view), "D2 pal left by the exit; W1 guard was defeated; T1 t was destroyed");
});

// ## TODO: Test Permutations
// - `advance` collects every departure across its ticks
// - an order's tick reports a departure it caused
// - a hostile in sight that is defeated is shown
