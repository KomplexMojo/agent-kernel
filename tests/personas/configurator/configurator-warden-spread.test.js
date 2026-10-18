/**
 * #397 (fixes #360) — wardens are seated strategically, not clumped at the exit.
 *
 * No warden sits on the exit approach tile itself, so it can never seal the exit; the exit
 * room is still guarded; the rest spread over the rooms other than the entry room, one room
 * each while rooms last. Pinned actors keep their cells, the seats are the same for the same
 * inputs, and the pattern is the same whatever affinity the wardens carry.
 */
"use strict";

const assert = require("node:assert/strict");

const KINDS = [null, "fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
const vitals = () => ({ health: { current: 10, max: 10, regen: 1 } });

function warden(id, kind) {
  return { id, category: "warden", motivations: ["defending"], vitals: vitals(),
    ...(kind ? { affinities: [{ kind, expression: "emit", stacks: 1 }], activeAffinityKey: `${kind}:emit` } : {}) };
}

function spec(actors) {
  return {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: { id: "warden_spread", runId: "warden_spread", createdAt: "2026-10-18T00:00:00.000Z", source: "runtime-test" },
    intent: { goal: "spread wardens" },
    plan: {},
    configurator: {
      inputs: {
        levelGen: {
          width: 40, height: 30, seed: 5,
          shape: { roomCount: 5, roomMinSize: 4, roomMaxSize: 6, corridorWidth: 1 },
          connectivity: { requirePath: true },
        },
        delverCount: 1,
        actors, movementStamina: {},
      },
    },
  };
}

async function build(actors) {
  const { orchestrateBuild } = await import("../../../packages/runtime/src/build/orchestrate-build.js");
  const result = await orchestrateBuild({ spec: spec(actors), producedBy: "runtime-test" });
  const data = result.simConfig.layout.data;
  const category = (actor) => result.initialState.presentation[actor.id]?.category;
  const seats = Object.fromEntries(result.initialState.actors
    .filter((actor) => ["delver", "warden"].includes(category(actor)))
    .map((actor) => [actor.id, actor.position]));
  return { data, seats, wardenIds: actors.filter((a) => a.category === "warden").map((a) => a.id) };
}

const key = (p) => `${p.x},${p.y}`;
const roomOf = (rooms, p) => rooms.findIndex((r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height);

function reachable(data, from, to, blocked) {
  const walk = (x, y) => x >= 0 && y >= 0 && x < data.width && y < data.height
    && !["wall", "barrier", "spawn", "exit"].includes(data.terrain[y * data.width + x]) && !blocked.has(`${x},${y}`);
  const seen = new Set([key(from)]); const queue = [from];
  while (queue.length) {
    const { x, y } = queue.shift();
    if (x === to.x && y === to.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: x + dx, y: y + dy };
      if (walk(next.x, next.y) && !seen.has(key(next))) { seen.add(key(next)); queue.push(next); }
    }
  }
  return false;
}

const roster = (kind) => [
  { id: "hero", category: "delver", motivations: ["exploring"], vitals: vitals() },
  ...Array.from({ length: 6 }, (_, i) => warden(`warden_${i + 1}`, kind)),
];

test("no warden on the exit approach; the exit room is guarded; the exit stays reachable", async () => {
  const { data, seats, wardenIds } = await build(roster(null));
  const exitApproach = data.exitApproach;
  assert.ok(exitApproach, "the layout names an exit approach");
  const wardenSeats = wardenIds.map((id) => seats[id]);
  assert.equal(wardenSeats.some((seat) => key(seat) === key(exitApproach)), false);
  const exitRoom = roomOf(data.rooms, exitApproach);
  assert.ok(wardenSeats.some((seat) => roomOf(data.rooms, seat) === exitRoom), "a warden guards the exit room");
  assert.ok(reachable(data, data.spawnApproach, exitApproach, new Set(wardenSeats.map(key))),
    "wardens never seal the route from spawn to exit");
});

test("wardens spread one room each over the rooms other than the entry room", async () => {
  const { data, seats, wardenIds } = await build(roster(null));
  const entryRoom = roomOf(data.rooms, data.spawnApproach);
  const rooms = wardenIds.map((id) => roomOf(data.rooms, seats[id]));
  assert.equal(rooms.includes(entryRoom), false, "no warden is seated in the entry room");
  const others = data.rooms.length - 1;
  assert.equal(new Set(rooms).size, Math.min(others, wardenIds.length), `rooms used: ${rooms.join(",")}`);
});

test("the same inputs give the same seats, whatever affinity the wardens carry", async () => {
  const baseline = await build(roster(null));
  assert.deepEqual((await build(roster(null))).seats, baseline.seats);
  for (const kind of KINDS.slice(1)) {
    assert.deepEqual((await build(roster(kind))).seats, baseline.seats, kind);
  }
});

// ## TODO: Test Permutations
// - a one-room level: wardens fill the shared room but none takes the exit approach
// - more wardens than rooms: the second pass repeats the room order
// - a room carrying a warden's affinity still draws that warden
// - a --place pinned warden keeps its cell and the others spread around it
