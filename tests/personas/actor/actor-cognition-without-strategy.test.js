/**
 * #308 — thinking motivations change play with no order and no strategy (Darren, option A).
 *
 *   reflexive         reacts to what touches it: out of a harmful field, else holds
 *   goal_oriented     adopts a goal from its other motivations once and follows it
 *   strategy_focused  adopts the same way but re-plans every turn
 *
 * The field here is fire only because a field needs a kind; every kind is handled alike.
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

const BASE_TILES = [
  "#########",
  "#.......#",
  "#.......#",
  "E.......#",
  "#.......#",
  "#.......#",
  "#########",
];

const vitals = () => ({
  health: { current: 10, max: 10, regen: 1 },
  stamina: { current: 8, max: 8, regen: 8 },
  mana: { current: 10, max: 10, regen: 1 },
  durability: { current: 5, max: 5, regen: 0 },
});

function simConfig() {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "c", runId: "c", createdAt: "2026-10-18T00:00:00.000Z" },
    seed: 0,
    layout: { kind: "grid", data: { width: 9, height: 7, tiles: BASE_TILES, spawn: { x: 1, y: 1 },
      exit: { x: 0, y: 3 }, rooms: [{ id: "R1", x: 1, y: 1, width: 7, height: 5 }], hazards: [] } },
  };
}

function harmfulField(position) {
  return { position, kind: "fire", expression: "emit", sourceId: "trap", stacks: 4, intensity: 2, falloff: 0.5 };
}

function payloadFor({ kinds, position = { x: 4, y: 3 }, hostileAt = null, fields = [] }) {
  const self = {
    id: "a1", alignment: "external", position, motivations: kinds, vitals: vitals(), lifecycle: "alive", defeatVital: "health",
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true },
    affinities: [], activeAffinityKey: null,
  };
  const others = hostileAt
    ? [{ id: "w1", alignment: "dungeon", position: hostileAt, vitals: vitals(), lifecycle: "alive" }]
    : [];
  return {
    actorId: self.id,
    observation: { tick: 0, actors: [self, ...others], exit: { x: 0, y: 3 }, affinityFields: fields },
    baseTiles: BASE_TILES,
    simConfig: simConfig(),
    initialState: { actors: [self, ...others] },
  };
}

async function turn(persona, payload, tick) {
  const [, { TickPhases }] = await loadModules();
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick });
  persona.advance({ phase: TickPhases.DECIDE, event: "cooldown", payload, tick });
  return (result.actions || []).filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
}

async function persona() {
  const [{ createActorPersona }] = await loadModules();
  return createActorPersona({ clock: () => "fixed", seed: 5 });
}

const moveTarget = (actions) => actions.find((a) => a.kind === "move")?.params?.target ?? null;

// Fields on the actor's own cell and on the column toward the exit: the way out of harm
// is away from the exit, the way to the exit runs through harm.
const FIELDS = [{ x: 4, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }].map(harmfulField);
const inField = (cell) => FIELDS.some((field) => field.position.x === cell.x && field.position.y === cell.y);

test("reflexive steps out of the harmful field; goal_oriented keeps to its route to the exit", async () => {
  const reflexive = moveTarget(await turn(await persona(), payloadFor({ kinds: ["exploring", "reflexive"], fields: FIELDS }), 0));
  const goal = moveTarget(await turn(await persona(), payloadFor({ kinds: ["exploring", "goal_oriented"], fields: FIELDS }), 0));
  assert.ok(reflexive, "the reflexive actor moves");
  assert.equal(inField(reflexive), false, `reflexive must step out of harm: ${JSON.stringify(reflexive)}`);
  assert.ok(reflexive.x >= 4, "the way out of harm is not toward the exit");
  assert.equal(goal?.x, 3, `goal_oriented takes the next step of its route to the exit: ${JSON.stringify(goal)}`);
  assert.equal(inField(goal), true, "and that step runs through harm");
});

test("reflexive holds when no step is better than where it stands", async () => {
  const everywhere = [];
  for (let y = 1; y <= 5; y += 1) for (let x = 1; x <= 7; x += 1) everywhere.push(harmfulField({ x, y }));
  const actions = await turn(await persona(), payloadFor({ kinds: ["reflexive"], fields: everywhere }), 0);
  assert.equal(moveTarget(actions), null, `reflexive holds: ${JSON.stringify(actions)}`);
});

test("goal_oriented keeps its first goal; strategy_focused re-plans when a hostile appears", async () => {
  const kinds = (cognition) => ["attacking", "exploring", cognition];
  const goal = await persona();
  const focused = await persona();
  // Tick 0: nobody in sight, so both adopt "reach the exit".
  await turn(goal, payloadFor({ kinds: kinds("goal_oriented") }), 0);
  await turn(focused, payloadFor({ kinds: kinds("strategy_focused") }), 0);
  assert.deepEqual(goal.view().context.cognition.a1.adopted, { kind: "reach", place: "exit" });
  assert.deepEqual(focused.view().context.cognition.a1.adopted, { kind: "reach", place: "exit" });
  // Tick 1: a hostile appears to the east, away from the exit.
  const withHostile = (cognition) => payloadFor({ kinds: kinds(cognition), position: { x: 3, y: 3 }, hostileAt: { x: 6, y: 3 } });
  const goalStep = moveTarget(await turn(goal, withHostile("goal_oriented"), 1));
  const focusedStep = moveTarget(await turn(focused, withHostile("strategy_focused"), 1));
  assert.deepEqual(goal.view().context.cognition.a1.adopted, { kind: "reach", place: "exit" });
  assert.deepEqual(focused.view().context.cognition.a1.adopted, { kind: "defeat", target: "w1" });
  assert.ok(goalStep.x < 3, `goal_oriented still heads for the exit: ${JSON.stringify(goalStep)}`);
  assert.ok(focusedStep.x > 3, `strategy_focused turns toward the hostile: ${JSON.stringify(focusedStep)}`);
});

test("a thinking actor with nothing to aim at adopts no goal and plays as before", async () => {
  const actor = await persona();
  const actions = await turn(actor, payloadFor({ kinds: ["goal_oriented"] }), 0);
  assert.equal(moveTarget(actions), null);
  assert.equal(actor.view().context.cognition, undefined);
});

test("a player's actor adopts nothing of its own", async () => {
  const actor = await persona();
  await turn(actor, payloadFor({ kinds: ["exploring", "goal_oriented", "user_controlled"] }), 0);
  assert.equal(actor.view().context.cognition, undefined);
});

// ## TODO: Test Permutations
// - goal_oriented re-adopts after its goal is done (target defeated, exit reached).
// - an authored strategy or a mid-game order replaces the adopted goal.
// - the same separations hold for a harmful field of every other kind.
