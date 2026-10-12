/**
 * The play session is the step-at-a-time seam an interactive UI drives: one
 * player command, one closed tick, one fresh frame. Core stays the authority on
 * legality and on reaching/leaving the exit; these tests pin that the session
 * reports core's answers rather than inventing its own.
 */
const assert = require("node:assert/strict");

const {
  createPlaySession,
  normalizePlayCommand,
  PLAY_DIRECTIONS,
} = require("../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

// The MVP maze as a unified-actor level: the player's delver seated at (2,1),
// the exit terrain at (8,7).
const MAZE = [
  "#########",
  "S...#...#",
  "#...#.#.#",
  "#.#...#.#",
  "#.###.#.#",
  "#...#...#",
  "#.#.#.###",
  "#...#...E",
  "#########",
];
const PLAYER = { category: "delver", id: "actor_mvp", position: { x: 2, y: 1 }, vitals: viableVitals(), motivations: ["user_controlled"] };
const mazeLevel = (extra = []) => buildUnifiedLevel({ id: "mvp_maze", tiles: MAZE, actors: [PLAYER, ...extra] });
const { simConfig, initialState } = mazeLevel();

/** A trap: a hazard actor with one active affinity and the mana to power it. */
function trap(id, kind, position, { expression = "emit", stacks = 1, mana = 30, regen = 3 } = {}) {
  return {
    category: "hazard", id, position,
    vitals: { durability: { current: 10, max: 10, regen: 1 }, mana: { current: mana, max: mana, regen } },
    affinities: [{ kind, expression, stacks }], activeAffinityKey: `${kind}:${expression}`,
  };
}

// From the player's seat (2,1) onto the exit terrain (8,7).
const PATH_TO_EXIT = [
  "east", "south", "south", "east", "east",
  "south", "south", "south", "south", "east", "east", "east",
];

const move = (direction) => ({ kind: "move", params: { direction } });
const newSession = () => createPlaySession({ simConfig, initialState });

async function walkToExit(session) {
  let last;
  for (const direction of PATH_TO_EXIT) {
    last = await session.act(move(direction));
    assert.equal(last.accepted.length, 1, `${direction} at tick ${last.tick}`);
  }
  return last;
}

test("the first view is the level's board at tick 0 with the player at its seat", async () => {
  const view = (await newSession()).view();
  assert.equal(view.tick, 0);
  assert.deepEqual(view.status, { tick: 0, exited: false, atExit: false });
  assert.deepEqual(view.player.position, { x: 2, y: 1 });
  assert.equal(view.player.id, "actor_mvp");
  assert.equal(view.rows[1], "S.@.#...#");
  assert.equal(view.rows.length, 9);
});

test("the HUD carries runtime's vital labels with the live values", async () => {
  const { player } = (await newSession()).view();
  const health = player.vitals.find((vital) => vital.key === "health");
  assert.equal(health.label, "HP");
  assert.equal(health.current, 10);
  assert.equal(health.max, 10);
});

test("an accepted move moves the player and closes exactly one tick", async () => {
  const session = await newSession();
  const result = await session.act(move("east"));
  assert.equal(result.tick, 1);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.accepted, [{
    actorId: "actor_mvp",
    tick: 1,
    kind: "move",
    params: { target: { x: 3, y: 1 } },
  }]);
  const view = session.view();
  assert.deepEqual(view.player.position, { x: 3, y: 1 });
  assert.equal(view.rows[1], "S..@#...#");
});

test("a move into a wall is core's rejection and still costs the turn", async () => {
  const session = await newSession();
  const result = await session.act(move("north"));
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0].reason, "BlockedByWall");
  assert.equal(result.tick, 1);
  assert.deepEqual(session.view().player.position, { x: 2, y: 1 });
  // The tick advanced, so the next move targets tick 2 and lands.
  assert.equal((await session.act(move("east"))).accepted.length, 1);
});

test("wait, and an absent command, close a tick without moving", async () => {
  const session = await newSession();
  assert.equal((await session.act({ kind: "wait" })).tick, 1);
  assert.equal((await session.act()).tick, 2);
  assert.deepEqual(session.view().player.position, { x: 2, y: 1 });
});

test("standing on the exit is atExit; core's exit dwell then exits", async () => {
  const session = await newSession();
  const last = await walkToExit(session);
  assert.equal(last.status.atExit, true);
  assert.equal(last.status.exited, false);
  assert.deepEqual(session.view().player.position, { x: 8, y: 7 });
  const stepped = await session.act({ kind: "wait" });
  assert.deepEqual(stepped.status, { tick: stepped.tick, exited: true, atExit: false });
});

test("stepping off the exit clears atExit", async () => {
  const session = await newSession();
  await walkToExit(session);
  assert.equal((await session.act(move("west"))).status.atExit, false);
});

test("once exited, commands are refused and the tick no longer advances", async () => {
  const session = await newSession();
  await walkToExit(session);
  const exitedAt = (await session.act({ kind: "wait" })).tick;
  const result = await session.act(move("west"));
  assert.equal(result.rejected[0].reason, "exited");
  assert.equal(result.tick, exitedAt);
  assert.equal((await session.act({ kind: "wait" })).tick, exitedAt);
});

test("a malformed command is a caller error, not a rejected move", async () => {
  const session = await newSession();
  await assert.rejects(session.act(move("up")), /unknown direction "up"/);
  await assert.rejects(session.act({ kind: "attack" }), /unknown command kind "attack"/);
  assert.deepEqual(normalizePlayCommand(null), { kind: "wait" });
});

test("directions are the shared eight-way set", () => {
  assert.deepEqual(
    [...PLAY_DIRECTIONS].sort(),
    ["east", "north", "northeast", "northwest", "south", "southeast", "southwest", "west"],
  );
});

test("a level that does not load is refused with core-setup's reason", async () => {
  await assert.rejects(createPlaySession({ simConfig, initialState: { ...initialState, actors: [] } }), /presentation must contain/);
  await assert.rejects(createPlaySession({ simConfig }), /required/);
});

test("playerActorId defaults to the primary actor; an actor not in the level is refused", async () => {
  const session = await createPlaySession({ simConfig, initialState });
  assert.equal(session.playerActorId, "actor_mvp");
  await assert.rejects(
    createPlaySession({ simConfig, initialState, playerActorId: "warden-1" }),
    /"warden-1" is not an actor in this level/,
  );
});

test("view().hazards reports the level's hazard actors; a barrier is drawn on the board instead", async () => {
  const barrier = {
    category: "barrier", id: "wall-c", position: { x: 5, y: 5 },
    vitals: { durability: { current: 10, max: 10, regen: 0 } },
  };
  const level = mazeLevel([trap("trap-a", "water", { x: 3, y: 3 }), trap("trap-b", "fire", { x: 3, y: 2 }), barrier]);
  const session = await createPlaySession(level);
  const view = session.view();
  assert.deepEqual(view.hazards.map((hazard) => [hazard.id, hazard.position]), [
    ["trap-a", { x: 3, y: 3 }],
    ["trap-b", { x: 3, y: 2 }],
  ]);
  assert.equal(view.hazards[0].activeAffinityKey, "water:emit");
  assert.equal(view.rows[5][5], "B", "the barrier is on the board");
  assert.ok(!view.actors.some((actor) => actor.id === "wall-c"));
  view.hazards[0].position.x = 99;
  assert.equal(session.view().hazards[0].position.x, 3, "the view is a copy");
  assert.deepEqual((await newSession()).view().hazards, [], "no hazards: an empty list");
});

test("two sessions on the same level are independent and deterministic", async () => {
  const a = await newSession();
  const b = await newSession();
  await a.act(move("east"));
  assert.deepEqual(b.view().player.position, { x: 2, y: 1 });
  await b.act(move("east"));
  assert.deepEqual(a.view(), b.view());
});

// ---------------------------------------------------------------------------
// Other actors take their turns: each act() is one runtime.step({ actorCommands }).
// ---------------------------------------------------------------------------

function buildArenaLevel({ wardenAffinities } = {}) {
  const tiles = ["#######", "#.....#", "#.....#", "#.....E", "#######"];
  return buildUnifiedLevel({
    id: "arena",
    tiles,
    actors: [
      { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["random"], vitals: viableVitals() },
      {
        category: "warden", id: "warden_1", position: { x: 5, y: 1 }, motivations: ["random"], vitals: viableVitals(),
        ...(wardenAffinities ? { affinities: wardenAffinities } : {}),
      },
    ],
  });
}

test("view().actors carries every other actor so a UI can draw them", async () => {
  const session = await createPlaySession({ ...buildArenaLevel(), playerActorId: "delver_1" });
  const { actors, player } = session.view();
  assert.equal(player.id, "delver_1");
  assert.deepEqual(actors.map((a) => [a.id, a.role, a.position]), [["warden_1", "warden", { x: 5, y: 1 }]]);
});

test("view().actors carries each actor's affinities", async () => {
  const level = buildArenaLevel({ wardenAffinities: [{ kind: "fire", expression: "push", stacks: 1 }] });
  const session = await createPlaySession({ ...level, playerActorId: "delver_1" });
  const warden = session.view().actors.find((a) => a.id === "warden_1");
  assert.deepEqual(warden.affinities.map((a) => a.kind), ["fire"]);
});

test("while the player waits, the warden takes its own turns", async () => {
  const session = await createPlaySession({ ...buildArenaLevel(), playerActorId: "delver_1" });
  const seen = new Set();
  for (let i = 0; i < 4; i += 1) {
    await session.act();
    const warden = session.view().actors.find((a) => a.id === "warden_1");
    seen.add(`${warden.position.x},${warden.position.y}`);
  }
  assert.deepEqual(session.view().player.position, { x: 1, y: 1 }, "the player's actor never auto-plays");
  assert.ok(seen.size > 1 || !seen.has("5,1"), "the warden moved on its own");
});

test("any configured actor can be the player, not only the primary", async () => {
  const session = await createPlaySession({ ...buildArenaLevel(), playerActorId: "warden_1" });
  const result = await session.act(move("west"));
  assert.equal(result.accepted.length, 1);
  assert.deepEqual(session.view().player.position, { x: 4, y: 1 });
});

// ---------------------------------------------------------------------------
// Fog of war: core decides what is visible; the session remembers what was seen.
// ---------------------------------------------------------------------------

const { PLAY_SIGHT } = require("../../packages/runtime/src/runner/play-session.js");

test("with fog, an unlit player sees only adjacent cells; the rest is unknown fog", async () => {
  const session = await createPlaySession({ simConfig, initialState, fog: true });
  const view = session.view();
  // Player at (2,1): sight 1 covers x 1..3, y 0..2.
  assert.equal(view.sight[1], "uvvvuuuuu");
  assert.equal(view.rows[1], "?.@.?????");
  assert.equal(view.legend.fog, "?");
  assert.ok(view.rows[8].split("").every((c) => c === "?"), "far rows are fog");
});

test("cells seen once stay explored: base tile shown, marked remembered", async () => {
  const session = await createPlaySession({ simConfig, initialState, fog: true });
  await session.act(move("east"));
  await session.act(move("south"));
  const view = session.view();
  // (1,1) was seen from the start seat; now out of sight but remembered.
  assert.equal(view.sight[1][1], PLAY_SIGHT.REMEMBERED);
  assert.equal(view.rows[1][1], ".");
  assert.equal(view.sight[0][3], PLAY_SIGHT.REMEMBERED, "the wall above (3,1), seen on the way");
  assert.equal(view.rows[0][3], "#");
});

test("with fog, actors out of sight are not reported", async () => {
  const session = await createPlaySession({ ...buildArenaLevel(), playerActorId: "delver_1", fog: true });
  assert.deepEqual(session.view().actors, [], "the warden at (5,1) is four tiles away in an unlit level");
  const full = await createPlaySession({ ...buildArenaLevel(), playerActorId: "delver_1" });
  assert.equal(full.view().actors.length, 1, "without fog the warden is reported");
});

test("with fog, traps out of sight are not reported", async () => {
  const level = mazeLevel([trap("near", "water", { x: 3, y: 1 }), trap("far", "fire", { x: 5, y: 5 })]);
  const session = await createPlaySession({ ...level, fog: true });
  assert.deepEqual(session.view().hazards.map((h) => h.id), ["near"]);
});

test("with fog, a light-emitting trap lights its cells, which the player sees from afar", async () => {
  // Player at (2,1), unlit, so its own sight is one tile. The lamp at (3,3) is two
  // tiles away in line of sight; its light makes it, and the cells it reaches, visible.
  const lamp = (kind) => mazeLevel([trap("lamp", kind, { x: 3, y: 3 }, { stacks: 2 })]);
  const lit = (await createPlaySession({ ...lamp("light"), fog: true })).view();
  assert.equal(lit.sight[3][3], PLAY_SIGHT.VISIBLE, "the lamp's own cell");
  assert.equal(lit.sight[3][1], PLAY_SIGHT.VISIBLE, "a cell the lamp lights, in line of sight");
  assert.deepEqual(lit.hazards.map((h) => h.id), ["lamp"]);

  const unlit = (await createPlaySession({ ...lamp("fire"), fog: true })).view();
  assert.notEqual(unlit.sight[3][3], PLAY_SIGHT.VISIBLE, "fire emits no light");
  assert.deepEqual(unlit.hazards, []);
});

test("with fog, a lamp that cannot pay its mana upkeep goes dark", async () => {
  // Every affinity costs mana (2026-10-11). Light on emit at 2 stacks costs 2 + 2 = 4
  // a turn. With 6 mana and no regen the lamp pays once (6 -> 2), then cannot pay and
  // goes dark until its mana is full, which is never.
  const level = mazeLevel([trap("lamp", "light", { x: 3, y: 3 }, { stacks: 2, mana: 6, regen: 0 })]);
  const session = await createPlaySession({ ...level, fog: true });
  assert.equal(session.view().sight[3][3], PLAY_SIGHT.VISIBLE, "lit at the start");
  await session.act({ kind: "wait" });
  assert.equal(session.view().sight[3][3], PLAY_SIGHT.VISIBLE, "paid its first upkeep");
  await session.act({ kind: "wait" });
  assert.notEqual(session.view().sight[3][3], PLAY_SIGHT.VISIBLE, "drained: dark");
});

test("with fog, dark erases remembered cells once they leave sight; undarkened memory stays", async () => {
  // A 1-stack dark trap at (3,3) darkens cells within 2 steps (Manhattan), (3,2) among them.
  const level = mazeLevel([trap("shade", "dark", { x: 3, y: 3 })]);
  const session = await createPlaySession({ ...level, fog: true });
  assert.equal(session.view().sight[2][3], PLAY_SIGHT.VISIBLE, "adjacent, so seen even in the dark");
  await session.act(move("west"));
  const view = session.view();
  assert.equal(view.sight[2][3], PLAY_SIGHT.UNKNOWN, "out of sight under dark: forgotten");
  assert.equal(view.rows[2][3], "?");
  assert.equal(view.sight[1][3], PLAY_SIGHT.UNKNOWN, "(3,1) is also within the dark");
  assert.equal(view.sight[0][2], PLAY_SIGHT.REMEMBERED, "out of sight (corner), no dark: remembered");
});

test("without fog, every cell is visible", async () => {
  const view = (await newSession()).view();
  assert.ok(view.sight.every((row) => /^v+$/.test(row)));
});

// #202: the player uses affinities through the same Actor commands as a move.
function buildDuelLevel({ playerAffinities = [{ kind: "water", expression: "push", stacks: 3 }, { kind: "light", expression: "emit", stacks: 1 }] } = {}) {
  return buildUnifiedLevel({
    id: "duel",
    tiles: ["######", "#....#", "#....E", "######"],
    actors: [
      { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
        vitals: viableVitals({ mana: 40 }), affinities: playerAffinities },
      { category: "warden", id: "warden_1", position: { x: 2, y: 1 }, motivations: ["stationary"],
        vitals: viableVitals(), affinities: [{ kind: "fire", expression: "push", stacks: 1 }] },
    ],
  });
}
const equip = (affinityKey) => ({ kind: "equip_affinity", params: { affinityKey } });
const cast = (targetId) => ({ kind: "cast_affinity", params: { targetId } });

test("view().player lists the affinities the player knows and which one is equipped", async () => {
  const session = await createPlaySession(buildDuelLevel());
  const { player } = session.view();
  assert.deepEqual(player.affinities.map((a) => `${a.kind}:${a.expression}:${a.stacks}`), ["water:push:3", "light:emit:1"]);
  assert.equal(player.activeAffinityKey, null);
});

test("equipping costs the turn and switches the active affinity", async () => {
  const session = await createPlaySession(buildDuelLevel());
  const result = await session.act(equip("water:push"));
  assert.deepEqual(result.accepted.map((a) => a.kind), ["equip_affinity"]);
  assert.equal(result.tick, 1);
  assert.equal(session.view().player.activeAffinityKey, "water:push");
});

test("a cast spends the player's mana and hurts the target", async () => {
  const session = await createPlaySession(buildDuelLevel());
  await session.act(equip("water:push"));
  const manaBefore = session.view().player.vitals.find((v) => v.key === "mana").current;
  const result = await session.act(cast("warden_1"));
  assert.deepEqual(result.accepted.map((a) => [a.kind, a.params]), [["cast_affinity", { targetId: "warden_1" }]]);
  const view = session.view();
  assert.ok(view.player.vitals.find((v) => v.key === "mana").current < manaBefore);
  assert.ok(view.actors.find((a) => a.id === "warden_1").vitals.health.current < 10);
});

test("a refused cast reports core's reason and still costs the turn", async () => {
  const session = await createPlaySession(buildDuelLevel());
  const result = await session.act(cast("warden_1"));
  assert.deepEqual(result.rejected.map((r) => r.reason), ["NoActiveAffinity"]);
  assert.equal(result.tick, 1);
});

test("a defeated actor next to the player offers its affinities as loot, and take claims one", async () => {
  const session = await createPlaySession(buildDuelLevel());
  await session.act(equip("water:push"));
  for (let i = 0; i < 6 && session.view().actors.some((a) => a.id === "warden_1"); i += 1) {
    await session.act(cast("warden_1"));
  }
  const { loot } = session.view();
  assert.deepEqual(loot, [{ targetId: "warden_1", holdingId: "affinity:fire:push", kind: "affinity",
    affinity: "fire", expression: "push", position: { x: 2, y: 1 } }]);
  const result = await session.act({ kind: "take", params: { targetId: "warden_1", holdingId: "affinity:fire:push" } });
  assert.deepEqual(result.accepted.map((a) => a.kind), ["take"]);
  assert.ok(session.view().player.affinities.some((a) => a.kind === "fire" && a.expression === "push"));
  assert.deepEqual(session.view().loot, []);
});

test("view().player reports its slots: how many, what is equipped in order, and which are off", async () => {
  const session = await createPlaySession(buildDuelLevel());
  assert.equal(session.view().player.affinitySlots, 3, "a delver starts with three slots");
  assert.deepEqual(session.view().player.equippedAffinityKeys, []);
  await session.act(equip("water:push"));
  await session.act(equip("light:emit"));
  const { player } = session.view();
  assert.deepEqual(player.equippedAffinityKeys, ["water:push", "light:emit"]);
  assert.deepEqual(player.exhaustedAffinityKeys, []);
  const result = await session.act({ kind: "unequip_affinity", params: { affinityKey: "water:push" } });
  assert.deepEqual(result.accepted.map((a) => a.kind), ["unequip_affinity"]);
  assert.deepEqual(session.view().player.equippedAffinityKeys, ["light:emit"]);
});

// ## TODO: Test Permutations
// - an actor that emits light sees one more tile per stack
// - a dark cell is unknown from beyond one tile
// - each of the eight directions from an open floor cell (accepted, position delta)
// - diagonal moves that cut a wall corner (core's answer, whatever it is, is reported verbatim)
// - a warden's cast lowers the player's health in view()
// - an exit-ineligible (warden) player reaches atExit but never exits
// - repeated rejected moves each advance the tick by one
// - loot from a defeated actor two tiles away is not offered
// - an exhausted lasting affinity is reported as affinityExhausted on view().player
