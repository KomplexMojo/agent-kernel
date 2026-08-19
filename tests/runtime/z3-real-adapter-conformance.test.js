/**
 * Z.5 — the real Z3 adapter for actor_action_selection.
 *
 * Written before the adapter exists, per the repo's own working rule (tests before
 * production code). This is the RED baseline for Z.5: every test here fails today
 * because `packages/adapters-cli/src/adapters/z3/index.js` does not exist. Codex's
 * job tomorrow is to make it exist and turn this green — nothing more, nothing less.
 *
 * Scope is deliberately narrow, matching the Z.1 verdict: actor_action_selection
 * only, the single highest-value adopted site. Allocator budget-fit and
 * Configurator satisfiability are NOT this adapter's job.
 *
 * What this file does NOT decide (flagged, not assumed — see `~/vault/plans/active/Plan.md`
 * "## Z.5"): whether the adapter must independently re-verify candidate legality
 * (range/mana/reserved-tile) as Z3 constraints, or whether `candidateActions` is
 * already legal-only and Z3's job is purely optimization over priority. The tests
 * below only exercise the uncontroversial layer: conformance, and a ranking
 * preference already true of the JS stand-in it replaces.
 */
"use strict";

const assert = require("node:assert/strict");

async function loadConformance() {
  return import("../../packages/runtime/src/ports/solver-conformance.js");
}

async function loadAdapter() {
  return import("../../packages/adapters-cli/src/adapters/z3/index.js");
}

// ---------------------------------------------------------------------------
// Conformance — the Z.3 gate every solver adapter must clear before a run
// touches it. This is the same suite the JS stand-in already passes; a real
// Z3 binding starts from zero credit, not from the stand-in's track record.
// ---------------------------------------------------------------------------

test("the real Z3 adapter passes the shared conformance suite", async () => {
  const { checkSolverConformance } = await loadConformance();
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const result = await checkSolverConformance(createRealZ3SolverAdapter());
  assert.equal(result.ok, true, result.failures.join(" | "));
});

test("declares actor_action_selection only, same domain as the stand-in it replaces", async () => {
  const { describeSolverCapabilities } = await loadConformance();
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const caps = describeSolverCapabilities(createRealZ3SolverAdapter());
  assert.deepEqual(
    caps.domains,
    ["actor_action_selection"],
    "Allocator budget-fit and Configurator satisfiability are separate milestones — an adapter "
      + "that silently answered them would be a confidently wrong decision, not a convenience",
  );
  assert.equal(caps.deterministic, true);
});

// ---------------------------------------------------------------------------
// Behavior — the minimum a Z3-backed ranking must reproduce from the JS
// stand-in it replaces, using the REAL runtime-decision-v1 envelope shape
// the Actor actually sends (`personas/actor/controller.js:566-587`), not the
// abstract variables/constraints shape (which this domain does not use today).
// ---------------------------------------------------------------------------

test("picks attack over move-away when a legal attack candidate exists", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const adapter = createRealZ3SolverAdapter();
  const envelope = {
    contract: "runtime-decision-v1",
    decisionKind: "next_move",
    tick: 3,
    actor: { id: "actor_1", position: { x: 5, y: 5 } },
    visibleActors: [{ id: "hostile_1", position: { x: 6, y: 5 } }],
    candidateActions: [
      {
        id: "attack_hostile_1",
        action: { kind: "attack", actorId: "actor_1", tick: 3, params: { targetId: "hostile_1" } },
      },
      {
        id: "move_away",
        action: { kind: "move", actorId: "actor_1", tick: 3, params: { to: { x: 4, y: 5 } } },
      },
      { id: "wait_here", action: { kind: "wait", actorId: "actor_1", tick: 3, params: {} } },
    ],
    objectives: { primary: "resolve_visible_contacts" },
  };
  const result = await adapter.solve({ problem: { data: envelope } });
  assert.equal(result.status, "fulfilled", JSON.stringify(result));
  assert.equal(result.model?.selectedActionId, "attack_hostile_1");
});

test("selected action always names a real candidate id — resolveActionFromSolverResult's own requirement", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const { resolveActionFromSolverResult } = await import(
    "../../packages/runtime/src/personas/_shared/runtime-decision.mts"
  );
  const adapter = createRealZ3SolverAdapter();
  const envelope = {
    contract: "runtime-decision-v1",
    decisionKind: "next_move",
    tick: 1,
    actor: { id: "actor_1", position: { x: 0, y: 0 } },
    visibleActors: [],
    candidateActions: [
      { id: "wait_here", action: { kind: "wait", actorId: "actor_1", tick: 1, params: {} } },
    ],
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

// ## TODO: Test Permutations
//
// - a mana-insufficient cast_affinity candidate is never selected even when it would
//   otherwise score highest (needs the legality-scope decision resolved first)
// - two candidates that score identically: fixed variable order picks the SAME one on
//   every run — this is the determinism check applied to an actual tie, not just the
//   whole-envelope repeat the conformance suite already covers
// - empty `candidateActions` -> "unsat" with a `reason`, never a thrown error
// - z3-solver internal timeout/OOM surfaces as a shaped "error" result, never hangs
//   the tick and never rejects past the adapter boundary
// - `visibleActors` containing a hostile OUT of any candidate's range does not by
//   itself force an attack candidate to outrank a move-toward candidate
// - replay determinism end-to-end: same envelope solved twice in the same process
//   AND across two fresh process invocations produces byte-identical `model`
