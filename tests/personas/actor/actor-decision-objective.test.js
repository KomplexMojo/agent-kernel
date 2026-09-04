/**
 * Z6.1 — the Actor owns the meaning and ordering of decision features. These
 * tests stop at the runtime-decision envelope; adapters must only consume the
 * emitted integer tuples.
 */
"use strict";

const assert = require("node:assert/strict");

const OPEN_TILES = [
  "#####",
  "#...#",
  "#...#",
  "#...#",
  "##E##",
];

function tileKinds(baseTiles = OPEN_TILES) {
  return baseTiles.map((row) => Array.from(row, (cell) => (cell === "#" || cell === "B" ? 1 : 0)));
}

async function solverEnvelope({
  self,
  others = [],
  baseTiles = OPEN_TILES,
  exit = { x: 2, y: 4 },
  proposals,
  hazards,
  affinityFields,
}) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const observation = {
    actors: [self, ...others],
    tiles: { baseTiles, kinds: tileKinds(baseTiles) },
    exit,
    ...(Array.isArray(affinityFields) ? { affinityFields } : {}),
  };
  const payload = {
    actorId: self.id,
    observation,
    baseTiles,
    initialState: {
      actors: [{ id: self.id, role: self.role, kind: "motivated", runtimeDecisioning: true }],
    },
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
    ...(Array.isArray(proposals) ? { proposals } : {}),
    ...(Array.isArray(hazards) ? { hazards } : {}),
  };
  const persona = createActorPersona({ clock: () => "fixed" });
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  const effect = (result.effects || []).find((entry) => entry?.kind === "solver_request");
  assert.ok(effect, "the Actor emitted no solver request to inspect");
  return effect.request.problem.data;
}

function row(envelope, candidateActionId) {
  return envelope.objectives.actorDecision.candidates.find(
    (entry) => entry.candidateActionId === candidateActionId,
  );
}

test("attacking ranks its cast proposal with target health and live grant reserve", async () => {
  const envelope = await solverEnvelope({
    self: {
      id: "delver_1",
      kind: 2,
      role: "delver",
      position: { x: 1, y: 1 },
      motivation: { kind: "attacking" },
      vitals: { mana: { current: 1, max: 10, regen: 0 } },
      affinities: [{ kind: "fire", expression: "push", stacks: 2 }],
      affinityGrants: [{ kind: "fire", expression: "push", stacks: 2, mana: 5, manaMax: 10, manaRegen: 1 }],
    },
    others: [{
      id: "warden_1",
      kind: 2,
      role: "warden",
      position: { x: 3, y: 1 },
      vitals: { health: { current: 2, max: 10, regen: 0 } },
    }],
    hazards: [{ id: "fire_patch", position: { x: 2, y: 1 }, stacks: 3 }],
  });

  assert.equal(envelope.objectives.actorDecision.contract, "actor-decision-objective-v2");
  assert.deepEqual(row(envelope, "cast_affinity_warden_1").rank, [600, 8000, 0, 0, 0, 500, 0]);
  assert.deepEqual(row(envelope, "move_east").rank.slice(0, 6), [400, 8000, 0, 0, 0, 0]);
});

test("defending holds when its hostile is distant even if a move reaches cover", async () => {
  const baseTiles = [
    "#######",
    "#.....#",
    "#.....#",
    "#...#.#",
    "#.....#",
    "#..E..#",
    "#######",
  ];
  const envelope = await solverEnvelope({
    self: {
      id: "defender_1",
      kind: 2,
      role: "delver",
      position: { x: 2, y: 3 },
      motivation: { kind: "defending" },
    },
    others: [{ id: "warden_1", kind: 2, role: "warden", position: { x: 5, y: 3 } }],
    baseTiles,
  });

  assert.deepEqual(row(envelope, "wait_here").rank.slice(0, 3), [100, 0, 0]);
  assert.deepEqual(row(envelope, "move_east").rank.slice(0, 3), [0, 0, 1000]);
});

test("stealthy prefers the equally intentional move that increases hostile distance", async () => {
  const envelope = await solverEnvelope({
    self: {
      id: "scout_1",
      kind: 2,
      role: "delver",
      position: { x: 2, y: 2 },
      motivation: { kind: "stealthy" },
    },
    others: [{ id: "warden_1", kind: 2, role: "warden", position: { x: 2, y: 1 } }],
    exit: { x: 4, y: 2 },
    proposals: [
      { kind: "move", params: { direction: "east", from: { x: 2, y: 2 }, to: { x: 3, y: 2 } } },
      { kind: "move", params: { direction: "southeast", from: { x: 2, y: 2 }, to: { x: 3, y: 3 } } },
    ],
  });

  assert.deepEqual(row(envelope, "move_east").rank.slice(0, 3), [600, 0, 0]);
  assert.deepEqual(row(envelope, "move_southeast").rank.slice(0, 3), [600, 0, 1000]);
});

test("strategy-focused emits diagnostics but holds instead of fabricating lookahead", async () => {
  const envelope = await solverEnvelope({
    self: {
      id: "strategist_1",
      kind: 2,
      role: "delver",
      position: { x: 1, y: 1 },
      motivation: { kind: "strategy_focused" },
    },
    others: [{ id: "warden_1", kind: 2, role: "warden", position: { x: 3, y: 1 } }],
  });

  assert.deepEqual(row(envelope, "wait_here").rank.slice(0, 3), [100, 0, 0]);
  assert.equal(row(envelope, "move_east").rank[0], 0);
  assert.equal(row(envelope, "wait_here").features.cognitionTier, 3);
  assert.equal(row(envelope, "wait_here").features.reasoningClassName, "Strategic");
});

test("an unknown motivation emits an Actor-owned compatibility tuple", async () => {
  const envelope = await solverEnvelope({
    self: {
      id: "future_actor_1",
      kind: 2,
      role: "delver",
      position: { x: 1, y: 1 },
      motivation: { kind: "future_motivation" },
    },
    others: [{ id: "warden_1", kind: 2, role: "warden", position: { x: 3, y: 1 } }],
  });

  assert.equal(envelope.actor.motivationProfile, undefined);
  assert.equal(envelope.objectives.actorDecision.contract, "actor-decision-objective-v2");
  assert.deepEqual(envelope.objectives.actorDecision.order, [
    "intentClass",
    "targetFinish",
    "profileAlignment",
    "fieldSafety",
    "fieldBenefit",
    "castReserve",
    "inputOrder",
  ]);
  assert.equal(row(envelope, "move_east").rank[0], 80);
  assert.deepEqual(row(envelope, "move_east").rationaleTags, ["legacy_move_toward_hostile"]);
  assert.equal(row(envelope, "wait_here").rank[0], 10);
});

test("field safety breaks an otherwise-equal movement tie without changing intent", async () => {
  const envelope = await solverEnvelope({
    self: {
      id: "delver_1",
      kind: 2,
      role: "delver",
      position: { x: 2, y: 2 },
      motivation: { kind: "random" },
      vitals: { health: { current: 5, max: 10, regen: 0 } },
    },
    proposals: [
      { kind: "move", params: { direction: "east", from: { x: 2, y: 2 }, to: { x: 3, y: 2 } } },
      { kind: "move", params: { direction: "south", from: { x: 2, y: 2 }, to: { x: 2, y: 3 } } },
    ],
    affinityFields: [{
      position: { x: 3, y: 2 },
      kind: 1,
      expression: 3,
      stacks: 2,
      intensity: 2,
      contributionCount: 1,
      vitalEffects: [{ vital: 0, effect: -4 }],
    }],
  });

  assert.deepEqual(row(envelope, "move_east").rank.slice(0, 5), [600, 0, 0, -4, 0]);
  assert.deepEqual(row(envelope, "move_south").rank.slice(0, 5), [600, 0, 0, 0, 0]);
});

test("field benefit is capped by missing vital capacity and ignored when full", async () => {
  const fields = [{
    position: { x: 3, y: 2 },
    kind: 5,
    expression: 3,
    stacks: 5,
    intensity: 5,
    contributionCount: 1,
    vitalEffects: [{ vital: 0, effect: 8 }],
  }];
  const input = {
    self: {
      id: "delver_1",
      kind: 2,
      role: "delver",
      position: { x: 2, y: 2 },
      motivation: { kind: "random" },
    },
    proposals: [
      { kind: "move", params: { direction: "east", from: { x: 2, y: 2 }, to: { x: 3, y: 2 } } },
      { kind: "move", params: { direction: "south", from: { x: 2, y: 2 }, to: { x: 2, y: 3 } } },
    ],
    affinityFields: fields,
  };
  const injured = await solverEnvelope({
    ...input,
    self: { ...input.self, vitals: { health: { current: 6, max: 10, regen: 0 } } },
  });
  const full = await solverEnvelope({
    ...input,
    self: { ...input.self, vitals: { health: { current: 10, max: 10, regen: 0 } } },
  });

  assert.equal(row(injured, "move_east").rank[4], 4);
  assert.equal(row(injured, "move_south").rank[4], 0);
  assert.equal(row(full, "move_east").rank[4], 0);
});

test("a non-move evaluates the field at the Actor's current cell", async () => {
  const envelope = await solverEnvelope({
    self: {
      id: "delver_1",
      kind: 2,
      role: "delver",
      position: { x: 2, y: 2 },
      motivation: { kind: "random" },
      vitals: { health: { current: 10, max: 10, regen: 0 } },
    },
    proposals: [{ kind: "wait", params: {} }],
    affinityFields: [{
      position: { x: 2, y: 2 },
      kind: 1,
      expression: 3,
      stacks: 1,
      intensity: 1,
      contributionCount: 1,
      vitalEffects: [{ vital: 0, effect: -3 }],
    }],
  });

  assert.deepEqual(row(envelope, "wait_1").rank.slice(0, 5), [600, 0, 0, -3, 0]);
});

test("field benefit cannot override a stronger primary intent", async () => {
  const envelope = await solverEnvelope({
    self: {
      id: "delver_1",
      kind: 2,
      role: "delver",
      position: { x: 2, y: 2 },
      motivation: { kind: "stationary" },
      vitals: { health: { current: 0, max: 10, regen: 0 } },
    },
    affinityFields: [{
      position: { x: 3, y: 2 },
      kind: 5,
      expression: 3,
      stacks: 10,
      intensity: 10,
      contributionCount: 1,
      vitalEffects: [{ vital: 0, effect: 10 }],
    }],
  });

  assert.equal(row(envelope, "wait_here").rank[0], 100);
  assert.deepEqual(row(envelope, "move_east").rank.slice(0, 5), [0, 0, 0, 0, 10]);
});

test("the Actor objective distinguishes hostile pursuit from movement toward an ally", async () => {
  const envelope = await solverEnvelope({
    baseTiles: [
      "#######",
      "#.....#",
      "#.....#",
      "#.....#",
      "###E###",
    ],
    exit: { x: 3, y: 4 },
    self: {
      id: "delver_a",
      kind: 2,
      role: "delver",
      position: { x: 3, y: 2 },
      motivation: { kind: "attacking" },
    },
    others: [
      { id: "delver_b", kind: 2, role: "delver", position: { x: 1, y: 2 } },
      { id: "warden_1", kind: 2, role: "warden", position: { x: 5, y: 2 } },
    ],
  });

  assert.equal(row(envelope, "move_west").features.afterMinHostileDistance, 3);
  assert.equal(row(envelope, "move_east").features.afterMinHostileDistance, 1);
  assert.equal(row(envelope, "move_west").rationaleTags[0], "mobile_fallback");
  assert.equal(row(envelope, "move_east").rationaleTags[0], "hostile_progress");
  assert.ok(row(envelope, "move_east").rank[0] > row(envelope, "move_west").rank[0]);
});

// ## TODO: Test Permutations
// - two same-kind affinity grants use the first live pool in preserved observation order
// - invalid target health is neutral instead of producing a non-integer rank
// - a hazard with missing stacks contributes the documented default exposure of one
// - unknown motivation with only custom candidates uses no-match then input order
