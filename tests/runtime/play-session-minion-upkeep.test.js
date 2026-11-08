/**
 * #408 in play: a leader pays mana each turn for each living minion. The player's HUD shows the
 * total beside its mana regen and each minion's cost; a minion whose leader could not pay takes
 * no orders (the order is refused, and an order it already had waits) until the bond holds again.
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
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
const PLACE = { x: 9, y: 3 };
const hero = (mana) => ({ category: "delver", id: "hero", position: { x: 1, y: 1 },
  vitals: { ...viableVitals(), mana }, motivations: ["user_controlled"] });
const pal = (extra = {}) => ({ category: "delver", id: "pal", position: { x: 1, y: 3 }, vitals: viableVitals(),
  motivations: ["stationary", "friendly", "goal_oriented"], leader: "hero", ...extra });
const level = (actors) => buildUnifiedLevel({ id: "minion_upkeep", tiles: ROOM, actors });
const PAYS = { current: 10, max: 10, regen: 1 };
const BROKE = { current: 0, max: 10, regen: 0 };

test("the HUD shows the leader's minion upkeep beside its regen, and each minion's cost", async () => {
  const session = await createPlaySession(level([hero(PAYS), pal()]));
  const { player } = session.view();
  assert.equal(player.minionUpkeep, 1);
  assert.deepEqual(player.minions, [{ id: "pal", label: "D2", upkeep: 1, lapsed: false }]);
  await session.advance({ ticks: 1 });
  assert.equal(session.view().player.vitals.find((vital) => vital.key === "mana").current, 10, "1 upkeep, 1 regen");
});

test("a leader that cannot pay: the bond lapses, orders are refused, and the HUD says so", async () => {
  const session = await createPlaySession(level([hero(BROKE), pal()]));
  await session.advance({ ticks: 1 });
  assert.deepEqual(session.view().player.minions, [{ id: "pal", label: "D2", upkeep: 1, lapsed: true }]);
  assert.equal(session.view().player.minionUpkeep, 0, "a lapsed bond costs nothing");
  assert.deepEqual(session.view().orderable, []);
  const tick = session.status().tick;
  const refused = await session.order("pal", { goals: [{ kind: "reach", place: PLACE }] });
  assert.equal(refused.reason, "bond_lapsed");
  assert.equal(session.status().tick, tick, "a refused order runs no tick");
});

test("a lapsed minion stops following the order it was given; a bonded one carries it out", async () => {
  const strategy = { goals: [{ kind: "reach", place: PLACE }] };
  const statusOf = (session) => session.view().orders.find((order) => order.id === "pal")?.status;
  const bonded = await createPlaySession(level([hero(PAYS), pal({ strategy })]));
  const lapsed = await createPlaySession(level([hero(BROKE), pal({ strategy })]));
  await bonded.advance({ ticks: 10 });
  await lapsed.advance({ ticks: 10 });
  assert.equal(statusOf(bonded), "done", "the bonded minion reached its place");
  // The order is kept where it stood, not carried out: the minion runs its own motivations.
  assert.equal(statusOf(lapsed), "active");
});

// ## TODO: Test Permutations
// - the bond holds again once the leader's mana refills, and the order resumes
// - a seated minion's own HUD lists no minions and names its leader
// - two minions where the leader can pay only one: the first in id order keeps its bond
