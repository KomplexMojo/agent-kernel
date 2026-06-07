/**
 * M8 — Z3-style solver adapter (deterministic, fixture-free).
 *
 * This adapter satisfies the solver port contract (`adapter.solve(request)`)
 * for complex-motivation runtime-decision envelopes. It does NOT bind to an
 * actual Z3 binary — instead, it expresses the same kind of constraint-based
 * reasoning Z3 would do (priority weighting, feasibility checks) in pure JS so
 * tests are deterministic and do not require external services.
 *
 * Architecture: lives in `adapters-test`, never in `runtime` or `core-ts`.
 * The runtime calls it through `createSolverPort(adapter)`.
 *
 * Decision priority (matches the M1 contract for sandbox scenarios):
 *   1. attack       — close the loop on combat when adjacent to a hostile
 *   2. move toward hostile  — close distance to attack range
 *   3. move toward exit     — fall back to exploration
 *   4. wait         — last resort
 *
 * Returns `{ status: "fulfilled", model: { selectedActionId, ... } }` when a
 * candidate matches a rule, `{ status: "unsat" }` if no candidates, and forwards
 * any forced status from the request options for testability.
 */

const RUNTIME_DECISION_CONTRACT = "runtime-decision-v1";

const PRIORITY_RULES = Object.freeze([
  // (rule_id, predicate(candidate, envelope) -> boolean, weight)
  { id: "attack_adjacent", weight: 100, match: (c) => c.action?.kind === "attack" },
  { id: "move_toward_hostile", weight: 80, match: (c, env) => {
      if (c.action?.kind !== "move") return false;
      const visible = Array.isArray(env?.visibleActors) ? env.visibleActors : [];
      if (visible.length === 0) return false;
      const to = c.action.params?.to;
      if (!to) return false;
      // True if this move reduces Chebyshev distance to any visible actor
      const selfPos = env?.actor?.position;
      if (!selfPos) return false;
      for (const v of visible) {
        if (!v?.position) continue;
        const beforeDist = Math.max(
          Math.abs(v.position.x - selfPos.x),
          Math.abs(v.position.y - selfPos.y),
        );
        const afterDist = Math.max(
          Math.abs(v.position.x - to.x),
          Math.abs(v.position.y - to.y),
        );
        if (afterDist < beforeDist) return true;
      }
      return false;
    } },
  { id: "move_toward_exit", weight: 50, match: (c, env) => {
      if (c.action?.kind !== "move") return false;
      const exit = env?.objectives?.exit;
      if (!exit) return false;
      const to = c.action.params?.to;
      const selfPos = env?.actor?.position;
      if (!to || !selfPos) return false;
      const beforeDist = Math.max(Math.abs(exit.x - selfPos.x), Math.abs(exit.y - selfPos.y));
      const afterDist = Math.max(Math.abs(exit.x - to.x), Math.abs(exit.y - to.y));
      return afterDist < beforeDist;
    } },
  { id: "move_fallback", weight: 20, match: (c) => c.action?.kind === "move" },
  { id: "wait", weight: 10, match: (c) => c.action?.kind === "wait" },
]);

function scoreCandidate(candidate, envelope) {
  for (const rule of PRIORITY_RULES) {
    if (rule.match(candidate, envelope)) {
      return { score: rule.weight, ruleId: rule.id };
    }
  }
  return { score: 0, ruleId: "no_match" };
}

function pickBest(envelope) {
  const candidates = Array.isArray(envelope?.candidateActions) ? envelope.candidateActions : [];
  if (candidates.length === 0) return null;
  let best = null;
  const ranked = [];
  for (const c of candidates) {
    const scored = scoreCandidate(c, envelope);
    ranked.push({ candidateActionId: c.id, score: scored.score, ruleId: scored.ruleId });
    if (!best || scored.score > best.score) {
      best = { candidate: c, score: scored.score, ruleId: scored.ruleId };
    }
  }
  // Sort ranked descending for stable diagnostics
  ranked.sort((a, b) => b.score - a.score);
  return { best, ranked };
}

/**
 * Create a Z3-style solver adapter.
 *
 * @param {object} [options]
 * @param {string} [options.forceStatus] - For testing: forces "deferred"|"unsat"|"error"
 * @param {boolean} [options.throwOnSolve] - For testing: throws to exercise port error handling
 * @returns {{ solve: (request: object) => Promise<object> }}
 */
export function createZ3SolverAdapter(options = {}) {
  const { forceStatus = null, throwOnSolve = false } = options;

  async function solve(request) {
    if (throwOnSolve) {
      throw new Error("z3_adapter_simulated_failure");
    }
    if (forceStatus === "deferred") {
      return { status: "deferred", reason: "z3_forced_deferred" };
    }
    if (forceStatus === "unsat") {
      return { status: "unsat", reason: "z3_no_satisfying_assignment" };
    }
    if (forceStatus === "error") {
      return { status: "error", reason: "z3_forced_error" };
    }

    // Extract envelope
    const envelope = request?.problem?.data;
    if (!envelope || envelope.contract !== RUNTIME_DECISION_CONTRACT) {
      return {
        status: "error",
        reason: "z3_missing_runtime_decision_envelope",
      };
    }

    const result = pickBest(envelope);
    if (!result || !result.best) {
      return {
        status: "unsat",
        reason: "z3_no_candidates",
      };
    }

    // Build response model that resolveActionFromSolverResult consumes
    return {
      status: "fulfilled",
      model: {
        contract: RUNTIME_DECISION_CONTRACT,
        decisionKind: envelope.decisionKind || "next_move",
        selectedActionId: result.best.candidate.id,
        confidence: result.best.score / 100,
        rationaleTags: [result.best.ruleId],
        rankedCandidates: result.ranked,
      },
    };
  }

  return { solve, kind: "z3" };
}
