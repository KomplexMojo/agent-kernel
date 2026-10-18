/**
 * Every motivation must MEAN something, and mobility 0 must mean it.
 *
 * AUDIT, 2026-09-06: driving the Actor with all twelve motivation kinds across six
 * positions, with and without an adjacent hostile, produced FIVE distinct behaviours:
 *
 *   random                                                              unique
 *   patrolling                                                          unique
 *   exploring · stealthy · friendly                                     identical (fixed, #311)
 *   attacking · defending                                               identical
 *   stationary · reflexive · goal_oriented · strategy_focused ·
 *     user_controlled                                                   identical (silent)
 *
 * Collapsing is not automatically a defect — five of those have mobility 0 and combat 0,
 * so holding position is the correct reading of their profile. `defending` is different:
 * it collapsed onto `attacking` because of a real gap, and that is what this file pins.
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

function simConfig() {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "m", runId: "m", createdAt: "2026-01-01T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 9,
        height: 7,
        tiles: BASE_TILES,
        spawn: { x: 1, y: 1 },
        exit: { x: 0, y: 3 },
        rooms: [{ id: "R1", x: 1, y: 1, width: 7, height: 5 }],
        hazards: [],
      },
    },
  };
}

const vitals = () => ({
  health: { current: 10, max: 10, regen: 1 },
  stamina: { current: 8, max: 8, regen: 8 },
  mana: { current: 10, max: 10, regen: 1 },
});

async function propose({ kind, position = { x: 4, y: 3 }, hostileAt = null, alignment = "external", alliesAt = [] }) {
  const [{ createActorPersona }, { TickPhases }] = await loadModules();
  const self = {
    id: "a1", alignment, position, motivations: [kind], vitals: vitals(),
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true },
    affinities: [{ kind: "fire", expression: "push", stacks: 2 }], activeAffinityKey: "fire:push",
  };
  const others = hostileAt
    ? [{ id: "d1", alignment: alignment === "external" ? "dungeon" : "external", position: hostileAt, vitals: vitals() }]
    : [];
  alliesAt.forEach((at, index) => others.push({ id: `ally${index}`, alignment, position: at, vitals: vitals() }));
  const payload = {
    actorId: self.id,
    observation: { tick: 0, actors: [self, ...others], exit: { x: 0, y: 3 } },
    baseTiles: BASE_TILES,
    simConfig: simConfig(),
    initialState: {
      actors: [
        self,
        ...others,
      ],
    },
  };
  const persona = createActorPersona({ clock: () => "fixed", seed: 5 });
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  return (result.actions || []).filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
}

test("a defending actor with no enemy in sight holds its ground", async () => {
  // THE BUG. `defending` has mobility 0 — stationary — and combat 2. The holds-position
  // early return is gated on `!hasCombatRole`, so a defender skips it, finds no hostile,
  // and falls through to `buildMoveProposal`: shortest path to the level EXIT. Measured
  // across six positions, `defending` and `attacking` proposed byte-identical moves.
  //
  // The code asserted the opposite in a comment three lines up — "a combat motivation
  // with mobility 0 holds its ground instead of pursuing, which is what separates
  // defending from attacking" — which is true of the PURSUIT branch and was never true
  // of the fallback below it. A defender walking to the exit is not defending anything.
  const actions = await propose({ kind: "defending" });
  assert.deepEqual(
    actions.filter((a) => a.kind === "move"),
    [],
    `a defending actor must not walk off: ${JSON.stringify(actions)}`,
  );
});

test("a defending actor still strikes what comes to it", async () => {
  // The other half, and the reason the fix cannot simply be an early return on
  // holdsPosition: charter §382 says defending holds ground AND fights. Suppressing
  // movement must not silence the actor, which is a mistake this file's ancestors
  // already made once — three tests said so.
  const actions = await propose({ kind: "defending", hostileAt: { x: 5, y: 3 } });
  assert.ok(
    actions.some((a) => a.kind === "cast_affinity"),
    `a defending actor must fight an adjacent hostile: ${JSON.stringify(actions)}`,
  );
});

test("attacking still closes on a distant hostile", async () => {
  // ANTI-VACUITY. `attacking` has mobility 1, so the holds-position rule must not touch
  // it. Without this, suppressing movement for every combat motivation would pass above.
  const actions = await propose({ kind: "attacking", hostileAt: { x: 7, y: 3 } });
  const move = actions.find((a) => a.kind === "move");
  assert.ok(move, `an attacking actor must pursue: ${JSON.stringify(actions)}`);
  assert.ok(move.params.target.x > 4, `pursuit should close the gap: ${JSON.stringify(move.params.target)}`);
});

test("every mobility-0 motivation holds position", async () => {
  // The rule stated as a rule rather than one case: mobility 0 means stationary, and no
  // motivation carrying it may propose a move when nothing is adjacent to fight.
  const { MOTIVATION_KIND_BY_CODE, getMotivationMobilityTier } = await import(
    "../../../packages/core-ts/src/index.ts"
  );
  const stationary = [];
  for (let code = 1; code <= 12; code += 1) {
    if (getMotivationMobilityTier(code) === 0) stationary.push(MOTIVATION_KIND_BY_CODE[code]);
  }
  assert.ok(stationary.length >= 5, `expected several stationary kinds, got ${stationary}`);

  for (const kind of stationary) {
    const actions = await propose({ kind });
    assert.deepEqual(
      actions.filter((a) => a.kind === "move"),
      [],
      `${kind} has mobility 0 but proposed a move`,
    );
  }
});

test("mobility-bearing motivations do propose movement", async () => {
  // The mirror, so "hold everything" cannot pass. Anything core rates mobile must move.
  const { MOTIVATION_KIND_BY_CODE, getMotivationMobilityTier } = await import(
    "../../../packages/core-ts/src/index.ts"
  );
  for (let code = 1; code <= 12; code += 1) {
    if (getMotivationMobilityTier(code) === 0) continue;
    const kind = MOTIVATION_KIND_BY_CODE[code];
    const actions = await propose({ kind });
    assert.ok(
      actions.some((a) => a.kind === "move"),
      `${kind} is mobile (tier ${getMotivationMobilityTier(code)}) but proposed no move`,
    );
  }
});

// #311 — stealthy and friendly mean something of their own. Both still head for the
// exit like exploring; stealthy keeps to the walls and away from hostiles, friendly keeps
// within two tiles of its nearest ally.
const moveOf = (actions) => actions.find((a) => a.kind === "move")?.params?.target ?? null;

test("stealthy keeps to the walls where exploring walks the middle of the room", async () => {
  // From (4,2), (3,1) (3,2) and (3,3) all keep to a shortest route to the exit; (3,1) runs
  // beside the north wall.
  const exploring = moveOf(await propose({ kind: "exploring", position: { x: 4, y: 2 } }));
  const stealthy = moveOf(await propose({ kind: "stealthy", position: { x: 4, y: 2 } }));
  assert.deepEqual(stealthy, { x: 3, y: 1 });
  assert.notDeepEqual(exploring, stealthy, `exploring takes another step: ${JSON.stringify(exploring)}`);
});

test("stealthy takes the step toward the exit that keeps furthest from a hostile", async () => {
  const north = moveOf(await propose({ kind: "stealthy", hostileAt: { x: 3, y: 1 } }));
  const south = moveOf(await propose({ kind: "stealthy", hostileAt: { x: 3, y: 5 } }));
  assert.deepEqual(north, { x: 3, y: 4 });
  assert.deepEqual(south, { x: 3, y: 2 });
});

test("friendly with no ally in sight walks to the exit like exploring", async () => {
  assert.deepEqual(moveOf(await propose({ kind: "friendly" })), moveOf(await propose({ kind: "exploring" })));
});

test("friendly goes to an ally that is out of reach before anything else", async () => {
  const step = moveOf(await propose({ kind: "friendly", alliesAt: [{ x: 7, y: 3 }] }));
  const exploring = moveOf(await propose({ kind: "exploring", alliesAt: [{ x: 7, y: 3 }] }));
  assert.equal(step?.x, 5, `toward the ally, away from the exit: ${JSON.stringify(step)}`);
  assert.equal(exploring.x, 3, "exploring ignores the ally");
});

test("friendly keeps within two tiles of its ally on the way to the exit", async () => {
  // The ally stands two tiles east: every step west would leave it behind, so friendly holds.
  const held = await propose({ kind: "friendly", alliesAt: [{ x: 6, y: 3 }] });
  assert.equal(moveOf(held), null, `friendly waits for its ally: ${JSON.stringify(held)}`);
  // One tile east: a step west still keeps it in reach.
  assert.equal(moveOf(await propose({ kind: "friendly", alliesAt: [{ x: 5, y: 3 }] }))?.x, 3);
});

// ## TODO: Test Permutations
// - a defending actor with a hostile two tiles away (out of reach, still holds)
// - stealthy in a corridor (one step toward the exit, so it takes it)
// - friendly with two allies at different distances (the nearest decides)
// - friendly beside an ally that has exited or been defeated (ignored)
