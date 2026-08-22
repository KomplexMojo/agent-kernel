/**
 * Real Z3 adapter for the actor_action_selection constraint domain.
 *
 * Candidate actions are produced and legality-filtered by the Actor persona.
 * This adapter only ranks those candidates with a deterministic Optimize
 * objective; it does not duplicate range, resource, or collision policy.
 *
 * Deliberate duplicate of packages/adapters-cli/src/adapters/z3/index.js, not
 * a shared import: this repo has no internal package.json dependency edges
 * (every cross-package reference is relative-path only, by convention), and
 * each adapter package already owns its own solver implementation
 * (adapters-test's stand-in, adapters-cli's fixture stub, adapters-web's own
 * createWebSolverAdapter). An adapters-web -> adapters-cli relative import
 * would be a lateral adapter-to-adapter dependency the architecture does not
 * sanction. Keep the two files in sync by hand until/unless a shared adapter
 * package is introduced.
 */

import { init } from "z3-solver";

const RUNTIME_DECISION_CONTRACT = "runtime-decision-v1";

const PRIORITY_WEIGHTS = Object.freeze({
  attack: 100,
  move_toward_hostile: 80,
  move_toward_exit: 50,
  move_fallback: 20,
  wait: 10,
  no_match: 0,
});

let sharedZ3Promise;

function getSharedZ3() {
  sharedZ3Promise ||= init();
  return sharedZ3Promise;
}

function chebyshevDistance(a, b) {
  if (!a || !b) return null;
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function movesCloserTo(candidate, origin, targets) {
  if (candidate?.action?.kind !== "move") return false;
  const destination = candidate.action.params?.to;
  if (!destination || !origin) return false;
  return targets.some((target) => {
    const before = chebyshevDistance(origin, target);
    const after = chebyshevDistance(destination, target);
    return before !== null && after !== null && after < before;
  });
}

/**
 * Whether the Actor persona ruled this visible actor an enemy.
 *
 * ⚠️ **Absent means HOSTILE, and the direction of that default is load-bearing.**
 * Only `hostile === false` is an ally. Every envelope built before hostility was
 * threaded carries no such field, and a fixture or an older run must keep
 * behaving as it did rather than quietly pacifying: an adapter that read a
 * missing flag as "allied" would stop pursuing anyone at all, in every one of
 * them, while every ally-targeting test still passed.
 *
 * This adapter does NOT compare roles. Which roles are allied is the Actor
 * persona's ruling (`rolesAreAllied`, `personas/actor/controller.js`), including
 * a fail-safe that two MISSING roles must not compare equal. Re-deriving it here
 * would make this file a second allegiance authority, free to drift from the
 * first.
 */
function isHostile(visibleActor) {
  return visibleActor?.hostile !== false;
}

function scoreCandidate(candidate, envelope) {
  if (candidate?.action?.kind === "attack") {
    return { score: PRIORITY_WEIGHTS.attack, ruleId: "attack" };
  }

  const actorPosition = envelope.actor?.position;
  // Allies are excluded before the distance test, not after: `visibleActors` is
  // everyone this actor perceives, and treating the whole list as enemies is
  // what sent delvers chasing their own delvers on this path.
  const visiblePositions = Array.isArray(envelope.visibleActors)
    ? envelope.visibleActors.filter(isHostile).map((actor) => actor?.position).filter(Boolean)
    : [];
  if (movesCloserTo(candidate, actorPosition, visiblePositions)) {
    return {
      score: PRIORITY_WEIGHTS.move_toward_hostile,
      ruleId: "move_toward_hostile",
    };
  }

  const exit = envelope.objectives?.exit;
  if (exit && movesCloserTo(candidate, actorPosition, [exit])) {
    return { score: PRIORITY_WEIGHTS.move_toward_exit, ruleId: "move_toward_exit" };
  }

  if (candidate?.action?.kind === "move") {
    return { score: PRIORITY_WEIGHTS.move_fallback, ruleId: "move_fallback" };
  }
  if (candidate?.action?.kind === "wait") {
    return { score: PRIORITY_WEIGHTS.wait, ruleId: "wait" };
  }
  return { score: PRIORITY_WEIGHTS.no_match, ruleId: "no_match" };
}

function validateEnvelope(envelope) {
  if (!envelope || envelope.contract !== RUNTIME_DECISION_CONTRACT) {
    return "z3_missing_runtime_decision_envelope";
  }
  if (!Array.isArray(envelope.candidateActions)) {
    return "z3_missing_candidate_actions";
  }
  if (envelope.candidateActions.some((candidate) => (
    !candidate
    || typeof candidate.id !== "string"
    || candidate.id.length === 0
    || !candidate.action
    || typeof candidate.action !== "object"
  ))) {
    return "z3_invalid_candidate_action";
  }
  return null;
}

/**
 * @param {{ init?: typeof init }} [options]
 * @returns {{
 *   solve: (request: object) => Promise<object>,
 *   kind: "z3-real",
 *   capabilities: { domains: string[], deterministic: true }
 * }}
 */
export function createRealZ3SolverAdapter(options = {}) {
  const getZ3 = typeof options.init === "function"
    ? (() => {
        let injectedZ3Promise;
        return () => {
          injectedZ3Promise ||= options.init();
          return injectedZ3Promise;
        };
      })()
    : getSharedZ3;

  async function solve(request) {
    try {
      const envelope = request?.problem?.data;
      const validationError = validateEnvelope(envelope);
      if (validationError) {
        return { status: "error", reason: validationError };
      }

      const candidates = envelope.candidateActions;
      if (candidates.length === 0) {
        return { status: "unsat", reason: "z3_no_candidates" };
      }

      const scored = candidates.map((candidate, index) => ({
        candidate,
        index,
        ...scoreCandidate(candidate, envelope),
      }));

      const { Context } = await getZ3();
      const context = new Context("actor_action_selection");
      const { Bool, If, Optimize, Sum, isTrue } = context;
      const selected = candidates.map((_, index) => (
        Bool.const(`selected_${String(index).padStart(6, "0")}`)
      ));
      const optimizer = new Optimize();

      optimizer.add(Sum(...selected.map((variable) => If(variable, 1, 0))).eq(1));

      // Scaling makes the declared priority dominant. The decreasing bonus
      // makes candidate input order a unique, deterministic tie-break before
      // Z3 solves, rather than relying on its choice among equal optima.
      const tieScale = candidates.length + 1;
      const objective = Sum(...selected.map((variable, index) => {
        const coefficient = (scored[index].score * tieScale) + (candidates.length - index);
        return If(variable, coefficient, 0);
      }));
      optimizer.maximize(objective);

      const status = await optimizer.check();
      if (status === "unsat") {
        return { status: "unsat", reason: "z3_no_satisfying_assignment" };
      }
      if (status !== "sat") {
        // "unknown" is a real Z3 outcome (e.g. resource limits) but is not one of
        // CONSTRAINT_RESULT_STATUS's four values — normalize to "error" so this
        // adapter never returns a status the shared conformance suite would reject.
        return {
          status: "error",
          reason: optimizer.reasonUnknown() || "z3_optimize_unknown",
        };
      }

      const model = optimizer.model();
      const selectedIndex = selected.findIndex((variable) => isTrue(model.eval(variable, true)));
      if (selectedIndex < 0 || selectedIndex >= candidates.length) {
        return { status: "error", reason: "z3_selected_action_missing" };
      }

      const winner = scored[selectedIndex];
      const rankedCandidates = scored
        .map(({ candidate, index, score, ruleId }) => ({
          candidateActionId: candidate.id,
          score,
          ruleId,
          index,
        }))
        .sort((a, b) => (b.score - a.score) || (a.index - b.index))
        .map(({ index: _index, ...candidate }) => candidate);

      return {
        status: "fulfilled",
        model: {
          contract: RUNTIME_DECISION_CONTRACT,
          decisionKind: envelope.decisionKind || "next_move",
          selectedActionId: winner.candidate.id,
          confidence: winner.score / PRIORITY_WEIGHTS.attack,
          rationaleTags: [winner.ruleId],
          rankedCandidates,
        },
      };
    } catch (error) {
      return {
        status: "error",
        reason: "z3_optimize_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    solve,
    kind: "z3-real",
    capabilities: {
      domains: ["actor_action_selection"],
      deterministic: true,
    },
  };
}
