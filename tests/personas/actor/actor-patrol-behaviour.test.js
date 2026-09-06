/**
 * `patrolling` patrols. It does not walk to the exit.
 *
 * Maintainer ruling (2026-09-05), closing the first half of #169.
 *
 * WHAT WAS WRONG. `patrolling` had no branch of its own in `buildMotivatedProposals`.
 * Core's profile table gives it mobility 2 — the HIGHEST tier — and combat 0, so it
 * cleared the holds-position guard, matched no combat branch, and fell through to
 * `buildMoveProposal`: shortest path to the level exit. Every patrolling actor therefore
 * beelined to the single exit tile alongside every other actor, and a measured 100-tick
 * run produced 579 `ActorCollision` rejections with three wardens that never moved.
 * The motivation named for patrolling was the one that left the fastest.
 *
 * THE SHAPE CHOSEN, and why it is stateless. A clockwise circuit of the actor's own
 * room. The next cell is a function of the current cell and the room rectangle, so no
 * memory is carried between ticks — which matters twice over: persona context must stay
 * serializable, and a memory-carrying patrol would inherit the runner-threading problem
 * that #162 is still open on. A waypoint patrol would have needed both.
 */
"use strict";

const assert = require("node:assert/strict");

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  return modulesPromise;
}

// A 7x7 room carved out of a wall border, with the level exit OUTSIDE it at (0,3).
// The exit sits on the far side deliberately: a patrol that quietly still seeks the exit
// would show up as a westward drift rather than a circuit.
const BASE_TILES = [
  "#########",
  "#.......#",
  "#.......#",
  "E.......#",
  "#.......#",
  "#.......#",
  "#########",
];

const ROOMS = [{ id: "R1", x: 1, y: 1, width: 7, height: 5 }];

function simConfig() {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "patrol_sim", runId: "patrol", createdAt: "2026-01-01T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 9,
        height: 7,
        tiles: BASE_TILES,
        spawn: { x: 1, y: 1 },
        exit: { x: 0, y: 3 },
        rooms: ROOMS,
        hazards: [],
      },
    },
  };
}

async function proposeFrom(position, { motivation = { kind: "patrolling" }, others = [], role = "warden" } = {}) {
  const [{ createActorPersona }, { TickPhases }] = await loadModules();
  const persona = createActorPersona({ clock: () => "fixed" });
  const self = { id: `${role}_1`, kind: 2, role, position, motivation };
  const payload = {
    actorId: self.id,
    observation: { tick: 0, actors: [self, ...others], exit: { x: 0, y: 3 } },
    baseTiles: BASE_TILES,
    simConfig: simConfig(),
    initialState: { actors: [{ id: self.id, role, kind: "motivated" }] },
  };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  return (result.actions || []).find((a) => a.kind === "move") || null;
}

/** Walk the patrol by feeding each proposed destination back in as the next position. */
async function walk(from, steps) {
  const path = [{ ...from }];
  let at = { ...from };
  for (let i = 0; i < steps; i += 1) {
    const move = await proposeFrom(at);
    if (!move) break;
    at = { x: move.params.to.x, y: move.params.to.y };
    path.push({ ...at });
  }
  return path;
}

const onPerimeter = (p) => {
  const r = ROOMS[0];
  return p.x === r.x || p.x === r.x + r.width - 1 || p.y === r.y || p.y === r.y + r.height - 1;
};

test("a patrolling actor circuits its room instead of walking to the exit", async () => {
  const path = await walk({ x: 1, y: 1 }, 20);

  assert.ok(path.length > 8, `patrol stalled after ${path.length} steps: ${JSON.stringify(path)}`);
  // THE LOAD-BEARING ASSERTION. The exit is at (0,3), due west. Exit-seeking — the old
  // behaviour — reaches x=1,y=3 and then leaves the room. A circuit never does.
  assert.ok(
    path.every((p) => p.x >= 1),
    `a patrolling actor left the room toward the exit: ${JSON.stringify(path)}`,
  );
  assert.ok(
    path.every(onPerimeter),
    `patrol left its room's perimeter: ${JSON.stringify(path)}`,
  );
});

test("the circuit returns to where it started", async () => {
  // A patrol that merely wanders along the perimeter would satisfy the test above. This
  // is what makes it a CIRCUIT. The room is 7x5, so its perimeter is 2*(7+5)-4 = 20
  // cells and exactly 20 steps close the loop.
  const start = { x: 1, y: 1 };
  const path = await walk(start, 20);
  assert.deepEqual(path[path.length - 1], start, `circuit did not close: ${JSON.stringify(path)}`);
});

test("every step is to an adjacent tile", async () => {
  const path = await walk({ x: 1, y: 1 }, 12);
  for (let i = 1; i < path.length; i += 1) {
    const dx = Math.abs(path[i].x - path[i - 1].x);
    const dy = Math.abs(path[i].y - path[i - 1].y);
    assert.ok(dx <= 1 && dy <= 1 && (dx || dy), `step ${i} is not one tile: ${JSON.stringify(path)}`);
  }
});

test("an actor inside the room joins the perimeter rather than stalling", async () => {
  const move = await proposeFrom({ x: 4, y: 3 });
  assert.ok(move, "an actor away from the perimeter must still propose a move");
  const to = move.params.to;
  const r = ROOMS[0];
  const before = Math.min(4 - r.x, r.x + r.width - 1 - 4, 3 - r.y, r.y + r.height - 1 - 3);
  const after = Math.min(to.x - r.x, r.x + r.width - 1 - to.x, to.y - r.y, r.y + r.height - 1 - to.y);
  assert.ok(after < before, `step did not approach the perimeter: ${JSON.stringify(to)}`);
});

test("the patrol is deterministic", async () => {
  // `ak replay` compares runs frame by frame, so a patrol that varied between runs would
  // break replay outright rather than degrade it.
  const a = await walk({ x: 1, y: 1 }, 10);
  const b = await walk({ x: 1, y: 1 }, 10);
  assert.deepEqual(a, b);
});

test("a non-patrolling actor still heads for the exit", async () => {
  // ANTI-VACUITY. Without this, deleting exit-seeking altogether would pass every test
  // above — and the change under test is meant to give `patrolling` its OWN behaviour,
  // not to remove exit-seeking from the actors that should have it.
  const move = await proposeFrom({ x: 3, y: 3 }, { motivation: { kind: "exploring" }, role: "delver" });
  assert.ok(move, "an exploring actor must still propose a move");
  assert.ok(
    move.params.to.x < 3,
    `exploring should close on the exit at (0,3), went to ${JSON.stringify(move.params.to)}`,
  );
});

// ## TODO: Test Permutations
// - a room whose perimeter is broken by an interior wall
// - two patrolling actors on the same ring, one blocking the other
// - an actor whose position lies outside every declared room
