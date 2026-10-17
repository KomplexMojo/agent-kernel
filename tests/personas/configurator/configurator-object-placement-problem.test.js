/**
 * Z9.0 — characterize today's greedy build placement and lock the Z9.1 search contract.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const FIXTURE_PATH = resolve(__dirname, "../../fixtures/configurator/object-placement-greedy-counterexample.json");
const readPlacementFixture = () => JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

async function hostedPlacement(configurator, adapter) {
  const { createHostedObjectPlacer } = await import(
    "../../../packages/runtime/src/commands/solver-host.js"
  );
  return createHostedObjectPlacer({
    prepare: configurator.prepareObjectPlacement,
    complete: configurator.completeObjectPlacement,
    adapter,
    clock: () => "2026-09-01T00:00:00.000Z",
  });
}

function splitFixtureObjects(fixture) {
  return {
    hazards: fixture.objects.filter(({ kind }) => kind === "hazard"),
    resources: fixture.objects.filter(({ kind }) => kind === "resource"),
  };
}

const pointKey = ({ x, y }) => `${x},${y}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const contains = (room, point) => (
  point.x >= room.x && point.x < room.x + room.width
  && point.y >= room.y && point.y < room.y + room.height
);

function marker(layout, kind) {
  const index = layout.terrain.indexOf(kind);
  assert.ok(index >= 0);
  return { x: index % layout.width, y: Math.floor(index / layout.width) };
}
function walkable(layout) {
  return layout.terrain.flatMap((kind, index) => kind !== "floor" ? [] :
    [{ x: index % layout.width, y: Math.floor(index / layout.width) }]);
}

function pathExists(layout, blocking) {
  const allowed = new Set(walkable(layout).map(pointKey));
  const spawn = layout.spawnApproach || marker(layout, "spawn");
  const exit = layout.exitApproach || marker(layout, "exit");
  const start = pointKey(spawn);
  const target = pointKey(exit);
  const queue = [spawn];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (pointKey(current) === target) return true;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = pointKey(next);
      if (allowed.has(key) && !blocking.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return false;
}

function placementContext(board) {
  const cells = walkable(board.layout);
  const cellKeys = new Set(cells.map(pointKey));
  const occupied = new Set([
    pointKey(board.layout.spawnApproach || marker(board.layout, "spawn")),
    pointKey(board.layout.exitApproach || marker(board.layout, "exit")),
  ]);
  (board.actors || []).forEach(({ position }) => occupied.add(pointKey(position)));
  const placements = new Map();
  const blocking = new Set();

  for (const object of board.objects) {
    if (!object.position) continue;
    const key = pointKey(object.position);
    const room = object.roomId
      ? board.layout.rooms.find(({ id }) => id === object.roomId)
      : null;
    if (!cellKeys.has(key) || (object.roomId && (!room || !contains(room, object.position)))) {
      return { error: "containment" };
    }
    if (occupied.has(key)) return { error: "collision" };
    occupied.add(key);
    placements.set(object.id, object.position);
    if (object.blocking === true) blocking.add(key);
  }
  return { cells, occupied, placements, blocking };
}

function candidates(board, object, context) {
  const room = object.roomId
    ? board.layout.rooms.find(({ id }) => id === object.roomId)
    : null;
  if (object.roomId && !room) return [];
  return context.cells.filter((cell) => (
    !context.occupied.has(pointKey(cell)) && (!room || contains(room, cell))
  ));
}

function search(board, { ignorePath = false } = {}) {
  const context = placementContext(board);
  if (context.error) return null;
  const pending = board.objects.filter((object) => !object.position);

  function visit(index) {
    if (index === pending.length) {
      return board.objects.map((object) => ({
        id: object.id,
        position: context.placements.get(object.id),
      }));
    }
    const object = pending[index];
    for (const cell of candidates(board, object, context)) {
      const key = pointKey(cell);
      context.occupied.add(key);
      context.placements.set(object.id, cell);
      if (object.blocking === true) context.blocking.add(key);
      const legalPath = ignorePath || pathExists(board.layout, context.blocking);
      const result = legalPath ? visit(index + 1) : null;
      if (result) return result;
      context.occupied.delete(key);
      context.placements.delete(object.id);
      if (object.blocking === true) context.blocking.delete(key);
    }
    return null;
  }
  return visit(0);
}

function solve(board) {
  const context = placementContext(board);
  if (context.error) return { status: "unsat", reason: context.error };
  const pending = board.objects.filter((object) => !object.position);
  if (pending.some((object) => object.roomId && candidates(board, object, context).length === 0)) {
    return { status: "unsat", reason: "containment" };
  }
  if (context.cells.filter((cell) => !context.occupied.has(pointKey(cell))).length < pending.length) {
    return { status: "unsat", reason: "capacity" };
  }
  const assignment = search(board);
  if (assignment) return { status: "fulfilled", assignment };
  if (search(board, { ignorePath: true })) return { status: "unsat", reason: "path_obstruction" };
  return { status: "unsat", reason: "capacity" };
}

function greedyFailure(board) {
  const context = placementContext(board);
  if (context.error) return context.error;
  for (const object of board.objects.filter((entry) => !entry.position)) {
    const [cell] = candidates(board, object, context);
    if (!cell) return object.id;
    context.occupied.add(pointKey(cell));
  }
  return null;
}

test("current build placement remains hazards-first and row-major", async () => {
  const { orchestrateBuild } = await import(
    "../../../packages/runtime/src/build/orchestrate-build.js"
  );
  const spec = {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: { id: "z9_current", runId: "z9_current", createdAt: "2026-09-01T00:00:00.000Z", source: "runtime-test" },
    intent: { goal: "characterize placement" },
    plan: {},
    configurator: { inputs: {
      levelGen: { width: 7, height: 7, walkableTilesTarget: 20, seed: 9, hazards: [
        { id: "hazard_first", affinity: { kind: "fire", expression: "emit", stacks: 1 } },
        { id: "hazard_second", affinity: { kind: "water", expression: "emit", stacks: 1 } },
      ] },
      resources: [{ id: "resource_first", category: "resource", vitals: { durability: { current: 1, max: 1, regen: 0 } }, holdings: [] }],
      actors: [], movementStamina: {},
    } },
  };
  const result = await orchestrateBuild({ spec, producedBy: "runtime-test" });
  const data = result.simConfig.layout.data;
  const project = (entry) => ({ id: entry.id, position: entry.position });
  assert.equal(Object.hasOwn(data, "hazards"), false);
  assert.deepEqual(result.initialState.actors.filter((actor) => actor.id.startsWith("hazard_")).map(project), [
    { id: "hazard_first", position: { x: 1, y: 1 } },
    { id: "hazard_second", position: { x: 3, y: 1 } },
  ]);
  assert.deepEqual(result.initialState.actors.filter((actor) => actor.id === "resource_first").map(project), [
    { id: "resource_first", position: { x: 4, y: 1 } },
  ]);
});

test("complete search preserves fixed coordinates and finds the first lexicographic assignment", () => {
  const fixture = readPlacementFixture();
  assert.equal(greedyFailure(fixture), fixture.expected.greedyFailureAt);
  assert.deepEqual(solve(fixture), {
    status: "fulfilled",
    assignment: fixture.expected.assignment,
  });
  assert.equal(pathExists(fixture.layout, new Set()), true);
});

test("the four actionable unsat reason families remain distinct", () => {
  const base = readPlacementFixture();
  const collision = clone(base);
  collision.objects[0].position = clone(collision.layout.spawnApproach);
  assert.deepEqual(solve(collision), { status: "unsat", reason: "collision" });

  const containment = clone(base);
  containment.objects[2].roomId = "missing_room";
  assert.deepEqual(solve(containment), { status: "unsat", reason: "containment" });

  const capacity = clone(base);
  Object.assign(capacity.layout, {
    width: 5, height: 3,
    spawnApproach: { x: 1, y: 1 }, exitApproach: { x: 3, y: 1 },
    terrain: ["wall", "spawn", "wall", "exit", "wall", "wall", "floor", "floor", "floor", "wall", "wall", "wall", "wall", "wall", "wall"],
  });
  capacity.layout.rooms = [];
  capacity.actors = [];
  capacity.objects = [{ id: "one" }, { id: "two" }];
  assert.deepEqual(solve(capacity), { status: "unsat", reason: "capacity" });

  const blocked = clone(capacity);
  Object.assign(blocked.layout, {
    width: 6, height: 4,
    spawnApproach: { x: 1, y: 1 }, exitApproach: { x: 4, y: 1 },
    terrain: ["wall", "spawn", "wall", "wall", "exit", "wall", "wall", "floor", "floor", "floor", "floor", "wall", "wall", "floor", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"],
  });
  blocked.layout.rooms = [{ id: "choke", x: 2, y: 1, width: 1, height: 1 }];
  blocked.objects = [{ id: "blocker", roomId: "choke", blocking: true }];
  assert.deepEqual(solve(blocked), { status: "unsat", reason: "path_obstruction" });
});

test("object placement uses the existing Configurator domain, not a fourth solver domain", async () => {
  const { buildConstraintProblem, CONSTRAINT_DOMAINS, validateConstraintProblem } = await import(
    "../../../packages/runtime/src/contracts/constraint-problem.js"
  );
  const problem = buildConstraintProblem({
    domain: CONSTRAINT_DOMAINS.CONFIGURATOR_SATISFIABILITY,
    posedBy: "configurator",
    variables: [],
    constraints: [],
    objective: ["authored_entity_order", "row_major_cell"],
    context: { problemKind: "object_placement" },
  });
  assert.deepEqual(validateConstraintProblem(problem), { ok: true, errors: [] });
  assert.equal(problem.context.problemKind, "object_placement");
  assert.deepEqual(problem.objective, ["authored_entity_order", "row_major_cell"]);
});

test("the Configurator authors a linear object-placement problem and consumes genuine Z3 search", async () => {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/persona.js"
  );
  const { createHybridConstraintSolverAdapter } = await import(
    "../../../packages/adapters-cli/src/adapters/z3/index.js"
  );
  const fixture = readPlacementFixture();
  const configurator = createConfiguratorPersona({ clock: () => "2026-09-01T00:00:00.000Z" });
  const args = {
    layout: fixture.layout,
    actors: fixture.actors,
    ...splitFixtureObjects(fixture),
  };
  const prepared = configurator.prepareObjectPlacement(args);

  assert.equal(prepared.status, "ready");
  assert.equal(prepared.problem.domain, "configurator_satisfiability");
  assert.equal(prepared.problem.posedBy, "configurator");
  assert.equal(prepared.problem.context.problemKind, "object_placement");
  assert.ok(prepared.problem.variables.every(({ kind }) => kind === "integer"));
  assert.ok(prepared.problem.constraints.every(({ kind }) => kind === "linear"));
  assert.deepEqual(
    prepared.problem.objective.priorities.slice(0, 2).map(({ id }) => id),
    ["place_flexible_hazard", "place_room_resource"],
  );

  const adapter = createHybridConstraintSolverAdapter();
  const firstModel = await adapter.solve(prepared.request);
  const replayedModel = await adapter.solve(prepared.request);
  assert.deepEqual(replayedModel, firstModel, "the adapter must replay the full placement model exactly");
  const placeObjects = await hostedPlacement(configurator, adapter);
  const result = await placeObjects(args);
  const replay = await placeObjects(args);
  assert.equal(result.ok, true);
  assert.equal(result.source, "solver");
  assert.deepEqual(replay, result, "the same authored problem must replay to the same model");
  const placedById = new Map(
    result.actors.map((entry) => [entry.id, entry]),
  );
  assert.deepEqual(fixture.expected.assignment.map(({ id }) => ({
    id,
    position: placedById.get(id).position,
  })), fixture.expected.assignment);
  assert.deepEqual(fixture.layout, readPlacementFixture().layout, "placement must not mutate caller layout");
});

test("solver unsat is final and distinguishes collision, containment, capacity, and path obstruction", async () => {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/persona.js"
  );
  const { createHybridConstraintSolverAdapter } = await import(
    "../../../packages/adapters-cli/src/adapters/z3/index.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => "2026-09-01T00:00:00.000Z" });
  const placeObjects = await hostedPlacement(configurator, createHybridConstraintSolverAdapter());
  const base = readPlacementFixture();
  const baseArgs = { layout: base.layout, actors: base.actors, ...splitFixtureObjects(base) };

  const collision = clone(baseArgs);
  collision.resources[0].position = clone(collision.layout.spawnApproach);
  assert.deepEqual(await placeObjects(collision), {
    ok: false,
    status: "unsat",
    reason: "collision",
  });

  const containment = clone(baseArgs);
  containment.resources[1].roomId = "missing_room";
  assert.deepEqual(await placeObjects(containment), {
    ok: false,
    status: "unsat",
    reason: "containment",
  });

  const corridor = {
    width: 6, height: 3,
    spawnApproach: { x: 1, y: 1 }, exitApproach: { x: 4, y: 1 },
    terrain: ["wall", "spawn", "wall", "wall", "exit", "wall", "wall", "floor", "floor", "floor", "floor", "wall", "wall", "wall", "wall", "wall", "wall", "wall"],
    rooms: [{ id: "choke", x: 2, y: 1, width: 1, height: 1 }],
  };
  assert.deepEqual(await placeObjects({
    layout: corridor,
    hazards: [{ id: "blocker", roomId: "choke", blocking: true }],
    resources: [],
    actors: [],
  }), {
    ok: false,
    status: "unsat",
    reason: "path_obstruction",
  });

  assert.deepEqual(await placeObjects({
    layout: corridor,
    hazards: [{ id: "one" }, { id: "two" }, { id: "three" }],
    resources: [],
    actors: [],
  }), {
    ok: false,
    status: "unsat",
    reason: "capacity",
  });
});

test("deferred and capability-absent solvers retain the exact hazards-first row-major fallback", async () => {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/persona.js"
  );
  const configurator = createConfiguratorPersona({ clock: () => "2026-09-01T00:00:00.000Z" });
  const args = {
    layout: {
      width: 5, height: 3,
      spawnApproach: { x: 1, y: 1 }, exitApproach: { x: 3, y: 1 },
      terrain: ["wall", "spawn", "wall", "exit", "wall", "wall", "floor", "floor", "floor", "wall", "wall", "wall", "wall", "wall", "wall"],
    },
    hazards: [{ id: "hazard_first", affinity: { kind: "fire", expression: "emit", stacks: 1 } }],
    resources: [],
    actors: [],
  };
  const deferred = {
    kind: "forced-deferred",
    capabilities: { domains: ["configurator_satisfiability"], deterministic: true },
    solve: async () => ({ status: "deferred", reason: "forced_deferred" }),
  };
  const absent = {
    kind: "allocator-only",
    capabilities: { domains: ["allocator_budget_fit"], deterministic: true },
    solve: async () => assert.fail("capability-absent adapter must not be called"),
  };
  const expected = {
    ok: true,
    source: "fallback",
    actors: [{
      id: "hazard_first", position: { x: 2, y: 1 }, alignment: "dungeon",
      lifecycle: "alive", defeatVital: "durability",
      vitals: {
        mana: { current: 12, max: 12, regen: 4 }, // upkeep 2 + range 1 + intensity 1 (#340)
        durability: { current: 5, max: 5, regen: 0 },
      },
      capabilities: { canMove: false, canCast: true, canEquip: false, canTake: false,
        canExit: false, blocksMovement: false, blocksSight: false },
      motivations: [], affinities: [{ kind: "fire", expression: "emit", stacks: 1 }],
      activeAffinityKey: "fire:emit", holdings: [], category: "hazard",
    }],
    layout: {
      ...args.layout,
    },
  };

  assert.deepEqual(await (await hostedPlacement(configurator, deferred))(args), expected);
  assert.deepEqual(await (await hostedPlacement(configurator, absent))(args), expected);
  assert.deepEqual(configurator.completeObjectPlacement(args), expected);
});

test("build glue delegates placement policy to the public Configurator surface", () => {
  const root = resolve(__dirname, "../../..");
  const orchestrator = readFileSync(
    resolve(root, "packages/runtime/src/build/orchestrate-build.js"),
    "utf8",
  );
  const controller = readFileSync(
    resolve(root, "packages/runtime/src/personas/configurator/controller.js"),
    "utf8",
  );
  const placement = readFileSync(
    resolve(root, "packages/runtime/src/personas/configurator/object-placement.js"),
    "utf8",
  );
  const adapter = readFileSync(
    resolve(root, "packages/adapters-cli/src/adapters/z3/index.js"),
    "utf8",
  );

  assert.match(orchestrator, /completeObjectPlacement|placeObjects/);
  assert.match(controller, /prepareObjectPlacement:\s*services\.prepareObjectPlacement/);
  assert.match(controller, /completeObjectPlacement:\s*services\.completeObjectPlacement/);
  assert.match(placement, /export function buildObjectPlacementProblem/);
  [
    "collectWalkablePositions",
    "collectReservedPlacementKeys",
    "assignPositionedLayoutObjects",
  ].forEach((token) => assert.equal(
    orchestrator.includes(token),
    false,
    `${token} must not remain in build glue`,
  ));
  ["hazard", "resource", "spawn", "roomId"].forEach((token) => assert.equal(
    adapter.includes(token),
    false,
    `${token} meaning must not enter the generic platform adapter`,
  ));
});

// ## TODO: Test Permutations
// - two requested rooms competing for one shared corridor cell report capacity, not containment
// - multiple complete assignments retain authored-object then row-major lexicographic order
// - malformed fulfilled models with missing, duplicate, or non-binary assignments are rejected
