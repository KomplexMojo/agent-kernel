/**
 * M8 — Z3-style solver adapter tests
 *
 * Verifies that the deterministic Z3-shaped adapter:
 *   - Selects attack > move-toward-hostile > move-toward-exit > wait
 *   - Returns "unsat" when no candidates are present
 *   - Returns "error" when the request lacks a runtime-decision envelope
 *   - Honors forced status options for testability of port error paths
 *   - Throws via the port boundary only when explicitly configured
 */
"use strict";

const assert = require("node:assert/strict");

const RUNTIME_DECISION_CONTRACT = "runtime-decision-v1";

/**
 * Build a minimal SolverRequest with a runtime-decision envelope.
 */
function buildRequest({
  candidates = [],
  actor = { id: "delver_1", position: { x: 1, y: 2 } },
  visibleActors = [],
  objectives = {},
  decisionKind = "next_move",
} = {}) {
  return {
    schema: "agent-kernel/SolverRequest",
    schemaVersion: 1,
    meta: { id: "test_req", runId: "test_run", createdAt: "2026-06-04T00:00:00.000Z", producedBy: "actor" },
    problem: {
      language: "custom",
      data: {
        contract: RUNTIME_DECISION_CONTRACT,
        decisionKind,
        phase: "decide",
        tick: 1,
        actor,
        candidateActions: candidates,
        visibleActors,
        objectives,
        providerPolicy: { mode: "solver", preferred: "solver" },
      },
    },
    options: { engine: "z3" },
  };
}

// ---------------------------------------------------------------------------
// Priority selection
// ---------------------------------------------------------------------------

test("z3 adapter prefers attack when an attack candidate is present", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({
    candidates: [
      { id: "candidate_1", action: { kind: "wait", params: {} } },
      { id: "candidate_2", action: { kind: "move", params: { direction: "east", from: { x: 1, y: 2 }, to: { x: 2, y: 2 } } } },
      { id: "candidate_3", action: { kind: "attack", params: { targetId: "warden_1" } } },
    ],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "candidate_3");
  assert.deepEqual(result.model.rationaleTags, ["attack_adjacent"]);
});

test("z3 adapter prefers move-toward-hostile over move-toward-exit when both are present", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  // Self at (1,2), hostile at (4,2), exit at (4,1) — east move reduces distance to both
  // We want to confirm that move_toward_hostile rule (higher weight) fires before exit
  const result = await adapter.solve(buildRequest({
    actor: { id: "delver_1", position: { x: 1, y: 2 } },
    visibleActors: [{ id: "warden_1", position: { x: 4, y: 2 } }],
    objectives: { exit: { x: 4, y: 1 } },
    candidates: [
      { id: "cand_east", action: { kind: "move", params: { direction: "east", from: { x: 1, y: 2 }, to: { x: 2, y: 2 } } } },
    ],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "cand_east");
  assert.deepEqual(result.model.rationaleTags, ["move_toward_hostile"]);
});

test("z3 adapter prefers move-toward-exit when no hostile is visible", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({
    actor: { id: "delver_1", position: { x: 1, y: 2 } },
    visibleActors: [],
    objectives: { exit: { x: 4, y: 2 } },
    candidates: [
      { id: "cand_wait", action: { kind: "wait", params: {} } },
      { id: "cand_east", action: { kind: "move", params: { direction: "east", from: { x: 1, y: 2 }, to: { x: 2, y: 2 } } } },
    ],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "cand_east");
  assert.deepEqual(result.model.rationaleTags, ["move_toward_exit"]);
});

test("z3 adapter falls back to wait when only wait candidates are available", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({
    candidates: [{ id: "only_wait", action: { kind: "wait", params: {} } }],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "only_wait");
  assert.deepEqual(result.model.rationaleTags, ["wait"]);
});

test("z3 adapter ranks all candidates in descending score order for diagnostics", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({
    candidates: [
      { id: "a", action: { kind: "wait", params: {} } },
      { id: "b", action: { kind: "attack", params: { targetId: "x" } } },
      { id: "c", action: { kind: "move", params: { direction: "east", from: { x: 1, y: 2 }, to: { x: 2, y: 2 } } } },
    ],
    objectives: { exit: { x: 4, y: 2 } },
  }));

  const scores = result.model.rankedCandidates.map((r) => r.score);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1] >= scores[i], `ranked candidates should be in descending score order; got ${scores}`);
  }
  // Attack should be first (highest weight)
  assert.equal(result.model.rankedCandidates[0].candidateActionId, "b");
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

test("z3 adapter returns unsat when no candidate actions are provided", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({ candidates: [] }));
  assert.equal(result.status, "unsat");
  assert.equal(result.reason, "z3_no_candidates");
});

test("z3 adapter returns error when request lacks a runtime-decision envelope", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve({
    schema: "agent-kernel/SolverRequest",
    schemaVersion: 1,
    meta: { id: "bad_req", runId: "test", createdAt: "2026-06-04T00:00:00.000Z", producedBy: "actor" },
    problem: { language: "custom", data: { wrongShape: true } },
  });

  assert.equal(result.status, "error");
  assert.equal(result.reason, "z3_missing_runtime_decision_envelope");
});

test("z3 adapter honors forceStatus option for testability", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");

  for (const status of ["deferred", "unsat", "error"]) {
    const adapter = createZ3SolverAdapter({ forceStatus: status });
    const result = await adapter.solve(buildRequest({ candidates: [{ id: "x", action: { kind: "wait", params: {} } }] }));
    assert.equal(result.status, status, `forceStatus=${status} must yield status=${status}`);
  }
});

test("z3 adapter throws (port boundary error path) when throwOnSolve is true", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const { createSolverPort } = await import("../../packages/runtime/src/ports/solver.js");

  const adapter = createZ3SolverAdapter({ throwOnSolve: true });
  const port = createSolverPort({ clock: () => "2026-06-04T00:00:00.000Z" });

  const result = await port.solve(adapter, buildRequest({
    candidates: [{ id: "x", action: { kind: "wait", params: {} } }],
  }));

  // Port should catch and convert thrown errors into structured error responses
  assert.equal(result.status, "error");
  assert.equal(result.reason, "z3_adapter_simulated_failure");
});

test("z3 adapter falls back when hostile is visible but move candidate does not reduce distance", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({
    actor: { id: "delver_1", position: { x: 1, y: 2 } },
    visibleActors: [{ id: "warden_1", position: { x: 4, y: 2 } }],
    objectives: { exit: { x: 1, y: 1 } },
    candidates: [
      { id: "cand_north", action: { kind: "move", params: { direction: "north", from: { x: 1, y: 2 }, to: { x: 1, y: 1 } } } },
      { id: "cand_wait", action: { kind: "wait", params: {} } },
    ],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "cand_north");
  assert.deepEqual(result.model.rationaleTags, ["move_toward_exit"]);
});

test("z3 adapter selection is deterministic for multiple equal-priority candidates", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({
    candidates: [
      { id: "first_attack", action: { kind: "attack", params: { targetId: "warden_1" } } },
      { id: "second_attack", action: { kind: "attack", params: { targetId: "warden_2" } } },
    ],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "first_attack");
  assert.deepEqual(result.model.rationaleTags, ["attack_adjacent"]);
});

test("z3 adapter still prefers attack candidate when no hostile is visible", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({
    visibleActors: [],
    objectives: { exit: { x: 4, y: 2 } },
    candidates: [
      { id: "cand_move", action: { kind: "move", params: { direction: "east", from: { x: 1, y: 2 }, to: { x: 2, y: 2 } } } },
      { id: "cand_attack", action: { kind: "attack", params: { targetId: "warden_hidden" } } },
    ],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "cand_attack");
  assert.deepEqual(result.model.rationaleTags, ["attack_adjacent"]);
});

test("z3 adapter handles diagonal move candidates with Chebyshev distance", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({
    actor: { id: "delver_1", position: { x: 1, y: 1 } },
    visibleActors: [{ id: "warden_1", position: { x: 3, y: 3 } }],
    candidates: [
      { id: "cand_wait", action: { kind: "wait", params: {} } },
      { id: "cand_southeast", action: { kind: "move", params: { direction: "southeast", from: { x: 1, y: 1 }, to: { x: 2, y: 2 } } } },
    ],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "cand_southeast");
  assert.deepEqual(result.model.rationaleTags, ["move_toward_hostile"]);
});

test("z3 adapter selects attack even when target is outside visibleActors", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({
    visibleActors: [{ id: "warden_visible", position: { x: 4, y: 2 } }],
    candidates: [
      { id: "cand_move", action: { kind: "move", params: { direction: "east", from: { x: 1, y: 2 }, to: { x: 2, y: 2 } } } },
      { id: "cand_attack_hidden", action: { kind: "attack", params: { targetId: "warden_hidden" } } },
    ],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.selectedActionId, "cand_attack_hidden");
  assert.deepEqual(result.model.rationaleTags, ["attack_adjacent"]);
});

test("z3 adapter consecutive solve calls do not share mutable state", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();
  const request = buildRequest({
    candidates: [
      { id: "cand_wait", action: { kind: "wait", params: {} } },
      { id: "cand_attack", action: { kind: "attack", params: { targetId: "warden_1" } } },
    ],
  });

  const first = await adapter.solve(request);
  const second = await adapter.solve(request);

  assert.deepEqual(second, first);
});

test("z3 adapter propagates custom decisionKind to model output", async () => {
  const { createZ3SolverAdapter } = await import("../../packages/adapters-test/src/adapters/solver/z3-adapter.js");
  const adapter = createZ3SolverAdapter();

  const result = await adapter.solve(buildRequest({
    decisionKind: "next_attack",
    candidates: [{ id: "cand_attack", action: { kind: "attack", params: { targetId: "warden_1" } } }],
  }));

  assert.equal(result.status, "fulfilled");
  assert.equal(result.model.decisionKind, "next_attack");
  assert.equal(result.model.selectedActionId, "cand_attack");
});
