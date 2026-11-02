/**
 * #680 — one tick that commands several `ai_controlled` actors. An AI driving a dungeon side
 * (wardens, hazards) used to command one, switch, then command the next, advancing the world
 * each time. `actTick({ actorId: command })` runs a single tick; actors left out play their own
 * motivations; anyone not `ai_controlled` is refused (`not_playable`) while the rest still run.
 */
const assert = require("node:assert/strict");
const { createPlaySession, replayPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const ROOM = ["###########", "S.........#", "#.........#", "#.........E", "###########"];
const actor = (category, id, position, motivations) => ({ category, id, position, vitals: viableVitals(), motivations });
const level = () => buildUnifiedLevel({ id: "tick_room", tiles: ROOM, actors: [
  actor("delver", "hero", { x: 1, y: 1 }, ["user_controlled"]),
  actor("warden", "guard", { x: 8, y: 1 }, ["ai_controlled"]),
  actor("warden", "sentry", { x: 8, y: 3 }, ["ai_controlled"]),
  actor("warden", "idler", { x: 5, y: 2 }, ["stationary"]),
] });
const where = (session, id) => session.view().actors.find((entry) => entry.id === id)?.position
  ?? session.view().aiControlled.find((entry) => entry.id === id)?.position;

test("two ai_controlled actors act in one tick, by id and by label", async () => {
  const session = await createPlaySession(level());
  const before = session.status().tick;
  const labels = new Map(session.view().aiControlled.map((entry) => [entry.id, entry.label]));
  const result = await session.actTick({ guard: { kind: "move", params: { direction: "west" } }, [labels.get("sentry")]: { kind: "move", params: { direction: "west" } } });
  assert.equal(result.tick, before + 1, "one tick for both");
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.accepted.map((entry) => entry.actorId).sort(), ["guard", "sentry"]);
  assert.deepEqual(where(session, "guard"), { x: 7, y: 1 });
  assert.deepEqual(where(session, "sentry"), { x: 7, y: 3 });
});

test("an actor left out plays its own motivations; the seat does not move", async () => {
  const session = await createPlaySession(level());
  await session.actTick({ guard: { kind: "move", params: { direction: "west" } } });
  assert.deepEqual(where(session, "sentry"), { x: 8, y: 3 }, "sentry has no command and does not act");
  assert.deepEqual(session.view().player.position, { x: 1, y: 1 });
});

test("a non-ai_controlled actor is refused with not_playable; the others still run", async () => {
  const session = await createPlaySession(level());
  const before = session.status().tick;
  const result = await session.actTick({
    guard: { kind: "move", params: { direction: "west" } },
    hero: { kind: "move", params: { direction: "east" } },
    idler: { kind: "move", params: { direction: "east" } },
    ghost: { kind: "wait" },
  });
  assert.equal(result.tick, before + 1);
  assert.deepEqual(result.accepted.map((entry) => entry.actorId), ["guard"]);
  const reasons = Object.fromEntries(result.rejected.map((entry) => [entry.actorId, entry.reason]));
  assert.deepEqual(reasons, { hero: "not_playable", idler: "not_playable", ghost: "unknown_actor" });
  assert.deepEqual(session.view().player.position, { x: 1, y: 1 }, "the player's party was not commanded");
});

test("no valid entry runs no tick; commands that need a tick of their own are refused", async () => {
  const session = await createPlaySession(level());
  const before = session.status().tick;
  const result = await session.actTick({ hero: { kind: "wait" }, guard: { kind: "advance" }, sentry: { kind: "inspect", params: { targetId: "hero" } } });
  assert.equal(result.tick, before);
  assert.equal(session.status().tick, before);
  assert.deepEqual(result.rejected.map((entry) => entry.reason).sort(), ["not_playable", "single_actor_only", "single_actor_only"]);
  await assert.rejects(() => session.actTick({}), /at least one entry/);
});

test("the shared tick is logged and replays to the same game", async () => {
  const first = level();
  const session = await createPlaySession(first);
  await session.actTick({ guard: { kind: "move", params: { direction: "west" } }, sentry: { kind: "move", params: { direction: "north" } } });
  await session.act({ kind: "wait" });
  await session.actTick({ guard: { kind: "move", params: { direction: "west" } } });
  const capture = session.captureInput({ meta: { id: "c", runId: "r", createdAt: "2026-11-02T00:00:00.000Z" } });
  assert.ok(capture.payload.commands.some((entry) => entry.actorCommands), "the tick is in the log");
  const replayed = await replayPlaySession({ simConfig: first.simConfig, initialState: first.initialState, capturedInput: capture });
  assert.deepEqual(where(replayed, "guard"), where(session, "guard"));
  assert.deepEqual(where(replayed, "sentry"), where(session, "sentry"));
  assert.equal(replayed.status().tick, session.status().tick);
});

// ## TODO: Test Permutations
// - a hazard (non-moving role) commanded to cast
// - a defeated or exited ai_controlled actor in the map
// - a cast target given as a label
