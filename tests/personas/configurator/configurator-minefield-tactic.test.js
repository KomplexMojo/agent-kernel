/**
 * #418 — the `minefield` tactic: a room on the spawn-to-exit route gets hazards whose fields
 * overlap, seated clear of a safe line from doorway to doorway. The line is safe because the
 * fields fade out before it, by core's own falloff, for every kind. The hazards are ordinary
 * hazards priced by the Allocator from the hazard share; a minefield it cannot afford shrinks.
 */
"use strict";

const assert = require("node:assert/strict");

const CREATED_AT = "2026-10-18T00:00:00.000Z";
const KINDS = ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const EMIT = 3;

// Three rooms in a row joined by one-wide corridors on row 5: spawn in R1, exit in R3.
function corridorLayout({ middle = { x: 10, y: 1, width: 9, height: 9 } } = {}) {
  const width = 30;
  const height = 11;
  const rooms = [
    { id: "R1", x: 1, y: 3, width: 4, height: 5 },
    { id: "R2", ...middle },
    { id: "R3", x: 24, y: 3, width: 4, height: 5 },
  ];
  const terrain = Array.from({ length: width * height }, () => "wall");
  const open = (x, y) => { terrain[y * width + x] = "floor"; };
  rooms.forEach((room) => {
    for (let y = room.y; y < room.y + room.height; y += 1) for (let x = room.x; x < room.x + room.width; x += 1) open(x, y);
  });
  for (let x = 5; x < 24; x += 1) if (x < middle.x || x >= middle.x + middle.width) open(x, 5);
  return { width, height, terrain, rooms, spawnApproach: { x: 1, y: 5 }, exitApproach: { x: 27, y: 5 },
    entryRoomId: "R1", exitRoomId: "R3" };
}

async function compile({ params = {}, layout = corridorLayout(), seed = 0, resources = [{ id: "loot" }] } = {}) {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  const configurator = createConfiguratorPersona({ clock: () => CREATED_AT });
  return configurator.compileTactics({ tactics: [{ tactic: "minefield", params }], layout, actors: [], resources, seed });
}

const seatOf = (placement, id) => placement.find((constraint) => constraint.subject.ref === id).near.target.cells[0];

async function falloff(distance, range) {
  const { computeAffinityFalloff } = await import("../../../packages/core-ts/src/state/affinity-spatial.ts");
  return computeAffinityFalloff(distance, range, EMIT);
}

test("the safe line is out of every hazard's field and the fields overlap, for every affinity mix", async () => {
  for (const first of KINDS) {
    for (const second of KINDS) {
      const { report, hazards, placement } = await compile({ params: { kinds: `${first}+${second}` } });
      const row = report[0];
      const label = `${first}+${second}`;
      assert.equal(row.applied, true, `${label}: ${row.note}`);
      assert.equal(row.room, "R2", label);
      assert.equal(hazards.length, 4, label);
      assert.deepEqual(hazards.map((hazard) => hazard.affinity), [first, second, first, second], label);
      const seats = row.hazards.map(({ id }) => seatOf(placement, id));
      // Core measures field reach as |dx| + |dy| (rules/actor-fields.ts).
      for (const cell of row.safeLine.cells) {
        for (const seat of seats) assert.equal(await falloff(manhattan(cell, seat), 1), 0, `${label}: line cell ${cell.x},${cell.y}`);
      }
      seats.forEach((seat, index) => seats.slice(index + 1).forEach((other) => assert.ok(chebyshev(seat, other) > 1, `${label}: seats touch`)));
      const cells = new Set(seats.flatMap((seat) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => `${seat.x + dx},${seat.y + dy}`)));
      let overlap = false;
      for (const entry of cells) {
        const [x, y] = entry.split(",").map(Number);
        const reached = [];
        for (const seat of seats) if (await falloff(manhattan({ x, y }, seat), 1) > 0) reached.push(seat);
        if (reached.length >= 2) overlap = true;
      }
      assert.ok(overlap, `${label}: some cell is in two fields`);
    }
  }
});

test("the safe line runs doorway to doorway along walkable cells, and the short route crosses the fields", async () => {
  const { report, placement } = await compile();
  const row = report[0];
  const cells = row.safeLine.cells;
  assert.deepEqual(cells[0], row.safeLine.from);
  assert.deepEqual(cells[cells.length - 1], row.safeLine.to);
  assert.equal(cells.length, row.safeLine.length);
  cells.slice(1).forEach((cell, index) => assert.equal(manhattan(cell, cells[index]), 1, "each step is one move"));
  assert.ok(row.safeLine.length > row.shortRoute.length, "the safe line is the long way round");
  // Row 5 is the straight way through R2; a hazard's field reaches it.
  const seats = row.hazards.map(({ id }) => seatOf(placement, id));
  let crossed = false;
  for (let x = 10; x < 19; x += 1) {
    for (const seat of seats) if (await falloff(manhattan({ x, y: 5 }, seat), 1) > 0) crossed = true;
  }
  assert.ok(crossed, "the short route passes through a field");
  assert.equal(row.reward, "loot");
  const reward = placement.find((constraint) => constraint.subject.kind === "resource");
  assert.ok(reward && seats.every((seat) => chebyshev(seat, reward.near.target.cells[0]) > 1), "the reward sits in the minefield, touching no hazard");
});

test("drawn kinds are damaging rows of the table, never opposites of each other", async () => {
  const { AFFINITY_TABLE } = await import("../../../packages/core-ts/src/state/affinity-table.ts");
  const { getOppositeAffinityKind } = await import("../../../packages/core-ts/src/state/affinity.ts");
  const code = (kind) => AFFINITY_TABLE.findIndex((row) => row.kind === kind) + 1;
  for (let seed = 0; seed < 10; seed += 1) {
    const { hazards } = await compile({ seed });
    const kinds = hazards.map((hazard) => hazard.affinity);
    kinds.forEach((kind) => assert.equal(AFFINITY_TABLE.find((row) => row.kind === kind).outward, "damage", `seed ${seed}: ${kind}`));
    kinds.forEach((kind) => kinds.forEach((other) => assert.notEqual(getOppositeAffinityKind(code(kind)), code(other), `seed ${seed}: ${kind}/${other}`)));
  }
});

test("hazards keep their field lit and meet the viability floor", async () => {
  const { computeInternalManaUpkeep } = await import("../../../packages/runtime/src/personas/configurator/cost-model.js");
  const { hazards } = await compile({ params: { range: 2, hazards: 1 }, layout: corridorLayout({ middle: { x: 9, y: 0, width: 11, height: 11 } }) });
  const [hazard] = hazards;
  assert.deepEqual(hazard.affinityStacks[0], { kind: hazard.affinity, expression: "emit", stacks: 2, intensity: 1, targetType: "floor" });
  assert.ok(hazard.vitals.mana.regen >= computeInternalManaUpkeep(3), JSON.stringify(hazard.vitals.mana));
  assert.ok(hazard.vitals.mana.max >= 10 && hazard.vitals.durability.max >= 10 && hazard.vitals.durability.regen >= 1);
});

test("a room too small for every hazard holds what fits, and says so", async () => {
  const { report, hazards } = await compile({ params: { hazards: 9 }, layout: corridorLayout({ middle: { x: 10, y: 2, width: 7, height: 7 } }) });
  assert.equal(report[0].applied, true);
  assert.ok(hazards.length < 9 && hazards.length > 0, String(hazards.length));
  assert.match(report[0].note, new RegExp(`holds ${hazards.length} of 9 hazards`));
});

test("a bad minefield is refused with a reason", async () => {
  await assert.rejects(compile({ params: { room: "R9" } }), /no room "R9"/);
  await assert.rejects(compile({ params: { mines: 2 } }), /unknown param mines/);
  await assert.rejects(compile({ params: { hazards: -1 } }), /hazards must be a whole number/);
  await assert.rejects(compile({ params: { range: 0 } }), /range must be a whole number >= 1/);
  await assert.rejects(compile({ params: { kinds: "fire+lava" } }), /not lava/);
  const none = await compile({ layout: { width: 3, height: 1, terrain: ["floor", "floor", "floor"], rooms: [] } });
  assert.equal(none.report[0].applied, false);
});

test("fitTacticHazards drops hazards from the end until the share is approved", async () => {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  const configurator = createConfiguratorPersona({ clock: () => CREATED_AT });
  const report = [{ tactic: "minefield", applied: true, hazards: [{ id: "a" }, { id: "b" }, { id: "c" }] }];
  const fitted = configurator.fitTacticHazards({ report, affordable: (dropped) => dropped.size >= 2 });
  assert.deepEqual([...fitted.dropped], ["c", "b"]);
  assert.deepEqual(fitted.report[0].hazards, [{ id: "a" }]);
  assert.equal(fitted.report[0].note, "the hazard share affords 1 of 3 hazards");
});

function spec({ tactics, budget }) {
  return {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: { id: "minefield", runId: "minefield", createdAt: CREATED_AT, source: "runtime-test" },
    intent: { goal: "a room of hazards with a safe line" },
    plan: { hints: { tactics } },
    ...(budget ? { budget: { budget: { schema: "agent-kernel/BudgetArtifact", schemaVersion: 1,
      meta: { id: "budget", runId: "minefield", createdAt: CREATED_AT, producedBy: "runtime-test" },
      budget: { tokens: budget } } } } : {}),
    configurator: {
      inputs: {
        levelGen: {
          width: 40, height: 30, seed: 5,
          shape: { roomCount: 5, roomMinSize: 7, roomMaxSize: 9, corridorWidth: 1 },
          connectivity: { requirePath: true },
        },
        delverCount: 1,
        actors: [{ id: "hero", category: "delver", motivations: ["exploring"], vitals: { health: { current: 10, max: 10, regen: 1 } } }],
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
  const seats = Object.fromEntries(result.initialState.actors.map((actor) => [actor.id, actor.position]));
  return { result, seats, row: result.tacticReport.find((entry) => entry.tactic === "minefield") };
}

test("a built minefield seats its hazards clear of the safe line, priced from the hazard share", async () => {
  const { result, seats, row } = await build({ tactics: [{ tactic: "minefield", params: { hazards: 3 } }] });
  assert.equal(row.applied, true, row.note);
  assert.equal(row.hazards.length, 3);
  for (const { id } of row.hazards) {
    assert.ok(seats[id], `${id} is in the level`);
    row.safeLine.cells.forEach((cell) => assert.ok(chebyshev(cell, seats[id]) >= row.safeLine.clearance, `${id} by ${cell.x},${cell.y}`));
    assert.ok(result.budgetReceipt.lineItems.some((item) => item.category === "hazards" && item.subjectRef?.id === id),
      `${id} is priced from the hazard share`);
  }
});

test("a minefield the hazard share cannot afford shrinks, and the row says so", async () => {
  const { result, seats, row } = await build({ tactics: [{ tactic: "minefield", params: { hazards: 12 } }], budget: 1500 });
  assert.equal(result.budgetReceipt.status, "approved");
  assert.ok(row.hazards.length < 12, `kept ${row.hazards.length}`);
  assert.match(row.note, new RegExp(`the hazard share affords ${row.hazards.length} of \\d+ hazards`));
  const built = result.initialState.actors.filter((actor) => actor.id.startsWith("minefield_"));
  assert.equal(built.length, row.hazards.length, "dropped hazards are not in the level");
  row.hazards.forEach(({ id }) => assert.ok(seats[id], id));
});

// ## TODO: Test Permutations
// - two minefields in different rooms do not share cells or ids
// - an authored positioned hazard in the room keeps the minefield's seats from touching it
// - room= naming a dead-end room (one doorway) is reported not applied
// - range=3 widens the clearance by core's falloff
