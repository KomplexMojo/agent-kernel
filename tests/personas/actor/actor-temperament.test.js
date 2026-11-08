/**
 * #675 (Darren, 2026-11-02): an actor's temperament sets how adventurous its pick among the
 * tactics that fire is. At 0 (the default) it takes the first, as before; above 0 it draws among
 * them from its seeded coin, earlier ones likelier. Move ranking stays deterministic, and the same
 * seed replays the same.
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../../fixtures/ui-ascii/unified-level.mjs");

const ROOM = [
  "############",
  "S..........#",
  "#..........#",
  "#..........#",
  "#..........#",
  "#..........E",
  "############",
];
const HERO = { category: "delver", id: "hero", position: { x: 1, y: 1 }, vitals: viableVitals(), motivations: ["user_controlled"] };
// Both tactics fire every turn: hold still, or step east.
const STRATEGY = { tactics: [
  { when: { tickAtLeast: 0 }, do: { kind: "wait" } },
  { when: { tickAtLeast: 0 }, do: { kind: "move", params: { direction: "east" } } },
] };
const rover = (temperament) => ({ category: "delver", id: "rover", position: { x: 2, y: 3 }, vitals: viableVitals({ stamina: 40 }),
  motivations: ["stationary", "strategy_focused"], strategy: STRATEGY, ...(temperament === undefined ? {} : { temperament }) });

async function picks(temperament, { seed = 0, turns = 8 } = {}) {
  const level = buildUnifiedLevel({ id: "temperament_room", tiles: ROOM, actors: [HERO, rover(temperament)], seed });
  const session = await createPlaySession({ ...level, fog: false });
  const tactics = [];
  for (let turn = 0; turn < turns; turn += 1) {
    await session.act({ kind: "wait" });
    tactics.push(session.strategies().rover.tactic);
  }
  return tactics;
}

test("temperament 0, or none, takes the first tactic that fires every turn", async () => {
  assert.deepEqual(await picks(undefined), Array(8).fill(0));
  assert.deepEqual(await picks(0), Array(8).fill(0));
});

test("a bold actor draws among the tactics that fire, and the same seed replays the same", async () => {
  const first = await picks(3);
  assert.ok(first.includes(0) && first.includes(1), `drew both tactics: ${first}`);
  assert.deepEqual(await picks(3), first, "same seed, same draws");
  assert.notDeepEqual(await picks(3, { seed: 5 }), first, "the level's seed sets the coin");
});

test("a calm level carries no temperaments; a bold actor's is beside the roster", () => {
  const calm = buildUnifiedLevel({ id: "t", tiles: ROOM, actors: [HERO, rover(0)] });
  assert.equal(calm.initialState.temperaments, undefined);
  const bold = buildUnifiedLevel({ id: "t", tiles: ROOM, actors: [HERO, rover(2)] });
  assert.deepEqual(bold.initialState.temperaments, { rover: 2 });
  assert.equal(bold.initialState.actors.find((actor) => actor.id === "rover").temperament, undefined, "not on the core record");
});

// ## TODO: Test Permutations
// - over many turns, a higher temperament takes the later tactic more often than a lower one
// - an ordered strategy (session.order) is drawn by the same temperament
// - a recovery wait that stalled is left out of the draw
