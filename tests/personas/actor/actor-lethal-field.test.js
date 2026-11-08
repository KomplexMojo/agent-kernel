/**
 * #622 (Darren, 2026-11-01): an actor steps out of a lethal field instead of casting at its
 * emitter. Traced before the change: an `attacking` delver beside a decay-emit trap proposed one
 * candidate, a push at the trap (its nearest hostile, adjacent so no move), and cast it every turn
 * until the field killed it; no step out was on the list, and `intentClass` would have ranked
 * any move below an in-range cast anyway. A field is lethal where staying would leave the actor's
 * defeat vital near defeat (core's band, 25% of max or less) after this turn's field harm.
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../../fixtures/ui-ascii/unified-level.mjs");

const ROOM = [
  "##########",
  "S........#",
  "#........#",
  "#........#",
  "#........E",
  "##########",
];
const START = { x: 3, y: 2 };
const TRAP = { x: 3, y: 1 };

function level({ health = 12, max = 12 } = {}) {
  return buildUnifiedLevel({ id: "lethal_field", tiles: ROOM, actors: [
    { category: "delver", id: "hero", position: { x: 1, y: 4 }, vitals: viableVitals(), motivations: ["user_controlled"] },
    { category: "delver", id: "att", position: { ...START }, motivations: ["attacking"],
      vitals: { ...viableVitals(), health: { current: health, max, regen: 0 }, durability: { current: 0, max: 1, regen: 0 },
        mana: { current: 200, max: 200, regen: 5 } },
      affinities: [{ kind: "fire", expression: "push", stacks: 3, intensity: 1 }], activeAffinityKey: "fire:push" },
    // A decay emit reaching one tile: 2 health a turn to anything beside it.
    { category: "hazard", id: "trap", position: { ...TRAP },
      vitals: { durability: { current: 200, max: 200, regen: 5 }, mana: { current: 200, max: 200, regen: 20 } },
      affinities: [{ kind: "decay", expression: "emit", stacks: 1, intensity: 2 }], activeAffinityKey: "decay:emit" },
  ] });
}
const attacker = (session) => session.view().actors.find((actor) => actor.id === "att");
const healthOf = (actor) => actor.vitals.health.current;

test("with health to spare the cast still wins: it stands and pushes at the trap", async () => {
  const session = await createPlaySession(level({ health: 40, max: 40 }));
  await session.advance({ ticks: 1 });
  assert.deepEqual(attacker(session).position, START);
});

test("near defeat after this turn's harm, it steps out of the field instead of casting", async () => {
  const session = await createPlaySession(level({ health: 4, max: 12 }));
  await session.advance({ ticks: 1 });
  const att = attacker(session);
  assert.notDeepEqual(att.position, START, "it stepped");
  assert.equal(healthOf(att), 4, "out of the field: no harm this turn");
});

test("the traced board: it fights while it can afford to, then leaves and does not walk back in", async () => {
  const session = await createPlaySession(level());
  const trail = [];
  for (let tick = 0; tick < 12; tick += 1) {
    await session.advance({ ticks: 1 });
    const att = attacker(session);
    assert.ok(att, `alive at tick ${tick}: ${JSON.stringify(trail)}`);
    trail.push({ ...att.position, health: healthOf(att) });
  }
  assert.deepEqual({ x: trail[0].x, y: trail[0].y }, START, "the first turn goes to the cast");
  // Before: 12, 10, 8, 6, 4, 2, defeated. It leaves near defeat and takes no more harm.
  const settled = trail.at(-1).health;
  assert.ok(settled > 0 && trail.slice(-4).every((step) => step.health === settled), JSON.stringify(trail));
});

// ## TODO: Test Permutations
// - every neighbouring cell is as lethal: it holds and casts (nothing is safer)
// - durability absorbs the field first: not lethal until the armour is gone
// - a defending (non-pursuing) actor steps out the same way
// - a commanded actor is never moved by this rule
