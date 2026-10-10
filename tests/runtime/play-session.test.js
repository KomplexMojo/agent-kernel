/**
 * The play session is the step-at-a-time seam an interactive UI drives: one
 * player command, one closed tick, one fresh frame. Core stays the authority on
 * legality and on reaching/leaving the exit; these tests pin that the session
 * reports core's answers rather than inventing its own.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const {
  createPlaySession,
  normalizePlayCommand,
  PLAY_DIRECTIONS,
} = require("../../packages/runtime/src/runner/play-session.js");

const FIXTURES = resolve(__dirname, "../fixtures/artifacts");
const readFixture = (name) => JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8"));
const simConfig = readFixture("sim-config-artifact-v1-mvp-grid.json");
const initialState = readFixture("initial-state-artifact-v1-mvp-actor.json");

// From the fixture actor's seat (2,1) to the exit approach (7,7).
const PATH_TO_EXIT = [
  "east", "south", "south", "east", "east",
  "south", "south", "south", "south", "east", "east",
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

test("the first view is core's frame at tick 0 with the player at its seat", async () => {
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
    params: { direction: "east", from: { x: 2, y: 1 }, to: { x: 3, y: 1 } },
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

test("reaching the exit approach is atExit; core's exit dwell then exits", async () => {
  const session = await newSession();
  const last = await walkToExit(session);
  assert.equal(last.status.atExit, true);
  assert.equal(last.status.exited, false);
  assert.deepEqual(session.view().player.position, { x: 7, y: 7 });
  const stepped = await session.act({ kind: "wait" });
  assert.deepEqual(stepped.status, { tick: stepped.tick, exited: true, atExit: false });
});

test("stepping off the exit approach clears atExit", async () => {
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
  await assert.rejects(createPlaySession({ simConfig, initialState: { ...initialState, actors: [] } }), /missing_actors/);
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

test("view().hazards reports the layout's traps; a blocking one is core's barrier instead", async () => {
  const hazards = [
    { id: "trap-a", affinity: "water", expression: "emit", position: { x: 4, y: 3 } },
    { id: "trap-b", affinity: "fire", expression: "emit", x: 3, y: 2 },
    { id: "wall-c", affinity: "earth", expression: "push", blocking: true, position: { x: 5, y: 5 } },
  ];
  const withHazards = { ...simConfig, layout: { ...simConfig.layout, data: { ...simConfig.layout.data, hazards } } };
  const session = await createPlaySession({ simConfig: withHazards, initialState });
  const view = session.view();
  assert.deepEqual(view.hazards.map((hazard) => [hazard.id, hazard.position]), [
    ["trap-a", { x: 4, y: 3 }],
    ["trap-b", { x: 3, y: 2 }],
  ]);
  assert.equal(view.hazards[0].affinity, "water");
  view.hazards[0].position.x = 99;
  assert.equal(session.view().hazards[0].position.x, 4, "the view is a copy");
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

function makeVitals(hp) {
  return {
    health: { current: hp, max: hp, regen: 0 },
    mana: { current: hp, max: hp, regen: 0 },
    stamina: { current: hp, max: hp, regen: 0 },
    durability: { current: 1, max: 1, regen: 0 },
  };
}

function buildArenaLevel() {
  const tiles = ["#######", "#.....#", "#.....#", "#.....E", "#######"];
  return {
    simConfig: {
      schema: "agent-kernel/SimConfigArtifact",
      schemaVersion: 1,
      meta: { id: "arena_sim", runId: "arena", createdAt: "2026-10-10T00:00:00.000Z" },
      seed: 0,
      layout: {
        kind: "grid",
        data: {
          width: 7, height: 5, tiles, spawn: { x: 1, y: 1 }, exit: { x: 6, y: 3 }, exitApproach: { x: 5, y: 3 },
          rooms: [{ id: "R1", x: 0, y: 0, width: 7, height: 5 }], hazards: [],
        },
      },
    },
    initialState: {
      schema: "agent-kernel/InitialStateArtifact",
      schemaVersion: 1,
      meta: { id: "arena_state", runId: "arena", createdAt: "2026-10-10T00:00:00.000Z" },
      simConfigRef: { id: "arena_sim", schema: "agent-kernel/SimConfigArtifact", schemaVersion: 1 },
      actors: [
        { id: "delver_1", kind: "ambulatory", archetype: "delver", role: "delver", position: { x: 1, y: 1 }, motivation: { kind: "random" }, vitals: makeVitals(10) },
        { id: "warden_1", kind: "ambulatory", archetype: "warden", role: "warden", position: { x: 5, y: 1 }, motivation: { kind: "random" }, vitals: makeVitals(6) },
      ],
    },
  };
}

test("view().actors carries every other actor so a UI can draw them", async () => {
  const session = await createPlaySession({ ...buildArenaLevel(), playerActorId: "delver_1" });
  const { actors, player } = session.view();
  assert.equal(player.id, "delver_1");
  assert.deepEqual(actors.map((a) => [a.id, a.role, a.position]), [["warden_1", "warden", { x: 5, y: 1 }]]);
});

test("view().actors carries each actor's authored affinities when core's observation reports none", async () => {
  const level = buildArenaLevel();
  level.initialState.actors[1].affinities = [{ kind: "fire", expression: "push", stacks: 1 }];
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

// ## TODO: Test Permutations
// - each of the eight directions from an open floor cell (accepted, position delta)
// - diagonal moves that cut a wall corner (core's answer, whatever it is, is reported verbatim)
// - a warden attack lowers the player's health in view()
// - an exit-ineligible (warden) player reaches atExit but never exits
// - repeated rejected moves each advance the tick by one
