/**
 * #731: a strategy's "nearest hostile" is an actor that can harm or chase: never a barrier, and
 * never a resource with no affinity. Barriers and resources carry the dungeon's alignment, so
 * they used to count, and `kite` ({ hostileWithin: 1 } → retreat) stepped away from the barrier
 * beside its path every turn and never reached the exit. Structures in the way have their own
 * condition and selector (structureOnRoute, route_structure).
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../../fixtures/ui-ascii/unified-level.mjs");

const KITE = Object.freeze({
  goals: [{ kind: "reach", place: "exit" }],
  tactics: [
    { when: { hostileWithin: 1 }, do: { kind: "retreat" } },
    { when: { hostileWithin: 9 }, do: { kind: "cast_affinity", params: { targetId: "nearest_hostile" } } },
  ],
});

const ROOM = [
  "##########",
  "S........#",
  "#........#",
  "#........E",
  "##########",
];

const hero = () => ({ category: "delver", id: "hero", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
  affinities: [{ kind: "wind", expression: "push", stacks: 2 }], activeAffinityKey: "wind:push",
  vitals: viableVitals({ health: 20, mana: 40, stamina: 100 }) });
const barrier = (id, x, y) => ({ category: "barrier", id, position: { x, y }, vitals: { durability: { current: 10, max: 10, regen: 0 } } });
const resource = (id, x, y) => ({ category: "resource", id, position: { x, y }, vitals: { durability: { current: 1, max: 1, regen: 0 } },
  holdings: [{ id: `${id}_heal`, kind: "vital", permanenceMode: "consumable", claimedBy: null, vitals: [{ key: "health", delta: 1 }] }] });

async function play(actors, turns = 40) {
  const session = await createPlaySession({ ...buildUnifiedLevel({ id: "kite_room", tiles: ROOM, actors }), fog: false });
  const ordered = await session.order(session.playerActorId, KITE);
  assert.equal(ordered.ok, true, ordered.reason);
  const status = (await session.advance({ ticks: turns })).status;
  return { session, status };
}

test("kite walks past barriers and a resource beside its path to the exit (#731)", async () => {
  const { status } = await play([hero(), barrier("wall-a", 2, 2), barrier("wall-b", 4, 2), barrier("wall-c", 6, 2), resource("chest", 7, 1)]);
  assert.equal(status.exited, true, "a barrier or a resource is not a threat to step away from");
});

test("a warden is still a hostile: kite's tactics fire for it", async () => {
  const warden = { category: "warden", id: "guard", position: { x: 2, y: 2 }, motivations: ["stationary"],
    affinities: [{ kind: "water", expression: "push", stacks: 1 }], activeAffinityKey: "water:push",
    vitals: viableVitals({ health: 200, mana: 10 }) };
  const session = await createPlaySession({ ...buildUnifiedLevel({ id: "kite_room", tiles: ROOM, actors: [hero(), warden] }), fog: false });
  await session.order(session.playerActorId, KITE);
  const fired = new Set();
  for (let turn = 0; turn < 8; turn += 1) {
    await session.advance({ ticks: 1 });
    const tactic = session.strategies().hero?.tactic;
    if (tactic !== undefined) fired.add(tactic);
  }
  assert.ok(fired.size > 0, "a tactic fired: the warden is the nearest hostile");
});

// ## TODO: Test Permutations
// - a hazard beside the path still counts (it can harm): kite steps away from it
// - a raised barrier (cast by a warden) is not a threat either
// - hit-and-fade under half mana retreats from a warden, never from a barrier
