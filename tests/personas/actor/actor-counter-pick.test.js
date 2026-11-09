/**
 * #564 — a warden that has read a delver's affinity (from a revealing field, never an inspect)
 * favours the opposite kind among the push/pull slots that reach. The answer sits behind one
 * decision point, `counterKinds`, which strategy and tactics (#395) will replace.
 */
const assert = require("node:assert/strict");

const ACTOR = "../../../packages/runtime/src/personas/actor/strategy.js";
const KINDS = ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
const OPPOSED = { fire: "water", water: "fire", earth: "wind", wind: "earth", growth: "decay", decay: "growth", corrode: "fortify", fortify: "corrode", light: "dark", dark: "light" };

test("the counter of a reading is the opposite of every kind read, for every kind", async () => {
  const { counterKinds } = await import(ACTOR);
  for (const kind of KINDS) assert.deepEqual(counterKinds({ kinds: [kind], tick: 3 }), [OPPOSED[kind]]);
  assert.deepEqual(counterKinds({ kinds: ["fire", "light"], tick: 1 }).sort(), ["dark", "water"]);
  assert.deepEqual(counterKinds(undefined), []);
});

test("a reading is remembered with its tick and a cast at that target prefers the counter", async () => {
  const { followStrategy, STRATEGY_DEPTH, normalizeStrategy } = await import(ACTOR);
  const seen = [];
  const target = { id: "delver", position: { x: 2, y: 0 }, alignment: "external" };
  const context = {
    actorId: "w", self: { id: "w", position: { x: 0, y: 0 }, alignment: "dungeon" }, record: { id: "w", vitals: {}, affinities: [] },
    view: { actors: [] }, hostiles: [target], nearestHostile: target, configuredIds: new Set(), tick: 4,
    readings: { delver: [{ kind: "fire", expression: "emit", intensity: "2+" }] },
    castAt: (t, distance, skip, prefer) => { seen.push(prefer); return { kind: "cast_affinity", params: { targetId: t.id } }; },
    exitStep: () => [{ kind: "wait" }], exitPlace: () => null, onExit: () => false, commandProposal: () => null,
    received: [], dealt: [],
  };
  const strategy = normalizeStrategy({ goals: [{ kind: "defeat", target: "delver" }] });
  const turn = followStrategy({ strategy, depth: STRATEGY_DEPTH.FULL, entry: {}, context });
  assert.deepEqual(turn.entry.readings, { delver: { kinds: ["fire"], tick: 4 } });
  // A later turn with no fresh reading still counters from the remembered one.
  seen.length = 0;
  followStrategy({ strategy, depth: STRATEGY_DEPTH.FULL, entry: turn.entry, context: { ...context, tick: 9, readings: {} } });
  assert.ok(seen.every((prefer) => prefer.includes("water")), `casts prefer water, saw ${JSON.stringify(seen)}`);
});

// ## TODO: Test Permutations
