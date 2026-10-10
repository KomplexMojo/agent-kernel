/**
 * The play session is the step-at-a-time seam an interactive UI drives: one
 * player move, one closed tick, one fresh frame. Core stays the authority on
 * legality and on reaching/leaving the exit; these tests pin that the session
 * reports core's answers rather than inventing its own.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const {
  createPlaySession,
  PLAY_DIRECTIONS,
  PLAY_STATUS,
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

function newSession() {
  return createPlaySession({ simConfig, initialState });
}

test("the first view is core's frame at tick 0 with the player at its seat", () => {
  const view = newSession().view();
  assert.equal(view.tick, 0);
  assert.equal(view.status, PLAY_STATUS.PLAYING);
  assert.deepEqual(view.player.position, { x: 2, y: 1 });
  assert.equal(view.player.id, "actor_mvp");
  assert.equal(view.rows[1], "S.@.#...#");
  assert.equal(view.rows.length, 9);
});

test("the HUD carries runtime's vital labels with the live values", () => {
  const { player } = newSession().view();
  const health = player.vitals.find((vital) => vital.key === "health");
  assert.equal(health.label, "HP");
  assert.equal(health.current, 10);
  assert.equal(health.max, 10);
});

test("an accepted move moves the player and closes exactly one tick", () => {
  const session = newSession();
  const result = session.move("east");
  assert.equal(result.accepted, true);
  assert.equal(result.reason, null);
  assert.equal(result.tick, 1);
  const view = session.view();
  assert.deepEqual(view.player.position, { x: 3, y: 1 });
  assert.equal(view.rows[1], "S..@#...#");
});

test("a move into a wall is core's rejection and costs no tick", () => {
  const session = newSession();
  const result = session.move("north");
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "BlockedByWall");
  assert.equal(result.tick, 0);
  assert.deepEqual(session.view().player.position, { x: 2, y: 1 });
  // The tick did not advance, so the next move still targets tick 1 and lands.
  assert.equal(session.move("east").accepted, true);
});

test("wait closes a tick without moving", () => {
  const session = newSession();
  const result = session.wait();
  assert.equal(result.tick, 1);
  assert.deepEqual(session.view().player.position, { x: 2, y: 1 });
  assert.equal(session.move("east").tick, 2);
});

test("reaching the exit approach is at_exit; core's exit dwell then escapes", () => {
  const session = newSession();
  let last;
  for (const direction of PATH_TO_EXIT) {
    last = session.move(direction);
    assert.equal(last.accepted, true, `${direction} at tick ${last.tick}`);
  }
  assert.equal(last.status, PLAY_STATUS.AT_EXIT);
  assert.deepEqual(session.view().player.position, { x: 7, y: 7 });
  assert.equal(session.wait().status, PLAY_STATUS.ESCAPED);
  assert.equal(session.status(), PLAY_STATUS.ESCAPED);
});

test("stepping off the exit approach clears at_exit", () => {
  const session = newSession();
  for (const direction of PATH_TO_EXIT) session.move(direction);
  assert.equal(session.move("west").status, PLAY_STATUS.PLAYING);
});

test("once escaped, moves are refused and wait no longer advances the tick", () => {
  const session = newSession();
  for (const direction of PATH_TO_EXIT) session.move(direction);
  const escapedAt = session.wait().tick;
  const result = session.move("west");
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "escaped");
  assert.equal(session.wait().tick, escapedAt);
});

test("an unknown direction is a caller error, not a rejected move", () => {
  assert.throws(() => newSession().move("up"), /unknown direction "up"/);
});

test("directions are the shared eight-way set", () => {
  assert.deepEqual(
    [...PLAY_DIRECTIONS].sort(),
    ["east", "north", "northeast", "northwest", "south", "southeast", "southwest", "west"],
  );
});

test("a level that does not load is refused with core-setup's reason", () => {
  assert.throws(() => createPlaySession({ simConfig, initialState: { ...initialState, actors: [] } }), /missing_actors/);
  assert.throws(() => createPlaySession({ simConfig }), /required/);
});

test("two sessions on the same level are independent and deterministic", () => {
  const a = newSession();
  const b = newSession();
  a.move("east");
  assert.deepEqual(b.view().player.position, { x: 2, y: 1 });
  b.move("east");
  assert.deepEqual(a.view(), b.view());
});

// ## TODO: Test Permutations
// - each of the eight directions from an open floor cell (accepted, position delta)
// - diagonal moves that cut a wall corner (core's answer, whatever it is, is reported verbatim)
// - multi-actor initial state: the player is the id-sorted primary actor
// - an exit-ineligible (warden) player reaches at_exit but never escapes
// - repeated rejected moves never advance the tick
