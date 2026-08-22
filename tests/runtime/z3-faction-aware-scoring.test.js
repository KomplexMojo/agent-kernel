/**
 * The Z3 adapter must not score closing on an ALLY as pursuing a hostile.
 *
 * THE DEFECT THESE TESTS FORBID (live on `main` when they were written).
 * DS.2 made hostility role-based — `resolveNearestHostile` skips allies, so the
 * deterministic path stopped sending delvers after their own delvers. The Z3
 * path never got the same treatment: `scoreCandidate` maps EVERY entry of
 * `envelope.visibleActors` into the `move_toward_hostile` rule with no faction
 * check at all. So a run routed through the solver still closes on allies, and
 * with the ally nearer than the enemy it prefers the ally outright.
 *
 * ⇒ *A rule enforced on one path and not its neighbour. That reads as enforced
 * — the persona suite is green, the fix is committed, and the bug is still
 * reachable in a run — which is the defect class this repo keeps re-finding.*
 *
 * WHERE THE RULE LIVES, AND WHY NOT HERE. The adapter does NOT compare roles.
 * Hostility is domain semantics owned by the Actor persona (`rolesAreAllied`,
 * `personas/actor/controller.js`), including a fail-safe that is easy to get
 * backwards: two MISSING roles must not compare equal, or every actor becomes
 * everyone's ally and combat stops game-wide. Re-deriving that inside an adapter
 * would be a second allegiance authority, quietly divergent from the first —
 * the F10 defect this codebase has already paid for once. The persona stamps
 * `hostile` on each visible actor; the adapter consumes it and nothing else.
 *
 * ⚠️ **ABSENT MEANS HOSTILE, and one test below exists only to forbid the
 * opposite.** An envelope with no `hostile` field must behave exactly as it does
 * today. Defaulting an unknown to "allied" would pacify every run whose envelope
 * predates this change — and would leave every ally-targeting assertion here
 * green while doing it.
 */
"use strict";

const assert = require("node:assert/strict");

async function loadAdapter() {
  return import("../../packages/adapters-cli/src/adapters/z3/index.js");
}

/**
 * A delver at (5,5) with an ally 2 tiles WEST and a warden 4 tiles EAST.
 *
 * ⚠️ **The two are on OPPOSITE SIDES on purpose, and the test is worthless
 * otherwise.** Put them both east and the ally-ward move closes on the warden
 * as well, so it scores `move_toward_hostile` for a legitimate reason and the
 * test passes without the rule ever being consulted. Each move here approaches
 * exactly one of them and retreats from the other.
 *
 * ⚠️ The ally-ward move is deliberately FIRST in `candidateActions`. The
 * adapter's tie-break is candidate input order, so with both moves scored
 * `move_toward_hostile` (the pre-fix behavior) the ally move wins outright —
 * which is what makes this red before the fix rather than accidentally green.
 */
function allyAndEnemyBoard() {
  return {
    contract: "runtime-decision-v1",
    decisionKind: "next_move",
    tick: 4,
    actor: { id: "delver_a", role: "delver", position: { x: 5, y: 5 } },
    visibleActors: [
      // The ally is the NEARER of the two — the arrangement that made the old
      // rule pick wrong, rather than one where it happened to pick right.
      { id: "delver_b", role: "delver", position: { x: 3, y: 5 }, hostile: false },
      { id: "warden_1", role: "warden", position: { x: 9, y: 5 }, hostile: true },
    ],
    candidateActions: [
      {
        id: "move_toward_ally",
        action: { kind: "move", actorId: "delver_a", tick: 4, params: { to: { x: 4, y: 5 } } },
      },
      {
        id: "move_toward_warden",
        action: { kind: "move", actorId: "delver_a", tick: 4, params: { to: { x: 6, y: 5 } } },
      },
      { id: "wait_here", action: { kind: "wait", actorId: "delver_a", tick: 4, params: {} } },
    ],
    objectives: { primary: "resolve_visible_contacts" },
  };
}

function rankOf(result, candidateActionId) {
  const ranked = result?.model?.rankedCandidates || [];
  return ranked.find((entry) => entry.candidateActionId === candidateActionId);
}

// ---------------------------------------------------------------------------
// The fix itself: an ally is not a hostile, so closing on one is not pursuit.
// ---------------------------------------------------------------------------

test("the solver never treats closing on an ally as pursuing a hostile", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const result = await createRealZ3SolverAdapter().solve({
    problem: { data: allyAndEnemyBoard() },
  });

  assert.equal(result.status, "fulfilled", JSON.stringify(result));
  const allyMove = rankOf(result, "move_toward_ally");
  assert.notEqual(
    allyMove?.ruleId,
    "move_toward_hostile",
    "the adapter scored a move toward a FELLOW DELVER as hostile pursuit. `visibleActors` is "
      + "every actor this one can see, allies included — the rule must read each entry's "
      + "hostility rather than assuming the whole list is enemies.",
  );
});

test("with an ally nearer than the warden, the solver still closes on the warden", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const result = await createRealZ3SolverAdapter().solve({
    problem: { data: allyAndEnemyBoard() },
  });

  assert.equal(result.status, "fulfilled", JSON.stringify(result));
  assert.equal(
    result.model?.selectedActionId,
    "move_toward_warden",
    "'does not chase the ally' is trivially satisfied by an adapter that picks `wait` for "
      + "everything, so this pairs with the test above: the delver must still engage the actual "
      + "enemy. The ally move is listed first precisely so a faction-blind ranking picks it.",
  );
  assert.equal(rankOf(result, "move_toward_warden")?.ruleId, "move_toward_hostile");
});

test("with only allies visible, advancing to the exit beats closing on one of them", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const envelope = {
    contract: "runtime-decision-v1",
    decisionKind: "next_move",
    tick: 7,
    actor: { id: "delver_a", role: "delver", position: { x: 2, y: 2 } },
    visibleActors: [
      { id: "delver_b", role: "delver", position: { x: 5, y: 2 }, hostile: false },
    ],
    candidateActions: [
      // Genuinely closes on the ally (Chebyshev 3 -> 2), so a faction-blind
      // ranking scores it `move_toward_hostile` (80) and it beats the exit (50).
      {
        id: "move_toward_ally",
        action: { kind: "move", actorId: "delver_a", tick: 7, params: { to: { x: 3, y: 2 } } },
      },
      {
        id: "move_toward_exit",
        action: { kind: "move", actorId: "delver_a", tick: 7, params: { to: { x: 1, y: 2 } } },
      },
    ],
    objectives: { primary: "advance_to_exit", exit: { x: 0, y: 2 } },
  };

  const result = await createRealZ3SolverAdapter().solve({ problem: { data: envelope } });

  assert.equal(result.status, "fulfilled", JSON.stringify(result));
  assert.equal(
    result.model?.selectedActionId,
    "move_toward_exit",
    "a party of allies with no enemy in sight must make progress. Scoring ally-pursuit at "
      + "`move_toward_hostile` (80) outranks `move_toward_exit` (50), so a faction-blind adapter "
      + "leaves a delver orbiting its own teammate instead of advancing.",
  );
});

// ---------------------------------------------------------------------------
// The fail-safe. These forbid a fix that pacifies the game by default.
// ---------------------------------------------------------------------------

test("a visible actor with NO hostility field is still pursued — absent must never mean allied", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const envelope = {
    contract: "runtime-decision-v1",
    decisionKind: "next_move",
    tick: 2,
    actor: { id: "actor_1", position: { x: 0, y: 0 } },
    // No `hostile`, no `role` — the shape every envelope had before this change.
    visibleActors: [{ id: "unknown_1", position: { x: 4, y: 0 } }],
    candidateActions: [
      {
        id: "move_toward_unknown",
        action: { kind: "move", actorId: "actor_1", tick: 2, params: { to: { x: 1, y: 0 } } },
      },
      { id: "wait_here", action: { kind: "wait", actorId: "actor_1", tick: 2, params: {} } },
    ],
  };

  const result = await createRealZ3SolverAdapter().solve({ problem: { data: envelope } });

  assert.equal(result.status, "fulfilled", JSON.stringify(result));
  assert.equal(
    rankOf(result, "move_toward_unknown")?.ruleId,
    "move_toward_hostile",
    "an unlabelled actor was treated as an ally. Every envelope built before this change carries "
      + "no hostility field at all, so defaulting absent to 'allied' would stop the solver "
      + "pursuing anyone in any of them — a game-wide ceasefire that every ally-targeting test "
      + "in this file would still call correct.",
  );
});

test("an explicit hostile: true is pursued even when a role would suggest otherwise", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const envelope = {
    contract: "runtime-decision-v1",
    decisionKind: "next_move",
    tick: 9,
    actor: { id: "delver_a", role: "delver", position: { x: 0, y: 0 } },
    // Same role as the observer, but the persona has ruled it hostile. The
    // adapter consumes that ruling; it does not second-guess it by comparing
    // roles itself, because it is not the authority on what a role means.
    visibleActors: [{ id: "delver_turncoat", role: "delver", position: { x: 4, y: 0 }, hostile: true }],
    candidateActions: [
      {
        id: "move_toward_turncoat",
        action: { kind: "move", actorId: "delver_a", tick: 9, params: { to: { x: 1, y: 0 } } },
      },
      { id: "wait_here", action: { kind: "wait", actorId: "delver_a", tick: 9, params: {} } },
    ],
  };

  const result = await createRealZ3SolverAdapter().solve({ problem: { data: envelope } });

  assert.equal(result.status, "fulfilled", JSON.stringify(result));
  assert.equal(
    rankOf(result, "move_toward_turncoat")?.ruleId,
    "move_toward_hostile",
    "the adapter must read the hostility the persona computed, not re-derive it from `role`. "
      + "Re-deriving would make the adapter a second allegiance authority, free to disagree with "
      + "the first.",
  );
});

test("attack still outranks everything, ally or not — this narrows pursuit, it does not change priority", async () => {
  const { createRealZ3SolverAdapter } = await loadAdapter();
  const envelope = {
    contract: "runtime-decision-v1",
    decisionKind: "next_move",
    tick: 5,
    actor: { id: "delver_a", role: "delver", position: { x: 5, y: 5 } },
    visibleActors: [
      { id: "delver_b", role: "delver", position: { x: 6, y: 5 }, hostile: false },
      { id: "warden_1", role: "warden", position: { x: 4, y: 5 }, hostile: true },
    ],
    candidateActions: [
      {
        id: "move_toward_ally",
        action: { kind: "move", actorId: "delver_a", tick: 5, params: { to: { x: 6, y: 4 } } },
      },
      {
        id: "attack_warden",
        action: { kind: "attack", actorId: "delver_a", tick: 5, params: { targetId: "warden_1" } },
      },
    ],
  };

  const result = await createRealZ3SolverAdapter().solve({ problem: { data: envelope } });

  assert.equal(result.status, "fulfilled", JSON.stringify(result));
  assert.equal(result.model?.selectedActionId, "attack_warden");
});

// ## TODO: Test Permutations
// - two allies and two wardens visible: the nearer WARDEN is closed on, not the nearer ally
// - every visible actor allied and no exit in the envelope: falls to move_fallback, never wait-only
// - `hostile: false` on ALL entries plus an attack candidate: attack still wins
// - hostility flag present but not a boolean (string "false", 0, null): treated as hostile
// - the same envelope solved twice: identical selectedActionId and rankedCandidates (replay safety)
// - ranked order is stable when an ally and an enemy tie on distance
