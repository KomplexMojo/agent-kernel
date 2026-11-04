/**
 * Wind-knockback playtest (seed 6): earth defending warden looks idle after a crushing
 * wind hit. Trace: casts gate on mana, not stamina; unlit sight radius 1 drops a
 * knockback target at distance 2 out of the scoped observation; defending holds and waits.
 * Battle log is silent for waits, which reads as "won't attack while adjacent."
 */
"use strict";

const assert = require("node:assert/strict");

async function propose({ self, others = [], castManaBase = { "earth:push": 2 } }) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const persona = createActorPersona({ clock: () => "2026-11-04T00:00:00.000Z" });
  const observation = {
    actors: [self, ...others],
    tiles: { baseTiles: ["#######", "#.....#", "#######"] },
    exit: { x: 5, y: 1 },
  };
  const payload = {
    actorId: self.id,
    observation,
    baseTiles: observation.tiles.baseTiles,
    initialState: { actors: [self, ...others] },
    simConfig: { actionCosts: { castManaBase } },
  };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 1 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 1 });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 1 }).actions;
}

function warden(overrides = {}) {
  return {
    id: "foe-1",
    category: "warden",
    alignment: "dungeon",
    lifecycle: "alive",
    position: { x: 3, y: 1 },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: false },
    motivations: ["defending"],
    affinities: [{ kind: "earth", expression: "push", stacks: 2, intensity: 1 }],
    activeAffinityKey: "earth:push",
    vitals: {
      health: { current: 40, max: 40, regen: 1 },
      mana: { current: 40, max: 40, regen: 4 },
      stamina: { current: 10, max: 10, regen: 2 },
      durability: { current: 10, max: 10, regen: 1 },
    },
    ...overrides,
  };
}

function hero(position) {
  return {
    id: "hero-1",
    category: "delver",
    alignment: "external",
    lifecycle: "alive",
    position,
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true },
    motivations: ["user_controlled"],
    affinities: [{ kind: "wind", expression: "push", stacks: 3, intensity: 2 }],
    activeAffinityKey: "wind:push",
    vitals: {
      health: { current: 30, max: 30, regen: 1 },
      mana: { current: 60, max: 60, regen: 6 },
      stamina: { current: 12, max: 12, regen: 2 },
      durability: { current: 15, max: 15, regen: 1 },
    },
  };
}

test("defending earth warden with drained stamina still casts when adjacent", async () => {
  const actions = await propose({
    self: warden({
      vitals: {
        ...warden().vitals,
        stamina: { current: 0, max: 10, regen: 2 },
      },
    }),
    others: [hero({ x: 2, y: 1 })],
  });
  assert.deepEqual(actions.map(({ kind, params }) => ({ kind, params })), [
    { kind: "cast_affinity", params: { targetId: "hero-1" } },
  ]);
});

test("defending earth warden waits when mana cannot pay earth:push (cost 6)", async () => {
  const actions = await propose({
    self: warden({
      vitals: {
        ...warden().vitals,
        mana: { current: 5, max: 40, regen: 4 },
      },
    }),
    others: [hero({ x: 2, y: 1 })],
  });
  assert.equal(actions[0]?.kind, "wait");
  assert.equal(actions.some((action) => action.kind === "cast_affinity"), false);
});

test("defending waits when knockback leaves the hostile out of the scoped observation", async () => {
  // Unlit BASELINE_SIGHT_RADIUS is 1: after an intensity-1 push from adjacent the target
  // sits at distance 2 and is omitted from the Actor's observation payload.
  const actions = await propose({
    self: warden({
      vitals: {
        ...warden().vitals,
        stamina: { current: 0, max: 10, regen: 2 },
      },
    }),
    others: [],
  });
  assert.equal(actions[0]?.kind, "wait");
  assert.equal(actions.some((action) => action.kind === "cast_affinity"), false);
});

test("defending still casts at distance 2 when the hostile remains in observation", async () => {
  // Cast range is stacks=2; sight—not reach—is what drops the target after knockback.
  const actions = await propose({
    self: warden(),
    others: [hero({ x: 1, y: 1 })],
  });
  assert.deepEqual(actions.map(({ kind, params }) => ({ kind, params })), [
    { kind: "cast_affinity", params: { targetId: "hero-1" } },
  ]);
});

// ## TODO: Test Permutations
// - attacking motivation pursues a remembered contact after the same knockback sight break
// - lit observer (emit light) keeps distance-2 hostiles in observation and keeps casting
// - defending with mana exactly equal to cast cost still proposes cast_affinity
