/**
 * RB1.2 — deterministic fixture adapter for Actor-authored objectives.
 *
 * The adapter owns transport validation and stable lexicographic comparison.
 * It treats actions, features, tags, and objective-axis names as opaque data.
 */
"use strict";

const assert = require("node:assert/strict");

const RUNTIME_DECISION_CONTRACT = "runtime-decision-v1";
const ACTOR_DECISION_OBJECTIVE_CONTRACT = "actor-decision-objective-v1";

function buildRequest({
  candidates = [], ranks = [], order = ["primary", "secondary"], tags = [],
  features = [], decisionKind = "next_move", includeObjective = true,
} = {}) {
  const objectives = includeObjective ? {
    actorDecision: {
      contract: ACTOR_DECISION_OBJECTIVE_CONTRACT,
      order,
      candidates: candidates.map((candidate, index) => ({
        candidateActionId: candidate.id,
        rank: ranks[index],
        features: features[index] || { opaqueIndex: index },
        rationaleTags: tags[index] || [`opaque_${index}`],
      })),
    },
  } : undefined;
  return {
    schema: "agent-kernel/SolverRequest",
    schemaVersion: 1,
    meta: { id: "test_req", runId: "test_run", createdAt: "2026-06-04T00:00:00.000Z", producedBy: "actor" },
    problem: {
      language: "custom",
      data: {
        contract: RUNTIME_DECISION_CONTRACT,
        decisionKind,
        candidateActions: candidates,
        ...(objectives ? { objectives } : {}),
      },
    },
    options: { engine: "z3" },
  };
}

test("fixture adapter selects the lexicographically highest opaque tuple", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const candidates = [
    { id: "looks_preferred", action: { kind: "attack", params: { targetId: "x" } } },
    { id: "tuple_winner", action: { kind: "wait", params: {} } },
  ];
  const result = await createZ3SolverAdapter().solve(buildRequest({
    candidates,
    ranks: [[1, 99], [2, -99]],
    tags: [["not_selected"], ["actor_selected"]],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "tuple_winner");
  assert.deepEqual(result.model.rationaleTags, ["actor_selected"]);
  assert.deepEqual(result.model.rankedCandidates.map((row) => row.candidateActionId), ["tuple_winner", "looks_preferred"]);
});

test("fixture adapter compares later axes only after earlier axes tie", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const candidates = [
    { id: "later_axis", action: { kind: "move", params: {} } },
    { id: "first_axis", action: { kind: "wait", params: {} } },
  ];
  const result = await createZ3SolverAdapter().solve(buildRequest({ candidates, ranks: [[4, 100], [5, -100]] }));
  assert.equal(result.model.selectedActionId, "first_axis");
});

test("fixture adapter preserves input order for equal tuples", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const candidates = [
    { id: "first", action: { kind: "wait", params: {} } },
    { id: "second", action: { kind: "attack", params: {} } },
  ];
  const result = await createZ3SolverAdapter().solve(buildRequest({ candidates, ranks: [[7, 7], [7, 7]] }));
  assert.equal(result.model.selectedActionId, "first");
  assert.deepEqual(result.model.rankedCandidates.map((row) => row.candidateActionId), ["first", "second"]);
});

test("fixture adapter returns copied Actor diagnostics without interpreting them", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const candidates = [{ id: "only", action: { kind: "custom_action", params: {} } }];
  const request = buildRequest({
    candidates,
    ranks: [[3, 2]],
    features: [{ nested: { meaning: "Actor-owned" } }],
    tags: [["Actor-authored tag"]],
  });
  const result = await createZ3SolverAdapter().solve(request);

  assert.deepEqual(result.model.rankedCandidates[0], {
    candidateActionId: "only",
    rank: [3, 2],
    features: { nested: { meaning: "Actor-owned" } },
    rationaleTags: ["Actor-authored tag"],
  });
  request.problem.data.objectives.actorDecision.candidates[0].features.nested.meaning = "mutated";
  assert.equal(result.model.rankedCandidates[0].features.nested.meaning, "Actor-owned");
});

test("fixture adapter defers a missing Actor objective instead of deriving policy", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const result = await createZ3SolverAdapter().solve(buildRequest({
    candidates: [{ id: "only", action: { kind: "attack", params: {} } }],
    includeObjective: false,
  }));
  assert.deepEqual(result, { status: "deferred", reason: "actor_decision_objective_missing" });
});

test("fixture adapter defers malformed Actor objectives", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const candidate = { id: "only", action: { kind: "wait", params: {} } };
  const malformedRequests = [
    buildRequest({ candidates: [candidate], ranks: [[1]], order: ["duplicate", "duplicate"] }),
    buildRequest({ candidates: [candidate], ranks: [[1]], order: ["first", "second"] }),
    buildRequest({ candidates: [candidate], ranks: [[1.5, 2]] }),
  ];
  for (const request of malformedRequests) {
    const result = await createZ3SolverAdapter().solve(request);
    assert.deepEqual(result, { status: "deferred", reason: "actor_decision_objective_invalid" });
  }
});

test("fixture adapter returns unsat when no candidate actions are provided", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const result = await createZ3SolverAdapter().solve(buildRequest());
  assert.deepEqual(result, { status: "unsat", reason: "z3_no_candidates" });
});

test("fixture adapter returns error when the runtime-decision envelope is absent", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const result = await createZ3SolverAdapter().solve({ problem: { data: { wrongShape: true } } });
  assert.deepEqual(result, { status: "error", reason: "z3_missing_runtime_decision_envelope" });
});

test("fixture adapter honors forced statuses", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  for (const status of ["deferred", "unsat", "error"]) {
    const result = await createZ3SolverAdapter({ forceStatus: status }).solve({});
    assert.equal(result.status, status);
    assert.ok(result.reason);
  }
});

test("fixture adapter throws only when explicitly configured", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const { createSolverPort } = await import("../../packages/runtime/src/ports/solver.js");
  const port = createSolverPort({ clock: () => "2026-06-04T00:00:00.000Z" });
  const result = await port.solve(createZ3SolverAdapter({ throwOnSolve: true }), {});
  assert.equal(result.status, "error");
  assert.equal(result.reason, "z3_adapter_simulated_failure");
  assert.equal(result.meta.createdAt, "2026-06-04T00:00:00.000Z");
});

test("fixture adapter has no mutable state and preserves decisionKind", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const request = buildRequest({
    candidates: [{ id: "only", action: { kind: "wait", params: {} } }],
    ranks: [[1, 0]],
    decisionKind: "next_custom_action",
  });
  const adapter = createZ3SolverAdapter();
  const first = await adapter.solve(request);
  const second = await adapter.solve(request);
  assert.deepEqual(second, first);
  assert.equal(first.model.decisionKind, "next_custom_action");
});

// ## TODO: Test Permutations
// - empty or whitespace-only axis names defer as an invalid objective
// - duplicate candidate ids defer before tuple comparison
// - a non-serializable features value defers rather than leaking an exception
// - negative integers and zero compare correctly across every opaque axis
// - byte-identical results across fresh process invocations for an exact tie
