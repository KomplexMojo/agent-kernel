/**
 * Z6.2/RB1/Z7.1 — conformance for the hybrid adapter behind z3-real.
 *
 * The Actor path remains a pure tuple consumer. The Allocator path compiles its
 * persona-authored integer problem through Z3 without interpreting budget meaning.
 */
"use strict";

const assert = require("node:assert/strict");

async function loadConformance() {
  return import("../../packages/runtime/src/ports/solver-conformance.js");
}

async function loadAdapter() {
  return import("../../packages/adapters-cli/src/adapters/z3/index.js");
}

function actorObjective(candidates, ranks, tags = []) {
  return {
    actorDecision: {
      contract: "actor-decision-objective-v1",
      order: ["opaque_preference"],
      candidates: candidates.map((candidate, index) => ({
        candidateActionId: candidate.id,
        rank: [ranks[index]],
        features: { opaqueIndex: index },
        rationaleTags: tags[index] || [`opaque_${index}`],
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Conformance — the Z.3 gate every solver adapter must clear before a run
// touches it. This is the same suite the JS stand-in already passes; a real
// Z3 binding starts from zero credit, not from the stand-in's track record.
// ---------------------------------------------------------------------------

test("the Actor lexicographic adapter passes the shared conformance suite", async () => {
  const { checkSolverConformance } = await loadConformance();
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const result = await checkSolverConformance(createRealZ3SolverAdapter());
  assert.equal(result.ok, true, result.failures.join(" | "));
});

test("the deprecated z3-real alias reports the canonical hybrid domains", async () => {
  const { describeSolverCapabilities } = await loadConformance();
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const caps = describeSolverCapabilities(createRealZ3SolverAdapter());
  assert.deepEqual(
    caps.domains,
    ["allocator_budget_fit", "configurator_satisfiability"],
    "Z9.1 adopts Configurator object placement through the existing satisfiability domain. "
      + "`actor_action_selection` was RETIRED 2026-09-05 — measured at 0.0% divergence from a "
      + "plain sort with 0 Z3 initializations — so the hybrid adapter is a two-domain solver "
      + "that also answers one non-constraint envelope.",
  );
  assert.deepEqual(
    caps.contracts,
    ["runtime-decision-v1"],
    "the Actor path did not go away with the domain: the adapter still sorts its rank tuple, "
      + "and now says so as a contract rather than as a search it never performed",
  );
  assert.equal(caps.deterministic, true);
  assert.equal(createRealZ3SolverAdapter().kind, "hybrid-constraint");
});

test("the legacy factory alias never initializes Z3", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  let initCalls = 0;
  const adapter = createRealZ3SolverAdapter({
    init() {
      initCalls += 1;
      throw new Error("Z3 must not initialize for independent candidate ranking");
    },
  });
  const candidates = [{ id: "wait_here", action: { kind: "wait", params: {} } }];
  const result = await adapter.solve({
    problem: {
      data: {
        contract: "runtime-decision-v1",
        candidateActions: candidates,
        objectives: actorObjective(candidates, [1]),
      },
    },
  });
  assert.equal(result.status, "fulfilled", JSON.stringify(result));
  assert.equal(result.model.selectedActionId, "wait_here");
  assert.equal(initCalls, 0);
});

// ---------------------------------------------------------------------------
// Behavior — opaque tuple comparison over the runtime-decision-v1 envelope.
// ---------------------------------------------------------------------------

test("selects the highest Actor tuple without interpreting action kinds", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const adapter = createRealZ3SolverAdapter();
  const candidateActions = [
    {
      id: "attack_hostile_1",
      action: { kind: "attack", actorId: "actor_1", tick: 3, params: { targetId: "hostile_1" } },
    },
    {
      id: "move_away",
      action: { kind: "move", actorId: "actor_1", tick: 3, params: { to: { x: 4, y: 5 } } },
    },
    { id: "wait_here", action: { kind: "wait", actorId: "actor_1", tick: 3, params: {} } },
  ];
  const envelope = {
    contract: "runtime-decision-v1",
    decisionKind: "next_move",
    tick: 3,
    actor: { id: "actor_1", position: { x: 5, y: 5 } },
    visibleActors: [{ id: "hostile_1", position: { x: 6, y: 5 } }],
    candidateActions,
    objectives: actorObjective(candidateActions, [1, 3, 2], [
      ["lower_despite_action_kind"], ["Actor chose this"], ["middle"],
    ]),
  };
  const result = await adapter.solve({ problem: { data: envelope } });
  assert.equal(result.status, "fulfilled", JSON.stringify(result));
  assert.equal(result.model?.selectedActionId, "move_away");
  assert.deepEqual(result.model?.rationaleTags, ["Actor chose this"]);
});

test("selected action always names a real candidate id — resolveActionFromSolverResult's own requirement", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const { resolveActionFromSolverResult } = await import(
    "../../packages/runtime/src/personas/_shared/runtime-decision.mts"
  );
  const adapter = createRealZ3SolverAdapter();
  const candidateActions = [
    { id: "wait_here", action: { kind: "wait", actorId: "actor_1", tick: 1, params: {} } },
  ];
  const envelope = {
    contract: "runtime-decision-v1",
    decisionKind: "next_move",
    tick: 1,
    actor: { id: "actor_1", position: { x: 0, y: 0 } },
    visibleActors: [],
    candidateActions,
    objectives: actorObjective(candidateActions, [1]),
  };
  const solverRequest = { problem: { data: envelope } };
  const solverResult = await adapter.solve(solverRequest);
  const resolved = resolveActionFromSolverResult({ solverRequest, solverResult });
  assert.equal(resolved.ok, true, JSON.stringify(resolved.errors));
  assert.equal(resolved.action.kind, "wait");
});

test("an envelope missing the runtime-decision-v1 contract defers cleanly instead of guessing", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const adapter = createRealZ3SolverAdapter();
  const result = await adapter.solve({ problem: { data: { contract: "something-else" } } });
  assert.notEqual(result.status, "fulfilled");
});

/**
 * A Z3 Context is a WASM allocation z3-solver never frees, so constructing one per
 * solve leaks unreclaimably: 10.45 MB per solve measured through the Allocator path,
 * with solve TIME flat throughout, so nothing gets slower and no existing test notices.
 * The Allocator's hosted fitter is called from inside `runLlmBudgetLoop`'s round loop,
 * which is where that became unbounded growth in a real run.
 *
 * These two tests forbid the CAPABILITY rather than measuring the symptom. An RSS
 * threshold would be environment-dependent and would pass on a fast machine with a
 * small heap; counting constructions is exact, and it fails the moment someone moves
 * `new Context` back inside the solve. The stub below never solves anything -- it
 * answers `unsat` immediately -- because what is under test is context lifecycle, not
 * arithmetic.
 */
function countingZ3Stub() {
  let contexts = 0;
  const value = {};
  for (const method of ["add", "mul", "sub", "ge", "le", "eq", "neg"]) value[method] = () => value;
  class Optimize {
    add() {}
    maximize() {}
    minimize() {}
    async check() { return "unsat"; }
    reasonUnknown() { return "stub"; }
  }
  class Context {
    constructor() {
      contexts += 1;
      this.Int = { const: () => value, val: () => value };
      this.Optimize = Optimize;
      this.If = () => value;
    }
  }
  return { init: async () => ({ Context }), contextCount: () => contexts };
}

function budgetFitProblem(budget) {
  return {
    schema: "agent-kernel/ConstraintProblem",
    schemaVersion: 1,
    meta: { id: `ctx_${budget}`, runId: "ctx", createdAt: "2026-09-04T00:00:00.000Z" },
    domain: "allocator_budget_fit",
    posedBy: "allocator",
    variables: [
      { id: "floorTiles", kind: "integer", min: 0, max: 5 },
      { id: "hallwayTiles", kind: "integer", min: 0, max: 5 },
    ],
    constraints: [{
      id: "budget_cap",
      kind: "linear",
      relation: "<=",
      rightHandSide: budget,
      terms: [
        { variableId: "floorTiles", coefficient: 1 },
        { variableId: "hallwayTiles", coefficient: 9 },
      ],
    }],
    objective: {
      kind: "lexicographic",
      priorities: [{
        id: "retained_total",
        sense: "maximize",
        expression: {
          kind: "linear",
          terms: [
            { variableId: "floorTiles", coefficient: 1 },
            { variableId: "hallwayTiles", coefficient: 1 },
          ],
        },
      }],
    },
    context: {},
  };
}

test("many solves do not construct many Z3 contexts", async () => {
  const { createHybridConstraintSolverAdapter } = await loadAdapter();
  const stub = countingZ3Stub();
  const adapter = createHybridConstraintSolverAdapter({ init: stub.init });

  for (let index = 0; index < 60; index += 1) {
    const result = await adapter.solve({ problem: budgetFitProblem(2 + (index % 7)) });
    assert.equal(result.status, "unsat", "the stub answers unsat; a compile error would mask the count");
  }

  assert.equal(
    stub.contextCount(),
    1,
    "60 solves constructed more than one Z3 context. A context is never freed, so one per "
      + "solve leaks ~10MB every time a persona poses a problem — see createGenericZ3Solver.",
  );
});

test("context reuse is bounded, so one context cannot accumulate without limit", async () => {
  const { createHybridConstraintSolverAdapter } = await loadAdapter();
  const stub = countingZ3Stub();
  const adapter = createHybridConstraintSolverAdapter({ init: stub.init });

  // One past the bound: the second context proves recycling actually happens. Reusing a
  // single context forever aborts the PROCESS with a WASM out-of-bounds once its
  // ast_manager fills, which is not a failure this adapter could report as a status.
  for (let index = 0; index < 251; index += 1) {
    await adapter.solve({ problem: budgetFitProblem(2 + (index % 7)) });
  }

  assert.equal(
    stub.contextCount(),
    2,
    "the context is never recycled, so a long-running process accumulates AST nodes in one "
      + "context until Z3 aborts. Reuse must be bounded, not unlimited.",
  );
});

// ## TODO: Test Permutations
//
// - two candidates with equal tuples: stable input order picks the SAME one on
//   every run — this is the determinism check applied to an actual tie, not just the
//   whole-envelope repeat the conformance suite already covers
// - empty `candidateActions` -> "unsat" with a `reason`, never a thrown error
// - malformed rank widths and non-integer members defer with the typed reason
// - replay determinism end-to-end: same envelope solved twice in the same process
//   AND across two fresh process invocations produces byte-identical `model`
