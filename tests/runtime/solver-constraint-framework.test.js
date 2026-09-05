/**
 * Z.1 / Z.3 — the solver framework: one problem contract, declared capabilities,
 * and a determinism gate every adapter must clear.
 *
 * Scope is the maintainer's rule (2026-08-14): a solver is adopted only where it
 * REPLACES A RULE CAGE — a search whose hand-rolled version is greedy,
 * incomplete or exploding. Three sites qualified (Actor action selection,
 * Allocator budget fit, Configurator satisfiability) and three were refused
 * (Moderator interaction resolution, tick ordering, the core matrices — all
 * total functions over bounded inputs, already optimal). These tests hold that
 * line: the domain list is closed, and a persona may not pose another's question.
 *
 * Neither adapter in this repo is real Z3 — one is a weighted-priority JS
 * stand-in, one a fixture stub. The determinism check is what a real one will
 * have to clear, and it is not free: a solver may return any satisfying
 * assignment, and this repo replays runs frame by frame.
 */
"use strict";

const assert = require("node:assert/strict");

async function loadContract() {
  return import("../../packages/runtime/src/contracts/constraint-problem.js");
}

async function loadConformance() {
  return import("../../packages/runtime/src/ports/solver-conformance.js");
}

// ---------------------------------------------------------------------------
// The contract: adopted domains only, and one owner each
// ---------------------------------------------------------------------------

test("only the two ADOPTED domains exist", async () => {
  const { CONSTRAINT_DOMAINS } = await loadContract();
  assert.deepEqual(
    Object.values(CONSTRAINT_DOMAINS).sort(),
    ["allocator_budget_fit", "configurator_satisfiability"],
    "the domain list is closed on purpose. Moderator interaction resolution and tick ordering "
      + "were REFUSED — they evaluate rather than search — and a domain for either would be the "
      + "artificial introduction the adoption rule forbids.",
  );
});

// ⚠️ THREE → TWO, and the removal is the point. `actor_action_selection` was adopted on the
// qualitative gate alone and retired 2026-09-05 once the quantitative half was measured: 0.0%
// divergence from a plain stable sort over 819 permutations, 0 Z3 initializations, and no host
// ever routed on it. This test guards the retirement in the direction that actually decays —
// silent RE-adoption — because re-adding the string is a one-line change that no other
// assertion here would notice.
test("the retired Actor domain cannot be posed as a constraint problem", async () => {
  const { buildConstraintProblem, validateConstraintProblem, CONSTRAINT_DOMAIN_OWNERS } = await loadContract();
  assert.equal(
    CONSTRAINT_DOMAIN_OWNERS.actor_action_selection,
    undefined,
    "a retired domain must not keep an owner: the owner table is what makes a domain posable",
  );
  const result = validateConstraintProblem(buildConstraintProblem({
    domain: "actor_action_selection",
    posedBy: "actor",
    meta: { id: "x", runId: "x", createdAt: "2026-08-14T00:00:00.000Z" },
  }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /not an adopted constraint domain/);
});

test("a problem in a refused or invented domain is rejected", async () => {
  const { buildConstraintProblem, validateConstraintProblem } = await loadContract();
  const result = validateConstraintProblem(buildConstraintProblem({
    domain: "moderator_interaction_resolution",
    posedBy: "moderator",
    meta: { id: "x", runId: "x", createdAt: "2026-08-14T00:00:00.000Z" },
  }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /not an adopted constraint domain/);
});

test("one persona may not pose another persona's question", async () => {
  const { buildConstraintProblem, validateConstraintProblem, CONSTRAINT_DOMAINS } = await loadContract();
  const meta = { id: "x", runId: "x", createdAt: "2026-08-14T00:00:00.000Z" };

  const wrong = validateConstraintProblem(buildConstraintProblem({
    domain: CONSTRAINT_DOMAINS.ALLOCATOR_BUDGET_FIT,
    posedBy: "configurator",
    meta,
  }));
  assert.equal(wrong.ok, false, "budget fit is the Allocator's — pricing has one author");
  assert.match(wrong.errors.join(" "), /owned by the allocator/);

  const right = validateConstraintProblem(buildConstraintProblem({
    domain: CONSTRAINT_DOMAINS.ALLOCATOR_BUDGET_FIT,
    posedBy: "allocator",
    meta,
  }));
  assert.equal(right.ok, true, right.errors.join(" | "));
});

test("an unattributed problem is refused", async () => {
  const { buildConstraintProblem, validateConstraintProblem, CONSTRAINT_DOMAINS } = await loadContract();
  const result = validateConstraintProblem(buildConstraintProblem({
    domain: CONSTRAINT_DOMAINS.CONFIGURATOR_SATISFIABILITY,
    meta: { id: "x", runId: "x", createdAt: "2026-08-14T00:00:00.000Z" },
  }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /posedBy: required/);
});

test("runtime-decision-v1 remains the family's first member, not a rival scheme", async () => {
  const contract = await loadContract();
  const shared = await import(
    "../../packages/runtime/src/personas/_shared/runtime-decision.mts"
  );
  assert.equal(
    contract.RUNTIME_DECISION_CONTRACT,
    shared.RUNTIME_DECISION_CONTRACT,
    "the Actor's existing envelope and the family must name the same contract string, or the "
      + "generalization has quietly created the second authority it was meant to prevent",
  );
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

test("an unsat result without an explanation is marked as such", async () => {
  const { normalizeConstraintResult, CONSTRAINT_DOMAINS } = await loadContract();
  const result = normalizeConstraintResult(
    { status: "unsat" },
    { domain: CONSTRAINT_DOMAINS.ALLOCATOR_BUDGET_FIT, meta: {} },
  );
  assert.equal(
    result.reason,
    "unsat_without_explanation",
    "a solver is preferred to the greedy loop it replaces because it can say WHY nothing fits; "
      + "an unexplained unsat returns less than the code it displaced",
  );
});

// ---------------------------------------------------------------------------
// Conformance — every adapter in the repo must pass
// ---------------------------------------------------------------------------

test("the adapters-test z3 stand-in passes conformance", async () => {
  const { checkSolverConformance } = await loadConformance();
  const { createZ3SolverAdapter } = await import(
    "../../packages/adapters-test/src/adapters/solver/z3-adapter.js"
  );
  const result = await checkSolverConformance(createZ3SolverAdapter());
  assert.equal(result.ok, true, result.failures.join(" | "));
});

test("conformance CATCHES a non-deterministic adapter", async () => {
  const { checkSolverConformance } = await loadConformance();
  let calls = 0;
  const flaky = {
    kind: "flaky",
    capabilities: { domains: ["allocator_budget_fit"], deterministic: true },
    async solve() {
      calls += 1;
      return { status: "fulfilled", model: { selectedActionId: `candidate_${calls}` } };
    },
  };
  const result = await checkSolverConformance(flaky);
  assert.equal(result.ok, false);
  assert.match(
    result.failures.join(" "),
    /not deterministic/,
    "this is the gate a real Z3 must clear: a solver may return ANY satisfying assignment, and "
      + "this repo compares replayed runs frame by frame",
  );
});

test("conformance CATCHES an adapter that declares neither a domain nor a contract", async () => {
  const { checkSolverConformance } = await loadConformance();
  const silent = {
    kind: "silent",
    capabilities: { domains: [], deterministic: true },
    async solve() { return { status: "deferred", reason: "no domain" }; },
  };
  const result = await checkSolverConformance(silent);
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /declares neither a constraint domain nor a problem contract/);
});

// The half that retiring `actor_action_selection` added, and the one that could rot quietly:
// an adapter answering the Actor's envelope declares a CONTRACT and no domain, and must still
// clear the gate. Get this wrong and the Actor adapter silently stops being conformance-checked
// at all -- losing the determinism guarantee that `ak replay` depends on.
test("an adapter that declares only a problem contract still clears the gate", async () => {
  const { checkSolverConformance, describeSolverCapabilities } = await loadConformance();
  const byContract = {
    kind: "envelope-only",
    capabilities: { contracts: ["runtime-decision-v1"], deterministic: true },
    async solve() { return { status: "deferred", reason: "not my envelope" }; },
  };
  assert.deepEqual(describeSolverCapabilities(byContract).contracts, ["runtime-decision-v1"]);
  assert.deepEqual(describeSolverCapabilities(byContract).domains, []);
  const result = await checkSolverConformance(byContract);
  assert.equal(result.ok, true, result.failures.join(" | "));

  // ...and an invented contract string declares nothing, exactly as an invented domain does.
  const bogus = { ...byContract, capabilities: { contracts: ["smt-lib-v2"], deterministic: true } };
  const rejected = await checkSolverConformance(bogus);
  assert.equal(rejected.ok, false);
  assert.match(rejected.failures.join(" "), /declares neither a constraint domain nor a problem contract/);
});

test("conformance CATCHES an adapter that throws instead of returning a status", async () => {
  const { checkSolverConformance } = await loadConformance();
  const thrower = {
    kind: "thrower",
    capabilities: { domains: ["allocator_budget_fit"], deterministic: true },
    async solve() { throw new Error("boom"); },
  };
  const result = await checkSolverConformance(thrower);
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /threw instead of returning a status/);
});

test("capability routing: a domain an adapter never claimed is not handed to it", async () => {
  const { adapterHandlesDomain, describeSolverCapabilities } = await loadConformance();
  const { createZ3SolverAdapter } = await import(
    "../../packages/adapters-test/src/adapters/solver/z3-adapter.js"
  );
  const adapter = createZ3SolverAdapter();
  // The stand-in answers the Actor's ENVELOPE and claims no constraint domain at all --
  // `actor_action_selection` was retired, and this adapter is why it should have been: it
  // sorts rank tuples and has never searched for anything.
  assert.deepEqual(describeSolverCapabilities(adapter).contracts, ["runtime-decision-v1"]);
  assert.deepEqual(describeSolverCapabilities(adapter).domains, []);
  assert.equal(
    adapterHandlesDomain(adapter, "allocator_budget_fit"),
    false,
    "an adapter that answered a domain it never claimed would produce a confidently wrong "
      + "decision rather than a clean deferral.",
  );
  assert.equal(describeSolverCapabilities(adapter).deterministic, true);
});

// ## TODO: Test Permutations
//
// - every (domain, persona) pair: exactly the owning persona validates
// - a problem whose `variables`/`constraints` are not arrays
// - an adapter deterministic in behavior but NOT declaring it (must fail — the
//   declaration is what the port trusts)
// - an adapter that returns an unknown status string
// - result normalization for each of fulfilled / unsat / deferred / error
// - the CLI fixture-stub adapter: declares no domains, so it must fail
//   conformance while remaining usable as a fixture replayer
