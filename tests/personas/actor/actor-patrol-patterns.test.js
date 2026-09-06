/**
 * Patrolling patterns — loop / ping_pong / random_walk must diverge from the same start.
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
    meta: { id: "pattern_sim", runId: "pattern", createdAt: "2026-01-01T00:00:00.000Z" },
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

async function walk(pattern, steps) {
  const [{ createActorPersona }, { TickPhases }] = await loadModules();
  const path = [{ x: 1, y: 1 }];
  let at = { x: 1, y: 1 };
  for (let tick = 0; tick < steps; tick += 1) {
    const persona = createActorPersona({ clock: () => "fixed" });
    const self = {
      id: "warden_1",
      kind: 2,
      role: "warden",
      position: at,
      motivation: { kind: "patrolling", pattern },
      motivations: [{ kind: "patrolling", pattern }],
    };
    const payload = {
      actorId: self.id,
      tick,
      observation: { tick, actors: [self], exit: { x: 0, y: 3 } },
      baseTiles: BASE_TILES,
      simConfig: simConfig(),
      initialState: {
        actors: [{
          id: self.id,
          role: "warden",
          kind: "motivated",
          motivation: { kind: "patrolling", pattern },
          motivations: [{ kind: "patrolling", pattern }],
        }],
      },
    };
    persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick });
    persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick });
    const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick });
    const move = (result.actions || []).find((a) => a.kind === "move");
    if (!move) break;
    at = { x: move.params.to.x, y: move.params.to.y };
    path.push({ ...at });
  }
  return path;
}

function pathKey(path) {
  return path.map((p) => `${p.x},${p.y}`).join(">");
}

test("loop, ping_pong and random_walk produce different paths from the same start", async () => {
  const loop = await walk("loop", 12);
  const ping = await walk("ping_pong", 12);
  const random = await walk("random_walk", 12);

  assert.ok(loop.length > 4, `loop stalled: ${pathKey(loop)}`);
  assert.ok(ping.length > 4, `ping_pong stalled: ${pathKey(ping)}`);
  assert.ok(random.length > 1, `random_walk stalled: ${pathKey(random)}`);

  assert.notEqual(pathKey(loop), pathKey(ping), "loop and ping_pong must diverge");
  assert.notEqual(pathKey(loop), pathKey(random), "loop and random_walk must diverge");
  assert.notEqual(pathKey(ping), pathKey(random), "ping_pong and random_walk must diverge");
});

test("loop (default) still circuits the room perimeter", async () => {
  const path = await walk("loop", 20);
  assert.deepEqual(path[path.length - 1], path[0], `loop did not close: ${pathKey(path)}`);
});
