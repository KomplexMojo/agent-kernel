/**
 * #299 — the solver hosts record which build-time decisions the solver made and which the
 * persona's fallback made, and one summary line names them.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const CLOCK = () => "2026-09-01T00:00:00.000Z";
const PLACEMENT_FIXTURE = resolve(__dirname, "../fixtures/configurator/object-placement-greedy-counterexample.json");

function placementArgs() {
  const fixture = JSON.parse(readFileSync(PLACEMENT_FIXTURE, "utf8"));
  return {
    layout: fixture.layout,
    actors: fixture.actors,
    hazards: fixture.objects.filter(({ kind }) => kind === "hazard"),
    resources: fixture.objects.filter(({ kind }) => kind === "resource"),
  };
}

async function placerWith(adapter) {
  const { createHostedObjectPlacer } = await import("../../packages/runtime/src/commands/solver-host.js");
  const { createConfiguratorPersona } = await import("../../packages/runtime/src/personas/configurator/persona.js");
  const configurator = createConfiguratorPersona({ clock: CLOCK });
  const decisions = [];
  const placeObjects = createHostedObjectPlacer({
    prepare: configurator.prepareObjectPlacement,
    complete: configurator.completeObjectPlacement,
    adapter,
    clock: CLOCK,
    record: (decision) => decisions.push(decision),
  });
  return { placeObjects, decisions };
}

test("a placement the solver answered records solver with its objective values", async () => {
  const { createHybridConstraintSolverAdapter } = await import("../../packages/adapters-cli/src/adapters/z3/index.js");
  const { placeObjects, decisions } = await placerWith(createHybridConstraintSolverAdapter());
  const result = await placeObjects(placementArgs());

  assert.equal(result.source, "solver");
  assert.equal(decisions.length, 1);
  const [decision] = decisions;
  assert.equal(decision.domain, "configurator_satisfiability");
  assert.equal(decision.decision, "solver");
  assert.equal(decision.status, "fulfilled");
  assert.ok(Array.isArray(decision.objectiveValues) && decision.objectiveValues.length > 0);
  assert.equal(decision.reason, undefined);
});

test("no capable adapter records the fallback and the reason it was taken", async () => {
  const { placeObjects, decisions } = await placerWith(undefined);
  const result = await placeObjects(placementArgs());

  assert.equal(result.source, "fallback");
  assert.deepEqual(decisions, [{
    domain: "configurator_satisfiability",
    decision: "fallback",
    status: "deferred",
    reason: "solver_domain_unavailable",
  }]);
});

test("an adapter that defers records the adapter's own reason", async () => {
  const { placeObjects, decisions } = await placerWith({
    kind: "forced-deferred",
    capabilities: { domains: ["configurator_satisfiability"], deterministic: true },
    solve: async () => ({ status: "deferred", reason: "forced_deferred" }),
  });
  await placeObjects(placementArgs());

  assert.equal(decisions[0].decision, "fallback");
  assert.equal(decisions[0].reason, "forced_deferred");
});

test("a placement with nothing to place records that no search was posed", async () => {
  const { placeObjects, decisions } = await placerWith(undefined);
  const args = placementArgs();
  await placeObjects({ ...args, hazards: [], resources: [] });

  assert.deepEqual(decisions, [{
    domain: "configurator_satisfiability",
    decision: "none",
    status: "bypass",
    reason: "no_search_needed",
  }]);
});

test("the budget-fit host records its decision under the Allocator's domain", async () => {
  const { createHostedLayoutBudgetFitter } = await import("../../packages/runtime/src/commands/solver-host.js");
  const { createAllocatorPersona } = await import("../../packages/runtime/src/personas/allocator/persona.js");
  const allocator = createAllocatorPersona({ clock: CLOCK });
  const decisions = [];
  const fitLayout = createHostedLayoutBudgetFitter({
    prepare: allocator.prepareLayoutBudgetFit,
    complete: allocator.completeLayoutBudgetFit,
    clock: CLOCK,
    record: (decision) => decisions.push(decision),
  });
  await fitLayout({ layout: { floorTiles: 400, hallwayTiles: 0 }, remainingBudgetTokens: 10 });

  assert.deepEqual(decisions, [{
    domain: "allocator_budget_fit",
    decision: "fallback",
    status: "deferred",
    reason: "solver_domain_unavailable",
  }]);
});

test("one summary line names every decision and why the fallback answered", async () => {
  const { summarizeSolverDecisions } = await import("../../packages/runtime/src/commands/solver-host.js");

  assert.equal(summarizeSolverDecisions([
    { domain: "configurator_satisfiability", decision: "fallback", status: "deferred", reason: "solver_domain_unavailable" },
    { domain: "allocator_budget_fit", decision: "solver", status: "fulfilled", objectiveValues: [3] },
  ]), "placement: fallback (solver_domain_unavailable); budget fit: solver");
  assert.equal(summarizeSolverDecisions([
    { domain: "configurator_satisfiability", decision: "none", status: "bypass", reason: "no_search_needed" },
  ]), "placement: none (no_search_needed)");
  assert.equal(summarizeSolverDecisions([
    { domain: "configurator_satisfiability", decision: "solver", status: "unsat", reason: "path_obstruction" },
  ]), "placement: solver (unsat: path_obstruction)");
  assert.equal(summarizeSolverDecisions([]), "");
});

// ## TODO: Test Permutations
// - budget fit answered by the hybrid adapter records `solver` with objective values
// - a solver model the Configurator rejects records `solver` with the rejection reason
// - a placement pre-check that is unsat with no capable adapter records the fallback
