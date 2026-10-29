/**
 * A solver adapter that answers from answers recorded where z3 ran (#557), for the phone app,
 * which has no solver. `answers` is `[{ key, result }]` as `AK_SOLVER_RECORD` wrote them. A
 * question with no recorded answer is deferred, so the persona's own fallback decides it, and
 * the build's solver decisions say so. Deterministic: the same answers give the same build.
 */
import { solverAnswerKey } from "../../../../runtime/src/ports/solver.js";
import { CONSTRAINT_DOMAINS } from "../../../../runtime/src/contracts/constraint-problem.js";

export function createRecordedSolverAdapter(answers = []) {
  const byKey = new Map((Array.isArray(answers) ? answers : []).map((entry) => [entry.key, entry.result]));
  return {
    kind: "recorded",
    capabilities: {
      domains: [CONSTRAINT_DOMAINS.CONFIGURATOR_SATISFIABILITY, CONSTRAINT_DOMAINS.ALLOCATOR_BUDGET_FIT],
      deterministic: true,
    },
    async solve(request) {
      const key = solverAnswerKey(request);
      return byKey.has(key) ? structuredClone(byKey.get(key)) : { status: "deferred", reason: "no_recorded_answer" };
    },
  };
}
