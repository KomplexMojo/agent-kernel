/**
 * Orders in a live game (Phase 2b, decisions 5 and 8). `order(actor, strategy)` gives a
 * party member or a companion on the seated actor's side a new strategy; giving it is
 * the seated actor's turn and taking it the ordered actor's, so one tick runs. `advance`
 * lets the world run for orders to play out, stopping early at `until`. Both are logged,
 * so a replay reaches the same game.
 */
const assert = require("node:assert/strict");

const { createPlaySession, replayPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
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
const PAL = { category: "delver", id: "pal", position: { x: 1, y: 3 }, vitals: viableVitals(), motivations: ["stationary", "goal_oriented"] };
const GUARD = { category: "warden", id: "guard", position: { x: 9, y: 4 }, vitals: viableVitals(), motivations: ["stationary"] };

const level = (actors = [HERO, PAL, GUARD]) => buildUnifiedLevel({ id: "orders_room", tiles: ROOM, actors });
const positionOf = (session, id) => {
  const view = session.view();
  return view.player?.id === id ? view.player.position : view.actors.find((actor) => actor.id === id)?.position;
};

test("an order costs one turn and names its targets by label", async () => {
  const session = await createPlaySession(level());
  const before = session.status().tick;
  const result = await session.order("D2", { goals: [{ kind: "follow", target: "D1" }] });
  assert.equal(result.ok, true);
  assert.equal(result.actorId, "pal");
  assert.deepEqual(result.strategy, { goals: [{ kind: "follow", target: "hero", distance: 1 }] }, "labels resolve to ids");
  assert.equal(session.status().tick, before + 1, "one turn passes");
  assert.deepEqual(positionOf(session, "hero"), { x: 1, y: 1 }, "the seated actor spent its turn giving the order");
  const [order] = session.view().orders;
  assert.deepEqual({ id: order.id, label: order.label, status: order.status, goal: order.goal, goals: order.goals },
    { id: "pal", label: "D2", status: "active", goal: 0, goals: 1 });
});

test("orders go to your side only, and a malformed one is refused before any turn", async () => {
  const session = await createPlaySession(level());
  const tick = session.status().tick;
  assert.equal((await session.order("guard", { goals: [{ kind: "survive" }] })).reason, "not_yours");
  assert.equal((await session.order("nobody", { goals: [{ kind: "survive" }] })).reason, "unknown_actor");
  const malformed = await session.order("pal", { goals: [{ kind: "dance" }] });
  assert.equal(malformed.reason, "invalid_strategy");
  assert.match(malformed.error, /unknown kind "dance"/);
  assert.equal(session.status().tick, tick, "no refused order runs a tick");
});

test("advance runs until every order has run its course", async () => {
  const session = await createPlaySession(level());
  await session.order("pal", { goals: [{ kind: "reach", place: { x: 5, y: 3 } }] });
  const result = await session.advance({ ticks: 20, until: "orders_done" });
  assert.equal(result.stoppedBy, "orders_done");
  assert.ok(result.ticks < 20);
  assert.deepEqual(positionOf(session, "pal"), { x: 5, y: 3 });
  assert.deepEqual(positionOf(session, "hero"), { x: 1, y: 1 }, "a seated actor with no strategy waits");
});

test("an order to reach the exit walks onto the exit, leaves the level, and is done", async () => {
  const scout = { ...PAL, id: "scout", motivations: ["goal_oriented"] };
  const session = await createPlaySession(buildUnifiedLevel({ id: "exit_room", tiles: ROOM, actors: [HERO, scout],
    approaches: { exitApproach: { x: 10, y: 5 } } }));
  await session.order("scout", { goals: [{ kind: "reach", place: "exit" }] });
  const result = await session.advance({ ticks: 30, until: "orders_done" });
  assert.equal(result.stoppedBy, "orders_done");
  assert.equal(session.view().actors.find((actor) => actor.id === "scout")?.lifecycle ?? "exited", "exited");
  assert.equal(session.view().orders.find((order) => order.id === "scout").status, "done");
});

test("advance stops at contact when a hostile comes into a party member's sight", async () => {
  const lantern = { affinities: [{ kind: "light", expression: "emit", stacks: 3 }], activeAffinityKey: "light:emit", vitals: viableVitals({ mana: 2000 }) };
  const strategy = { goals: [{ kind: "reach", place: { x: 8, y: 4 } }] };
  const session = await createPlaySession(buildUnifiedLevel({ id: "contact_room", tiles: ROOM, actors: [
    { ...HERO, ...lantern, motivations: ["user_controlled"], strategy }, GUARD] }));
  const result = await session.advance({ ticks: 30, until: "contact" });
  assert.equal(result.stoppedBy, "contact");
  const hero = positionOf(session, "hero");
  assert.ok(Math.max(Math.abs(hero.x - 9), Math.abs(hero.y - 4)) <= 4, "the seated actor walked its own strategy until it saw the guard");
});

test("a replay reaches the same game, orders and advances included", async () => {
  const session = await createPlaySession(level());
  await session.act({ kind: "move", params: { direction: "east" } });
  await session.order("pal", { goals: [{ kind: "reach", place: { x: 4, y: 4 } }, { kind: "hold", place: { x: 4, y: 4 }, ticks: 2 }] });
  await session.advance({ ticks: 3 });
  const capture = session.captureInput({ meta: { id: "c", runId: "r", createdAt: "2026-10-14T00:00:00.000Z" } });
  assert.deepEqual(capture.payload.commands.map((entry) => (entry.order ? "order" : entry.command?.kind)),
    ["move", "order", "wait", "wait", "wait"]);
  const replayed = await replayPlaySession({ ...level(), capturedInput: capture });
  assert.deepEqual(replayed.strategies(), session.strategies());
  assert.deepEqual(positionOf(replayed, "pal"), positionOf(session, "pal"));
});

// ## TODO: Test Permutations
// - advance with a seated actor that has its own strategy logs auto ticks, and a replay re-seats it for them.
// - an order to a defeated or exited actor is refused (defeated / exited) and runs no tick.
// - an order to the seated actor itself: one wait, and its strategy runs on advance.
// - advance stops early when the seated actor exits or is defeated (stoppedBy exited / defeated).
// - advance refuses ticks < 1 and an unknown `until`.
