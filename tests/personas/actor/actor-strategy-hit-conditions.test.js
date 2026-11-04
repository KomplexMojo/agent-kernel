/**
 * #718: three tactic conditions a strategy recipe needs, each read only from what the actor
 * observes (the seat rule):
 *   hitBy: <kind> [by: cast | field]   a hit it felt last turn revealed that affinity (#497)
 *   hitByCast: true                    another's cast struck it last turn
 *   structureOnRoute: true             a structure it can see stands on its walk to its goal
 * and two target selectors for a tactic's cast: "attacker" (whoever struck it, when seen) and
 * "route_structure" (the structure structureOnRoute found). The guard at the end fails any
 * condition that reads context outside what the actor observes.
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../../packages/runtime/src/runner/play-session.js");
const {
  STRATEGY_CONDITION_INPUTS,
  actorStrategyConditionHolds,
  normalizeActorStrategy,
} = require("../../../packages/runtime/src/personas/actor/persona.js");
const { buildUnifiedLevel, viableVitals } = require("../../fixtures/ui-ascii/unified-level.mjs");

const HERO = { category: "delver", id: "hero", position: { x: 1, y: 1 }, vitals: viableVitals(), motivations: ["user_controlled"] };
const LIGHT = { kind: "light", expression: "emit", stacks: 9 };

async function waitUntil(session, done, turns = 12) {
  for (let turn = 0; turn < turns && !done(); turn += 1) await session.act({ kind: "wait" });
  return done();
}

test("the new conditions normalise, and a malformed one names its field", () => {
  const tactic = (when) => normalizeActorStrategy({ tactics: [{ when, do: { kind: "retreat" } }] }).tactics[0].when;
  assert.deepEqual(tactic({ hitBy: "water" }), { hitBy: "water" });
  assert.deepEqual(tactic({ hitBy: "water", by: "field" }), { hitBy: "water", by: "field" });
  assert.deepEqual(tactic({ hitByCast: true }), { hitByCast: true });
  assert.deepEqual(tactic({ structureOnRoute: true }), { structureOnRoute: true });
  assert.throws(() => tactic({ hitBy: "plasma" }), /when\.hitBy must be an affinity kind/);
  assert.throws(() => tactic({ hitBy: "water", by: "melee" }), /when\.by must be cast or field/);
  assert.throws(() => tactic({ hitByCast: "yes" }), /when\.hitByCast must be true/);
  assert.throws(() => tactic({ structureOnRoute: 1 }), /when\.structureOnRoute must be true/);
  assert.throws(() => tactic({ sneezed: true }), /hitBy, hitByCast or structureOnRoute/);
  const cast = normalizeActorStrategy({ tactics: [{ when: { hitByCast: true },
    do: { kind: "cast_affinity", params: { targetId: "attacker", affinityKey: "fire:push" } } }] }).tactics[0].do;
  assert.deepEqual(cast, { kind: "cast_affinity", params: { targetId: "attacker", affinityKey: "fire:push" } });
});

const ROOM = [
  "##########",
  "S........#",
  "#........#",
  "#........#",
  "#........#",
  "#........E",
  "##########",
];

function duel(when) {
  const answer = { category: "delver", id: "answer", position: { x: 2, y: 4 }, motivations: ["stationary", "strategy_focused"],
    affinities: [{ kind: "fire", expression: "push", stacks: 4 }, LIGHT], activeAffinityKey: "fire:push",
    equippedAffinityKeys: ["fire:push", "light:emit"], vitals: viableVitals({ health: 200, mana: 2000 }),
    strategy: { tactics: [{ when, do: { kind: "cast_affinity", params: { targetId: "attacker", affinityKey: "fire:push" } } }] } };
  const soaker = { category: "warden", id: "soaker", position: { x: 5, y: 4 }, motivations: ["stationary", "attacking"],
    affinities: [{ kind: "water", expression: "push", stacks: 4 }, LIGHT], activeAffinityKey: "water:push",
    equippedAffinityKeys: ["water:push", "light:emit"], vitals: viableVitals({ health: 200, mana: 2000 }) };
  return createPlaySession({ ...buildUnifiedLevel({ id: "hit_room", tiles: ROOM, actors: [HERO, answer, soaker] }), fog: false });
}

test("hitBy: a water cast that struck the actor fires the tactic, and it answers whoever cast it", async () => {
  const session = await duel({ hitBy: "water", by: "cast" });
  assert.ok(await waitUntil(session, () => session.strategies().answer?.tactic === 0), "the tactic fired after the hit");
  await session.act({ kind: "wait" });
  const answered = session.view().battleLog.filter((line) => line.event === "cast" && /fire push/i.test(line.text));
  assert.ok(answered.length > 0, "the answer is a fire push at the attacker");
});

test("hitByCast fires on any cast that struck it; hitBy another kind never fires", async () => {
  const cast = await duel({ hitByCast: true });
  assert.ok(await waitUntil(cast, () => cast.strategies().answer?.tactic === 0));
  const other = await duel({ hitBy: "fire" });
  assert.equal(await waitUntil(other, () => other.strategies().answer?.tactic === 0, 8), false, "fire never struck it");
});

// A wall with one gap at (4, 3); a barrier fills it, so every way to the exit crosses it.
const GAP = [
  "##########",
  "S...#....#",
  "#...#....#",
  "#........E",
  "#...#....#",
  "##########",
];

function breaker(barrierAt) {
  const delver = { category: "delver", id: "breaker", position: { x: 2, y: 3 }, motivations: ["exploring", "strategy_focused"],
    affinities: [{ kind: "corrode", expression: "push", stacks: 3 }, LIGHT], activeAffinityKey: "corrode:push",
    equippedAffinityKeys: ["corrode:push", "light:emit"], vitals: viableVitals({ mana: 2000 }),
    strategy: { goals: [{ kind: "reach", place: "exit" }],
      tactics: [{ when: { structureOnRoute: true }, do: { kind: "cast_affinity", params: { targetId: "route_structure", affinityKey: "corrode:push" } } }] } };
  const barrier = { category: "barrier", id: "plug", position: barrierAt, vitals: { durability: { current: 30, max: 30, regen: 0 } } };
  return createPlaySession({ ...buildUnifiedLevel({ id: "gap_room", tiles: GAP, actors: [HERO, delver, barrier] }), fog: false });
}

test("structureOnRoute: a barrier closing the way to the goal is named and broken, then the walk goes on", async () => {
  const session = await breaker({ x: 4, y: 3 });
  assert.ok(await waitUntil(session, () => session.strategies().breaker?.tactic === 0, 4), "the barrier is on the route");
  const standing = () => session.view().rows[3][4] === "▮";
  assert.ok(standing(), "the barrier stands in the gap");
  assert.ok(await waitUntil(session, () => !standing(), 30), "the barrier was broken");
  assert.ok(await waitUntil(session, () => session.strategies().breaker?.tactic === undefined, 2), "the way is clear: back to the goal");
  assert.ok(await waitUntil(session, () => session.strategies().breaker?.status === "done", 20), "it walked through the gap to the exit");
});

test("structureOnRoute: a barrier off the walk does not fire", async () => {
  const session = await breaker({ x: 2, y: 1 });
  assert.equal(await waitUntil(session, () => session.strategies().breaker?.tactic === 0, 6), false);
});

// ── the seat-rule guard ─────────────────────────────────────────────────────────

/** What a deciding actor observes: its own record, its scoped view, its own hits, the tick, the goal it was given. */
const OBSERVED = new Set(["self", "record", "view", "nearestHostile", "hostiles", "received", "tick", "tileKinds", "baseTiles", "exitPlace"]);

const SAMPLES = {
  vital: { vital: "health", below: 50 },
  hostileWithin: { hostileWithin: 2 },
  defeated: { defeated: "guard" },
  tickAtLeast: { tickAtLeast: 3 },
  hitBy: { hitBy: "water", by: "cast" },
  hitByCast: { hitByCast: true },
  structureOnRoute: { structureOnRoute: true },
};

function fullContext() {
  const self = { id: "hero", position: { x: 1, y: 0 }, lifecycle: "alive" };
  const guard = { id: "guard", position: { x: 3, y: 0 }, lifecycle: "alive" };
  const plug = { id: "plug", position: { x: 2, y: 0 }, lifecycle: "alive", defeatVital: "durability", capabilities: { canMove: false } };
  return {
    actorId: "hero", self, record: { vitals: { health: { current: 4, max: 10 } } },
    view: { actors: [self, guard, plug] }, hostiles: [guard], nearestHostile: guard,
    received: [{ tick: 2, event: "cast", kind: "water", expression: "push", sourceId: "guard" }], tick: 3,
    tileKinds: [[1, 0, 0, 0, 0, 1]], baseTiles: ["#....E"], exitPlace: () => ({ x: 4, y: 0 }),
    // Not observations: a condition must never read these.
    configuredIds: new Set(["hero", "guard", "plug", "hidden"]), reservedTargets: [], initialState: { actors: [] },
  };
}

test("every condition reads only what the actor observes (seat rule)", () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(STRATEGY_CONDITION_INPUTS).sort(),
    "each condition the Actor knows has its observed inputs declared, and a sample here");
  for (const [kind, inputs] of Object.entries(STRATEGY_CONDITION_INPUTS)) {
    for (const input of inputs) assert.ok(OBSERVED.has(input), `${kind} reads ${input}, which the actor does not observe`);
    const when = normalizeActorStrategy({ tactics: [{ when: SAMPLES[kind], do: { kind: "retreat" } }] }).tactics[0].when;
    const context = new Proxy(fullContext(), {
      get(target, key) {
        if (typeof key === "string" && !inputs.includes(key)) throw new Error(`${kind} read context.${key}, outside its declared inputs`);
        return target[key];
      },
    });
    assert.equal(typeof actorStrategyConditionHolds(when, context, { kind: "reach", place: { x: 4, y: 0 } }), "boolean", kind);
  }
});

test("the samples hold on the observed context, so the guard exercises each condition's reads", () => {
  for (const kind of Object.keys(SAMPLES)) {
    const when = normalizeActorStrategy({ tactics: [{ when: SAMPLES[kind], do: { kind: "retreat" } }] }).tactics[0].when;
    const holds = actorStrategyConditionHolds(when, fullContext(), { kind: "reach", place: { x: 4, y: 0 } });
    assert.equal(holds, kind !== "defeated", `${kind}`);
  }
});

// ## TODO: Test Permutations
// - hitBy by field: a lasting water emit the actor stands in fires `{ hitBy: "water", by: "field" }`, not `by: "cast"`.
// - attacker unseen: a cast from beyond the actor's sight fires hitByCast, but a cast at "attacker" proposes nothing.
// - structureOnRoute with a hazard (passable) on the open walk, and with a goal target (take) that is itself a structure.
// - structureOnRoute on hold/lead/defeat goals, and with no goal left (done): never holds.
