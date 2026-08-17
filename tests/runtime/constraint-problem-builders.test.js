/**
 * Z.2 — each adopting persona poses its OWN question, and consumes its own answer.
 *
 * Three builders, three owners, and the ownership rule is enforced rather than
 * documented: `validateConstraintProblem` refuses a problem posed by anyone but
 * the domain's owner. That is the whole point of the split — the Allocator may
 * not ask a configuration-validity question, and the Configurator may not ask a
 * pricing one.
 *
 * Every consumer here returns `null` rather than a partial answer when the
 * solver did not fulfil, or when the model names something that was never
 * offered. A solver answering a different question is not partially right.
 * `null` is what keeps the deterministic rule path in charge.
 */
"use strict";

const assert = require("node:assert/strict");

const META = { id: "z2", runId: "z2", createdAt: "2026-08-14T00:00:00.000Z" };

async function contract() {
  return import("../../packages/runtime/src/contracts/constraint-problem.js");
}

async function personas() {
  const [actor, allocator, configurator] = await Promise.all([
    import("../../packages/runtime/src/personas/actor/persona.js"),
    import("../../packages/runtime/src/personas/allocator/persona.js"),
    import("../../packages/runtime/src/personas/configurator/persona.js"),
  ]);
  return {
    actor: actor.createActorPersona({ clock: () => "fixed", seed: 1 }),
    allocator,
    configurator: configurator.createConfiguratorPersona({ clock: () => "fixed" }),
  };
}

// ---------------------------------------------------------------------------
// Every builder produces a problem its OWN persona is allowed to pose
// ---------------------------------------------------------------------------

test("all three builders produce problems that pass ownership validation", async () => {
  const { validateConstraintProblem } = await contract();
  const { actor, allocator, configurator } = await personas();

  const problems = [
    ["actor", actor.buildActionSelectionProblem({
      actor: { id: "a1", position: { x: 1, y: 1 } },
      proposals: [{ kind: "move", params: { to: { x: 2, y: 1 } } }],
      meta: META,
    })],
    ["allocator", allocator.buildBudgetFitProblem({
      items: [{ id: "vital_health_point", unitCost: 1 }],
      budgetTokens: 100,
      meta: META,
    })],
    ["configurator", configurator.buildSatisfiabilityProblem({
      actors: [{ id: "a1", motivations: ["patrolling"], vitals: {}, affinities: [] }],
      meta: META,
    })],
  ];

  for (const [name, problem] of problems) {
    const result = validateConstraintProblem(problem);
    assert.equal(result.ok, true, `${name}: ${result.errors.join(" | ")}`);
    assert.equal(problem.posedBy, name, "the builder must attribute the problem to its own persona");
  }
});

test("a builder's problem is REFUSED if attributed to the wrong persona", async () => {
  const { validateConstraintProblem } = await contract();
  const { allocator } = await personas();
  const problem = allocator.buildBudgetFitProblem({
    items: [{ id: "x", unitCost: 1 }],
    budgetTokens: 10,
    meta: META,
  });
  const tampered = { ...problem, posedBy: "configurator" };
  assert.equal(validateConstraintProblem(tampered).ok, false, "pricing has one author");
});

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

test("the Actor's problem offers exactly the candidates it authored", async () => {
  const { actor } = await personas();
  const proposals = [
    { kind: "move", params: { to: { x: 2, y: 1 } } },
    { kind: "cast_affinity", params: { kind: "fire", expression: "push", stacks: 1 } },
  ];
  const problem = actor.buildActionSelectionProblem({
    actor: { id: "a1", position: { x: 1, y: 1 } },
    proposals,
    resources: { mana: 5, stamina: 3 },
    reservedTargets: [{ x: 3, y: 3 }],
    meta: META,
    tick: 4,
  });

  assert.equal(problem.variables.length, 2, "the solver may only choose among the Actor's own "
    + "candidates — a wider space lets it invent a move nothing validated");
  assert.deepEqual(problem.variables.map((v) => v.kind), ["move", "cast_affinity"]);
  const ids = problem.constraints.map((c) => c.id);
  assert.ok(ids.includes("mana_available") && ids.includes("stamina_available"));
  assert.ok(
    ids.includes("reserved_tiles"),
    "tiles claimed earlier this tick must be stated: core occupancy does not update until APPLY, "
      + "so a solver blind to them would route two actors onto one tile",
  );
});

test("the Actor resolves a fulfilled model back to its own proposal", async () => {
  const { actor } = await personas();
  const proposals = [{ kind: "wait", params: {} }, { kind: "move", params: { to: { x: 2, y: 1 } } }];
  const chosen = actor.resolveActionFromConstraintResult(
    { status: "fulfilled", model: { selectedActionId: "candidate_2" } },
    proposals,
  );
  assert.equal(chosen, proposals[1]);
});

test("the Actor returns null for an unoffered candidate and for every non-fulfilled status", async () => {
  const { actor } = await personas();
  const proposals = [{ kind: "wait", params: {} }];

  assert.equal(
    actor.resolveActionFromConstraintResult(
      { status: "fulfilled", model: { selectedActionId: "candidate_99" } },
      proposals,
    ),
    null,
    "a model naming something never offered is answering a different question",
  );
  for (const status of ["unsat", "deferred", "error"]) {
    assert.equal(
      actor.resolveActionFromConstraintResult({ status, model: { selectedActionId: "candidate_1" } }, proposals),
      null,
      `${status} must fall back to the rule path, not be mined for a usable answer`,
    );
  }
});

// ---------------------------------------------------------------------------
// Allocator
// ---------------------------------------------------------------------------

test("the Allocator's budget cap is a hard linear constraint over its own prices", async () => {
  const { allocator } = await personas();
  const problem = allocator.buildBudgetFitProblem({
    items: [
      { id: "a", unitCost: 3, maxQuantity: 2 },
      { id: "b", unitCost: 5 },
    ],
    budgetTokens: 12,
    meta: META,
  });
  const cap = problem.constraints.find((c) => c.id === "budget_cap");
  assert.equal(cap.bound, 12);
  assert.deepEqual(
    cap.terms,
    [{ variable: "a", coefficient: 3 }, { variable: "b", coefficient: 5 }],
    "coefficients are the ALLOCATOR's prices — the solver searches over them, it never derives one",
  );
  assert.equal(
    problem.variables.find((v) => v.id === "b").maxQuantity,
    null,
    "an absent maxQuantity means unbounded-within-budget; defaulting it to 1 would silently forbid "
      + "buying two and look like the solver declining",
  );
});

test("the Allocator re-derives cost from its own prices, and refuses an unknown item", async () => {
  const { allocator } = await personas();
  const items = [{ id: "a", unitCost: 3 }, { id: "b", unitCost: 5 }];

  const ok = allocator.resolveSelectionFromConstraintResult(
    { status: "fulfilled", model: { assignments: { a: 2, b: 1 } } },
    items,
  );
  assert.deepEqual(ok.selections, [{ id: "a", quantity: 2 }, { id: "b", quantity: 1 }]);
  assert.equal(ok.totalCost, 11, "cost comes from the Allocator's prices, not from a total the "
    + "adapter reported over numbers we handed it");

  assert.equal(
    allocator.resolveSelectionFromConstraintResult(
      { status: "fulfilled", model: { assignments: { a: 1, ghost: 1 } } },
      items,
    ),
    null,
    "a partially-recognized selection would be priced against an item list that does not describe it",
  );
});

// ---------------------------------------------------------------------------
// Configurator
// ---------------------------------------------------------------------------

test("the Configurator names constraints PER ACTOR, so an unsat can say who fails", async () => {
  const { configurator } = await personas();
  const problem = configurator.buildSatisfiabilityProblem({
    actors: [
      { id: "delver_1", motivations: ["patrolling", "attacking"], vitals: {}, affinities: [{ kind: "fire" }] },
      { id: "warden_1", motivations: ["stationary"], vitals: {}, affinities: [] },
    ],
    meta: META,
  });

  const ids = problem.constraints.map((c) => c.id);
  assert.ok(ids.includes("delver_1:motivation_exclusivity"));
  assert.ok(ids.includes("delver_1:affinity_requires_mana"));
  assert.ok(ids.includes("warden_1:mobility_requires_stamina"));
  assert.ok(
    !ids.includes("warden_1:affinity_requires_mana"),
    "an actor with no affinity has nothing to pay for",
  );
  assert.ok(
    ids.every((id) => id.includes(":")),
    "every constraint is scoped to an actor. 'the configuration is unsatisfiable' is not "
      + "actionable; 'this actor cannot move because its stamina pool is 0' is — and that is the "
      + "sentence F12 needed for as long as it existed",
  );
});

test("the Configurator reports which constraints failed, and refuses to read deferred as valid", async () => {
  const { configurator } = await personas();

  const sat = configurator.resolveSatisfiabilityFromConstraintResult({ status: "fulfilled" });
  assert.deepEqual(sat, { satisfiable: true, failing: [] });

  const unsat = configurator.resolveSatisfiabilityFromConstraintResult({
    status: "unsat",
    reason: "conflicting motivations",
    model: { unsatisfiedConstraints: ["delver_1:motivation_exclusivity"] },
  });
  assert.equal(unsat.satisfiable, false);
  assert.deepEqual(unsat.failing, ["delver_1:motivation_exclusivity"]);

  for (const status of ["deferred", "error"]) {
    assert.equal(
      configurator.resolveSatisfiabilityFromConstraintResult({ status }),
      null,
      `${status} must NOT read as satisfiable — a solver that could not answer has not approved `
        + "anything, and the Configurator's own checks stand",
    );
  }
});

// ## TODO: Test Permutations
//
// - every (domain, posedBy) pair across all three personas: exactly the owner validates
// - Actor: zero proposals; proposals with explicit candidateIds; missing resources
// - Allocator: budgetTokens 0; an item with unitCost 0; quantities that are
//   non-integer or negative in the model (must be ignored, not coerced)
// - Configurator: an actor with no id (must still be addressable in constraint ids);
//   an actor with three conflicting motivations
// - every consumer against a malformed model (null, array, wrong-typed fields)
