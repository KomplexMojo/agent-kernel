/**
 * #301 — relational placement constraints on the Configurator's object placement: distance
 * bounds to a marker, a room or another object (Chebyshev), counts within a radius, on/off
 * the only route, and spread/clump. Solved with real Z3 through the hosted placer; a
 * constraint that cannot hold is refused with the constraint named, never dropped.
 */
"use strict";

const assert = require("node:assert/strict");

const CREATED_AT = "2026-10-18T00:00:00.000Z";
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

async function load() {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/persona.js");
  const { createHostedObjectPlacer } = await import("../../../packages/runtime/src/commands/solver-host.js");
  const { createHybridConstraintSolverAdapter } = await import("../../../packages/adapters-cli/src/adapters/z3/index.js");
  const configurator = createConfiguratorPersona({ clock: () => CREATED_AT });
  const placer = (adapter = createHybridConstraintSolverAdapter()) => createHostedObjectPlacer({
    prepare: configurator.prepareObjectPlacement,
    complete: configurator.completeObjectPlacement,
    adapter,
    clock: () => CREATED_AT,
  });
  return { configurator, placer };
}

// An open room with walls round it; spawn top-left, exit bottom-right.
function openBoard(width, height) {
  const terrain = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      terrain.push(y === 0 && x === 1 ? "spawn" : y === height - 1 && x === width - 2 ? "exit" : edge ? "wall" : "floor");
    }
  }
  return {
    width, height, terrain,
    spawnApproach: { x: 1, y: 1 }, exitApproach: { x: width - 2, y: height - 2 },
    rooms: [{ id: "far_corner", x: width - 4, y: 1, width: 2, height: 2 }],
  };
}

// Two 3x3 rooms joined by a one-cell-wide corridor of length 3: the corridor is the only route.
function corridorBoard() {
  const rows = [
    "#S#######",
    "#...#####",
    "#.......#",
    "#...#...#",
    "#####...#",
    "#######E#",
  ];
  const terrain = rows.flatMap((row) => [...row].map((char) => (
    char === "#" ? "wall" : char === "S" ? "spawn" : char === "E" ? "exit" : "floor")));
  return {
    width: 9, height: 6, terrain,
    spawnApproach: { x: 1, y: 1 }, exitApproach: { x: 7, y: 4 },
    rooms: [],
  };
}

const hazard = (id, affinity) => ({ id, affinity: { kind: affinity, expression: "emit", stacks: 1 } });
const resource = (id) => ({ id, vitals: { durability: { current: 1, max: 1, regen: 0 } }, holdings: [] });
const warden = (id) => ({ id, archetype: "warden", alignment: "dungeon" });
const positions = (result) => new Map(result.actors.map((actor) => [actor.id, actor.position]));

test("parses the spec-string grammar into one canonical constraint", async () => {
  const { parsePlacementConstraint } = await import(
    "../../../packages/runtime/src/personas/configurator/placement-constraints.js"
  );
  assert.deepEqual(parsePlacementConstraint("hazard:trap1;near=exit:1;onRoute"), {
    label: "hazard:trap1;near=exit:1;onRoute",
    subject: { kind: "hazard", ref: "trap1" },
    near: { target: { kind: "exit" }, distance: 1 },
    route: "on",
  });
  assert.deepEqual(parsePlacementConstraint("warden:*;near=hazard:trap1:2;count=3").near, {
    target: { kind: "hazard", ref: "trap1" }, distance: 2,
  });
  assert.throws(() => parsePlacementConstraint("hazard:1"), /says nothing about placement/);
  assert.throws(() => parsePlacementConstraint("hazard:1;near=warden:*:2"), /must name one thing/);
  assert.throws(() => parsePlacementConstraint("hazard:1;far=exit:3;count=1"), /count needs near=/);
  assert.throws(() => parsePlacementConstraint("exit;near=spawn:1"), /spawn, exit and rooms are not placed/);
});

test("a distance bound to a marker or a room holds, and the report says so", async () => {
  const { placer } = await load();
  const layout = openBoard(20, 14);
  const result = await placer()({
    layout,
    hazards: [hazard("trap1", "fire"), hazard("trap2", "water")],
    resources: [resource("cache")],
    actors: [],
    placement: ["hazard:trap1;near=exit:1", "resource:cache;near=room:far_corner:0", "hazard:2;far=spawn:10"],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.source, "solver");
  const placed = positions(result);
  assert.ok(chebyshev(placed.get("trap1"), layout.exitApproach) <= 1);
  const room = layout.rooms[0];
  const cache = placed.get("cache");
  assert.ok(cache.x >= room.x && cache.x < room.x + room.width && cache.y >= room.y && cache.y < room.y + room.height);
  assert.ok(chebyshev(placed.get("trap2"), layout.spawnApproach) >= 10);
  assert.deepEqual(result.placementReport.map(({ constraint, held }) => ({ constraint, held })), [
    { constraint: "hazard:trap1;near=exit:1", held: true },
    { constraint: "resource:cache;near=room:far_corner:0", held: true },
    { constraint: "hazard:2;far=spawn:10", held: true },
  ]);
});

test("onRoute puts a trap on the only route; offRoute keeps it off", async () => {
  const { placer } = await load();
  const layout = corridorBoard();
  const onlyRoute = ["3,2", "4,2", "5,2"];
  const on = await placer()({ layout, hazards: [hazard("trap1", "earth")], resources: [], actors: [],
    placement: ["hazard:trap1;onRoute"] });
  assert.equal(on.ok, true, JSON.stringify(on));
  const onCell = positions(on).get("trap1");
  assert.ok(onlyRoute.includes(`${onCell.x},${onCell.y}`), `${onCell.x},${onCell.y} is not on the only route`);
  const off = await placer()({ layout, hazards: [hazard("trap1", "wind")], resources: [], actors: [],
    placement: ["hazard:trap1;offRoute;far=spawn:2"] });
  assert.equal(off.ok, true, JSON.stringify(off));
  const offCell = positions(off).get("trap1");
  assert.ok(!onlyRoute.includes(`${offCell.x},${offCell.y}`));
  assert.equal(off.placementReport.every(({ held }) => held), true);
});

test("three wardens within 2 of a trap that is itself still to be placed", async () => {
  const { placer } = await load();
  const layout = openBoard(24, 16);
  const actors = [warden("w1"), warden("w2"), warden("w3"), warden("w4")];
  const result = await placer()({
    layout,
    hazards: [hazard("trap1", "growth")],
    resources: [],
    actors,
    placement: ["hazard:trap1;far=spawn:8", "warden:*;near=hazard:trap1:2;count=3"],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const trap = positions(result).get("trap1");
  const near = Object.values(result.actorPositions).filter((cell) => chebyshev(cell, trap) <= 2);
  assert.equal(Object.keys(result.actorPositions).length, 4, "every named warden is placed by this search");
  assert.ok(near.length >= 3);
  assert.equal(result.placementReport[1].held, true);
  assert.ok(result.placementReport[1].matched >= 3);
});

test("two objects still to be placed keep a minimum distance from each other", async () => {
  const { placer } = await load();
  const layout = openBoard(12, 10);
  const result = await placer()({
    layout,
    hazards: [hazard("a", "corrode"), hazard("b", "fortify")],
    resources: [],
    actors: [],
    placement: ["hazard:a;far=hazard:b:5"],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const placed = positions(result);
  assert.ok(chebyshev(placed.get("a"), placed.get("b")) >= 5);
});

test("spread pushes things apart and clump draws them together", async () => {
  const { placer } = await load();
  const layout = openBoard(12, 10);
  const resources = [resource("r1"), resource("r2"), resource("r3")];
  const spread = await placer()({ layout, hazards: [], resources, actors: [], placement: ["resource:*;spread"] });
  const clump = await placer()({ layout, hazards: [], resources, actors: [], placement: ["resource:*;clump;near=exit:4"] });
  assert.equal(spread.ok, true, JSON.stringify(spread));
  assert.equal(clump.ok, true, JSON.stringify(clump));
  assert.ok(spread.placementReport[0].closestPair >= 4, JSON.stringify(spread.placementReport));
  assert.equal(clump.placementReport[0].farthestPair, 1);
});

test("a constraint that cannot hold is refused with the constraint named", async () => {
  const { placer } = await load();
  const layout = openBoard(16, 12);
  const noCell = await placer()({ layout, hazards: [hazard("trap1", "light")], resources: [], actors: [],
    placement: ["hazard:trap1;near=exit:0"] });
  assert.equal(noCell.ok, false);
  assert.equal(noCell.status, "unsat");
  assert.equal(noCell.reason, "placement_constraint");
  assert.match(noCell.detail, /"hazard:trap1;near=exit:0" leaves trap1 no free cell/);

  const together = await placer()({ layout, hazards: [hazard("a", "dark"), hazard("b", "light")], resources: [], actors: [],
    placement: ["hazard:a;near=spawn:1", "hazard:b;near=exit:1", "hazard:a;near=hazard:b:2"] });
  assert.equal(together.ok, false);
  assert.equal(together.status, "unsat");
  assert.equal(together.reason, "placement_constraint");
  assert.match(together.detail, /"hazard:a;near=hazard:b:2"/);

  const tooFew = await placer()({ layout, hazards: [hazard("a", "fire")], resources: [], actors: [warden("w1")],
    placement: ["warden:*;near=hazard:a:2;count=2"] });
  assert.equal(tooFew.reason, "placement_constraint");
  assert.match(tooFew.detail, /asks for 2 but names only 1/);

  const unknown = await placer()({ layout, hazards: [hazard("a", "fire")], resources: [], actors: [],
    placement: ["hazard:a;near=room:nowhere:1"] });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "placement_constraint_invalid");
  assert.match(unknown.detail, /no room "nowhere"/);
});

test("without a solver a constrained placement is refused, never placed as if unconstrained", async () => {
  const { placer } = await load();
  const layout = openBoard(16, 12);
  const result = await placer(null)({ layout, hazards: [hazard("trap1", "water")], resources: [], actors: [],
    placement: ["hazard:trap1;near=exit:2"] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "placement_constraints_need_solver");
  const unconstrained = await placer(null)({ layout, hazards: [hazard("trap1", "water")], resources: [], actors: [] });
  assert.equal(unconstrained.ok, true);
  assert.equal(unconstrained.source, "fallback");
});

// ## TODO: Test Permutations
// - near and far on the same constraint bound a ring around the target
// - a count whose target is an object already in place uses no extra variables
// - an authored-position hazard that breaks its own constraint is refused naming it
// - spread over wardens and hazards together across a corridor level
