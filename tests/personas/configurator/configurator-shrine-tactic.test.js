/**
 * #486 — the `shrine` tactic: helping hazards are a placement role, not a new actor type. A
 * room (off the spawn-to-exit route when there is one, a detour worth taking) gets hazards whose
 * emitted field restores a vital, drawn from the affinity table's restoring rows by the seed,
 * every kind alike. A health shrine is reported as a healing well. They are ordinary hazards,
 * priced by the Allocator from the hazard share; a shrine it cannot afford is dropped.
 */
"use strict";

const assert = require("node:assert/strict");

const CREATED_AT = "2026-10-18T00:00:00.000Z";
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Three rooms in a row on row 5 (spawn in R1, exit in R3), and R4 below R2, off the route.
function sideRoomLayout() {
  const width = 30;
  const height = 16;
  const rooms = [
    { id: "R1", x: 1, y: 3, width: 4, height: 5 },
    { id: "R2", x: 10, y: 1, width: 9, height: 9 },
    { id: "R3", x: 24, y: 3, width: 4, height: 5 },
    { id: "R4", x: 12, y: 12, width: 5, height: 3 },
  ];
  const terrain = Array.from({ length: width * height }, () => "wall");
  const open = (x, y) => { terrain[y * width + x] = "floor"; };
  rooms.forEach((room) => {
    for (let y = room.y; y < room.y + room.height; y += 1) for (let x = room.x; x < room.x + room.width; x += 1) open(x, y);
  });
  for (let x = 5; x < 24; x += 1) if (x < 10 || x >= 19) open(x, 5);
  open(14, 10); open(14, 11);
  return { width, height, terrain, rooms, spawnApproach: { x: 1, y: 5 }, exitApproach: { x: 27, y: 5 },
    entryRoomId: "R1", exitRoomId: "R3" };
}

async function configurator() {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  return createConfiguratorPersona({ clock: () => CREATED_AT });
}

async function compile({ params = {}, layout = sideRoomLayout(), seed = 0, tactics } = {}) {
  return (await configurator()).compileTactics({ tactics: tactics || [{ tactic: "shrine", params }], layout, actors: [], resources: [], seed });
}

const seatOf = (placement, id) => placement.find((constraint) => constraint.subject.ref === id).near.target.cells[0];
const inRoom = (room, { x, y }) => x >= room.x && y >= room.y && x < room.x + room.width && y < room.y + room.height;

test("a shrine's kind is a restoring row of the affinity table, drawn from the seed", async () => {
  const { AFFINITY_TABLE } = await import("../../../packages/core-ts/src/state/affinity-table.ts");
  const restoring = AFFINITY_TABLE.filter((row) => row.outward === "restore");
  const seen = new Set();
  for (let seed = 0; seed < 10; seed += 1) {
    const { hazards, report } = await compile({ seed });
    assert.equal(report[0].applied, true, report[0].note);
    assert.equal(hazards.length, 1);
    const row = restoring.find((entry) => entry.kind === hazards[0].affinity);
    assert.ok(row, `seed ${seed}: ${hazards[0].affinity} restores nothing`);
    assert.deepEqual(report[0].shrines, [{ id: hazards[0].id, kind: row.kind, restores: row.primaryVital,
      name: row.primaryVital === "health" ? "healing well" : "shrine" }]);
    seen.add(row.kind);
    const again = await compile({ seed });
    assert.deepEqual(again, await compile({ seed }), "the same seed seats the same shrine");
  }
  assert.deepEqual([...seen].sort(), restoring.map((row) => row.kind).sort(), "every restoring kind is drawn by some seed");
});

test("a shrine sits in a room off the route when there is one, clear of other hazards", async () => {
  const layout = sideRoomLayout();
  const { report, hazards, placement } = await compile({ params: { count: 2 }, layout });
  const row = report[0];
  assert.equal(row.room, "R4");
  assert.equal(hazards.length, 2);
  const seats = row.hazards.map(({ id }) => seatOf(placement, id));
  const room = layout.rooms.find((entry) => entry.id === "R4");
  seats.forEach((seat) => assert.ok(inRoom(room, seat), JSON.stringify(seat)));
  assert.ok(chebyshev(seats[0], seats[1]) > 1, "two shrines never touch");
  // Placed after a minefield, it keeps clear of the minefield's hazards too.
  const both = await compile({ layout, tactics: [{ tactic: "minefield", params: { hazards: 2 } }, { tactic: "shrine", params: { room: "R2" } }] });
  const mines = both.report[0].hazards.map(({ id }) => seatOf(both.placement, id));
  const shrine = seatOf(both.placement, both.report[1].hazards[0].id);
  mines.forEach((mine) => assert.ok(chebyshev(mine, shrine) > 1, "the shrine touches no mine"));
});

test("shrine hazards keep their field lit and meet the viability floor", async () => {
  const { computeInternalManaUpkeep } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");
  const [hazard] = (await compile({ params: { range: 2, kinds: "light" } })).hazards;
  assert.deepEqual(hazard.affinityStacks[0], { kind: "light", expression: "emit", stacks: 2, intensity: 1, targetType: "floor" });
  assert.ok(hazard.vitals.mana.regen >= computeInternalManaUpkeep(3), JSON.stringify(hazard.vitals.mana));
  assert.ok(hazard.vitals.mana.max >= 10 && hazard.vitals.durability.max >= 10 && hazard.vitals.durability.regen >= 1);
});

test("kinds= names restoring kinds in order; a harmful or unknown kind is refused", async () => {
  const { hazards } = await compile({ params: { count: 3, kinds: "growth+fortify" } });
  assert.deepEqual(hazards.map((hazard) => hazard.affinity), ["growth", "fortify", "growth"]);
  await assert.rejects(compile({ params: { kinds: "fire" } }), /restore a vital.*growth, fortify, light/);
  await assert.rejects(compile({ params: { kinds: "growth+lava" } }), /not lava/);
});

test("a bad shrine is refused with a reason; a level with no room says so", async () => {
  await assert.rejects(compile({ params: { room: "R9" } }), /no room "R9"/);
  await assert.rejects(compile({ params: { wells: 2 } }), /unknown param wells/);
  await assert.rejects(compile({ params: { count: 0 } }), /count must be a whole number >= 1/);
  await assert.rejects(compile({ params: { range: 0 } }), /range must be a whole number >= 1/);
  const none = await compile({ layout: { width: 3, height: 1, terrain: ["floor", "floor", "floor"], rooms: [] } });
  assert.equal(none.report[0].applied, false);
});

test("validateTactics reads shrine params like the compile does", async () => {
  const persona = await configurator();
  assert.deepEqual(persona.validateTactics([{ tactic: "shrine", params: { count: 2 } }]), []);
  assert.match(persona.validateTactics([{ tactic: "shrine", params: { kinds: "decay" } }])[0], /restore a vital/);
});

test("fitTacticHazards drops shrine and minefield hazards alike, from the end", async () => {
  const persona = await configurator();
  const report = [
    { tactic: "minefield", applied: true, hazards: [{ id: "a" }, { id: "b" }] },
    { tactic: "shrine", applied: true, hazards: [{ id: "s" }], shrines: [{ id: "s", kind: "growth", restores: "health", name: "healing well" }] },
  ];
  const fitted = persona.fitTacticHazards({ report, affordable: (dropped) => dropped.size >= 2 });
  assert.deepEqual([...fitted.dropped], ["s", "b"]);
  assert.deepEqual(fitted.report[1].hazards, []);
  assert.deepEqual(fitted.report[1].shrines, []);
  assert.match(fitted.report[1].note, /affords 0 of 1 hazards/);
  assert.deepEqual(fitted.report[0].hazards, [{ id: "a" }]);
});

// ## TODO: Test Permutations
// - room= naming a route room seats the shrine there
// - count larger than the room holds seats what fits and says so
// - every restoring kind with range 1..3 keeps its field lit
// - a level whose only rooms are the entry and exit rooms takes the shrine in the exit room
