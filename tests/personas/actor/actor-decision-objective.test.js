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

  assert.equal(envelope.objectives.actorDecision.contract, "actor-decision-objective-v6");
  // v4: the cast now carries its REAL class (in_range_combat, 500) plus the demoted
  // proposal flag at index 7. It used to read 600 purely because it was a proposal.
  assert.deepEqual(row(envelope, "cast_affinity_warden_1").rank, [500, 8000, 0, 0, 0, 0, 500, 1, 0]);
  assert.deepEqual(row(envelope, "move_east").rank.slice(0, 7), [400, 8000, 0, 0, 0, 0, 0]);
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

  // Stage B: cover is a COUNT of adjacent opaque cells, not a flat 1000, so this asserts
  // the relationship the test is named for -- the move genuinely reaches cover, and intent
  // still outranks it -- rather than a magic constant that would have to be re-guessed
  // whenever the map changes.
  assert.deepEqual(row(envelope, "wait_here").rank.slice(0, 4), [100, 0, 0, 0]);
  assert.equal(row(envelope, "move_east").rank[0], 0, "moving is a weaker intent than holding");
  assert.ok(row(envelope, "move_east").rank[2] > 0, "and the move does reach cover");
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

  // This actor prefers STEALTH, so the signal under test is the stealth member (index 3),
  // not cover. Under v2 both collapsed into one summed slot and the distinction could not
  // be asserted at all — which is the information loss Stage B removed.
  assert.deepEqual(row(envelope, "move_east").rank.slice(0, 4), [300, 0, 0, 0]);
  assert.equal(row(envelope, "move_southeast").rank[0], 300, "equally intentional");
  assert.equal(row(envelope, "move_southeast").rank[2], 0, "and it is not a cover gain");
  assert.ok(
    row(envelope, "move_southeast").rank[3] > row(envelope, "move_east").rank[3],
    "the southeast move is the one that increases hostile distance",
  );
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
  assert.equal(envelope.objectives.actorDecision.contract, "actor-decision-objective-v6");
  assert.deepEqual(envelope.objectives.actorDecision.order, [
    "intentClass",
    "targetFinish",
    "coverAlignment",
    "stealthAlignment",
    "fieldSafety",
    "fieldBenefit",
    "castReserve",
    "actorProposal",
    "inputOrder",
  ]);
  // v5 PUT THIS BRANCH ON THE SHARED `ACTOR_INTENT_CLASS` SCALE. It used to publish its own
  // 100/80/50/20/10 under the same `intentClass` member name, which was invisible while
  // adapters only stable-sorted the tuple -- both scales rank their own branch identically.
  // It became a live defect when the Moderator started ORDERING ACTORS by rank[0]: a legacy
  // attacker (100) tied with a motivated actor's WAIT (100) and lost to its mere movement
  // (200). These literals are the shared scale, and the ratio to `wait_here` is what proves
  // the remap stayed monotonic -- i.e. that the branch still SELECTS what it selected before.
  assert.equal(row(envelope, "move_east").rank[0], 400);
  assert.deepEqual(row(envelope, "move_east").rationaleTags, ["legacy_move_toward_hostile"]);
  assert.equal(row(envelope, "wait_here").rank[0], 100);
  assert.ok(
    row(envelope, "move_east").rank[0] > row(envelope, "wait_here").rank[0],
    "the remap must preserve which candidate this branch prefers",
  );
});

// THE TRAP THIS GUARDS: one member name, two producers, two scales. It cost nothing until a
// consumer compared the value ACROSS producers, and then it silently mis-ordered actors.
// Motivated and unmotivated actors coexist in a tick, so their intentClass values must be
// drawn from the same set -- not merely be internally consistent.
test("motivated and legacy branches publish intentClass on one shared scale", async () => {
  const others = [{ id: "warden_1", kind: 2, role: "warden", position: { x: 3, y: 1 } }];
  const motivated = await solverEnvelope({
    self: {
      id: "delver_1", kind: 2, role: "delver", position: { x: 1, y: 1 },
      motivation: { kind: "attacking" },
    },
    others,
  });
  const legacy = await solverEnvelope({
    self: {
      id: "delver_1", kind: 2, role: "delver", position: { x: 1, y: 1 },
      motivation: { kind: "not_a_real_motivation" },
    },
    others,
  });
  assert.equal(motivated.actor.motivationProfile?.kind, "attacking", "motivated branch not exercised");
  assert.equal(legacy.actor.motivationProfile, undefined, "legacy branch not exercised");
  const allowed = new Set([0, 100, 200, 300, 400, 500]);
  for (const [label, envelope] of [["motivated", motivated], ["legacy", legacy]]) {
    for (const candidate of envelope.objectives.actorDecision.candidates) {
      assert.ok(
        allowed.has(candidate.rank[0]),
        `${label} branch published intentClass ${candidate.rank[0]}, which is off the shared scale`,
      );
    }
  }
});

// v4 EXPOSED A FALSE PREMISE HERE. These two moves used to share intentClass 600 only
// because both were Actor proposals, and field safety broke the resulting tie. With the
// proposal stamp demoted they carry their real classes -- 200 and 300 -- so intent, not
// safety, separates them. The assertion now records that, and the genuine tie-break case
// is covered by "field benefit cannot override a stronger primary intent" below.
test("intent separates moves the proposal stamp used to equalise", async () => {
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

  assert.deepEqual(row(envelope, "move_east").rank.slice(0, 6), [200, 0, 0, 0, -4, 0]);
  assert.deepEqual(row(envelope, "move_south").rank.slice(0, 6), [300, 0, 0, 0, 0, 0]);
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

  assert.equal(row(injured, "move_east").rank[5], 4);
  assert.equal(row(injured, "move_south").rank[5], 0);
  assert.equal(row(full, "move_east").rank[5], 0);
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

  assert.deepEqual(row(envelope, "wait_1").rank.slice(0, 6), [100, 0, 0, 0, -3, 0]);
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
  assert.deepEqual(row(envelope, "move_east").rank.slice(0, 6), [0, 0, 0, 0, 0, 10]);
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
  // v6 split the flat fallback: this move holds its distance to the exit, so it is lateral
  // rather than a retreat. The claim under test is unchanged -- pursuit still outranks a
  // non-pursuing move -- and the assertion below is the one that carries it.
  assert.equal(row(envelope, "move_west").rationaleTags[0], "mobile_lateral");
  assert.equal(row(envelope, "move_east").rationaleTags[0], "hostile_progress");
  assert.ok(row(envelope, "move_east").rank[0] > row(envelope, "move_west").rank[0]);
});

test("Stage B — cover is graded, so a corner outranks a single wall", async () => {
  // Under v2 both of these scored a flat 1000 and the actor had no reason to prefer the
  // corner. Grading is the whole point: "prefers cover" should mean more cover, not any.
  const baseTiles = [
    "#######",
    "#.....#",
    "#.###.#",
    "#.#...#",
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
    others: [{ id: "warden_1", kind: 2, role: "warden", position: { x: 5, y: 5 } }],
    baseTiles,
  });

  const covers = envelope.objectives.actorDecision.candidates
    .filter((entry) => entry.features?.endPosition)
    .map((entry) => entry.rank[2]);
  assert.ok(covers.some((value) => value > 0), "at least one destination is beside cover");
  assert.ok(
    new Set(covers.filter((value) => value > 0)).size > 1,
    `graded cover must distinguish destinations, got ${JSON.stringify(covers)}`,
  );
  assert.ok(covers.every((value) => value <= 8), "cover cannot exceed the eight neighbours");
});

test("Stage B — cover and stealth can no longer alias to the same alignment", async () => {
  // The v2 defect in one assertion: cover(1000) + stealth(0) and cover(0) + stealth(1000)
  // were the same number, so a sort could not tell a sheltering actor from a retreating
  // one. Separate members mean the two signals are independently readable.
  const order = ["intentClass", "targetFinish", "coverAlignment", "stealthAlignment",
    "fieldSafety", "fieldBenefit", "castReserve", "actorProposal", "inputOrder"];
  const envelope = await solverEnvelope({
    self: {
      id: "scout_1",
      kind: 2,
      role: "delver",
      position: { x: 2, y: 2 },
      motivation: { kind: "stealthy" },
    },
    others: [{ id: "warden_1", kind: 2, role: "warden", position: { x: 1, y: 1 } }],
  });
  assert.deepEqual(envelope.objectives.actorDecision.order, order);
  for (const entry of envelope.objectives.actorDecision.candidates) {
    assert.equal(entry.rank.length, order.length, "every row carries one member per axis");
  }
});

test("fieldSafety separates two candidates at the SAME intentClass", async () => {
  // The coverage v4 lost and the commit wrongly claimed was replaced. The renamed test above
  // no longer exercises this: with the proposal stamp demoted its two moves carry 200 and 300,
  // so intent decides and fieldSafety is never consulted. Adversarial review caught the false
  // replacement claim. This constructs the genuine case — two moves that BOTH close on the
  // exit, so both are exit_progress, differing only in the harm at their destination.
  const envelope = await solverEnvelope({
    self: {
      id: "delver_1",
      kind: 2,
      role: "delver",
      position: { x: 2, y: 2 },
      motivation: { kind: "exploring" },
      vitals: { health: { current: 10, max: 10, regen: 0 } },
    },
    affinityFields: [{
      position: { x: 3, y: 3 },
      kind: 1,
      expression: 3,
      stacks: 3,
      intensity: 3,
      contributionCount: 1,
      vitalEffects: [{ vital: 0, effect: -6 }],
    }],
  });

  const rows = envelope.objectives.actorDecision.candidates
    .filter((entry) => entry.features?.endPosition)
    .filter((entry) => entry.rank[0] === 300);
  assert.ok(rows.length >= 2, `need two exit_progress moves, got ${rows.length}`);

  const harmed = rows.filter((entry) => entry.rank[4] < 0);
  const safe = rows.filter((entry) => entry.rank[4] === 0);
  assert.ok(harmed.length >= 1 && safe.length >= 1,
    `need one harmful and one safe exit_progress move, got ${JSON.stringify(rows.map((r) => r.rank))}`);

  // Same intentClass, same targetFinish, same cover and stealth — fieldSafety is the first
  // member that differs, and the safe move must therefore outrank the harmful one.
  const a = safe[0].rank;
  const b = harmed[0].rank;
  assert.deepEqual(a.slice(0, 4), b.slice(0, 4), "the two must be tied up to fieldSafety");
  assert.ok(a[4] > b[4], `fieldSafety must favour the safe move: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
});

test("actorProposal settles a tie that every earlier member leaves equal", async () => {
  // v4 keeps the proposal as a tiebreak rather than deleting it, and this is the claim that
  // justifies the ninth member. It had NO test until adversarial review pointed out that the
  // rationale then on record described an effect that did not exist.
  const envelope = await solverEnvelope({
    self: {
      id: "delver_1",
      kind: 2,
      role: "delver",
      position: { x: 2, y: 2 },
      motivation: { kind: "exploring" },
      vitals: { health: { current: 10, max: 10, regen: 0 } },
    },
  });

  const rows = envelope.objectives.actorDecision.candidates;
  const proposals = rows.filter((entry) => entry.rank[7] === 1);
  assert.ok(proposals.length >= 1, "the Actor's own derived proposal must be flagged");

  // A proposal and a non-proposal that tie on everything before index 7 must be separated by
  // it, in the proposal's favour — and never before index 7, which is what "demoted" means.
  let tiesExercised = 0;
  for (const proposal of proposals) {
    const tied = rows.filter((entry) => entry !== proposal
      && JSON.stringify(entry.rank.slice(0, 7)) === JSON.stringify(proposal.rank.slice(0, 7)));
    tiesExercised += tied.length;
    for (const other of tied) {
      assert.equal(other.rank[7], 0, "a non-proposal carries 0 in the proposal member");
      assert.ok(proposal.rank[7] > other.rank[7],
        "the Actor's own suggestion settles a genuine tie in its favour");
    }
  }
  assert.ok(rows.every((entry) => entry.rank[7] === 0 || entry.rank[7] === 1),
    "the proposal member is a flag, not a score");
  // Anti-vacuity: without a real tie the loop above asserts nothing, and this test would
  // pass while proving the tiebreak never fires. This fixture yields two.
  assert.ok(tiesExercised > 0, "no genuine tie was exercised — this test proved nothing");
});

// ## TODO: Test Permutations
// - two same-kind affinity grants use the first live pool in preserved observation order
// - invalid target health is neutral instead of producing a non-integer rank
// - a hazard with missing stacks contributes the documented default exposure of one
// - unknown motivation with only custom candidates uses no-match then input order
