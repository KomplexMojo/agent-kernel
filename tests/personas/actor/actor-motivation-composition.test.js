/**
 * Motivation composition — union of candidates, existing intentClass tuple arbitrates.
 *
 * These pin MC.5: plural motivations compose without inventing a new priority system.
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
    meta: { id: "compose_sim", runId: "compose", createdAt: "2026-01-01T00:00:00.000Z" },
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

async function proposeActions(position, {
  motivation = { kind: "patrolling" },
  motivations = null,
  others = [],
  alignment = "dungeon",
  canMove = true,
  proposals,
  fullResult = false,
} = {}) {
  const [{ createActorPersona }, { TickPhases }] = await loadModules();
  const persona = createActorPersona({ clock: () => "fixed" });
  const self = {
    id: "actor_1",
    alignment,
    position,
    motivation,
    capabilities: { canMove, canCast: true, canEquip: true, canTake: true, canExit: false },
    affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
    activeAffinityKey: "fire:push",
    ...(motivations ? { motivations } : {}),
  };
  const payload = {
    ...(proposals ? { proposals } : {}),
    actorId: self.id,
    observation: { tick: 0, actors: [self, ...others], exit: { x: 0, y: 3 } },
    baseTiles: BASE_TILES,
    simConfig: simConfig(),
    initialState: {
      actors: [{
        id: self.id,
        alignment,
        capabilities: self.capabilities,
        affinities: self.affinities,
        activeAffinityKey: self.activeAffinityKey,
        motivation,
        ...(motivations ? { motivations } : {}),
      }],
    },
  };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  return fullResult ? result : result.actions || [];
}

test("single-kind patrolling is unchanged under the plural list", async () => {
  const fromSingular = await proposeActions({ x: 1, y: 1 }, { motivation: { kind: "patrolling" } });
  const fromPlural = await proposeActions(
    { x: 1, y: 1 },
    { motivation: { kind: "patrolling" }, motivations: ["patrolling"] },
  );
  assert.ok(fromSingular.some((a) => a.kind === "move"), "singular patrolling must still move");
  assert.deepEqual(fromPlural, fromSingular);
});

test("attacking+patrolling with no hostile nearby patrols", async () => {
  const actions = await proposeActions(
    { x: 1, y: 1 },
    {
      motivation: { kind: "attacking" },
      motivations: ["attacking", "patrolling"],
      alignment: "dungeon",
    },
  );
  assert.ok(actions.some((a) => a.kind === "move"), "must still patrol when no hostile is present");
  assert.ok(actions.every((a) => a.kind !== "cast_affinity"), "no cast without a hostile");
  const move = actions.find((a) => a.kind === "move");
  // Stay in-room: not exit-seeking west to (0,3).
  assert.ok(move.params.target.x >= 1, `patrol left the room: ${JSON.stringify(move.params.target)}`);
});

test("attacking+patrolling with an adjacent hostile casts — intentClass, not ordering", async () => {
  for (const motivations of [["attacking", "patrolling"], ["patrolling", "attacking"]]) {
    const actions = await proposeActions({ x: 2, y: 2 }, {
      motivations,
      others: [{ id: "delver_1", alignment: "external", position: { x: 3, y: 2 } }],
    });
    assert.equal(actions.length, 1, "one action must win the composed ranking");
    assert.equal(actions[0].kind, "cast_affinity");
    assert.equal(actions[0].params.targetId, "delver_1");
  }
});

test("stationary motivation does not veto a mobile patrol motivation", async () => {
  const actions = await proposeActions(
    { x: 1, y: 1 },
    {
      motivation: { kind: "stationary" },
      motivations: ["stationary", "patrolling"],
    },
  );
  assert.ok(
    actions.some((a) => a.kind === "move"),
    `patrol candidates must survive composition: ${JSON.stringify(actions)}`,
  );
});

test("reported intention uses the winning motivation rather than the first", async () => {
  const result = await proposeActions({ x: 2, y: 2 }, {
    motivations: ["stationary", "patrolling", "attacking"],
    others: [{ id: "enemy", alignment: "external", position: { x: 3, y: 2 } }],
    fullResult: true,
  });
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].kind, "cast_affinity");
  assert.equal(result.intentions.length, 1);
  assert.equal(result.intentions[0].intentClass, 500);
});

test("equal candidate evaluations retain input order deterministically", async () => {
  const left = { kind: "move", params: { target: { x: 2, y: 3 } } };
  const right = { kind: "move", params: { target: { x: 4, y: 3 } } };
  for (const proposals of [[left, right, left], [right, left, right]]) {
    const first = await proposeActions({ x: 3, y: 3 }, { proposals });
    const replay = await proposeActions({ x: 3, y: 3 }, { proposals });
    assert.equal(first.length, 1);
    assert.deepEqual(first[0].params, proposals[0].params);
    assert.deepEqual(replay, first);
  }
});

test("movement capability restricts the whole motivation union", async () => {
  const actions = await proposeActions({ x: 1, y: 1 }, {
    motivations: ['attacking', 'patrolling'], canMove: false,
    others: [{ id: 'enemy', alignment: 'external', position: { x: 6, y: 1 } }],
  });
  assert.equal(actions.some(action => action.kind === 'move'), false);
});

test("selection and intention remain separate for each actor", async () => {
  const result = await proposeActions({ x: 2, y: 2 }, {
    motivations: ["attacking"],
    others: [{
      id: "enemy", alignment: "external", position: { x: 3, y: 2 },
      motivations: [{ kind: "stationary" }],
    }],
    proposals: [
      { kind: "wait", params: {} },
      { kind: "wait", actorId: "enemy", params: {} },
      { kind: "cast_affinity", params: { targetId: "enemy" } },
    ],
    fullResult: true,
  });
  assert.deepEqual(result.actions.map(({ actorId, kind }) => ({ actorId, kind })), [
    { actorId: "actor_1", kind: "cast_affinity" },
    { actorId: "enemy", kind: "wait" },
  ]);
  assert.equal(result.intentions.find((entry) => entry.actorId === "actor_1").intentClass, 500);
  assert.equal(result.intentions.find((entry) => entry.actorId === "enemy").intentClass, 100);
});

test("duplicate proposals from two motivations appear once", async () => {
  // exploring and stealthy currently share buildMoveProposal (exit path). Composing
  // both must not emit the same move twice.
  const actions = await proposeActions(
    { x: 3, y: 3 },
    {
      motivation: { kind: "exploring" },
      motivations: ["exploring", "stealthy"],
      alignment: "external",
    },
  );
  const moves = actions.filter((a) => a.kind === "move");
  const signatures = new Set(moves.map((m) => JSON.stringify(m.params)));
  assert.equal(moves.length, signatures.size, "duplicate move candidates must be de-duplicated");
});
