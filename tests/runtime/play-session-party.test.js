/**
 * Party control (Phase 2, G1/G3). Only actors authored `user_controlled` are playable
 * (Darren, 2026-10-13); a level may hold several. The play session seats one, switches
 * between them for free, and sends each command for the active one (or a named one).
 * One tick still advances the whole world, and fog follows the active actor.
 *
 * Every actor in a view carries a short stable label (D1, W1, H1, ...) that a person
 * or Claude can say instead of an id; a cast's target may be given by label.
 */
const assert = require("node:assert/strict");

const {
  createPlaySession,
  playActorLabels,
  replayPlaySession,
} = require("../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const ROOM = [
  "#########",
  "S.......#",
  "#.......#",
  "#.......#",
  "#.......E",
  "#########",
];

const delver = (id, position, motivations) => ({ category: "delver", id, position, vitals: viableVitals(), motivations });
const warden = (id, position) => ({ category: "warden", id, position, vitals: viableVitals(), motivations: ["stationary"] });

const HERO_A = delver("hero-a", { x: 1, y: 1 }, ["user_controlled"]);
const HERO_B = delver("hero-b", { x: 6, y: 3 }, ["user_controlled"]);
const SCOUT = delver("scout", { x: 1, y: 3 }, ["stationary"]);
const GUARD = warden("guard", { x: 7, y: 1 });

function level(actors = [HERO_A, HERO_B, SCOUT, GUARD]) {
  return buildUnifiedLevel({ id: "party_room", tiles: ROOM, actors });
}

const move = (direction) => ({ kind: "move", params: { direction } });

function actorAt(session, id) {
  const view = session.view();
  if (view.player?.id === id) return view.player;
  return (view.actors || []).find((actor) => actor.id === id);
}

test("the party is every user_controlled actor; the first is seated", async () => {
  const session = await createPlaySession(level());
  assert.equal(session.activeActorId(), "hero-a");
  const party = session.view().party;
  assert.deepEqual(party.map((member) => [member.id, member.label, member.active]),
    [["hero-a", "D1", true], ["hero-b", "D2", false]]);
});

test("the party and everyone in sight carry their full motivation stack (#310)", async () => {
  const pal = delver("pal", { x: 3, y: 2 }, ["user_controlled", "exploring"]);
  const session = await createPlaySession(level([HERO_A, HERO_B, SCOUT, GUARD, pal]));
  const view = session.view();
  assert.deepEqual(view.party.map((member) => [member.id, member.motivations]),
    [["hero-a", ["user_controlled"]], ["hero-b", ["user_controlled"]], ["pal", ["user_controlled", "exploring"]]]);
  const seen = Object.fromEntries((view.actors || []).map((actor) => [actor.id, actor.motivations]));
  assert.deepEqual(seen.scout, ["stationary"]);
  assert.deepEqual(seen.guard, ["stationary"]);
  view.party[0].motivations.push("tampered");
  assert.deepEqual(session.view().party[0].motivations, ["user_controlled"], "the view hands out copies");
});

test("switching is free and moves command and fog to the new actor", async () => {
  const session = await createPlaySession({ ...level(), fog: true });
  const tick = session.status().tick;
  const result = session.switchTo("hero-b");
  assert.equal(result.ok, true);
  assert.equal(session.status().tick, tick, "switching runs no tick");
  assert.equal(session.view().player.id, "hero-b");

  const before = actorAt(session, "hero-b").position;
  const acted = await session.act(move("west"));
  assert.equal(acted.accepted.length, 1);
  assert.equal(acted.accepted[0].actorId, "hero-b");
  assert.deepEqual(session.view().player.position, { x: before.x - 1, y: before.y });
});

test("a switch may name the actor by its label", async () => {
  const session = await createPlaySession(level());
  assert.equal(session.switchTo("D2").ok, true);
  assert.equal(session.activeActorId(), "hero-b");
});

test("a companion or a warden is not playable", async () => {
  const session = await createPlaySession(level());
  assert.deepEqual(session.switchTo("scout"), { ok: false, reason: "not_playable", actorId: "scout" });
  assert.equal(session.switchTo("guard").reason, "not_playable");
  assert.equal(session.switchTo("nobody").reason, "unknown_actor");
  assert.equal(session.activeActorId(), "hero-a", "a refused switch leaves the seat alone");

  const result = await session.act({ kind: "wait" }, { actorId: "scout" });
  assert.equal(result.rejected[0].reason, "not_playable");
});

test("act can command a named party member without switching", async () => {
  const session = await createPlaySession(level());
  const result = await session.act(move("west"), { actorId: "D2" });
  assert.equal(result.accepted[0].actorId, "hero-b");
  assert.equal(session.activeActorId(), "hero-a");
});

test("labels are stable per role, in id order, and every view actor carries one", async () => {
  const session = await createPlaySession(level());
  const view = session.view();
  assert.equal(view.player.label, "D1");
  const labels = Object.fromEntries((view.actors || []).map((actor) => [actor.id, actor.label]));
  assert.deepEqual(labels, { "hero-b": "D2", scout: "D3", guard: "W1" });

  const { initialState } = level();
  const map = playActorLabels(initialState.actors, initialState.presentation);
  assert.deepEqual([...map], [["guard", "W1"], ["hero-a", "D1"], ["hero-b", "D2"], ["scout", "D3"]]);
});

test("a capture records whose command each was, and a replay reseats the last active actor", async () => {
  const session = await createPlaySession(level());
  await session.act(move("east"));
  session.switchTo("hero-b");
  await session.act(move("west"));
  const capture = session.captureInput({ meta: { id: "c", runId: "r", createdAt: "2026-10-14T00:00:00.000Z" } });
  assert.deepEqual(capture.payload.commands.map((entry) => entry.actorId), ["hero-a", "hero-b"]);
  assert.equal(capture.payload.activeActorId, "hero-b");

  const replayed = await replayPlaySession({ ...level(), capturedInput: capture });
  assert.equal(replayed.activeActorId(), "hero-b");
  assert.deepEqual(replayed.view().player.position, session.view().player.position);
});

test("a level whose only actor is not user_controlled still seats it, as before", async () => {
  const session = await createPlaySession(level([SCOUT]));
  assert.equal(session.activeActorId(), "scout");
  assert.deepEqual(session.view().party.map((member) => member.id), ["scout"]);
  const result = await session.act(move("east"));
  assert.equal(result.accepted.length, 1);
});

// ## TODO: Test Permutations
// - switching to a defeated or exited party member shows them, and act on them is refused (defeated / exited).
// - fog: each party member remembers what it saw; switching back restores its memory.
// - cast_affinity with targetId given as a label ("W1") hits that actor.
// - a replay of a capture with no activeActorId (pre-party) seats the first player.
