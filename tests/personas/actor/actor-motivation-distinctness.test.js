/**
 * Every motivation must MEAN something, and mobility 0 must mean it.
 *
 * AUDIT, 2026-09-06: driving the Actor with all twelve motivation kinds across six
 * positions, with and without an adjacent hostile, produced FIVE distinct behaviours:
 *
 *   random                                                              unique
 *   patrolling                                                          unique
 *   exploring · stealthy · friendly                                     identical
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

async function propose({ kind, position = { x: 4, y: 3 }, hostileAt = null }) {
  const [{ createActorPersona }, { TickPhases }] = await loadModules();
  const self = { id: "a1", kind: 2, role: "warden", position, motivation: { kind }, vitals: vitals() };
  const others = hostileAt
    ? [{ id: "d1", kind: 2, role: "delver", position: hostileAt, vitals: vitals() }]
    : [];
  const payload = {
    actorId: self.id,
    observation: { tick: 0, actors: [self, ...others], exit: { x: 0, y: 3 } },
    baseTiles: BASE_TILES,
    simConfig: simConfig(),
    initialState: {
      actors: [
        { id: self.id, role: "warden", kind: "motivated" },
        ...others.map((o) => ({ id: o.id, role: "delver", kind: "motivated" })),
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
    actions.some((a) => a.kind === "attack" || a.kind === "cast_affinity"),
    `a defending actor must fight an adjacent hostile: ${JSON.stringify(actions)}`,
  );
});

test("attacking still closes on a distant hostile", async () => {
  // ANTI-VACUITY. `attacking` has mobility 1, so the holds-position rule must not touch
  // it. Without this, suppressing movement for every combat motivation would pass above.
  const actions = await propose({ kind: "attacking", hostileAt: { x: 7, y: 3 } });
  const move = actions.find((a) => a.kind === "move");
  assert.ok(move, `an attacking actor must pursue: ${JSON.stringify(actions)}`);
  assert.ok(move.params.to.x > 4, `pursuit should close the gap: ${JSON.stringify(move.params.to)}`);
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

// ## TODO: Test Permutations
// - a defending actor with a hostile two tiles away (out of reach, still holds)
// - stealthy vs exploring once stealth has behaviour of its own
