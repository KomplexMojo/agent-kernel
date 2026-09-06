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
  role = "warden",
} = {}) {
  const [{ createActorPersona }, { TickPhases }] = await loadModules();
  const persona = createActorPersona({ clock: () => "fixed" });
  const self = {
    id: "actor_1",
    kind: 2,
    role,
    position,
    motivation,
    ...(motivations ? { motivations } : {}),
  };
  const payload = {
    actorId: self.id,
    observation: { tick: 0, actors: [self, ...others], exit: { x: 0, y: 3 } },
    baseTiles: BASE_TILES,
    simConfig: simConfig(),
    initialState: {
      actors: [{
        id: self.id,
        role,
        kind: "motivated",
        motivation,
        ...(motivations ? { motivations } : {}),
      }],
    },
  };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  return result.actions || [];
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
      role: "warden",
    },
  );
  assert.ok(actions.some((a) => a.kind === "move"), "must still patrol when no hostile is present");
  assert.ok(actions.every((a) => a.kind !== "attack"), "no attack without a hostile");
  const move = actions.find((a) => a.kind === "move");
  // Stay in-room: not exit-seeking west to (0,3).
  assert.ok(move.params.to.x >= 1, `patrol left the room: ${JSON.stringify(move.params.to)}`);
});

test("attacking+patrolling with an adjacent hostile attacks — intentClass, not ordering", async () => {
  const { classifyActorIntent } = await import(
    "../../../packages/runtime/src/personas/actor/controller.js"
  );
  const position = { x: 2, y: 2 };
  const hostile = { id: "delver_1", kind: 2, role: "delver", position: { x: 3, y: 2 }, hostile: true };
  const actions = await proposeActions(
    position,
    {
      motivation: { kind: "attacking" },
      motivations: ["attacking", "patrolling"],
      role: "warden",
      others: [hostile],
    },
  );
  const attack = actions.find((a) => a.kind === "attack");
  const move = actions.find((a) => a.kind === "move");
  // Composition must surface BOTH candidates — the existing intentClass tuple is what
  // picks between them. Asserting actions[0] would test emit order, which is not the
  // arbitration mechanism and which this milestone is forbidden to invent.
  assert.ok(attack, `expected an attack candidate among ${JSON.stringify(actions.map((a) => a.kind))}`);
  assert.ok(move, "expected a patrol move candidate alongside the attack");
  assert.equal(attack.params.targetId, "delver_1");

  const profile = { combatTier: 1, mobilityTier: 1 };
  const visible = [hostile];
  const exit = { x: 0, y: 3 };
  const attackRank = classifyActorIntent({
    action: attack,
    actorPosition: position,
    motivationProfile: profile,
    visibleActors: visible,
    exit,
  });
  const moveRank = classifyActorIntent({
    action: move,
    actorPosition: position,
    motivationProfile: profile,
    visibleActors: visible,
    exit,
  });
  assert.equal(attackRank.intentClass, 500, `attack should be in-range combat, got ${JSON.stringify(attackRank)}`);
  assert.ok(
    attackRank.intentClass > moveRank.intentClass,
    `intentClass must prefer attack (${attackRank.intentClass}) over move (${moveRank.intentClass})`,
  );
});

test("stationary+patrolling proposes no move — gating beats composition", async () => {
  const actions = await proposeActions(
    { x: 1, y: 1 },
    {
      motivation: { kind: "stationary" },
      motivations: ["stationary", "patrolling"],
    },
  );
  assert.ok(
    actions.every((a) => a.kind !== "move"),
    `stationary must suppress patrol movement: ${JSON.stringify(actions)}`,
  );
});

test("duplicate proposals from two motivations appear once", async () => {
  // exploring and stealthy currently share buildMoveProposal (exit path). Composing
  // both must not emit the same move twice.
  const actions = await proposeActions(
    { x: 3, y: 3 },
    {
      motivation: { kind: "exploring" },
      motivations: ["exploring", "stealthy"],
      role: "delver",
    },
  );
  const moves = actions.filter((a) => a.kind === "move");
  const signatures = new Set(moves.map((m) => JSON.stringify(m.params)));
  assert.equal(moves.length, signatures.size, "duplicate move candidates must be de-duplicated");
});
