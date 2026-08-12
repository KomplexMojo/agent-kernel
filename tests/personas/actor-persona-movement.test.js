const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/persona-behavior-v1-actor-movement.json"), "utf8"));

let actorModulePromise;

function loadActorModules() {
  actorModulePromise ??= Promise.all([
    import("../../packages/runtime/src/personas/actor/controller.mts"),
    import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  return actorModulePromise;
}

async function proposeOnce({
  actor,
  actors = [],
  baseTiles = ["#####", "#...E", "#####"],
  tick = 0,
  payload = {},
} = {}) {
  const [{ createActorPersona }, { TickPhases }] = await loadActorModules();
  const persona = createActorPersona({ clock: () => "fixed" });
  const actorId = actor.id;
  const observation = {
    tick,
    actors: [{ kind: 2, ...actor }, ...actors],
  };
  persona.advance({
    phase: TickPhases.OBSERVE,
    event: "observe",
    payload: { actorId, observation, baseTiles, ...payload },
    tick,
  });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: { actorId }, tick });
  return persona.advance({
    phase: TickPhases.DECIDE,
    event: "propose",
    payload: { actorId, ...payload },
    tick,
  });
}


test("actor persona proposes deterministic movement toward exit", async () => {
const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");


function applyDirection(position, direction) {
  if (direction === "north") return { x: position.x, y: position.y - 1 };
  if (direction === "northeast") return { x: position.x + 1, y: position.y - 1 };
  if (direction === "east") return { x: position.x + 1, y: position.y };
  if (direction === "southeast") return { x: position.x + 1, y: position.y + 1 };
  if (direction === "south") return { x: position.x, y: position.y + 1 };
  if (direction === "southwest") return { x: position.x - 1, y: position.y + 1 };
  if (direction === "west") return { x: position.x - 1, y: position.y };
  if (direction === "northwest") return { x: position.x - 1, y: position.y - 1 };
  return { ...position };
}

fixture.cases.forEach((entry) => {
  const persona = createActorPersona({ clock: () => "fixed" });
  let position = { ...entry.start };
  entry.expectedDirections.forEach((direction, index) => {
    const observation = {
      tick: index,
      actors: [{ id: entry.actorId, kind: 2, position: { ...position } }],
      tiles: { kinds: entry.kinds },
    };
    persona.advance({
      phase: TickPhases.OBSERVE,
      event: "observe",
      payload: { actorId: entry.actorId, observation, baseTiles: entry.baseTiles },
      tick: index,
    });
    persona.advance({
      phase: TickPhases.DECIDE,
      event: "decide",
      payload: { actorId: entry.actorId },
      tick: index,
    });
    const result = persona.advance({
      phase: TickPhases.DECIDE,
      event: "propose",
      payload: { actorId: entry.actorId },
      tick: index,
    });
    assert.equal(result.actions.length, 1);
    const action = result.actions[0];
    assert.equal(action.kind, "move");
    assert.equal(action.actorId, entry.actorId);
    assert.equal(action.params.direction, direction);
    assert.deepEqual(action.params.from, position);
    assert.deepEqual(action.params.to, applyDirection(position, direction));
    position = action.params.to;
    persona.advance({
      phase: TickPhases.DECIDE,
      event: "cooldown",
      payload: { actorId: entry.actorId },
      tick: index,
    });
  });
});
});


test("actor persona with exploring motivation proposes move toward exit", async () => {
const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

// 5×3 board: actor at (1,1), exit "E" at (4,1), floor in between.
const baseTiles = ["#####", "#...E", "#####"];
const actorId = "actor_delver";

const persona = createActorPersona({ clock: () => "fixed" });

persona.advance({
  phase: TickPhases.OBSERVE,
  event: "observe",
  payload: {
    actorId,
    observation: {
      tick: 0,
      actors: [{ id: actorId, kind: 2, position: { x: 1, y: 1 }, motivation: { mobility: "exploring" } }],
    },
    baseTiles,
  },
  tick: 0,
});

persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: { actorId }, tick: 0 });

const result = persona.advance({
  phase: TickPhases.DECIDE,
  event: "propose",
  payload: { actorId },
  tick: 0,
});

assert.ok(Array.isArray(result.actions));
assert.equal(result.actions.length, 1, "exploring motivation must produce exactly one action");
assert.equal(result.actions[0].kind, "move", "exploring motivation must advance toward exit");
assert.equal(result.actions[0].actorId, actorId);
});

// FAILING: buildMoveProposal ignores motivation.mobility (gap #5).
// M4 will check actor.motivation.mobility and return [] for stationary actors.

test("actor persona with stationary motivation proposes wait not move", async () => {
const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/controller.mts");
const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

const baseTiles = ["#####", "#...E", "#####"];
const actorId = "actor_warden";

const persona = createActorPersona({ clock: () => "fixed" });

persona.advance({
  phase: TickPhases.OBSERVE,
  event: "observe",
  payload: {
    actorId,
    observation: {
      tick: 0,
      actors: [{ id: actorId, kind: 2, position: { x: 1, y: 1 }, motivation: { mobility: "stationary" } }],
    },
    baseTiles,
  },
  tick: 0,
});

persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: { actorId }, tick: 0 });

const result = persona.advance({
  phase: TickPhases.DECIDE,
  event: "propose",
  payload: { actorId },
  tick: 0,
});

// A stationary warden must hold position — it must not propose movement.
assert.ok(Array.isArray(result.actions));
assert.equal(result.actions.length, 1, "stationary motivation must produce exactly one action");
assert.equal(result.actions[0].kind, "wait", "stationary motivation must produce wait, not move");
});

test.skip("actor persona with patrolling route proposes route movement instead of BFS to exit", async () => {
  const result = await proposeOnce({
    actor: {
      id: "patroller",
      position: { x: 1, y: 1 },
      motivation: { kind: "patrolling", route: [{ x: 1, y: 2 }, { x: 1, y: 3 }] },
    },
    baseTiles: ["#####", "#...E", "#...#", "#...#", "#####"],
  });
  assert.equal(result.actions[0].params.direction, "south");
});

test("actor persona with attacking motivation moves toward a visible opponent before the exit", async () => {
  const result = await proposeOnce({
    actor: {
      id: "attacker",
      position: { x: 1, y: 2 },
      motivation: { kind: "attacking" },
    },
    actors: [{ id: "opponent", kind: 2, position: { x: 1, y: 0 } }],
    baseTiles: ["#...#", "#...#", "#...E", "#####"],
  });

  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].kind, "move");
  assert.equal(result.actions[0].params.direction, "north");
  assert.deepEqual(result.actions[0].params.to, { x: 1, y: 1 });
});

test.skip("actor persona with defending hold point proposes wait at hold point", async () => {
  const result = await proposeOnce({
    actor: {
      id: "defender",
      position: { x: 2, y: 2 },
      motivation: { kind: "defending", pattern: "hold_point", target: { x: 2, y: 2 } },
    },
    baseTiles: ["#####", "#...#", "#...E", "#####"],
  });
  assert.equal(result.actions[0].kind, "wait");
});

test.skip("actor persona with user_controlled motivation emits no autonomous proposal", async () => {
  const result = await proposeOnce({
    actor: {
      id: "manual",
      position: { x: 1, y: 1 },
      motivation: { kind: "user_controlled" },
    },
  });
  assert.equal(result.actions.length, 0);
});

test.skip("actor persona with stationary motivation and no exit still proposes wait", async () => {
  const result = await proposeOnce({
    actor: {
      id: "stationary-no-exit",
      position: { x: 1, y: 1 },
      motivation: { mobility: "stationary" },
    },
    baseTiles: ["#####", "#...#", "#####"],
  });
  assert.equal(result.actions[0].kind, "wait");
});

test("actor persona with absent motivation defaults to exploring toward exit", async () => {
  const result = await proposeOnce({
    actor: {
      id: "default-explorer",
      position: { x: 1, y: 1 },
    },
  });

  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].kind, "move");
  assert.equal(result.actions[0].params.direction, "east");
});

test.skip("actor persona with exploring motivation and unreachable exit proposes wait", async () => {
  const result = await proposeOnce({
    actor: {
      id: "blocked-explorer",
      position: { x: 1, y: 1 },
      motivation: { mobility: "exploring" },
    },
    baseTiles: ["#####", "#.#E#", "#####"],
  });
  assert.equal(result.actions[0].kind, "wait");
});
