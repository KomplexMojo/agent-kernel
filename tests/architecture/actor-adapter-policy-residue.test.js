/**
 * RB1/Z7.1 — persona decision meaning must not live in any solver adapter or
 * shared envelope glue. Adapters validate and compile opaque contracts only.
 */
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const ADAPTERS = [
  "packages/adapters-cli/src/adapters/z3/index.js",
  "packages/adapters-web/src/adapters/z3/index.js",
  "packages/adapters-test/src/adapters/solver/z3-adapter.js",
];
const SHARED = "packages/runtime/src/personas/_shared/runtime-decision.mts";
const ACTOR = "packages/runtime/src/personas/actor/controller.js";
const ALLOCATOR_BUDGET_FIT = "packages/runtime/src/personas/allocator/budget-fit-problem.js";
const SOLVER_HOST = "packages/runtime/src/commands/solver-host.js";

const FORBIDDEN_POLICY_TOKENS = [
  "PRIORITY_RULES",
  "PRIORITY_WEIGHTS",
  "scoreCandidate",
  "scoreLegacyCandidate",
  "movesCloserTo",
  "chebyshevDistance",
  "move_toward_hostile",
  "move_toward_exit",
  "move_fallback",
];

/**
 * Every rank label the Actor must own. v4 demoted `actorProposal` from an intentClass of 600 to a tiebreak member, so the tuple
 * decides rather than re-stamping whichever proposal arrived. Stage B split `profileAlignment` into
 * `coverAlignment` and `stealthAlignment` (contract v3): summing a flat cover bonus with
 * a scaled stealth delta made the two indistinguishable, so a sort could not tell a
 * sheltering actor from a retreating one. Updating this list is the deliberate half of
 * that change -- the guard correctly refused to let a rank member disappear quietly.
 */
const ACTOR_ORDER_LABELS = [
  "intentClass",
  "targetFinish",
  "coverAlignment",
  "stealthAlignment",
  "fieldSafety",
  "fieldBenefit",
  "castReserve",
  "actorProposal",
  "inputOrder",
];

const ALLOCATOR_POLICY_TOKENS = [
  "floorTiles",
  "hallwayTiles",
  "tile_floor",
  "tile_hallway",
  "budget_cap",
  "retained_total",
  "layout_mix_distortion",
];

function source(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

test("solver adapters contain no Actor scoring policy", () => {
  for (const relativePath of ADAPTERS) {
    const adapterSource = source(relativePath);
    const residue = FORBIDDEN_POLICY_TOKENS.filter((token) => adapterSource.includes(token));
    assert.deepEqual(residue, [], `${relativePath} still owns Actor policy: ${residue.join(", ")}`);
  }
});

test("Actor tuple semantics have one source inside the Actor persona", () => {
  const actorSource = source(ACTOR);
  for (const label of ACTOR_ORDER_LABELS) {
    assert.ok(actorSource.includes(`"${label}"`), `Actor no longer owns objective label ${label}`);
  }

  for (const relativePath of [...ADAPTERS, SHARED]) {
    const consumerSource = source(relativePath);
    const residue = ACTOR_ORDER_LABELS.filter((label) => consumerSource.includes(`"${label}"`));
    assert.deepEqual(residue, [], `${relativePath} duplicates Actor tuple meaning: ${residue.join(", ")}`);
  }
});

test("platform solver adapters contain no Allocator pricing or objective meaning", () => {
  for (const relativePath of ADAPTERS.slice(0, 2)) {
    const adapterSource = source(relativePath);
    const residue = ALLOCATOR_POLICY_TOKENS.filter((token) => adapterSource.includes(token));
    assert.deepEqual(residue, [], `${relativePath} still owns Allocator policy: ${residue.join(", ")}`);
  }
});

test("Allocator returns solver effects while command glue owns dispatch", () => {
  const allocatorSource = source(ALLOCATOR_BUDGET_FIT);
  for (const forbidden of ["solverAdapter", "createSolverPort", "adapterHandlesDomain", ".solve("]) {
    assert.equal(
      allocatorSource.includes(forbidden),
      false,
      `${ALLOCATOR_BUDGET_FIT} executes solver capability ${forbidden} inside the persona`,
    );
  }
  assert.ok(allocatorSource.includes('kind: "solver_request"'));

  const hostSource = source(SOLVER_HOST);
  assert.ok(hostSource.includes("dispatchEffect"), "command glue no longer dispatches the effect");
  assert.ok(hostSource.includes("createSolverPort"), "command glue bypasses the solver port");
});

// ## TODO: Test Permutations
// - a forbidden policy token in a comment still fails: stale architectural claims are residue too
// - a new Actor order label requires updating the sole-source inventory before it can land
// - an adapter invocation hidden behind an aliased local name inside the Allocator still fails
