/**
 * Session demo contract: mobility `patrolling` vs `stationary` must stay
 * watcher-distinct on the same board (no hostile). Patrol proposes a move;
 * stationary proposes none. Exploring is the anti-vacuity control so "any
 * mobile move" cannot pass as patrol.
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

const ROOMS = [{ id: "R1", x: 1, y: 1, width: 7, height: 5 }];

function simConfig() {
  return {
    schema: "agent-kernel/SimConfigArtifact",
    schemaVersion: 1,
    meta: { id: "demo_pair", runId: "demo_pair", createdAt: "2026-01-01T00:00:00.000Z" },
    seed: 0,
    layout: {
      kind: "grid",
      data: {
        width: 9,
        height: 7,
        tiles: BASE_TILES,
        spawn: { x: 1, y: 1 },
        exit: { x: 0, y: 3 },
        rooms: ROOMS,
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

async function propose(kind, position = { x: 4, y: 3 }) {
  const [{ createActorPersona }, { TickPhases }] = await loadModules();
  const self = {
    id: "a1",
    alignment: "external",
    position,
    motivations: [kind],
    vitals: vitals(),
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true },
    affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
    activeAffinityKey: "fire:push",
  };
  const payload = {
    actorId: self.id,
    observation: { tick: 0, actors: [self], exit: { x: 0, y: 3 } },
    baseTiles: BASE_TILES,
    simConfig: simConfig(),
    initialState: { actors: [self] },
  };
  const persona = createActorPersona({ clock: () => "fixed", seed: 5 });
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  return (result.actions || []).filter((a) => a.kind !== "emit_log" && a.kind !== "emit_telemetry");
}

function moveTargets(actions) {
  return actions.filter((a) => a.kind === "move").map((a) => a.params.target);
}

test("demo pair: patrolling moves while stationary holds (same board, no hostile)", async () => {
  const patrol = await propose("patrolling");
  const hold = await propose("stationary");
  assert.ok(moveTargets(patrol).length > 0, `patrolling must move: ${JSON.stringify(patrol)}`);
  assert.deepEqual(moveTargets(hold), [], `stationary must hold: ${JSON.stringify(hold)}`);
});

test("demo pair: patrolling is not exploring's exit path", async () => {
  // Same seed and centre cell: patrol walks toward the room ring; exploring
  // walks toward the level exit. If these ever coincide, the demo pair is no
  // longer attributable by path alone — re-check before selling the recipe.
  const patrol = moveTargets(await propose("patrolling"));
  const explore = moveTargets(await propose("exploring"));
  assert.ok(patrol.length > 0 && explore.length > 0, "both mobile kinds must move");
  assert.notDeepEqual(
    patrol,
    explore,
    `patrolling collapsed onto exploring: ${JSON.stringify({ patrol, explore })}`,
  );
});

test("demo pair: on the ring, patrol steps along the perimeter and stationary still holds", async () => {
  const onRing = { x: 1, y: 1 };
  const patrol = moveTargets(await propose("patrolling", onRing));
  const hold = moveTargets(await propose("stationary", onRing));
  assert.deepEqual(patrol, [{ x: 2, y: 1 }], `expected clockwise ring step: ${JSON.stringify(patrol)}`);
  assert.deepEqual(hold, [], `stationary on the ring must not move: ${JSON.stringify(hold)}`);
});

// ## TODO: Test Permutations
// - patrolling ping_pong pattern vs loop on the same ring cell
// - stationary with an adjacent hostile still holds (combat 0) while attacking would strike
