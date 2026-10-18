/**
 * #398 — the `ambush` tactic: a room (named, or picked from the seed) holds the level's
 * resources, and its guards are seated where no doorway of the room can see them, by core's
 * own line-of-sight rule. `visible=true` seats them in the open near the loot instead. A room
 * that cannot hide every guard hides as many as fit and says so; the level is never refused.
 * Hiding is geometric, so every affinity (and none) gets the same seats.
 */
"use strict";

const assert = require("node:assert/strict");

const CREATED_AT = "2026-10-18T00:00:00.000Z";
const KINDS = [null, "fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
const vitals = () => ({ health: { current: 10, max: 10, regen: 1 } });
const key = ({ x, y }) => `${x},${y}`;
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function warden(id, kind) {
  return { id, category: "warden", motivations: ["defending"], vitals: vitals(),
    ...(kind ? { affinities: [{ kind, expression: "emit", stacks: 1 }], activeAffinityKey: `${kind}:emit` } : {}) };
}

function spec({ tactics, kind = null, guards = 3 }) {
  return {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: { id: "ambush", runId: "ambush", createdAt: CREATED_AT, source: "runtime-test" },
    intent: { goal: "an ambush" },
    plan: { hints: { tactics } },
    configurator: {
      inputs: {
        levelGen: {
          width: 40, height: 30, seed: 5,
          shape: { roomCount: 5, roomMinSize: 5, roomMaxSize: 7, corridorWidth: 1 },
          connectivity: { requirePath: true },
        },
        delverCount: 1,
        resources: [{ id: "loot", vitals: { durability: { current: 1, max: 1, regen: 0 } }, holdings: [] }],
        actors: [
          { id: "hero", category: "delver", motivations: ["exploring"], vitals: vitals() },
          ...Array.from({ length: guards }, (_, i) => warden(`guard_${i + 1}`, kind)),
        ],
        movementStamina: {},
      },
    },
  };
}

async function build(args) {
  const { orchestrateBuild } = await import("../../../packages/runtime/src/build/orchestrate-build.js");
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/persona.js");
  const { createHostedObjectPlacer } = await import("../../../packages/runtime/src/commands/solver-host.js");
  const { createHybridConstraintSolverAdapter } = await import("../../../packages/adapters-cli/src/adapters/z3/index.js");
  const configurator = createConfiguratorPersona({ clock: () => CREATED_AT });
  const placeObjects = createHostedObjectPlacer({ prepare: configurator.prepareObjectPlacement,
    complete: configurator.completeObjectPlacement, adapter: createHybridConstraintSolverAdapter(), clock: () => CREATED_AT });
  const result = await orchestrateBuild({ spec: spec(args), producedBy: "runtime-test", placeObjects });
  const data = result.simConfig.layout.data;
  const seats = Object.fromEntries(result.initialState.actors.map((actor) => [actor.id, actor.position]));
  return { result, data, seats, row: result.tacticReport.find((entry) => entry.tactic === "ambush") };
}

// Core's own sight rule, read independently of the Configurator: what a room's doorways see.
async function seenFromDoorways(data, room) {
  const { computeVisibleCells } = await import("../../../packages/core-ts/src/state/visibility.ts");
  const kinds = Array.from({ length: data.height }, (_, y) => Array.from({ length: data.width }, (_, x) => (
    ["wall", "spawn"].includes(data.terrain[y * data.width + x]) ? 1 : 0)));
  const inRoom = ({ x, y }) => x >= room.x && y >= room.y && x < room.x + room.width && y < room.y + room.height;
  const seen = new Set();
  data.terrain.forEach((terrain, index) => {
    const cell = { x: index % data.width, y: Math.floor(index / data.width) };
    if (terrain !== "floor" || inRoom(cell)) return;
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inRoom({ x: cell.x + dx, y: cell.y + dy }))) return;
    computeVisibleCells(kinds, cell, data.width + data.height)
      .forEach((row, y) => row.forEach((visible, x) => { if (visible) seen.add(`${x},${y}`); }));
  });
  return { seen, inRoom };
}

test("ambush puts the loot in a room and hides the guards from its doorways", async () => {
  const { data, seats, row } = await build({ tactics: [{ tactic: "ambush", params: { guards: 2 } }] });
  assert.equal(row.applied, true);
  assert.equal(row.variant, "hidden");
  assert.notEqual(row.room, data.entryRoomId, "the ambush is never the entry room");
  const room = data.rooms.find((entry) => entry.id === row.room);
  const { seen, inRoom } = await seenFromDoorways(data, room);
  assert.ok(inRoom(seats.loot), "the loot is in the ambush room");
  assert.deepEqual(row.guards, ["guard_1", "guard_2"]);
  assert.equal(row.hidden, 2, row.note);
  for (const id of row.guards) {
    assert.ok(inRoom(seats[id]), `${id} is in the room`);
    assert.equal(seen.has(key(seats[id])), false, `${id} is out of every doorway's sight`);
  }
});

test("visible=true seats the guards in the open, within 2 of the loot", async () => {
  const { data, seats, row } = await build({ tactics: [{ tactic: "ambush", params: { guards: 2, visible: "true" } }] });
  assert.equal(row.variant, "visible");
  const room = data.rooms.find((entry) => entry.id === row.room);
  const { inRoom } = await seenFromDoorways(data, room);
  for (const id of row.guards) {
    assert.ok(inRoom(seats[id]), `${id} is in the room`);
    assert.ok(chebyshev(seats[id], seats.loot) <= 2, `${id} stands by the loot`);
  }
});

test("a room that cannot hide every guard hides what fits, says so, and still builds", async () => {
  const { seats, row } = await build({ tactics: [{ tactic: "ambush", params: { guards: 12 } }], guards: 12 });
  assert.ok(row.hidden < 12, `hid ${row.hidden}`);
  assert.match(row.note, new RegExp(`hides ${row.hidden} of 12 guards`));
  assert.equal(row.guards.every((id) => seats[id]), true);
});

test("room= names the room; an unknown room or param is refused with a reason", async () => {
  const first = await build({ tactics: [{ tactic: "ambush" }] });
  const other = first.data.rooms.find((room) => room.id !== first.data.entryRoomId && room.id !== first.row.room);
  const named = await build({ tactics: [{ tactic: "ambush", params: { room: other.id } }] });
  assert.equal(named.row.room, other.id);
  await assert.rejects(build({ tactics: [{ tactic: "ambush", params: { room: "nowhere" } }] }), /no room "nowhere"/);
  await assert.rejects(build({ tactics: [{ tactic: "ambush", params: { gaurds: 2 } }] }), /unknown param gaurds/);
});

test("both variants seat the same for every affinity, and for none", async () => {
  for (const params of [{ guards: 2 }, { guards: 2, visible: "true" }]) {
    const baseline = (await build({ tactics: [{ tactic: "ambush", params }] })).seats;
    for (const kind of KINDS.slice(1)) {
      assert.deepEqual((await build({ tactics: [{ tactic: "ambush", params }], kind })).seats, baseline, `${kind} ${params.visible || "hidden"}`);
    }
  }
});

// ## TODO: Test Permutations
// - two ambush tactics take different rooms and different wardens
// - a warden named by an authored --place constraint is never taken as a guard
// - resources=0 sets guards without loot
// - a level with fewer wardens than guards= reports the shortfall
