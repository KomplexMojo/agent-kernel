/**
 * Z6.2 — the adapter consumes Actor-authored rank tuples without interpreting
 * their gameplay meaning. Missing or malformed objectives defer to the Actor's
 * deterministic fallback rather than invoking adapter-owned policy.
 */
"use strict";

const assert = require("node:assert/strict");

const ORDER = ["axis_0", "axis_1", "axis_2", "axis_3", "axis_4", "axis_5"];
const V2_ORDER = [...ORDER, "axis_6"];

async function adapter() {
  const { createRealZ3SolverAdapter } = await import(
    "../../packages/adapters-cli/src/adapters/z3/index.js"
  );
  return createRealZ3SolverAdapter();
}

function envelope(candidates, ranks, { contract = "actor-decision-objective-v1", order = ORDER } = {}) {
  return {
    contract: "runtime-decision-v1",
    decisionKind: "next_move",
    actor: { id: "actor_1", position: { x: 0, y: 0 } },
    visibleActors: [{ id: "hostile_1", hostile: true, position: { x: 3, y: 0 } }],
    candidateActions: candidates,
    objectives: {
      actorDecision: {
        contract,
        order,
        candidates: candidates.map((candidate, index) => ({
          candidateActionId: candidate.id,
          rank: ranks[index],
          features: { fixture: candidate.id },
          rationaleTags: [`fixture_${candidate.id}`],
        })),
      },
    },
  };
}

test("both supported opaque objective versions select deterministically", async () => {
  const solver = await adapter();
  const candidates = [WAIT, MOVE];
  const v1 = await solver.solve({
    problem: { data: envelope(candidates, [[100, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, -1]]) },
  });
  const v2 = await solver.solve({
    problem: {
      data: envelope(
        candidates,
        [[100, 0, 0, 0, 0, 0, 0], [100, 0, 0, 0, 0, 0, 1]],
        { contract: "actor-decision-objective-v2", order: V2_ORDER },
      ),
    },
  });

  assert.equal(v1.status, "fulfilled");
  assert.equal(v1.model.selectedActionId, "wait_here");
  assert.equal(v2.status, "fulfilled");
  assert.equal(v2.model.selectedActionId, "move_east");
});

test("an unknown objective version defers instead of being interpreted", async () => {
  const solver = await adapter();

  // THE SENTINEL IS DISCOVERED, NOT WRITTEN DOWN. This guard has now been silently inverted
  // TWICE by a version bump: the literal named the next unreleased version, the Actor shipped
  // that version, and the test kept passing while asserting the opposite of what it claims --
  // "a RELEASED version is rejected". A hardcoded future is a fact with an expiry date, and
  // nothing fails when it expires. So probe upward for the first version the adapter actually
  // refuses, and assert the property against that.
  let unknownContract = null;
  for (let version = 1; version <= 32 && !unknownContract; version += 1) {
    const probe = envelope(
      [WAIT, MOVE],
      [[100, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, -1]],
      { contract: `actor-decision-objective-v${version}`, order: V2_ORDER },
    );
    const outcome = await solver.solve({ problem: { data: probe } });
    if (outcome.status === "deferred") unknownContract = `actor-decision-objective-v${version}`;
  }
  assert.ok(unknownContract, "the adapter accepted every version probed — it cannot refuse anything");

  const request = envelope(
    [WAIT, MOVE],
    [[100, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, -1]],
    { contract: unknownContract, order: V2_ORDER },
  );

  assert.deepEqual(await solver.solve({ problem: { data: request } }), {
    status: "deferred",
    reason: "actor_decision_objective_invalid",
  });
});

const CAST = {
  id: "cast_fire",
  action: { kind: "cast_affinity", params: { kind: "fire", targetId: "hostile_1" } },
};
const MOVE = {
  id: "move_east",
  action: { kind: "move", params: { to: { x: 1, y: 0 } } },
};
const WAIT = { id: "wait_here", action: { kind: "wait", params: {} } };

test("valid Actor tuples select all four signed Z6.0 examples", async () => {
  const solver = await adapter();
  const examples = [
    { name: "attacking", candidates: [CAST, MOVE, WAIT], ranks: [[600, 8000, 0, 0, 500, 0], [400, 8000, 0, 0, 0, -1], [100, 0, 0, 0, 0, -2]], winner: "cast_fire" },
    { name: "defending", candidates: [MOVE, WAIT], ranks: [[0, 0, 1000, 0, 0, 0], [100, 0, 0, 0, 0, -1]], winner: "wait_here" },
    { name: "stealthy", candidates: [MOVE, { ...MOVE, id: "move_southeast" }], ranks: [[600, 0, 0, 0, 0, 0], [600, 0, 1000, 0, 0, -1]], winner: "move_southeast" },
    { name: "strategy_focused", candidates: [MOVE, WAIT], ranks: [[0, 0, 0, 0, 0, 0], [100, 0, 0, 0, 0, -1]], winner: "wait_here" },
  ];

  for (const example of examples) {
    const result = await solver.solve({ problem: { data: envelope(example.candidates, example.ranks) } });
    assert.equal(result.status, "fulfilled", `${example.name}: ${JSON.stringify(result)}`);
    assert.equal(result.model.selectedActionId, example.winner, example.name);
    assert.deepEqual(result.model.rankedCandidates[0].rank, example.ranks[
      example.candidates.findIndex((candidate) => candidate.id === example.winner)
    ]);
  }
});

test("each rank member is compared lexicographically before every later member", async () => {
  const solver = await adapter();
  for (let decisiveIndex = 0; decisiveIndex < ORDER.length; decisiveIndex += 1) {
    const winnerRank = [0, 0, 0, 0, 0, 0];
    const loserRank = [0, 0, 0, 0, 0, 0];
    winnerRank[decisiveIndex] = 1;
    for (let later = decisiveIndex + 1; later < ORDER.length; later += 1) {
      loserRank[later] = 10000;
    }
    const candidates = [WAIT, MOVE];
    const result = await solver.solve({
      problem: { data: envelope(candidates, [winnerRank, loserRank]) },
    });
    assert.equal(result.model.selectedActionId, "wait_here", ORDER[decisiveIndex]);
  }
});

test("missing and malformed objectives defer without adapter-owned scoring", async () => {
  const solver = await adapter();
  const legacyEnvelope = envelope([CAST, MOVE, WAIT], [
    [600, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, -1],
    [0, 0, 0, 0, 0, -2],
  ]);
  delete legacyEnvelope.objectives.actorDecision;
  const malformedEnvelope = structuredClone(legacyEnvelope);
  malformedEnvelope.objectives.actorDecision = {
    contract: "actor-decision-objective-v1",
    order: ORDER,
    candidates: [{
      candidateActionId: "cast_fire",
      rank: [600],
      features: {},
      rationaleTags: ["partial_row"],
    }],
  };

  const legacy = await solver.solve({ problem: { data: legacyEnvelope } });
  const malformed = await solver.solve({ problem: { data: malformedEnvelope } });
  assert.deepEqual(legacy, {
    status: "deferred",
    reason: "actor_decision_objective_missing",
  });
  assert.deepEqual(malformed, {
    status: "deferred",
    reason: "actor_decision_objective_invalid",
  });
});

test("objective diagnostics are deterministic and preserve Actor-authored plain data", async () => {
  const solver = await adapter();
  const request = { problem: { data: envelope([CAST, MOVE], [[600, 1, 2, 3, 4, 0], [500, 9, 9, 9, 9, -1]]) } };
  const first = await solver.solve(request);
  const second = await solver.solve(structuredClone(request));

  assert.deepEqual(second, first);
  assert.deepEqual(first.model.rationaleTags, ["fixture_cast_fire"]);
  assert.deepEqual(first.model.rankedCandidates[0], {
    candidateActionId: "cast_fire",
    rank: [600, 1, 2, 3, 4, 0],
    features: { fixture: "cast_fire" },
    rationaleTags: ["fixture_cast_fire"],
  });
});

// ## TODO: Test Permutations
// - duplicate candidate row ids defer with actor_decision_objective_invalid
// - a non-integer rank member invalidates the whole objective
// - objective rows in a different order from candidateActions invalidate the whole objective
// - two byte-identical tuples retain candidate input order as the stable final fallback
